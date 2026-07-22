import { WaniKaniApiError, WaniKaniClient } from '../api/WaniKaniClient';
import { LessonStartPayload, ReviewProgressPayload, StudyMaterialPayload } from '../api/types';
import {
  AppDatabase,
  clearRemoteCache,
  getSyncCursors,
  putAssignments,
  putLevelProgressions,
  putReviewStats,
  putStudyMaterials,
  putSubjects,
  putUser,
  putVoiceActors,
  restoreSubjectProgress,
  runExclusive,
  runInWriteTransaction,
  setSyncCursor,
  snapshotSubjectProgress,
} from '../db/database';
import { pruneOrphanLearningHistory } from '../study/reviewAttempts';
import { findBySubjectId, putStudyMaterialResource } from '../db/studyMaterialRepository';
import { classifySyncError, logSyncError, SyncErrorCategory } from '../db/errorLog';

export type SyncStep =
  | 'pending-progress'
  | 'pending-study-materials'
  | 'user'
  | 'subjects'
  | 'assignments'
  | 'study-materials'
  | 'level-progressions'
  | 'voice-actors'
  | 'review-statistics'
  | 'complete';

export class SyncError extends Error {
  readonly category: SyncErrorCategory;
  readonly isRetryable: boolean;

  constructor(message: string, category: SyncErrorCategory, isRetryable: boolean = true) {
    super(message);
    this.name = 'SyncError';
    this.category = category;
    this.isRetryable = isRetryable;
  }
}

export type SyncProgress = {
  step: SyncStep;
  label: string;
  completed: number;
  total: number;
};

export type SyncOptions = {
  db: AppDatabase;
  client: WaniKaniClient;
  onProgress?: (progress: SyncProgress) => void;
  onCheckpoint?: () => void | Promise<void>;
};

type SyncKind = 'pending' | 'incremental' | 'full';

type ProgressSubscriber = (progress: SyncProgress) => void;
type CheckpointSubscriber = () => void | Promise<void>;

let activeSync: Promise<void> | null = null;
let activeSyncKind: SyncKind | null = null;
let activeFullRefresh: Promise<void> | null = null;
// Subscribers for the in-flight sync. A caller that reuses a running sync is
// added here so its onProgress/onCheckpoint still fire, instead of silently
// dropping the progress/checkpoint updates it asked for. Each beginSync run
// captures its own arrays (assigned to these globals while it is the active
// run) so a superseding sync never fans out to a previous run's subscribers.
let activeProgressSubs: ProgressSubscriber[] = [];
let activeCheckpointSubs: CheckpointSubscriber[] = [];

const DOWNLOAD_REQUEST_RESERVE = 21;

/**
 * Adds a reusing caller's callbacks to the in-flight sync so progress and
 * checkpoint updates fan out to every caller, not just the one that started it.
 */
function subscribeToActiveSync(options: SyncOptions) {
  if (options.onProgress) {
    activeProgressSubs.push(options.onProgress);
  }
  if (options.onCheckpoint) {
    activeCheckpointSubs.push(options.onCheckpoint);
  }
}

/**
 * Registers a sync as the single in-flight sync. The tracking promise is
 * assigned synchronously (before `run()` yields) so concurrent callers in the
 * same tick observe it and never start a second clear/download. The `finally`
 * only clears state if it still points at this run, so a later sync that
 * supersedes this one is not torn down by this one's completion.
 *
 * `run` receives a fan-out copy of the options whose onProgress/onCheckpoint
 * broadcast to every current subscriber, so callers that join via
 * `subscribeToActiveSync` still receive updates.
 */
