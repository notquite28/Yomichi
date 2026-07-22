import * as SQLite from 'expo-sqlite';

import {
  ApiResource,
  AssignmentData,
  LevelProgressionData,
  ReviewStatisticData,
  StudyMaterialData,
  StudyMaterialPayload,
  SubjectData,
  VoiceActorData,
  WaniKaniUserData,
} from '../api/types';
import { migrations } from './schema';

export type AppDatabase = SQLite.SQLiteDatabase;
type SaveProgressCallback = (saved: number, total: number) => void;

const SUBJECT_LOOKUP_BATCH_SIZE = 500;

let databasePromise: Promise<AppDatabase> | null = null;

/**
 * Serializes write operations on the shared SQLite connection.
 *
 * `openAppDatabase` hands every caller (sync engine, screens, notification
 * service) the same connection. expo-sqlite runs individual statements
 * serially, but a JS-level transaction built from several awaited statements
 * yields the event loop between them. Without this lock a second
 * `BEGIN TRANSACTION` issued mid-flight — e.g. a user answering a review while a
 * background sync batch is open — either throws "cannot start a transaction
 * within a transaction" or has its COMMIT/ROLLBACK tear down the outer
 * transaction, losing sync progress and silently dropping the queued write.
 *
 * Every multi-statement write must run through `runInWriteTransaction`, and
 * every standalone single-statement write through `runExclusive`, so neither a
 * transaction nor a bare statement ever lands inside another transaction. (A
 * lone INSERT issued while some other transaction is open on the connection is
 * captured by that transaction and lost if it later rolls back, so single
 * statements need the lock too.)
 *
 * The lock is deliberately NOT reentrant. It serializes every write so a user
 * write (e.g. answering a review) never lands inside an open background-sync
 * transaction, where its COMMIT/ROLLBACK would corrupt the outer transaction or
 * its row would be lost on the sync's rollback. A user write issued mid-sync
 * therefore queues behind the active transaction and runs once it commits — it
 * does not interleave with it. Because the lock is not reentrant, inner helpers
 * invoked *inside* a locked block must NOT call
 * `runExclusive`/`runInWriteTransaction` (that would deadlock), and public
 * wrappers that take the lock must never be called from within another locked
 * block. Keep the work inside each locked block small — large sync batches hold
 * the lock for their whole duration and block UI writes until they finish, so
 * prefer chunking big writes over one long-held transaction.
 */
let writeLock: Promise<unknown> = Promise.resolve();

export function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = writeLock.then(task, task);
  // Keep the chain alive regardless of this task's outcome so one failed write
  // never wedges every subsequent write.
  writeLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function runInWriteTransaction<T>(db: AppDatabase, task: () => Promise<T>): Promise<T> {
  return runExclusive(async () => {
    await db.execAsync('BEGIN TRANSACTION;');
    try {
      const result = await task();
      await db.execAsync('COMMIT;');
      return result;
    } catch (error) {
      await db.execAsync('ROLLBACK;');
      throw error;
    }
  });
}

export async function openAppDatabase() {
  if (!databasePromise) {
    databasePromise =   SQLite.openDatabaseAsync('yomiji.db').then(async (db) => {
      await applyMigrations(db);
      return db;
    });
  }

  return databasePromise;
}

