import { getBurnedItemPracticeQueue } from './studyRepository';
import { putAssignments, putSubjects } from '../db/database';
import type { AppDatabase } from '../db/database';
import {
  makeAssignment,
  makeKanji,
  makeRadical,
  makeVocabulary,
  resetIdCounter,
} from '../../test/factories';
import { createTestDatabase } from '../../test/testDb';

const ALL_TYPES = {
  includeRadicals: true,
  includeKanji: true,
  includeVocabulary: true,
} as const;

describe('getBurnedItemPracticeQueue', () => {
  let db: AppDatabase;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    resetIdCounter();
    ({ db, cleanup } = await createTestDatabase());

    const radical = makeRadical({
      id: 201,
      characters: '火',
      level: 1,
      meanings: [{ meaning: 'Fire', primary: true, accepted_answer: true }],
      auxiliary_meanings: [],
    });
    const olderKanji = makeKanji({
      id: 202,
      characters: '山',
      level: 2,
      readings: [{ reading: 'さん', primary: true, accepted_answer: true, type: 'onyomi' }],
      meanings: [{ meaning: 'Mountain', primary: true, accepted_answer: true }],
      component_subject_ids: [],
      amalgamation_subject_ids: [],
      auxiliary_meanings: [],
    });
    const newerKanji = makeKanji({
      id: 203,
      characters: '川',
      level: 2,
      readings: [{ reading: 'かわ', primary: true, accepted_answer: true, type: 'kunyomi' }],
      meanings: [{ meaning: 'River', primary: true, accepted_answer: true }],
      component_subject_ids: [],
      amalgamation_subject_ids: [],
      auxiliary_meanings: [],
    });
    const vocab = makeVocabulary({
      id: 204,
      characters: '火山',
      level: 4,
      readings: [{ reading: 'かざん', primary: true, accepted_answer: true, type: 'onyomi' }],
      meanings: [{ meaning: 'Volcano', primary: true, accepted_answer: true }],
      component_subject_ids: [],
      context_sentences: [],
      parts_of_speech: ['noun'],
      pronunciation_audios: [],
      auxiliary_meanings: [],
    });
    const active = makeKanji({
      id: 205,
      characters: '水',
      level: 1,
      readings: [{ reading: 'すい', primary: true, accepted_answer: true, type: 'onyomi' }],
      meanings: [{ meaning: 'Water', primary: true, accepted_answer: true }],
      component_subject_ids: [],
      amalgamation_subject_ids: [],
      auxiliary_meanings: [],
    });

    await putSubjects(db, [radical, olderKanji, newerKanji, vocab, active]);
    await putAssignments(db, [
      makeAssignment(201, {
        subject_type: 'radical',
        srs_stage: 9,
        burned_at: '2024-02-01T00:00:00.000Z',
      }),
      makeAssignment(202, {
        subject_type: 'kanji',
        srs_stage: 9,
        burned_at: '2024-01-01T00:00:00.000Z',
      }),
      makeAssignment(203, {
        subject_type: 'kanji',
        srs_stage: 9,
        burned_at: '2024-04-01T00:00:00.000Z',
      }),
      makeAssignment(204, {
        subject_type: 'vocabulary',
        srs_stage: 9,
        burned_at: '2024-03-01T00:00:00.000Z',
      }),
      makeAssignment(205, {
        subject_type: 'kanji',
        srs_stage: 5,
        burned_at: null,
      }),
    ]);
  });

  afterEach(async () => {
    await cleanup();
  });

  test('orders by oldest burned', async () => {
    const queue = await getBurnedItemPracticeQueue(db, {
      order: 'oldestBurned',
      limit: 50,
      ...ALL_TYPES,
    });
    expect(queue.map((item) => item.subjectId)).toEqual([202, 201, 204, 203]);
  });

  test('orders by newest burned', async () => {
    const queue = await getBurnedItemPracticeQueue(db, {
      order: 'newestBurned',
      limit: 50,
      ...ALL_TYPES,
    });
    expect(queue.map((item) => item.subjectId)).toEqual([203, 204, 201, 202]);
  });

  test('filters by selected subject types', async () => {
    const queue = await getBurnedItemPracticeQueue(db, {
      order: 'oldestBurned',
      limit: 50,
      includeRadicals: false,
      includeKanji: true,
      includeVocabulary: false,
    });
    expect(queue.map((item) => item.subjectId)).toEqual([202, 203]);
    expect(queue.every((item) => item.subjectType === 'kanji')).toBe(true);
  });

  test('clamps queue length to limit', async () => {
    const queue = await getBurnedItemPracticeQueue(db, {
      order: 'oldestBurned',
      limit: 2,
      ...ALL_TYPES,
    });
    expect(queue).toHaveLength(2);
    expect(queue.map((item) => item.subjectId)).toEqual([202, 201]);
  });

  test('returns empty when no types selected', async () => {
    const queue = await getBurnedItemPracticeQueue(db, {
      order: 'oldestBurned',
      limit: 50,
      includeRadicals: false,
      includeKanji: false,
      includeVocabulary: false,
    });
    expect(queue).toEqual([]);
  });

  test('random returns limited items from the filtered set', async () => {
    const queue = await getBurnedItemPracticeQueue(db, {
      order: 'random',
      limit: 2,
      includeRadicals: false,
      includeKanji: true,
      includeVocabulary: true,
    });
    expect(queue).toHaveLength(2);
    const ids = new Set(queue.map((item) => item.subjectId));
    expect(ids.size).toBe(2);
    for (const id of ids) {
      expect([202, 203, 204]).toContain(id);
    }
  });
});
