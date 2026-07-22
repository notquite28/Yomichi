import {
  getBurnedSubjects,
  getBurnedSubjectCount,
  parseSynonymJson,
  searchSubjects,
  type SearchResult,
} from './subjectRepository';
import { createTestDatabase } from '../../test/testDb';
import { putSubjects, putAssignments, putReviewStats } from './database';
import {
  makeRadical,
  makeKanji,
  makeVocabulary,
  makeAssignment,
  makeReviewStat,
  resetIdCounter,
} from '../../test/factories';
import type { AppDatabase } from './database';

describe('parseSynonymJson', () => {
  test('parses valid JSON array of strings', () => {
    expect(parseSynonymJson('["hello","world"]')).toEqual(['hello', 'world']);
  });

  test('returns empty array for empty JSON array', () => {
    expect(parseSynonymJson('[]')).toEqual([]);
  });

  test('filters non-string values from array', () => {
    expect(parseSynonymJson('["hello", 42, null, "world"]')).toEqual(['hello', 'world']);
  });

  test('returns empty array for non-array JSON', () => {
    expect(parseSynonymJson('"hello"')).toEqual([]);
    expect(parseSynonymJson('42')).toEqual([]);
    expect(parseSynonymJson('null')).toEqual([]);
  });

  test('returns empty array for invalid JSON', () => {
    expect(parseSynonymJson('not json')).toEqual([]);
  });
});

// ── Test data ────────────────────────────────────────────────────────────────
// Radical "大"  (level 1, meaning "big")
// Kanji   "大"  (level 2, readings だい/たい, meanings big/large)
// Vocab   "大きい" (level 5, reading おおきい, meanings big/large)
// Vocab   "大学"  (level 10, reading だいがく, meaning university)
// Kanji   "小"   (level 3, reading しょう, meanings small/little)
// Vocab   "大"   (level 1, reading だい, meaning great)

async function seedSearchData(db: AppDatabase) {
  resetIdCounter();
  const subjects = [
    makeRadical({ id: 1, characters: '大', level: 1, meanings: [{ meaning: 'big', primary: true, accepted_answer: true }], auxiliary_meanings: [] }),
    makeKanji({ id: 2, characters: '大', level: 2, readings: [{ reading: 'だい', primary: true, accepted_answer: true, type: 'onyomi' }, { reading: 'たい', primary: false, accepted_answer: true, type: 'kunyomi' }], meanings: [{ meaning: 'big', primary: true, accepted_answer: true }, { meaning: 'large', primary: false, accepted_answer: true }], component_subject_ids: [], amalgamation_subject_ids: [], auxiliary_meanings: [] }),
    makeVocabulary({ id: 3, characters: '大きい', level: 5, readings: [{ reading: 'おおきい', primary: true, accepted_answer: true, type: 'kunyomi' }], meanings: [{ meaning: 'big', primary: true, accepted_answer: true }, { meaning: 'large', primary: false, accepted_answer: true }], component_subject_ids: [], context_sentences: [], parts_of_speech: ['adjective'], pronunciation_audios: [], auxiliary_meanings: [] }),
    makeVocabulary({ id: 4, characters: '大学', level: 10, readings: [{ reading: 'だいがく', primary: true, accepted_answer: true, type: 'onyomi' }], meanings: [{ meaning: 'university', primary: true, accepted_answer: true }], component_subject_ids: [], context_sentences: [], parts_of_speech: ['noun'], pronunciation_audios: [], auxiliary_meanings: [] }),
    makeKanji({ id: 5, characters: '小', level: 3, readings: [{ reading: 'しょう', primary: true, accepted_answer: true, type: 'onyomi' }], meanings: [{ meaning: 'small', primary: true, accepted_answer: true }, { meaning: 'little', primary: false, accepted_answer: true }], component_subject_ids: [], amalgamation_subject_ids: [], auxiliary_meanings: [] }),
    makeVocabulary({ id: 6, characters: '大', level: 1, readings: [{ reading: 'だい', primary: true, accepted_answer: true, type: 'onyomi' }], meanings: [{ meaning: 'great', primary: true, accepted_answer: true }], component_subject_ids: [], context_sentences: [], parts_of_speech: ['adjective'], pronunciation_audios: [], auxiliary_meanings: [] }),
    makeVocabulary({ id: 7, characters: '多大', level: 7, readings: [{ reading: 'ただい', primary: true, accepted_answer: true, type: 'onyomi' }], meanings: [{ meaning: 'huge amount', primary: true, accepted_answer: true }], component_subject_ids: [], context_sentences: [], parts_of_speech: ['noun'], pronunciation_audios: [], auxiliary_meanings: [] }),
  ];
  await putSubjects(db, subjects);

  // Add assignments so srsStage is non-null for some subjects
  const assignments = [
    makeAssignment(1, { srs_stage: 4 }),
    makeAssignment(2, { srs_stage: 6 }),
    makeAssignment(3, { srs_stage: 2 }),
    makeAssignment(4, { srs_stage: 1 }),
    makeAssignment(5, { srs_stage: 8 }),
    makeAssignment(6, { srs_stage: 3 }),
    makeAssignment(7, { srs_stage: 5 }),
  ];
  await putAssignments(db, assignments);
}