function beginSync(kind: SyncKind, options: SyncOptions, run: (fanout: SyncOptions) => Promise<void>): Promise<void> {
  const progressSubs: ProgressSubscriber[] = options.onProgress ? [options.onProgress] : [];
  const checkpointSubs: CheckpointSubscriber[] = options.onCheckpoint ? [options.onCheckpoint] : [];
  const fanout: SyncOptions = {
    db: options.db,
    client: options.client,
    onProgress: (progress) => {
      for (const sub of progressSubs) {
        sub(progress);
      }
    },
    onCheckpoint: async () => {
      for (const sub of checkpointSubs) {
        await sub();
      }
    },
  };

  const tracked: Promise<void> = run(fanout).finally(() => {
    if (activeSync === tracked) {
      activeSync = null;
      activeSyncKind = null;
      activeProgressSubs = [];
      activeCheckpointSubs = [];
    }
    if (activeFullRefresh === tracked) {
      activeFullRefresh = null;
    }
  });
  activeSync = tracked;
  activeSyncKind = kind;
  activeProgressSubs = progressSubs;
  activeCheckpointSubs = checkpointSubs;
  if (kind === 'full') {
    activeFullRefresh = tracked;
  }
  return tracked;
}

export function runIncrementalSync(options: SyncOptions): Promise<void> {
  // A full refresh supersedes an incremental sync; reuse it.
  if (activeFullRefresh) {
    subscribeToActiveSync(options);
    return activeFullRefresh;
  }
  // Another incremental sync already covers this request.
  if (activeSync && activeSyncKind === 'incremental') {
    subscribeToActiveSync(options);
    return activeSync;
  }
  // A pending-only sync does NOT include the remote download, so chain the
  // download after it rather than returning it (which would silently drop the
  // refresh the caller asked for).
  const prior = activeSync;
  return beginSync('incremental', options, async (fanout) => {
    if (prior) {
      await prior.catch(() => {});
    }
    await runPendingOnly(fanout, 'before-download');
    await runDownloadSync(fanout);
  });
}

export function runPendingSync(options: SyncOptions): Promise<void> {
  // Never reuse an in-flight pending-only sync: sendPending* SELECTs a batch
  // once, so writes queued after that SELECT would be stranded until a later
  // third flush. Chain a fresh drain after the prior sync instead (same
  // pattern already used when an incremental/full is active).
  const prior = activeSync;
  return beginSync('pending', options, async (fanout) => {
    if (prior) {
      await prior.catch(() => {});
    }
    await runPendingOnly(fanout, 'standalone');
  });
}

export async function hasPendingWrites(db: AppDatabase) {
  const row = await db.getFirstAsync<{ value: number }>(
    `SELECT
       (SELECT COUNT(*) FROM pending_progress) +
       (SELECT COUNT(*) FROM pending_study_materials) AS value`,
  );
  return (row?.value ?? 0) > 0;
}

async function runPendingOnly({ db, client, onProgress }: SyncOptions, mode: 'standalone' | 'before-download') {
  if (!(await hasPendingWrites(db))) {
    return;
  }

  const reserve = mode === 'before-download' ? DOWNLOAD_REQUEST_RESERVE : 0;
  const budget = Math.max(0, client.requestsRemainingInInterval - reserve);
  let remainingBudget = budget;

  try {
    onProgress?.({ step: 'pending-progress', label: 'Sending queued lesson and review progress', completed: 0, total: 2 });
    const sentProgress = await sendPendingProgress(db, client, remainingBudget);
    remainingBudget = Math.max(0, remainingBudget - sentProgress);
    onProgress?.({ step: 'pending-study-materials', label: 'Sending queued study material edits', completed: 1, total: 2 });
    await sendPendingStudyMaterials(db, client, remainingBudget);
    onProgress?.({ step: 'complete', label: 'Pending progress synced', completed: 2, total: 2 });
  } catch (error) {
    await logSyncError(db, error, 'pending_sync').catch(() => {});
    throw wrapSyncError(error);
  }
}

