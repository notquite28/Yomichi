import type { AppDatabase } from '../db/database';
import { runInWriteTransaction } from '../db/database';

export type InterventionKind =
  | 'mistake_lens'
  | 'confusion_pair'
  | 'pair_practice'
  | 'study_summary';

export type InterventionState =
  | 'offered'
  | 'generating'
  | 'shown'
  | 'skipped'
  | 'dismissed'
  | 'failed';

export type InterventionRow = {
  id: number;
  kind: InterventionKind;
  subjectIdsJson: string;
  evidenceHash: string;
  modelVersion: string | null;
  promptVersion: string | null;
  state: InterventionState;
  helpful: number | null;
  offeredAt: string;
  shownAt: string | null;
  resolvedAt: string | null;
  payloadJson: string | null;
};

export type InsertInterventionInput = {
  kind: InterventionKind;
  subjectIds: number[];
  evidenceHash: string;
  state?: InterventionState;
  modelVersion?: string | null;
  promptVersion?: string | null;
  payloadJson?: string | null;
  offeredAt?: string;
};

export async function insertIntervention(
  db: AppDatabase,
  input: InsertInterventionInput,
): Promise<number> {
  const subjectIdsJson = JSON.stringify(
    [...new Set(input.subjectIds)].sort((a, b) => a - b),
  );
  const offeredAt = input.offeredAt ?? new Date().toISOString();
  return runInWriteTransaction(db, async () => {
    const result = await db.runAsync(
      `INSERT INTO learning_interventions (
         kind, subject_ids_json, evidence_hash, model_version, prompt_version,
         state, helpful, offered_at, shown_at, resolved_at, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?)`,
      input.kind,
      subjectIdsJson,
      input.evidenceHash,
      input.modelVersion ?? null,
      input.promptVersion ?? null,
      input.state ?? 'offered',
      offeredAt,
      input.payloadJson ?? null,
    );
    return Number(result.lastInsertRowId);
  });
}

export async function updateInterventionState(
  db: AppDatabase,
  id: number,
  state: InterventionState,
  extra?: {
    helpful?: boolean;
    payloadJson?: string;
    modelVersion?: string;
    promptVersion?: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await runInWriteTransaction(db, async () => {
    const row = await db.getFirstAsync<{ state: string }>(
      'SELECT state FROM learning_interventions WHERE id = ?',
      id,
    );
    if (!row) {
      return;
    }

    const shownAt =
      state === 'shown' || state === 'generating' ? now : null;
    const resolvedAt =
      state === 'skipped' ||
      state === 'dismissed' ||
      state === 'failed' ||
      extra?.helpful != null
        ? now
        : null;

    await db.runAsync(
      `UPDATE learning_interventions
       SET state = ?,
           helpful = COALESCE(?, helpful),
           payload_json = COALESCE(?, payload_json),
           model_version = COALESCE(?, model_version),
           prompt_version = COALESCE(?, prompt_version),
           shown_at = CASE
             WHEN ? IS NOT NULL THEN COALESCE(shown_at, ?)
             ELSE shown_at
           END,
           resolved_at = CASE
             WHEN ? IS NOT NULL THEN ?
             ELSE resolved_at
           END
       WHERE id = ?`,
      state,
      extra?.helpful == null ? null : extra.helpful ? 1 : 0,
      extra?.payloadJson ?? null,
      extra?.modelVersion ?? null,
      extra?.promptVersion ?? null,
      shownAt,
      shownAt,
      resolvedAt,
      resolvedAt,
      id,
    );
  });
}

export async function findRecentByEvidenceHash(
  db: AppDatabase,
  hash: string,
  sinceIso: string,
): Promise<InterventionRow | null> {
  const row = await db.getFirstAsync<{
    id: number;
    kind: InterventionKind;
    subject_ids_json: string;
    evidence_hash: string;
    model_version: string | null;
    prompt_version: string | null;
    state: InterventionState;
    helpful: number | null;
    offered_at: string;
    shown_at: string | null;
    resolved_at: string | null;
    payload_json: string | null;
  }>(
    `SELECT id, kind, subject_ids_json, evidence_hash, model_version, prompt_version,
            state, helpful, offered_at, shown_at, resolved_at, payload_json
     FROM learning_interventions
     WHERE evidence_hash = ?
       AND offered_at >= ?
     ORDER BY offered_at DESC
     LIMIT 1`,
    hash,
    sinceIso,
  );
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    kind: row.kind,
    subjectIdsJson: row.subject_ids_json,
    evidenceHash: row.evidence_hash,
    modelVersion: row.model_version,
    promptVersion: row.prompt_version,
    state: row.state,
    helpful: row.helpful,
    offeredAt: row.offered_at,
    shownAt: row.shown_at,
    resolvedAt: row.resolved_at,
    payloadJson: row.payload_json,
  };
}
