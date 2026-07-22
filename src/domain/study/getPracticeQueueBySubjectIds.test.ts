import { applyMigrations, putAssignments, putSubjects } from '../db/database';
import { createTestDb } from '../../test/sqliteShim';
import { makeVocabulary, makeAssignment, resetIdCounter } from '../../test/factories';
import { getPracticeQueueBySubjectIds } from './studyRepository';
import type { AppDatabase } from '../db/database';

async function setupDb(): Promise<AppDatabase> {
  const db = createTestDb();
  await applyMigrations(db);
  return db;
}

describe('getPracticeQueueBySubjectIds', () => {
  let db: AppDatabase;

  beforeEach(async () => {
    resetIdCounter();
    db = await setupDb();
    await putSubjects(db, [
      makeVocabulary({ id: 1, characters: '犬' }),
      makeVocabulary({ id: 2, characters: '猫' }),
    ]);
    await putAssignments(db, [
      makeAssignment(1, { id: 11, subject_id: 1, srs_stage: 2, started_at: '2024-01-01T00:00:00.000Z' }),
      makeAssignment(2, { id: 22, subject_id: 2, srs_stage: 5, started_at: '2024-01-01T00:00:00.000Z' }),
    ]);
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('returns both subjects, repeated for pair practice length', async () => {
    const queue = await getPracticeQueueBySubjectIds(db, [1, 2]);
    const ids = queue.map((item) => item.subjectId);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
    expect(ids.filter((id) => id === 1).length).toBeGreaterThanOrEqual(1);
    expect(ids.filter((id) => id === 2).length).toBeGreaterThanOrEqual(1);
    // Repeated pair: at least [A,B,A,B] shape when both exist.
    expect(queue.length).toBeGreaterThanOrEqual(4);
  });

  it('preserves order and de-dupes input ids', async () => {
    const queue = await getPracticeQueueBySubjectIds(db, [2, 1, 2]);
    const firstTwo = queue.slice(0, 2).map((item) => item.subjectId);
    expect(firstTwo).toEqual([2, 1]);
  });
});
