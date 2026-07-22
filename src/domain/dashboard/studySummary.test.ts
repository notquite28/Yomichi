import { applyMigrations, putAssignments, putSubjects, putUser } from '../db/database';
import { createTestDb } from '../../test/sqliteShim';
import {
  makeVocabulary,
  makeAssignment,
  makeUser,
  resetIdCounter,
} from '../../test/factories';
import { recordAttempt } from '../study/reviewAttempts';
import {
  buildStudySummaryFacts,
  renderDeterministicSummary,
  studySummaryFactRefAllowlist,
} from './studySummary';
import type { AppDatabase } from '../db/database';

async function setupDb(): Promise<AppDatabase> {
  const db = createTestDb();
  await applyMigrations(db);
  return db;
}

describe('studySummary', () => {
  let db: AppDatabase;

  beforeEach(async () => {
    resetIdCounter();
    db = await setupDb();
    await putUser(db, makeUser({ level: 5, username: 'tester' }));
    const vocab = makeVocabulary({ id: 1 });
    await putSubjects(db, [vocab]);
    await putAssignments(db, [
      makeAssignment(1, {
        id: 10,
        subject_id: 1,
        srs_stage: 1,
        available_at: '2020-01-01T00:00:00.000Z',
        started_at: '2020-01-01T00:00:00.000Z',
      }),
    ]);
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('builds facts with top-5 limits and no recentWindow without attempts', async () => {
    const facts = await buildStudySummaryFacts(db, { syncRevision: 3 });
    expect(facts.level).toBe(5);
    expect(facts.recentMistakes.length).toBeLessThanOrEqual(5);
    expect(facts.topLeeches.length).toBeLessThanOrEqual(5);
    expect(facts.recentWindow).toBeNull();
    expect(facts.syncRevision).toBe(3);
    expect(studySummaryFactRefAllowlist(facts).has('facts.available_reviews')).toBe(true);
  });

  it('includes recentWindow after scored attempts', async () => {
    await recordAttempt(db, {
      sessionId: 1,
      subjectId: 1,
      assignmentId: 10,
      source: 'review',
      taskType: 'meaning',
      normalizedAnswer: null,
      resultKind: 'precise',
      scoredCorrect: true,
      srsStageBefore: 1,
    });
    const facts = await buildStudySummaryFacts(db);
    expect(facts.recentWindow).not.toBeNull();
    expect(facts.recentWindow?.scoredAttempts).toBe(1);
  });

  it('deterministic renderer mentions available reviews count', async () => {
    const facts = await buildStudySummaryFacts(db);
    const rendered = renderDeterministicSummary(facts);
    expect(rendered.overview).toContain(String(facts.availableReviews));
    expect(rendered.metrics.some((m) => m.label === 'Reviews due')).toBe(true);
    expect(rendered.nextAction.length).toBeGreaterThan(0);
  });
});
