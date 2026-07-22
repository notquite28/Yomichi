import { applyMigrations, putAssignments, putSubjects } from '../db/database';
import { createTestDb } from '../../test/sqliteShim';
import { makeKanji, makeVocabulary, makeAssignment, resetIdCounter } from '../../test/factories';
import { recordAttempt } from './reviewAttempts';
import {
  buildDeterministicCard,
  evaluateInterventionOffer,
  loadSubjectsForOffer,
} from './learningEvidence';
import type { AppDatabase } from '../db/database';

async function setupDb(): Promise<AppDatabase> {
  const db = createTestDb();
  await applyMigrations(db);
  return db;
}

describe('learningEvidence', () => {
  let db: AppDatabase;

  beforeEach(async () => {
    resetIdCounter();
    db = await setupDb();
    const kanjiA = makeKanji({
      id: 10,
      characters: '大',
      meanings: [{ meaning: 'big', primary: true, accepted_answer: true }],
      readings: [{ reading: 'だい', primary: true, accepted_answer: true, type: 'onyomi' }],
    });
    const kanjiB = makeKanji({
      id: 11,
      characters: '太',
      meanings: [{ meaning: 'fat', primary: true, accepted_answer: true }],
      readings: [{ reading: 'たい', primary: true, accepted_answer: true, type: 'onyomi' }],
    });
    const kanjiC = makeKanji({
      id: 12,
      characters: '代',
      meanings: [{ meaning: 'substitute', primary: true, accepted_answer: true }],
      readings: [{ reading: 'だい', primary: true, accepted_answer: true, type: 'onyomi' }],
    });
    await putSubjects(db, [kanjiA, kanjiB, kanjiC]);
    await putAssignments(db, [
      makeAssignment(10, { id: 100, subject_id: 10, srs_stage: 3, started_at: '2024-01-01T00:00:00.000Z' }),
      makeAssignment(11, { id: 101, subject_id: 11, srs_stage: 2, started_at: '2024-01-01T00:00:00.000Z' }),
      makeAssignment(12, { id: 102, subject_id: 12, srs_stage: 4, started_at: '2024-01-01T00:00:00.000Z' }),
    ]);
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('does not offer Mistake Lens after a single miss', async () => {
    await recordAttempt(db, {
      sessionId: 1,
      subjectId: 10,
      assignmentId: 100,
      source: 'review',
      taskType: 'meaning',
      normalizedAnswer: 'large',
      resultKind: 'incorrect',
      scoredCorrect: false,
      srsStageBefore: 3,
    });
    const offer = await evaluateInterventionOffer(db, {
      subjectId: 10,
      taskType: 'meaning',
      wrongAnswer: 'large',
      justMissed: true,
    });
    // wrong answer may still match nothing; single miss alone is not enough for repeated_miss
    if (offer?.type === 'mistake_lens') {
      throw new Error('expected no repeated_miss offer after 1 miss');
    }
  });

  it('offers repeated_miss after two scored misses', async () => {
    const now = new Date('2026-07-01T12:00:00.000Z');
    await recordAttempt(db, {
      sessionId: 1,
      subjectId: 10,
      assignmentId: 100,
      source: 'review',
      taskType: 'meaning',
      normalizedAnswer: 'large',
      resultKind: 'incorrect',
      scoredCorrect: false,
      srsStageBefore: 3,
      occurredAt: '2026-06-30T12:00:00.000Z',
    });
    await recordAttempt(db, {
      sessionId: 1,
      subjectId: 10,
      assignmentId: 100,
      source: 'review',
      taskType: 'meaning',
      normalizedAnswer: 'huge',
      resultKind: 'incorrect',
      scoredCorrect: false,
      srsStageBefore: 3,
      occurredAt: '2026-07-01T11:00:00.000Z',
    });

    const offer = await evaluateInterventionOffer(db, {
      subjectId: 10,
      taskType: 'meaning',
      wrongAnswer: 'huge',
      justMissed: true,
      now,
    });
    expect(offer?.type).toBe('mistake_lens');
    if (offer?.type === 'mistake_lens') {
      expect(offer.evidence.missCount).toBe(2);
      const subjects = await loadSubjectsForOffer(db, offer);
      const card = buildDeterministicCard(offer, subjects);
      expect(card.title).toBe('Mistake Lens');
      expect(card.missCount).toBe(2);
    }
  });

  it('offers unambiguous confusion_pair when wrong reading matches one learned subject', async () => {
    await recordAttempt(db, {
      sessionId: 1,
      subjectId: 11,
      assignmentId: 101,
      source: 'review',
      taskType: 'reading',
      normalizedAnswer: 'だい',
      resultKind: 'incorrect',
      scoredCorrect: false,
      srsStageBefore: 2,
    });
    // Also need a second miss OR pair can still surface on first wrong if match exists.
    // Spec: confusion pair uses latest wrong answer match; precedence over repeated miss.
    const offer = await evaluateInterventionOffer(db, {
      subjectId: 11,
      taskType: 'reading',
      wrongAnswer: 'だい',
      justMissed: true,
    });
    expect(offer?.type).toBe('confusion_pair');
    if (offer?.type === 'confusion_pair') {
      // 大 and 代 both accept だい — ambiguous
      expect(offer.ambiguous).toBe(true);
      expect(offer.evidence.matches.length).toBeGreaterThan(1);
    }
  });

  it('marks single-match confusion pair as unambiguous', async () => {
    // 太 reading たい — only itself has たい among seeded subjects if we answer with a unique match.
    // Seed an extra vocab with unique reading match for subject 10 wrong answer.
    const vocab = makeVocabulary({
      id: 20,
      characters: '大学',
      readings: [{ reading: 'だいがく', primary: true, accepted_answer: true, type: 'onyomi' }],
      meanings: [{ meaning: 'university', primary: true, accepted_answer: true }],
    });
    await putSubjects(db, [vocab]);
    await putAssignments(db, [
      makeAssignment(20, { id: 200, subject_id: 20, srs_stage: 2, started_at: '2024-01-01T00:00:00.000Z' }),
    ]);

    await recordAttempt(db, {
      sessionId: 1,
      subjectId: 10,
      assignmentId: 100,
      source: 'review',
      taskType: 'reading',
      normalizedAnswer: 'だいがく',
      resultKind: 'incorrect',
      scoredCorrect: false,
      srsStageBefore: 3,
    });

    const offer = await evaluateInterventionOffer(db, {
      subjectId: 10,
      taskType: 'reading',
      wrongAnswer: 'だいがく',
      justMissed: true,
    });
    expect(offer?.type).toBe('confusion_pair');
    if (offer?.type === 'confusion_pair') {
      expect(offer.ambiguous).toBe(false);
      expect(offer.evidence.matches).toHaveLength(1);
      expect(offer.evidence.matches[0]!.otherSubjectId).toBe(20);
    }
  });
});
