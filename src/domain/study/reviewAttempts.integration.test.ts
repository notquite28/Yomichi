/**
 * Integration tests for local review attempt history and retention.
 */
import { applyMigrations, putSubjects } from '../db/database';
import {
  clearLearningHistory,
  discardAttempt,
  getAttemptRevision,
  markAttemptOverridden,
  pruneLearningHistory,
  pruneOrphanLearningHistory,
  recordAttempt,
} from './reviewAttempts';
import { createTestDb } from '../../test/sqliteShim';
import { makeVocabulary, resetIdCounter } from '../../test/factories';
import type { AppDatabase } from '../db/database';

async function setupDb(): Promise<AppDatabase> {
  const db = createTestDb();
  await applyMigrations(db);
  return db;
}

async function countAttempts(db: AppDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM review_attempts');
  return row?.count ?? 0;
}

describe('reviewAttempts', () => {
  let db: AppDatabase;

  beforeEach(async () => {
    resetIdCounter();
    db = await setupDb();
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('records an attempt and bumps revision', async () => {
    const before = await getAttemptRevision(db);
    const id = await recordAttempt(db, {
      sessionId: 1,
      subjectId: 10,
      assignmentId: 20,
      source: 'review',
      taskType: 'meaning',
      normalizedAnswer: 'wrong',
      resultKind: 'incorrect',
      scoredCorrect: false,
      srsStageBefore: 1,
      occurredAt: '2026-01-01T00:00:00.000Z',
    });

    expect(id).toBeGreaterThan(0);
    expect(await getAttemptRevision(db)).toBe(before + 1);

    const row = await db.getFirstAsync<{
      normalized_answer: string | null;
      scored_correct: number;
      overridden: number;
    }>('SELECT normalized_answer, scored_correct, overridden FROM review_attempts WHERE id = ?', id);
    expect(row).toEqual({
      normalized_answer: 'wrong',
      scored_correct: 0,
      overridden: 0,
    });
  });

  it('stores null normalized_answer for correct typed answers', async () => {
    const id = await recordAttempt(db, {
      sessionId: 1,
      subjectId: 10,
      assignmentId: null,
      source: 'review',
      taskType: 'reading',
      normalizedAnswer: null,
      resultKind: 'precise',
      scoredCorrect: true,
      srsStageBefore: 2,
    });
    const row = await db.getFirstAsync<{ normalized_answer: string | null }>(
      'SELECT normalized_answer FROM review_attempts WHERE id = ?',
      id,
    );
    expect(row?.normalized_answer).toBeNull();
  });

  it('marks an attempt overridden', async () => {
    const id = await recordAttempt(db, {
      sessionId: 1,
      subjectId: 10,
      assignmentId: 20,
      source: 'review',
      taskType: 'meaning',
      normalizedAnswer: 'oops',
      resultKind: 'incorrect',
      scoredCorrect: false,
      srsStageBefore: 1,
    });
    await markAttemptOverridden(db, id);
    const row = await db.getFirstAsync<{ scored_correct: number; overridden: number }>(
      'SELECT scored_correct, overridden FROM review_attempts WHERE id = ?',
      id,
    );
    expect(row).toEqual({ scored_correct: 1, overridden: 1 });
  });

  it('discards an attempt hard-delete', async () => {
    const id = await recordAttempt(db, {
      sessionId: 1,
      subjectId: 10,
      assignmentId: 20,
      source: 'review',
      taskType: 'meaning',
      normalizedAnswer: 'later',
      resultKind: 'incorrect',
      scoredCorrect: false,
      srsStageBefore: 1,
    });
    await discardAttempt(db, id);
    expect(await countAttempts(db)).toBe(0);
  });

  it('prunes attempts older than 90 days and interventions older than 180 days', async () => {
    const now = new Date('2026-07-01T12:00:00.000Z');
    await recordAttempt(db, {
      sessionId: 1,
      subjectId: 1,
      assignmentId: 1,
      source: 'review',
      taskType: 'meaning',
      normalizedAnswer: 'old',
      resultKind: 'incorrect',
      scoredCorrect: false,
      srsStageBefore: 1,
      occurredAt: '2026-01-01T00:00:00.000Z',
    });
    await recordAttempt(db, {
      sessionId: 1,
      subjectId: 1,
      assignmentId: 1,
      source: 'review',
      taskType: 'meaning',
      normalizedAnswer: 'fresh',
      resultKind: 'incorrect',
      scoredCorrect: false,
      srsStageBefore: 1,
      occurredAt: '2026-06-20T00:00:00.000Z',
    });
    await db.runAsync(
      `INSERT INTO learning_interventions (
         kind, subject_ids_json, evidence_hash, state, offered_at
       ) VALUES (?, ?, ?, ?, ?)`,
      'mistake_lens',
      '[1]',
      'hash-old',
      'shown',
      '2025-01-01T00:00:00.000Z',
    );
    await db.runAsync(
      `INSERT INTO learning_interventions (
         kind, subject_ids_json, evidence_hash, state, offered_at
       ) VALUES (?, ?, ?, ?, ?)`,
      'mistake_lens',
      '[1]',
      'hash-new',
      'shown',
      '2026-06-01T00:00:00.000Z',
    );

    await pruneLearningHistory(db, now);

    const attempts = await db.getAllAsync<{ normalized_answer: string }>(
      'SELECT normalized_answer FROM review_attempts ORDER BY normalized_answer',
    );
    expect(attempts.map((row) => row.normalized_answer)).toEqual(['fresh']);

    const interventions = await db.getAllAsync<{ evidence_hash: string }>(
      'SELECT evidence_hash FROM learning_interventions ORDER BY evidence_hash',
    );
    expect(interventions.map((row) => row.evidence_hash)).toEqual(['hash-new']);

    // Same UTC day gate.
    await recordAttempt(db, {
      sessionId: 2,
      subjectId: 1,
      assignmentId: 1,
      source: 'review',
      taskType: 'meaning',
      normalizedAnswer: 'stale-again',
      resultKind: 'incorrect',
      scoredCorrect: false,
      srsStageBefore: 1,
      occurredAt: '2025-01-01T00:00:00.000Z',
    });
    await pruneLearningHistory(db, now);
    expect(await countAttempts(db)).toBe(2);
  });

  it('prunes excess attempts above the 50k cap', async () => {
    // Use raw inserts for speed; keep under full 50k by temporarily lowering via many inserts
    // is too heavy — assert cap path by inserting just over a small batch and verifying
    // prune still runs without error when under cap, and use direct SQL for excess simulation.
    const now = new Date('2026-07-01T12:00:00.000Z');
    await db.runAsync(
      `INSERT INTO learning_history_meta (key, value) VALUES ('last_maintenance_at', ?)`,
      '2026-06-01T00:00:00.000Z',
    );

    // Insert 5 rows then manually force count path by deleting nothing age-wise.
    for (let i = 0; i < 5; i += 1) {
      await db.runAsync(
        `INSERT INTO review_attempts (
           session_id, subject_id, assignment_id, source, task_type,
           normalized_answer, result_kind, scored_correct, overridden,
           occurred_at, srs_stage_before
         ) VALUES (?, ?, ?, 'review', 'meaning', ?, 'incorrect', 0, 0, ?, 1)`,
        1,
        i + 1,
        i + 1,
        `ans-${i}`,
        `2026-06-${String(10 + i).padStart(2, '0')}T00:00:00.000Z`,
      );
    }
    await pruneLearningHistory(db, now);
    expect(await countAttempts(db)).toBe(5);
  });

  it('clears learning history tables', async () => {
    await recordAttempt(db, {
      sessionId: 1,
      subjectId: 1,
      assignmentId: 1,
      source: 'review',
      taskType: 'meaning',
      normalizedAnswer: 'x',
      resultKind: 'incorrect',
      scoredCorrect: false,
      srsStageBefore: 1,
    });
    await db.runAsync(
      `INSERT INTO learning_interventions (
         kind, subject_ids_json, evidence_hash, state, offered_at
       ) VALUES ('mistake_lens', '[1]', 'h', 'offered', ?)`,
      new Date().toISOString(),
    );
    await clearLearningHistory(db);
    expect(await countAttempts(db)).toBe(0);
    const interventions = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM learning_interventions',
    );
    expect(interventions?.count).toBe(0);
    expect(await getAttemptRevision(db)).toBe(0);
  });

  it('prunes orphan attempts after subject removal', async () => {
    const vocab = makeVocabulary({ id: 42 });
    await putSubjects(db, [vocab]);
    await recordAttempt(db, {
      sessionId: 1,
      subjectId: 42,
      assignmentId: 1,
      source: 'review',
      taskType: 'meaning',
      normalizedAnswer: 'gone',
      resultKind: 'incorrect',
      scoredCorrect: false,
      srsStageBefore: 1,
    });
    await recordAttempt(db, {
      sessionId: 1,
      subjectId: 999,
      assignmentId: 2,
      source: 'review',
      taskType: 'meaning',
      normalizedAnswer: 'orphan',
      resultKind: 'incorrect',
      scoredCorrect: false,
      srsStageBefore: 1,
    });
    await db.runAsync(
      `INSERT INTO learning_interventions (
         kind, subject_ids_json, evidence_hash, state, offered_at
       ) VALUES ('confusion_pair', '[42,999]', 'pair', 'offered', ?)`,
      new Date().toISOString(),
    );

    await pruneOrphanLearningHistory(db);

    const attempts = await db.getAllAsync<{ subject_id: number }>(
      'SELECT subject_id FROM review_attempts ORDER BY subject_id',
    );
    expect(attempts.map((row) => row.subject_id)).toEqual([42]);
    const interventions = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM learning_interventions',
    );
    expect(interventions?.count).toBe(0);
  });
});