export async function applyMigrations(db: AppDatabase) {
  await db.execAsync(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = await db.getAllAsync<{ version: number }>('SELECT version FROM schema_migrations');
  const applied = new Set(appliedRows.map((row) => row.version));

  for (const migration of migrations) {
    if (applied.has(migration.version)) {
      continue;
    }

    await db.execAsync('BEGIN TRANSACTION;');
    try {
      await db.execAsync(migration.sql);
      await db.runAsync('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', migration.version, new Date().toISOString());
      await db.execAsync('COMMIT;');
    } catch (error) {
      await db.execAsync('ROLLBACK;');
      throw error;
    }
  }
}

export async function getSyncCursors(db: AppDatabase) {
  const rows = await db.getAllAsync<{ collection: string; updated_after: string }>('SELECT collection, updated_after FROM sync_cursors');
  return Object.fromEntries(rows.map((row) => [row.collection, row.updated_after]));
}

export async function getLastSyncTime(db: AppDatabase) {
  const row = await db.getFirstAsync<{ synced_at: string | null }>('SELECT MAX(synced_at) AS synced_at FROM sync_cursors');
  return row?.synced_at ? Date.parse(row.synced_at) : 0;
}

export async function setSyncCursor(db: AppDatabase, collection: string, updatedAfter: string | null | undefined) {
  await runExclusive(() =>
    db.runAsync(
      `INSERT INTO sync_cursors (collection, updated_after, synced_at)
       VALUES (?, ?, ?)
       ON CONFLICT(collection) DO UPDATE SET updated_after = excluded.updated_after, synced_at = excluded.synced_at`,
      collection,
      updatedAfter ?? '',
      new Date().toISOString(),
    ),
  );
}

export async function putUser(db: AppDatabase, user: ApiResource<WaniKaniUserData>) {
  await runExclusive(() =>
    db.runAsync(
      `INSERT INTO user (id, username, level, vacation_started_at, payload, updated_at)
       VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         username = excluded.username,
         level = excluded.level,
         vacation_started_at = excluded.vacation_started_at,
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
      user.data.username,
      user.data.level,
      user.data.current_vacation_started_at ?? null,
      JSON.stringify(user),
      user.data_updated_at ?? new Date().toISOString(),
    ),
  );
}

export async function putSubjects(db: AppDatabase, subjects: Array<ApiResource<SubjectData>>, onProgress?: SaveProgressCallback) {
  let saved = 0;
  await runInWriteTransaction(db, async () => {
    for (const subject of subjects) {
      if (!subject.id) {
        saved += 1;
        reportSaveProgress(saved, subjects.length, onProgress);
        continue;
      }

      const subjectType = subject.object === 'kana_vocabulary' ? 'vocabulary' : subject.object;
      await db.runAsync(
        `INSERT INTO subjects (id, japanese, level, subject_type, payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           japanese = excluded.japanese,
           level = excluded.level,
           subject_type = excluded.subject_type,
           payload = excluded.payload,
           updated_at = excluded.updated_at`,
        subject.id,
        subject.data.characters ?? '',
        subject.data.level,
        subjectType,
        JSON.stringify(subject),
        subject.data_updated_at ?? null,
      );

      await putSubjectAudioUrls(db, subject);
      saved += 1;
      reportSaveProgress(saved, subjects.length, onProgress);
    }
  });
}

export async function putAssignments(db: AppDatabase, assignments: Array<ApiResource<AssignmentData>>, onProgress?: SaveProgressCallback) {
  // Prefer selective subject lookup for the batch; fall back only if empty.
  const subjectIds = [
    ...new Set(
      assignments
        .map((assignment) => assignment.data?.subject_id)
        .filter((id): id is number => typeof id === 'number' && id > 0),
    ),
  ];
  const subjectById = new Map<number, { id: number; level: number; subject_type: string }>();
  for (let start = 0; start < subjectIds.length; start += SUBJECT_LOOKUP_BATCH_SIZE) {
    const subjectIdBatch = subjectIds.slice(start, start + SUBJECT_LOOKUP_BATCH_SIZE);
    const subjects = await db.getAllAsync<{ id: number; level: number; subject_type: string }>(
      `SELECT id, level, subject_type FROM subjects WHERE id IN (${subjectIdBatch.map(() => '?').join(', ')})`,
      ...subjectIdBatch,
    );
    for (const subject of subjects) {
      subjectById.set(subject.id, subject);
    }
  }
  let saved = 0;

  await runInWriteTransaction(db, async () => {
    // Offline review/lesson writes apply local srs/available/started/passed
    // immediately and queue pending_progress. If a download runs before those
    // rows flush (rate-limit reserve), remote assignment payloads would clobber
    // that local state and re-surface finished items. Preserve local columns
    // while a matching pending row exists — study materials already do the same.
    const pendingRows = await db.getAllAsync<{ kind: string; payload: string }>(
      `SELECT kind, payload FROM pending_progress WHERE kind IN ('review', 'lesson-start')`,
    );
    const pendingAssignmentIds = new Set<number>();
    for (const row of pendingRows) {
      try {
        const payload = JSON.parse(row.payload) as { assignmentId?: number };
        if (typeof payload.assignmentId === 'number' && payload.assignmentId > 0) {
          pendingAssignmentIds.add(payload.assignmentId);
        }
      } catch {
        // Corrupt pending payload: ignore for overlay; send path handles it.
      }
    }

    for (const assignment of assignments) {
      if (!assignment.id) {
        saved += 1;
        reportSaveProgress(saved, assignments.length, onProgress);
        continue;
      }

      const subject = subjectById.get(assignment.data.subject_id);
      const subjectType = assignment.data.subject_type === 'kana_vocabulary' ? 'vocabulary' : assignment.data.subject_type;
      const preserveLocalProgress = pendingAssignmentIds.has(assignment.id);
      const existing = preserveLocalProgress
        ? await db.getFirstAsync<{
            srs_stage: number;
            available_at: string | null;
            started_at: string | null;
            passed_at: string | null;
          }>(
            'SELECT srs_stage, available_at, started_at, passed_at FROM assignments WHERE id = ?',
            assignment.id,
          )
        : null;

      const srsStage = existing?.srs_stage ?? assignment.data.srs_stage;
      const availableAt = existing ? existing.available_at : (assignment.data.available_at ?? null);
      const startedAt = existing ? existing.started_at : (assignment.data.started_at ?? null);
      const passedAt = existing ? existing.passed_at : (assignment.data.passed_at ?? null);

      await db.runAsync(
        `INSERT INTO assignments (id, subject_id, level, subject_type, srs_stage, available_at, started_at, passed_at, burned_at, payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           subject_id = excluded.subject_id,
           level = excluded.level,
           subject_type = excluded.subject_type,
           srs_stage = excluded.srs_stage,
           available_at = excluded.available_at,
           started_at = excluded.started_at,
           passed_at = excluded.passed_at,
           burned_at = excluded.burned_at,
           payload = excluded.payload,
           updated_at = excluded.updated_at`,
        assignment.id,
        assignment.data.subject_id,
        subject?.level ?? null,
        subjectType || subject?.subject_type || 'unknown',
        srsStage,
        availableAt,
        startedAt,
        passedAt,
        assignment.data.burned_at ?? null,
        JSON.stringify(assignment),
        assignment.data_updated_at ?? null,
      );
      saved += 1;
      reportSaveProgress(saved, assignments.length, onProgress);
    }
  });
}

function applyPendingStudyMaterialOverlay(
  resource: ApiResource<StudyMaterialData>,
  pending: StudyMaterialPayload | null,
): ApiResource<StudyMaterialData> {
  if (!pending) return resource;
  return {
    ...resource,
    data: {
      ...resource.data,
      ...(pending.meaningSynonyms !== undefined ? { meaning_synonyms: pending.meaningSynonyms } : {}),
      ...(pending.meaningNote !== undefined ? { meaning_note: pending.meaningNote } : {}),
      ...(pending.readingNote !== undefined ? { reading_note: pending.readingNote } : {}),
    },
  };
}

export async function putStudyMaterials(db: AppDatabase, studyMaterials: Array<ApiResource<StudyMaterialData>>, onProgress?: SaveProgressCallback) {
  const subjectRows = await db.getAllAsync<{ id: number }>('SELECT id FROM subjects');
  const subjectIds = new Set(subjectRows.map((subject) => subject.id));
  let saved = 0;
  await runInWriteTransaction(db, async () => {
    for (const studyMaterial of studyMaterials) {
      if (!studyMaterial.id || !subjectIds.has(studyMaterial.data.subject_id)) {
        saved += 1;
        reportSaveProgress(saved, studyMaterials.length, onProgress);
        continue;
      }

      const pending = await db.getFirstAsync<{ payload: string }>(
        'SELECT payload FROM pending_study_materials WHERE subject_id = ?',
        studyMaterial.data.subject_id,
      );
      const pendingPayload = pending ? JSON.parse(pending.payload) as StudyMaterialPayload : null;
      if (pendingPayload && (!pendingPayload.id || pendingPayload.id <= 0)) {
        pendingPayload.id = studyMaterial.id;
        await db.runAsync(
          'UPDATE pending_study_materials SET payload = ? WHERE subject_id = ?',
          JSON.stringify(pendingPayload),
          studyMaterial.data.subject_id,
        );
      }
      const materialToStore = applyPendingStudyMaterialOverlay(studyMaterial, pendingPayload);

      const existing = await db.getFirstAsync<{ id: number }>(
        'SELECT id FROM study_materials WHERE subject_id = ?',
        studyMaterial.data.subject_id,
      );

      if (existing) {
        await db.runAsync(
          `UPDATE study_materials
           SET id = ?, payload = ?, updated_at = ?
           WHERE subject_id = ?`,
          studyMaterial.id,
          JSON.stringify(materialToStore),
          materialToStore.data_updated_at ?? null,
          studyMaterial.data.subject_id,
        );
      } else {
        await db.runAsync(
          `INSERT INTO study_materials (id, subject_id, payload, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             subject_id = excluded.subject_id,
             payload = excluded.payload,
             updated_at = excluded.updated_at`,
          studyMaterial.id,
          materialToStore.data.subject_id,
          JSON.stringify(materialToStore),
          materialToStore.data_updated_at ?? null,
        );
      }

      saved += 1;
      reportSaveProgress(saved, studyMaterials.length, onProgress);
    }
  });
}

export async function putLevelProgressions(db: AppDatabase, levels: Array<ApiResource<LevelProgressionData>>, onProgress?: SaveProgressCallback) {
  await putSimpleCollection(db, 'level_progressions', levels, (level) => [level.data.level, JSON.stringify(level), level.data_updated_at ?? null], onProgress);
}

export async function putVoiceActors(db: AppDatabase, voiceActors: Array<ApiResource<VoiceActorData>>, onProgress?: SaveProgressCallback) {
  await putSimpleCollection(db, 'voice_actors', voiceActors, (voiceActor) => [voiceActor.data.name, JSON.stringify(voiceActor), voiceActor.data_updated_at ?? null], onProgress);
}

export async function putReviewStats(db: AppDatabase, stats: Array<ApiResource<ReviewStatisticData>>, onProgress?: SaveProgressCallback) {
  let saved = 0;
  await runInWriteTransaction(db, async () => {
    for (const stat of stats) {
      if (!stat.id) {
        saved += 1;
        reportSaveProgress(saved, stats.length, onProgress);
        continue;
      }
      await db.runAsync(
        `INSERT INTO review_stats (id, subject_id, subject_type, percentage_correct, payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           subject_id = excluded.subject_id,
           subject_type = excluded.subject_type,
           percentage_correct = excluded.percentage_correct,
           payload = excluded.payload,
           updated_at = excluded.updated_at`,
        stat.id,
        stat.data.subject_id,
        stat.data.subject_type ?? null,
        stat.data.percentage_correct ?? null,
        JSON.stringify(stat),
        stat.data_updated_at ?? null,
      );
      saved += 1;
      reportSaveProgress(saved, stats.length, onProgress);
    }
  });
}

export async function resetLocalData(db: AppDatabase) {
  const tables = [
    'sync_cursors',
    'assignments',
    'study_materials',
    'level_progressions',
    'voice_actors',
    'review_stats',
    'audio_urls',
    'subject_progress',
    'pending_progress',
    'pending_study_materials',
    'error_log',
    'subjects',
    'user',
    'review_attempts',
    'learning_interventions',
    'learning_history_meta',
    'coach_cache',
  ];

  await runInWriteTransaction(db, async () => {
    for (const table of tables) {
      await db.execAsync(`DELETE FROM ${table};`);
    }
  });
}

export type SubjectProgressRow = {
  subject_id: number;
  level: number | null;
  srs_stage: number | null;
  subject_type: string | null;
  last_mistake_at: string | null;
};

/**
 * Reads the full subject_progress table. These rows hold local-only review
 * history (recent mistakes, leeches) that the download sync never
 * repopulates, so a caller that clears the remote cache must snapshot them
 * first and restore them afterwards or the history is lost.
 */
export async function snapshotSubjectProgress(db: AppDatabase): Promise<SubjectProgressRow[]> {
  return db.getAllAsync<SubjectProgressRow>(
    'SELECT subject_id, level, srs_stage, subject_type, last_mistake_at FROM subject_progress',
  );
}

/**
 * Restores a subject_progress snapshot taken before a cache clear. Each row is
 * only re-inserted when its subject still exists so the subject_id FK into
 * subjects(id) holds even if the subject was dropped by the refresh.
 * Also prunes any leftover orphan rows that survived clearRemoteCache.
 */
export async function restoreSubjectProgress(db: AppDatabase, rows: SubjectProgressRow[]) {
  await runInWriteTransaction(db, async () => {
    for (const row of rows) {
      await db.runAsync(
        `INSERT INTO subject_progress (subject_id, level, srs_stage, subject_type, last_mistake_at)
         SELECT ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM subjects WHERE id = ?)
         ON CONFLICT(subject_id) DO UPDATE SET
           level = excluded.level,
           srs_stage = excluded.srs_stage,
           subject_type = excluded.subject_type,
           last_mistake_at = excluded.last_mistake_at`,
        row.subject_id,
        row.level,
        row.srs_stage,
        row.subject_type,
        row.last_mistake_at,
        row.subject_id,
      );
    }
    // Drop progress rows whose subject no longer exists after the refresh.
    await db.runAsync(
      `DELETE FROM subject_progress
       WHERE subject_id NOT IN (SELECT id FROM subjects)`,
    );
  });
}

export async function clearRemoteCache(db: AppDatabase) {
  // Order matters with foreign_keys = ON: delete child tables that reference
  // subjects before deleting subjects itself. pending_study_materials is left
  // out entirely — its subject_id FKs into subjects, so its rows must already be
  // flushed, and it holds local writes that must never be wiped as a side effect
  // of clearing the remote cache. pending_progress has no such FK and is
  // likewise preserved.
  //
  // subject_progress is also preserved here: it holds local-only review history
  // (recent mistakes). Full refresh snapshots/restores it and prunes orphans
  // after a successful re-download. Leaving it intact means a failed refresh
  // mid-download cannot permanently erase that history.
  //
  // SQLite refuses to change foreign_keys inside an open transaction, so we
  // take the write lock, flip the pragma, then BEGIN/COMMIT manually rather
  // than using runInWriteTransaction.
  const tables = [
    'sync_cursors',
    'assignments',
    'study_materials',
    'level_progressions',
    'voice_actors',
    'review_stats',
    'audio_urls',
    'error_log',
    'subjects',
    'user',
  ];

  await runExclusive(async () => {
    // Guard under the same lock as the deletes so a concurrent queued edit
    // cannot slip in between the count and DELETE FROM subjects.
    const pending = await db.getFirstAsync<{ value: number }>(
      'SELECT COUNT(*) AS value FROM pending_study_materials',
    );
    if ((pending?.value ?? 0) > 0) {
      throw new Error('clearRemoteCache called with unflushed study-material writes; flush them before clearing the cache.');
    }

    await db.execAsync('PRAGMA foreign_keys = OFF;');
    try {
      await db.execAsync('BEGIN TRANSACTION;');
      try {
        for (const table of tables) {
          await db.execAsync(`DELETE FROM ${table};`);
        }
        await db.execAsync('COMMIT;');
      } catch (error) {
        await db.execAsync('ROLLBACK;');
        throw error;
      }
    } finally {
      await db.execAsync('PRAGMA foreign_keys = ON;');
    }
  });
}

async function putSubjectAudioUrls(db: AppDatabase, subject: ApiResource<SubjectData>) {
  if (!subject.id || !subject.data.pronunciation_audios?.length) {
    return;
  }

  for (const audio of subject.data.pronunciation_audios) {
    if (audio.content_type !== 'audio/mpeg') {
      continue;
    }

    await db.runAsync(
      `INSERT INTO audio_urls (subject_id, voice_actor_id, remote_url, status)
       VALUES (?, ?, ?, 'remote')
       ON CONFLICT(subject_id, remote_url) DO UPDATE SET
         voice_actor_id = excluded.voice_actor_id`,
      subject.id,
      audio.metadata?.voice_actor_id ?? null,
      audio.url,
    );
  }
}

async function putSimpleCollection<TData>(
  db: AppDatabase,
  table: 'level_progressions' | 'voice_actors',
  items: Array<ApiResource<TData>>,
  values: (item: ApiResource<TData>) => SQLite.SQLiteBindValue[],
  onProgress?: SaveProgressCallback,
) {
  const columns = table === 'level_progressions' ? '(id, level, payload, updated_at)' : '(id, name, payload, updated_at)';
  const updates = table === 'level_progressions'
    ? 'level = excluded.level, payload = excluded.payload, updated_at = excluded.updated_at'
    : 'name = excluded.name, payload = excluded.payload, updated_at = excluded.updated_at';

  await runInWriteTransaction(db, async () => {
    let saved = 0;
    for (const item of items) {
      if (!item.id) {
        saved += 1;
        reportSaveProgress(saved, items.length, onProgress);
        continue;
      }
      await db.runAsync(
        `INSERT INTO ${table} ${columns}
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET ${updates}`,
        item.id,
        ...values(item),
      );
      saved += 1;
      reportSaveProgress(saved, items.length, onProgress);
    }
  });
}

function reportSaveProgress(saved: number, total: number, onProgress?: SaveProgressCallback) {
  if (!onProgress || total === 0) {
    return;
  }
  if (saved === total || saved % 250 === 0) {
    onProgress(saved, total);
  }
}