async function runDownloadSync({ db, client, onProgress, onCheckpoint }: SyncOptions) {
  const report = (step: SyncStep, label: string, completed: number, total: number) => {
    onProgress?.({ step, label, completed, total });
  };

  const total = 7;
  let completed = 0;
  let currentStep: SyncStep = 'user';

  try {
    const cursors = await getSyncCursors(db);

    report('user', 'Refreshing user profile', completed, total);
    currentStep = 'user';
    const user = await client.getUser();
    await putUser(db, user);
    completed += 1;

    report('subjects', 'Downloading subjects', completed, total);
    currentStep = 'subjects';
    const subjects = await client.getSubjects(cursors.subjects, (page) => {
      report('subjects', formatDownloadLabel('subjects', page.loaded, page.total), completed, total);
    });
    report('subjects', `Saving subjects (${subjects.items.length})`, completed, total);
    await putSubjects(db, subjects.items, (saved, subjectTotal) => {
      report('subjects', formatSaveLabel('subjects', saved, subjectTotal), completed, total);
    });
    await setSyncCursor(db, 'subjects', subjects.dataUpdatedAt);
    await onCheckpoint?.();
    completed += 1;

    report('assignments', 'Downloading assignments', completed, total);
    currentStep = 'assignments';
    const assignments = await client.getAssignments(cursors.assignments, (page) => {
      report('assignments', formatDownloadLabel('assignments', page.loaded, page.total), completed, total);
    });
    report('assignments', `Saving assignments (${assignments.items.length})`, completed, total);
    await putAssignments(db, assignments.items, (saved, assignmentTotal) => {
      report('assignments', formatSaveLabel('assignments', saved, assignmentTotal), completed, total);
    });
    await setSyncCursor(db, 'assignments', assignments.dataUpdatedAt);
    await onCheckpoint?.();
    completed += 1;

    report('study-materials', 'Downloading study materials', completed, total);
    currentStep = 'study-materials';
    const studyMaterials = await client.getStudyMaterials(cursors.study_materials, (page) => {
      report('study-materials', formatDownloadLabel('study materials', page.loaded, page.total), completed, total);
    });
    report('study-materials', `Saving study materials (${studyMaterials.items.length})`, completed, total);
    await putStudyMaterials(db, studyMaterials.items, (saved, studyMaterialTotal) => {
      report('study-materials', formatSaveLabel('study materials', saved, studyMaterialTotal), completed, total);
    });
    await setSyncCursor(db, 'study_materials', studyMaterials.dataUpdatedAt);
    await onCheckpoint?.();
    completed += 1;

    report('level-progressions', 'Downloading level progressions', completed, total);
    currentStep = 'level-progressions';
    const levelProgressions = await client.getLevelProgressions(cursors.level_progressions, (page) => {
      report('level-progressions', formatDownloadLabel('level progressions', page.loaded, page.total), completed, total);
    });
    await putLevelProgressions(db, levelProgressions.items, (saved, levelTotal) => {
      report('level-progressions', formatSaveLabel('level progressions', saved, levelTotal), completed, total);
    });
    await setSyncCursor(db, 'level_progressions', levelProgressions.dataUpdatedAt);
    await onCheckpoint?.();
    completed += 1;

    report('voice-actors', 'Downloading voice actors', completed, total);
    currentStep = 'voice-actors';
    const voiceActors = await client.getVoiceActors(cursors.voice_actors, (page) => {
      report('voice-actors', formatDownloadLabel('voice actors', page.loaded, page.total), completed, total);
    });
    await putVoiceActors(db, voiceActors.items, (saved, voiceActorTotal) => {
      report('voice-actors', formatSaveLabel('voice actors', saved, voiceActorTotal), completed, total);
    });
    await setSyncCursor(db, 'voice_actors', voiceActors.dataUpdatedAt);
    await onCheckpoint?.();
    completed += 1;

    report('review-statistics', 'Downloading review statistics', completed, total);
    currentStep = 'review-statistics';
    const reviewStats = await client.getReviewStatistics(cursors.review_stats, (page) => {
      report('review-statistics', formatDownloadLabel('review statistics', page.loaded, page.total), completed, total);
    });
    report('review-statistics', `Saving review statistics (${reviewStats.items.length})`, completed, total);
    await putReviewStats(db, reviewStats.items, (saved, reviewStatTotal) => {
      report('review-statistics', formatSaveLabel('review statistics', saved, reviewStatTotal), completed, total);
    });
    await setSyncCursor(db, 'review_stats', reviewStats.dataUpdatedAt);
    await onCheckpoint?.();

    report('complete', 'Sync complete', total, total);
  } catch (error) {
    await logSyncError(db, error, `sync_step:${currentStep}`).catch(() => {});
    throw wrapSyncError(error);
  }
}

