import type { AppDatabase } from '../db/database';
import { runInWriteTransaction } from '../db/database';
import type { CoachAction } from './types';

export type CoachCacheRow = {
  subjectId: number;
  action: CoachAction;
  promptHash: string;
  response: string;
  createdAt: string;
};

export async function getCachedCoachResponse(
  db: AppDatabase,
  subjectId: number,
  action: CoachAction,
  promptHash: string,
): Promise<string | null> {
  const row = await db.getFirstAsync<{ response: string }>(
    `SELECT response FROM coach_cache
     WHERE subject_id = ? AND action = ? AND prompt_hash = ?
     LIMIT 1`,
    [subjectId, action, promptHash],
  );
  return row?.response ?? null;
}

export async function putCachedCoachResponse(
  db: AppDatabase,
  entry: CoachCacheRow,
): Promise<void> {
  await runInWriteTransaction(db, async () => {
    await db.runAsync(
      `INSERT INTO coach_cache (subject_id, action, prompt_hash, response, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(subject_id, action, prompt_hash) DO UPDATE SET
         response = excluded.response,
         created_at = excluded.created_at`,
      [entry.subjectId, entry.action, entry.promptHash, entry.response, entry.createdAt],
    );
  });
}

export async function clearCoachCache(db: AppDatabase): Promise<void> {
  await runInWriteTransaction(db, async () => {
    await db.runAsync('DELETE FROM coach_cache');
  });
}
