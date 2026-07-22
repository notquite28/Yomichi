import type { AppDatabase } from '../db/database';
import { runInWriteTransaction } from '../db/database';

export type AttemptSource = 'review' | 'lesson' | 'practice' | 'practice_pair';
export type AttemptTaskType = 'meaning' | 'reading';

export type RecordAttemptInput = {
  sessionId: number;
  subjectId: number;
  assignmentId: number | null;
  source: AttemptSource;
  taskType: AttemptTaskType;
  /** Null for correct typed answers and Anki. */
  normalizedAnswer: string | null;
  resultKind: string;
  scoredCorrect: boolean;
  srsStageBefore: number | null;
  occurredAt?: string;
};

const ATTEMPT_RETENTION_DAYS = 90;
const INTERVENTION_RETENTION_DAYS = 180;
const ATTEMPT_CAP = 50_000;
const PRUNE_BATCH = 2000;
const META_LAST_MAINTENANCE = 'last_maintenance_at';
const META_ATTEMPT_REVISION = 'attempt_revision';

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgoIso(days: number, now: Date): string {
  return new Date(now.getTime() - days * 24 * 3600_000).toISOString();
}

async function getMetaValue(db: AppDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM learning_history_meta WHERE key = ?',
    key,
  );
  return row?.value ?? null;
}

async function setMetaValue(db: AppDatabase, key: string, value: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO learning_history_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value,
  );
}

async function bumpAttemptRevisionUnlocked(db: AppDatabase): Promise<void> {
  const current = await getMetaValue(db, META_ATTEMPT_REVISION);
  const next = String((Number.parseInt(current ?? '0', 10) || 0) + 1);
  await setMetaValue(db, META_ATTEMPT_REVISION, next);
}

export async function bumpAttemptRevision(db: AppDatabase): Promise<void> {
  await runInWriteTransaction(db, async () => {
    await bumpAttemptRevisionUnlocked(db);
  });
}

export async function getAttemptRevision(db: AppDatabase): Promise<number> {
  const value = await getMetaValue(db, META_ATTEMPT_REVISION);
  return Number.parseInt(value ?? '0', 10) || 0;
}

export async function recordAttempt(db: AppDatabase, input: RecordAttemptInput): Promise<number> {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  return runInWriteTransaction(db, async () => {
    const result = await db.runAsync(
      `INSERT INTO review_attempts (
         session_id, subject_id, assignment_id, source, task_type,
         normalized_answer, result_kind, scored_correct, overridden,
         occurred_at, srs_stage_before
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      input.sessionId,
      input.subjectId,
      input.assignmentId,
      input.source,
      input.taskType,
      input.normalizedAnswer,
      input.resultKind,
      input.scoredCorrect ? 1 : 0,
      occurredAt,
      input.srsStageBefore,
    );
    await bumpAttemptRevisionUnlocked(db);
    return Number(result.lastInsertRowId);
  });
}

export async function markAttemptOverridden(db: AppDatabase, attemptId: number): Promise<void> {
  await runInWriteTransaction(db, async () => {
    await db.runAsync(
      `UPDATE review_attempts
       SET scored_correct = 1, overridden = 1
       WHERE id = ?`,
      attemptId,
    );
    await bumpAttemptRevisionUnlocked(db);
  });
}

export async function discardAttempt(db: AppDatabase, attemptId: number): Promise<void> {
  await runInWriteTransaction(db, async () => {
    await db.runAsync('DELETE FROM review_attempts WHERE id = ?', attemptId);
    await bumpAttemptRevisionUnlocked(db);
  });
}

export async function clearLearningHistory(db: AppDatabase): Promise<void> {
  await runInWriteTransaction(db, async () => {
    await db.runAsync('DELETE FROM review_attempts');
    await db.runAsync('DELETE FROM learning_interventions');
    await db.runAsync('DELETE FROM learning_history_meta');
    // Optional structured coach caches for learning features.
    try {
      await db.runAsync(
        `DELETE FROM coach_cache WHERE action IN ('mistake_lens', 'study_summary')`,
      );
    } catch {
      // coach_cache may be absent on very old DBs mid-migration; ignore.
    }
  });
}

async function deleteInBatches(
  db: AppDatabase,
  sql: string,
  params: Array<string | number> = [],
): Promise<number> {
  let total = 0;
  while (true) {
    const result = await db.runAsync(sql, ...params);
    const changes = result.changes ?? 0;
    total += changes;
    if (changes < PRUNE_BATCH) {
      break;
    }
  }
  return total;
}

export async function pruneLearningHistory(db: AppDatabase, now = new Date()): Promise<void> {
  const last = await getMetaValue(db, META_LAST_MAINTENANCE);
  if (last && utcDayKey(new Date(last)) === utcDayKey(now)) {
    return;
  }

  await runInWriteTransaction(db, async () => {
    const attemptCutoff = daysAgoIso(ATTEMPT_RETENTION_DAYS, now);
    await deleteInBatches(
      db,
      `DELETE FROM review_attempts
       WHERE id IN (
         SELECT id FROM review_attempts
         WHERE occurred_at < ?
         ORDER BY occurred_at ASC
         LIMIT ${PRUNE_BATCH}
       )`,
      [attemptCutoff],
    );

    const countRow = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM review_attempts',
    );
    const excess = (countRow?.count ?? 0) - ATTEMPT_CAP;
    if (excess > 0) {
      let remaining = excess;
      while (remaining > 0) {
        const batch = Math.min(PRUNE_BATCH, remaining);
        const result = await db.runAsync(
          `DELETE FROM review_attempts
           WHERE id IN (
             SELECT id FROM review_attempts
             ORDER BY occurred_at ASC
             LIMIT ?
           )`,
          batch,
        );
        const changes = result.changes ?? 0;
        if (changes === 0) {
          break;
        }
        remaining -= changes;
      }
    }

    const interventionCutoff = daysAgoIso(INTERVENTION_RETENTION_DAYS, now);
    await deleteInBatches(
      db,
      `DELETE FROM learning_interventions
       WHERE id IN (
         SELECT id FROM learning_interventions
         WHERE offered_at < ?
         ORDER BY offered_at ASC
         LIMIT ${PRUNE_BATCH}
       )`,
      [interventionCutoff],
    );

    await setMetaValue(db, META_LAST_MAINTENANCE, now.toISOString());
  });
}

export async function pruneOrphanLearningHistory(db: AppDatabase): Promise<void> {
  await runInWriteTransaction(db, async () => {
    await db.runAsync(
      `DELETE FROM review_attempts
       WHERE subject_id NOT IN (SELECT id FROM subjects)`,
    );

    // Interventions may reference multiple subjects; drop if any listed id is missing.
    const rows = await db.getAllAsync<{ id: number; subject_ids_json: string }>(
      'SELECT id, subject_ids_json FROM learning_interventions',
    );
    for (const row of rows) {
      let ids: number[] = [];
      try {
        const parsed = JSON.parse(row.subject_ids_json) as unknown;
        if (Array.isArray(parsed)) {
          ids = parsed.filter((value): value is number => typeof value === 'number');
        }
      } catch {
        ids = [];
      }
      if (ids.length === 0) {
        await db.runAsync('DELETE FROM learning_interventions WHERE id = ?', row.id);
        continue;
      }
      const placeholders = ids.map(() => '?').join(', ');
      const present = await db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM subjects WHERE id IN (${placeholders})`,
        ...ids,
      );
      if ((present?.count ?? 0) < ids.length) {
        await db.runAsync('DELETE FROM learning_interventions WHERE id = ?', row.id);
      }
    }

    await bumpAttemptRevisionUnlocked(db);
  });
}