function formatDownloadLabel(label: string, loaded: number, total?: number) {
  return total ? `Downloading ${label} (${loaded}/${total})` : `Downloading ${label} (${loaded})`;
}

function formatSaveLabel(label: string, saved: number, total: number) {
  return `Saving ${label} (${saved}/${total})`;
}

function wrapSyncError(error: unknown): SyncError {
  if (error instanceof SyncError) return error;
  const category = classifySyncError(error);
  const message = error instanceof Error ? error.message : String(error);
  return new SyncError(message, category, category !== 'auth');
}

export function isSyncAuthError(error: unknown): boolean {
  return error instanceof SyncError && error.category === 'auth';
}

export async function runFullRefresh(options: SyncOptions): Promise<void> {
  // Coalesce concurrent full-refresh requests.
  if (activeFullRefresh) {
    subscribeToActiveSync(options);
    return activeFullRefresh;
  }

  // Capture whatever sync is currently in flight and wait for it inside the
  // tracked body so the cache clear never races a download already writing.
  const prior = activeSync;
  return beginSync('full', options, async (fanout) => {
    if (prior) {
      await prior.catch(() => {});
    }
    await runPendingOnly(fanout, 'standalone');
    if (await hasPendingWrites(fanout.db)) {
      throw new SyncError('Full refresh postponed until queued writes are synced.', 'rate-limit', true);
    }
    // subject_progress holds local-only review history (recent mistakes,
    // leeches) that the download never repopulates. clearRemoteCache leaves
    // those rows in place (FK off while subjects are wiped) so a failed
    // download cannot erase history. After a successful re-download, restore
    // re-upserts the snapshot and prunes orphans whose subjects are gone.
    const progressSnapshot = await snapshotSubjectProgress(fanout.db);
    await clearRemoteCache(fanout.db);
    await runDownloadSync(fanout);
    await restoreSubjectProgress(fanout.db, progressSnapshot);
    await pruneOrphanLearningHistory(fanout.db);
  });
}

async function sendPendingProgress(db: AppDatabase, client: WaniKaniClient, limit: number) {
  if (limit <= 0) {
    return 0;
  }

  const rows = await db.getAllAsync<{ id: string; kind: string; payload: string }>(
    'SELECT id, kind, payload FROM pending_progress ORDER BY created_at ASC LIMIT ?',
    limit,
  );

  let sent = 0;
  for (const row of rows) {
    try {
      if (row.kind === 'lesson-start') {
        await client.startAssignment(JSON.parse(row.payload) as LessonStartPayload);
      } else if (row.kind === 'review') {
        await client.createReview(JSON.parse(row.payload) as ReviewProgressPayload);
      } else {
        // Unknown kinds must not be deleted: that would silently drop data if a
        // future write path introduces a new kind or a row is corrupt.
        await runExclusive(() =>
          db.runAsync(
            'UPDATE pending_progress SET attempts = attempts + 1, last_error = ? WHERE id = ?',
            `unknown pending_progress kind: ${row.kind}`,
            row.id,
          ),
        );
        await logSyncError(db, new Error(`unknown pending_progress kind: ${row.kind}`), 'pending_progress: unknown kind').catch(() => {});
        throw new Error(`unknown pending_progress kind: ${row.kind}`);
      }
      await runExclusive(() => db.runAsync('DELETE FROM pending_progress WHERE id = ?', row.id));
      sent += 1;
    } catch (error) {
      if (error instanceof WaniKaniApiError && error.status === 422) {
        await logSyncError(db, error, `pending_progress: discarded stale ${row.kind}`).catch(() => {});
        await runExclusive(() => db.runAsync('DELETE FROM pending_progress WHERE id = ?', row.id));
        continue;
      }
      // Skip re-updating when we already recorded the unknown-kind failure above.
      if (!(error instanceof Error && error.message.startsWith('unknown pending_progress kind:'))) {
        await runExclusive(() =>
          db.runAsync(
            'UPDATE pending_progress SET attempts = attempts + 1, last_error = ? WHERE id = ?',
            error instanceof Error ? error.message : String(error),
            row.id,
          ),
        );
        await logSyncError(db, error, `pending_progress: ${row.kind} send failed`).catch(() => {});
      }
      throw error;
    }
  }
  return sent;
}