describe('searchSubjects', () => {
  let db: AppDatabase;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const result = await createTestDatabase();
    db = result.db;
    cleanup = result.cleanup;
    await seedSearchData(db);
  });

  afterAll(async () => {
    await cleanup();
  });

  function ids(results: SearchResult[]) {
    return results.map((r) => r.id);
  }

  function matchTypes(results: SearchResult[]) {
    return results.map((r) => r.matchType);
  }

  // ── Basic matching ────────────────────────────────────────────────────────

  test('empty query returns empty array', async () => {
    expect(await searchSubjects(db, '')).toEqual([]);
  });

  test('whitespace-only query returns empty array', async () => {
    expect(await searchSubjects(db, '   ')).toEqual([]);
  });

  test('exact match on japanese text', async () => {
    const results = await searchSubjects(db, '小');
    expect(results.length).toBeGreaterThan(0);
    // Kanji 小 has japanese "小" → exact match
    const kanjiSmall = results.find((r) => r.id === 5);
    expect(kanjiSmall).toBeDefined();
    expect(kanjiSmall!.matchType).toBe('exact');
  });

  test('exact match on reading', async () => {
    const results = await searchSubjects(db, 'だい');
    // Kanji 大 (id=2) has reading "だい" → exact; Vocab 大 (id=6) has reading "だい" → exact
    // Vocab 大学 (id=4) has reading "だいがく" starts with "だい" → prefix
    const exactIds = results.filter((r) => r.matchType === 'exact').map((r) => r.id);
    expect(exactIds).toContain(2);
    expect(exactIds).toContain(6);
    const prefixIds = results.filter((r) => r.matchType === 'prefix').map((r) => r.id);
    expect(prefixIds).toContain(4);
  });

  test('exact match on meaning', async () => {
    const results = await searchSubjects(db, 'big');
    // Subjects 1, 2, 3 all have meaning "big" → exact
    const exactIds = results.filter((r) => r.matchType === 'exact').map((r) => r.id);
    expect(exactIds).toContain(1);
    expect(exactIds).toContain(2);
    expect(exactIds).toContain(3);
  });

  // ── Prefix and contains matching ─────────────────────────────────────────

  test('prefix match on japanese', async () => {
    const results = await searchSubjects(db, '大');
    // 大きい (id=3) starts with 大 → prefix; 大学 (id=4) starts with 大 → prefix
    const prefix = results.filter((r) => r.matchType === 'prefix');
    const prefixIds = prefix.map((r) => r.id);
    expect(prefixIds).toContain(3);
    expect(prefixIds).toContain(4);
  });

  test('prefix match on reading', async () => {
    const results = await searchSubjects(db, 'おお');
    // Vocab 大きい (id=3) reading "おおきい" starts with "おお" → prefix
    expect(results.length).toBe(1);
    expect(results[0]!.id).toBe(3);
    expect(results[0]!.matchType).toBe('prefix');
  });

  test('prefix match on meaning', async () => {
    const results = await searchSubjects(db, 'sm');
    // Kanji 小 (id=5) meaning "small" starts with "sm" → prefix
    expect(results.length).toBe(1);
    expect(results[0]!.id).toBe(5);
    expect(results[0]!.matchType).toBe('prefix');
  });

  test('contains match (not exact or prefix)', async () => {
    const results = await searchSubjects(db, 'rsity');
    // Vocab 大学 (id=4) meaning "university" contains "rsity" → contains
    expect(results.length).toBe(1);
    expect(results[0]!.id).toBe(4);
    expect(results[0]!.matchType).toBe('contains');
  });

  // ── Ranking and sorting ──────────────────────────────────────────────────

  test('exact matches come before prefix before contains', async () => {
    // Query "大":
    //   exact:  subjects 1,6 (japanese "大", level 1), 2 (japanese "大", level 2)
    //   prefix: subjects 3 (大きい), 4 (大学)
    //   contains: subject 7 (多大 — "大" in non-prefix position)
    const results = await searchSubjects(db, '大');
    const types = matchTypes(results);
    expect(types.slice(0, 3).every((t) => t === 'exact')).toBe(true);
    expect(types.slice(3, 5).every((t) => t === 'prefix')).toBe(true);
    expect(types.slice(5).every((t) => t === 'contains')).toBe(true);
  });

  test('lower level sorts before higher level within same match type', async () => {
    // Query "big": subjects 1 (level 1), 2 (level 2), 3 (level 5) all exact
    const results = await searchSubjects(db, 'big');
    const exactResults = results.filter((r) => r.matchType === 'exact');
    expect(exactResults.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  test('subject_type order within same match type and level', async () => {
    // Query "大": subjects 1 (radical, level 1) and 6 (vocabulary, level 1) both exact
    // Alphabetically: 'radical' < 'vocabulary'
    const results = await searchSubjects(db, '大');
    const exactAtLevel1 = results.filter((r) => r.matchType === 'exact' && r.level === 1);
    expect(exactAtLevel1.map((r) => r.subjectType)).toEqual(['radical', 'vocabulary']);
  });

  test('limit parameter truncates results', async () => {
    const unlimited = await searchSubjects(db, '大');
    expect(unlimited.length).toBeGreaterThanOrEqual(6);
    const limited = await searchSubjects(db, '大', 2);
    expect(limited.length).toBe(2);
    expect(limited).toEqual(unlimited.slice(0, 2));
  });

  test('case insensitivity — uppercase query matches lowercase meaning', async () => {
    const results = await searchSubjects(db, 'BIG');
    const exactIds = results.filter((r) => r.matchType === 'exact').map((r) => r.id);
    expect(exactIds).toContain(1);
    expect(exactIds).toContain(2);
    expect(exactIds).toContain(3);
  });
});

describe('getBurnedSubjects', () => {
  let db: AppDatabase;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    resetIdCounter();
    ({ db, cleanup } = await createTestDatabase());

    const radical = makeRadical({
      id: 101,
      characters: '火',
      level: 1,
      meanings: [{ meaning: 'Fire', primary: true, accepted_answer: true }],
      auxiliary_meanings: [],
    });
    const olderKanji = makeKanji({
      id: 102,
      characters: '山',
      level: 2,
      readings: [
        { reading: 'さん', primary: true, accepted_answer: true, type: 'onyomi' },
        { reading: 'やま', primary: true, accepted_answer: true, type: 'kunyomi' },
        { reading: 'せん', primary: false, accepted_answer: true, type: 'onyomi' },
      ],
      meanings: [
        { meaning: 'Mountain', primary: true, accepted_answer: true },
        { meaning: 'Hill', primary: false, accepted_answer: true },
      ],
      component_subject_ids: [],
      amalgamation_subject_ids: [],
      auxiliary_meanings: [],
    });
    const newerVocab = makeVocabulary({
      id: 103,
      characters: '火山',
      level: 3,
      readings: [{ reading: 'かざん', primary: true, accepted_answer: true, type: 'onyomi' }],
      meanings: [{ meaning: 'Volcano', primary: true, accepted_answer: true }],
      component_subject_ids: [],
      context_sentences: [],
      parts_of_speech: ['noun'],
      pronunciation_audios: [],
      auxiliary_meanings: [],
    });
    const activeKanji = makeKanji({
      id: 104,
      characters: '水',
      level: 1,
      readings: [{ reading: 'すい', primary: true, accepted_answer: true, type: 'onyomi' }],
      meanings: [{ meaning: 'Water', primary: true, accepted_answer: true }],
      component_subject_ids: [],
      amalgamation_subject_ids: [],
      auxiliary_meanings: [],
    });

    await putSubjects(db, [radical, olderKanji, newerVocab, activeKanji]);
    await putAssignments(db, [
      makeAssignment(101, {
        subject_type: 'radical',
        srs_stage: 9,
        burned_at: '2024-03-01T00:00:00.000Z',
      }),
      makeAssignment(102, {
        subject_type: 'kanji',
        srs_stage: 9,
        burned_at: '2024-01-01T00:00:00.000Z',
      }),
      makeAssignment(103, {
        subject_type: 'vocabulary',
        srs_stage: 9,
        burned_at: '2024-05-01T00:00:00.000Z',
      }),
      makeAssignment(104, {
        subject_type: 'kanji',
        srs_stage: 5,
        burned_at: null,
      }),
    ]);
    await putReviewStats(db, [
      makeReviewStat(102, { percentage_correct: 88 }),
    ]);
  });

  afterEach(async () => {
    await cleanup();
  });

  test('returns only stage-9 subjects ordered by oldest burned', async () => {
    const rows = await getBurnedSubjects(db);
    expect(rows.map((row) => row.id)).toEqual([102, 101, 103]);
  });

  test('returns a stable page and total count', async () => {
    await expect(getBurnedSubjectCount(db)).resolves.toBe(3);
    await expect(getBurnedSubjects(db, { limit: 2, offset: 1 })).resolves.toMatchObject([
      { id: 101 },
      { id: 103 },
    ]);
  });

  test('joins primary readings and primary meaning', async () => {
    const rows = await getBurnedSubjects(db);
    const kanji = rows.find((row) => row.id === 102);
    expect(kanji).toMatchObject({
      japanese: '山',
      primaryReadings: 'さん · やま',
      primaryMeaning: 'Mountain',
      percentageCorrect: 88,
      burnedAt: '2024-01-01T00:00:00.000Z',
    });
  });

  test('radicals have empty primary readings', async () => {
    const rows = await getBurnedSubjects(db);
    const radical = rows.find((row) => row.id === 101);
    expect(radical).toMatchObject({
      japanese: '火',
      primaryReadings: '',
      primaryMeaning: 'Fire',
    });
  });
  test('tolerates an individually corrupted cached payload', async () => {
    await db.runAsync('UPDATE subjects SET payload = ? WHERE id = ?', 'truncated {', 101);

    const rows = await getBurnedSubjects(db);

    expect(rows.map((row) => row.id)).toEqual([102, 101, 103]);
    expect(rows.find((row) => row.id === 101)).toMatchObject({
      japanese: '火',
      primaryReadings: '',
      primaryMeaning: '',
    });
    expect(rows.find((row) => row.id === 102)).toMatchObject({
      primaryReadings: 'さん · やま',
      primaryMeaning: 'Mountain',
    });
  });

});