async function sendPendingStudyMaterials(db: AppDatabase, client: WaniKaniClient, limit: number) {
  if (limit <= 0) {
    return 0;
  }

  const rows = await db.getAllAsync<{ id: string; subject_id: number; payload: string }>(
    'SELECT id, subject_id, payload FROM pending_study_materials ORDER BY created_at ASC LIMIT ?',
    limit,
  );

  let sent = 0;
  let remainingBudget = limit;
  for (const row of rows) {
    let uploadedPayload: string | null = null;
    try {
      const pendingPayload = JSON.parse(row.payload) as StudyMaterialPayload;
      const local = pendingPayload.id && pendingPayload.id > 0 ? null : await findBySubjectId(db, row.subject_id);
      const localId = local && local.id > 0 ? local.id : undefined;
      const remoteId = pendingPayload.id && pendingPayload.id > 0 ? pendingPayload.id : localId;
      const payload: StudyMaterialPayload = { ...pendingPayload, subjectId: row.subject_id };
      if (remoteId) {
        payload.id = remoteId;
      }

      const requestCost = payload.id && payload.id > 0 ? 1 : 2;
      if (requestCost > remainingBudget) {
        break;
      }

      // Track the exact payload string we are about to upload. The pending row
      // is keyed by subject_id (`study-material:<subjectId>`), so a concurrent
      // queueStudyMaterialUpdate for the same subject overwrites this row's
      // payload in place. The post-upload DELETE must therefore be conditional
      // on this string so it only removes the row we actually sent — if a newer
      // edit landed mid-upload, the DELETE matches nothing and that edit is
      // preserved for the next flush instead of being silently overwritten.
      let storedPayload = row.payload;
      uploadedPayload = storedPayload;
      if (localId && localId !== pendingPayload.id) {
        storedPayload = JSON.stringify(payload);
        uploadedPayload = storedPayload;
        await runExclusive(() =>
          db.runAsync(
            'UPDATE pending_study_materials SET payload = ? WHERE id = ? AND payload = ?',
            storedPayload,
            row.id,
            row.payload,
          ),
        );
      }
      const resource = await client.upsertStudyMaterial(payload);
      await runInWriteTransaction(db, async () => {
        if (resource) {
          await putStudyMaterialResource(db, resource);
        }
        await db.runAsync(
          'DELETE FROM pending_study_materials WHERE id = ? AND payload = ?',
          row.id,
          storedPayload,
        );
      });
      remainingBudget -= requestCost;
      sent += 1;
    } catch (error) {
      if (error instanceof WaniKaniApiError && error.status === 422) {
        await logSyncError(db, error, 'pending_study_materials: discarded stale').catch(() => {});
        if (uploadedPayload) {
          await runExclusive(() =>
            db.runAsync(
              'DELETE FROM pending_study_materials WHERE id = ? AND payload = ?',
              row.id,
              uploadedPayload,
            ),
          );
        } else {
          await runExclusive(() => db.runAsync('DELETE FROM pending_study_materials WHERE id = ?', row.id));
        }
        continue;
      }
      await runExclusive(() => {
        if (uploadedPayload) {
          return db.runAsync(
            'UPDATE pending_study_materials SET attempts = attempts + 1, last_error = ? WHERE id = ? AND payload = ?',
            error instanceof Error ? error.message : String(error),
            row.id,
            uploadedPayload,
          );
        }
        return db.runAsync(
          'UPDATE pending_study_materials SET attempts = attempts + 1, last_error = ? WHERE id = ?',
          error instanceof Error ? error.message : String(error),
          row.id,
        );
      });
      await logSyncError(db, error, 'pending_study_materials: send failed').catch(() => {});
      throw error;
    }
  }
  return sent;
}
