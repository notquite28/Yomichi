/**
 * Integration tests for the full sync pipeline.
 *
 * These tests exercise the sync service with a real in-memory SQLite database
 * and a mock API client. They verify:
 * - Incremental sync stores all collection data correctly
 * - Cursors advance after each sync
 * - Pending writes flush before remote fetches
 * - clearRemoteCache preserves pending writes
 * - Full refresh clears remote data but re-fetches everything
 * - Progress callbacks fire for each sync step
 * - Checkpoint callbacks fire after each collection save
 */
import { applyMigrations, clearRemoteCache, getLastSyncTime, getSyncCursors, putAssignments, putSubjects, resetLocalData } from '../../domain/db/database';
import { runFullRefresh, runIncrementalSync, runPendingSync, SyncProgress } from '../../domain/sync/syncService';
import { queueLessonStart, queueReviewResult, queueStudyMaterialUpdate } from '../../domain/study/studyRepository';
import { createMockApi, apiError, type MockApiClient } from '../../test/mockApi';
import { createTestDb } from '../../test/sqliteShim';
import {
  makeUser,
  makeRadical,
  makeKanji,
  makeVocabulary,
  makeKanaVocabulary,
  makeAssignment,
  makeStudyMaterial,
  makeLevelProgression,
  makeVoiceActor,
  makeReviewStat,
  resetIdCounter,
} from '../../test/factories';
import type { AppDatabase } from '../../domain/db/database';
import type { WaniKaniClient } from '../../domain/api/WaniKaniClient';
import { WaniKaniApiError } from '../../domain/api/WaniKaniClient';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function setupDb(): Promise<AppDatabase> {
  const db = createTestDb();
  await applyMigrations(db);
  return db;
}

function collectionResult<T>(dataUpdatedAt: string, items: T[] = []) {
  return { items, dataUpdatedAt, totalCount: items.length };
}

// ── Incremental Sync ─────────────────────────────────────────────────────────

describe('runIncrementalSync', () => {
  let db: AppDatabase;

  beforeEach(async () => {
    resetIdCounter();
    db = await setupDb();
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('stores user, subjects, assignments, study materials, level progressions, voice actors, and review stats', async () => {
    const radical = makeRadical({ id: 100 });
    const kanji = makeKanji({ id: 200 });
    const vocab = makeVocabulary({ id: 300 });
    const user = makeUser({ username: 'integration', level: 3 });
    const assignment = makeAssignment(300, { id: 400, subject_id: 300, srs_stage: 2 });
    const studyMaterial = makeStudyMaterial(300, { id: 500, subject_id: 300 });
    const levelProgression = makeLevelProgression({ id: 600, level: 1 });
    const voiceActor = makeVoiceActor({ id: 700, name: 'TestActor' });
    const reviewStat = makeReviewStat(300, { id: 800, subject_id: 300 });

    const mockApi = createMockApi({
      getUser: async () => user,
      getSubjects: async () => collectionResult('2024-06-01T01:00:00.000Z', [radical, kanji, vocab]),
      getAssignments: async () => collectionResult('2024-06-01T02:00:00.000Z', [assignment]),
      getStudyMaterials: async () => collectionResult('2024-06-01T03:00:00.000Z', [studyMaterial]),
      getLevelProgressions: async () => collectionResult('2024-06-01T04:00:00.000Z', [levelProgression]),
      getVoiceActors: async () => collectionResult('2024-06-01T05:00:00.000Z', [voiceActor]),
      getReviewStatistics: async () => collectionResult('2024-06-01T06:00:00.000Z', [reviewStat]),
    });
    const client = mockApi as unknown as WaniKaniClient;

    await runIncrementalSync({ db, client });

    // Verify user
    const userRow = await db.getFirstAsync<{ username: string; level: number }>('SELECT username, level FROM user WHERE id = 1');
    expect(userRow?.username).toBe('integration');
    expect(userRow?.level).toBe(3);

    // Verify subjects
    const subjects = await db.getAllAsync<{ id: number; subject_type: string; japanese: string }>('SELECT id, subject_type, japanese FROM subjects ORDER BY id');
    expect(subjects).toHaveLength(3);
    expect(subjects[0]!.subject_type).toBe('radical');
    expect(subjects[1]!.subject_type).toBe('kanji');
    expect(subjects[2]!.subject_type).toBe('vocabulary');

    // Verify assignments
    const assignments = await db.getAllAsync<{ id: number; subject_id: number; srs_stage: number }>('SELECT id, subject_id, srs_stage FROM assignments');
    expect(assignments).toHaveLength(1);
    expect(assignments[0]!.subject_id).toBe(300);
    expect(assignments[0]!.srs_stage).toBe(2);

    // Verify study materials
    const materials = await db.getAllAsync<{ id: number; subject_id: number }>('SELECT id, subject_id FROM study_materials');
    expect(materials).toHaveLength(1);
    expect(materials[0]!.subject_id).toBe(300);

    // Verify level progressions
    const levels = await db.getAllAsync<{ id: number; level: number }>('SELECT id, level FROM level_progressions');
    expect(levels).toHaveLength(1);
    expect(levels[0]!.level).toBe(1);

    // Verify voice actors
    const actors = await db.getAllAsync<{ id: number; name: string }>('SELECT id, name FROM voice_actors');
    expect(actors).toHaveLength(1);
    expect(actors[0]!.name).toBe('TestActor');

    // Verify review stats
    const stats = await db.getAllAsync<{ id: number; subject_id: number; percentage_correct: number }>('SELECT id, subject_id, percentage_correct FROM review_stats');
    expect(stats).toHaveLength(1);
    expect(stats[0]!.percentage_correct).toBe(91);
  });

  it('keeps pending study material overlays when request reserve defers pending sends', async () => {
    const subjectId = 301;
    const vocab = makeVocabulary({ id: subjectId });
    await putSubjects(db, [vocab]);
    await queueStudyMaterialUpdate(db, { subjectId, meaningNote: 'local note' });

    const remoteStudyMaterial = makeStudyMaterial(subjectId, {
      id: 901,
      meaning_note: 'remote note',
      reading_note: 'remote reading',
      meaning_synonyms: ['remote'],
    });
    const mockApi = createMockApi({
      requestsRemainingInInterval: 21,
      getUser: async () => makeUser(),
      getSubjects: async () => collectionResult('2024-06-01T01:00:00.000Z'),
      getAssignments: async () => collectionResult('2024-06-01T02:00:00.000Z'),
      getStudyMaterials: async () => collectionResult('2024-06-01T03:00:00.000Z', [remoteStudyMaterial]),
      getLevelProgressions: async () => collectionResult('2024-06-01T04:00:00.000Z'),
      getVoiceActors: async () => collectionResult('2024-06-01T05:00:00.000Z'),
      getReviewStatistics: async () => collectionResult('2024-06-01T06:00:00.000Z'),
    });

    await runIncrementalSync({ db, client: mockApi as unknown as WaniKaniClient });

    const pending = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM pending_study_materials');
    expect(pending?.count).toBe(1);
    const material = await db.getFirstAsync<{ payload: string }>(
      'SELECT payload FROM study_materials WHERE subject_id = ?',
      subjectId,
    );
    const parsed = JSON.parse(material!.payload) as {
      data: { meaning_note: string; reading_note: string; meaning_synonyms: string[] };
    };
    expect(parsed.data.meaning_note).toBe('local note');
    expect(parsed.data.reading_note).toBe('remote reading');
    expect(parsed.data.meaning_synonyms).toEqual(['remote']);
  });

  it('preserves local offline assignment progress when pending flush is deferred by reserve', async () => {
    const subjectId = 310;
    const assignmentId = 610;
    const vocab = makeVocabulary({ id: subjectId });
    const assignment = makeAssignment(subjectId, {
      id: assignmentId,
      subject_id: subjectId,
      srs_stage: 1,
      started_at: '2024-01-01T00:00:00.000Z',
      available_at: '2024-01-01T00:00:00.000Z',
    });
    await putSubjects(db, [vocab]);
    await putAssignments(db, [assignment]);
    await queueReviewResult(db, {
      assignmentId,
      incorrectMeaningAnswers: 0,
      incorrectReadingAnswers: 0,
    });

    const local = await db.getFirstAsync<{ srs_stage: number; available_at: string | null }>(
      'SELECT srs_stage, available_at FROM assignments WHERE id = ?',
      assignmentId,
    );
    expect(local?.srs_stage).toBe(2);
    expect(local?.available_at).toBeNull();

    // Remote still shows the pre-review assignment. Budget is only enough for
    // download reserve, so the pending review is not flushed before putAssignments.
    const remoteAssignment = makeAssignment(subjectId, {
      id: assignmentId,
      subject_id: subjectId,
      srs_stage: 1,
      started_at: '2024-01-01T00:00:00.000Z',
      available_at: '2024-01-01T00:00:00.000Z',
    });
    const mockApi = createMockApi({
      requestsRemainingInInterval: 21,
      getUser: async () => makeUser(),
      getSubjects: async () => collectionResult('2024-06-01T01:00:00.000Z', [vocab]),
      getAssignments: async () => collectionResult('2024-06-01T02:00:00.000Z', [remoteAssignment]),
      getStudyMaterials: async () => collectionResult('2024-06-01T03:00:00.000Z'),
      getLevelProgressions: async () => collectionResult('2024-06-01T04:00:00.000Z'),
      getVoiceActors: async () => collectionResult('2024-06-01T05:00:00.000Z'),
      getReviewStatistics: async () => collectionResult('2024-06-01T06:00:00.000Z'),
    });

    await runIncrementalSync({ db, client: mockApi as unknown as WaniKaniClient });

    const pending = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM pending_progress');
    expect(pending?.count).toBe(1);
    const after = await db.getFirstAsync<{ srs_stage: number; available_at: string | null }>(
      'SELECT srs_stage, available_at FROM assignments WHERE id = ?',
      assignmentId,
    );
    expect(after?.srs_stage).toBe(2);
    expect(after?.available_at).toBeNull();
  });

  it('writes cursor freshness rows for empty collections with no updated cursor', async () => {
    const mockApi = createMockApi({
      getUser: async () => makeUser(),
      getSubjects: async () => collectionResult('', []),
      getAssignments: async () => collectionResult('2024-06-01T02:00:00.000Z'),
      getStudyMaterials: async () => collectionResult('2024-06-01T03:00:00.000Z'),
      getLevelProgressions: async () => collectionResult('2024-06-01T04:00:00.000Z'),
      getVoiceActors: async () => collectionResult('2024-06-01T05:00:00.000Z'),
      getReviewStatistics: async () => collectionResult('2024-06-01T06:00:00.000Z'),
    });

    await runIncrementalSync({ db, client: mockApi as unknown as WaniKaniClient });

    const cursor = await db.getFirstAsync<{ updated_after: string; synced_at: string }>(
      'SELECT updated_after, synced_at FROM sync_cursors WHERE collection = ?',
      'subjects',
    );
    expect(cursor?.updated_after).toBe('');
    expect(cursor?.synced_at).toBeTruthy();
    expect(await getLastSyncTime(db)).toBeGreaterThan(0);
  });

  it('advances cursors after each collection fetch', async () => {
    const user = makeUser();
    const mockApi = createMockApi({
      getUser: async () => user,
      getSubjects: async () => collectionResult('2024-06-01T01:00:00.000Z'),
      getAssignments: async () => collectionResult('2024-06-01T02:00:00.000Z'),
      getStudyMaterials: async () => collectionResult('2024-06-01T03:00:00.000Z'),
      getLevelProgressions: async () => collectionResult('2024-06-01T04:00:00.000Z'),
      getVoiceActors: async () => collectionResult('2024-06-01T05:00:00.000Z'),
      getReviewStatistics: async () => collectionResult('2024-06-01T06:00:00.000Z'),
    });
    const client = mockApi as unknown as WaniKaniClient;

    await runIncrementalSync({ db, client });

    const cursors = await getSyncCursors(db);
    expect(cursors.subjects).toBe('2024-06-01T01:00:00.000Z');
    expect(cursors.assignments).toBe('2024-06-01T02:00:00.000Z');
    expect(cursors.study_materials).toBe('2024-06-01T03:00:00.000Z');
    expect(cursors.level_progressions).toBe('2024-06-01T04:00:00.000Z');
    expect(cursors.voice_actors).toBe('2024-06-01T05:00:00.000Z');
    expect(cursors.review_stats).toBe('2024-06-01T06:00:00.000Z');
  });

  it('passes stored cursors to API methods on subsequent sync', async () => {
    // First sync with no cursors
    const user = makeUser();
    const mockApi1 = createMockApi({
      getUser: async () => user,
      getSubjects: async () => collectionResult('2024-06-01T01:00:00.000Z'),
      getAssignments: async () => collectionResult('2024-06-01T02:00:00.000Z'),
      getStudyMaterials: async () => collectionResult('2024-06-01T03:00:00.000Z'),
      getLevelProgressions: async () => collectionResult('2024-06-01T04:00:00.000Z'),
      getVoiceActors: async () => collectionResult('2024-06-01T05:00:00.000Z'),
      getReviewStatistics: async () => collectionResult('2024-06-01T06:00:00.000Z'),
    });

    await runIncrementalSync({ db, client: mockApi1 as unknown as WaniKaniClient });

    // Second sync — should pass the stored cursors
    const mockApi2 = createMockApi({
      getUser: async () => user,
      getSubjects: async () => collectionResult('2024-06-02T01:00:00.000Z'),
      getAssignments: async () => collectionResult('2024-06-02T02:00:00.000Z'),
      getStudyMaterials: async () => collectionResult('2024-06-02T03:00:00.000Z'),
      getLevelProgressions: async () => collectionResult('2024-06-02T04:00:00.000Z'),
      getVoiceActors: async () => collectionResult('2024-06-02T05:00:00.000Z'),
      getReviewStatistics: async () => collectionResult('2024-06-02T06:00:00.000Z'),
    });
    await runIncrementalSync({ db, client: mockApi2 as unknown as WaniKaniClient });

    const subjectCall = mockApi2.calls.find((c) => c.method === 'getSubjects');
    expect(subjectCall?.args[0]).toBe('2024-06-01T01:00:00.000Z');

    const assignmentCall = mockApi2.calls.find((c) => c.method === 'getAssignments');
    expect(assignmentCall?.args[0]).toBe('2024-06-01T02:00:00.000Z');
  });

  it('flushes pending writes before fetching remote data', async () => {
    const user = makeUser();
    const vocab = makeVocabulary({ id: 500 });
    const assignment = makeAssignment(500, { id: 600, subject_id: 500, srs_stage: 1, started_at: '2024-01-01T00:00:00.000Z', available_at: '2024-01-01T00:00:00.000Z' });

    // Seed a subject and assignment so queueReviewResult can reference them
    await putSubjects(db, [vocab]);
    await putAssignments(db, [assignment]);

    // Queue a pending review
    await queueReviewResult(db, { assignmentId: 600, incorrectMeaningAnswers: 0, incorrectReadingAnswers: 0 });

    const mockApi = createMockApi({
      getUser: async () => user,
      getSubjects: async () => collectionResult('2024-06-01T01:00:00.000Z'),
      getAssignments: async () => collectionResult('2024-06-01T02:00:00.000Z'),
      getStudyMaterials: async () => collectionResult('2024-06-01T03:00:00.000Z'),
      getLevelProgressions: async () => collectionResult('2024-06-01T04:00:00.000Z'),
      getVoiceActors: async () => collectionResult('2024-06-01T05:00:00.000Z'),
      getReviewStatistics: async () => collectionResult('2024-06-01T06:00:00.000Z'),
    });

    await runIncrementalSync({ db, client: mockApi as unknown as WaniKaniClient });

    // Pending review should have been sent before any fetches
    const reviewCallIdx = mockApi.calls.findIndex((c) => c.method === 'createReview');
    const getUserCallIdx = mockApi.calls.findIndex((c) => c.method === 'getUser');
    expect(reviewCallIdx).toBeLessThan(getUserCallIdx);

    // Pending row should be deleted
    const pending = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM pending_progress');
    expect(pending?.count).toBe(0);
  });

  it('fires progress callbacks for each sync step', async () => {
    const user = makeUser();
    const mockApi = createMockApi({
      getUser: async () => user,
      getSubjects: async () => collectionResult('2024-06-01T01:00:00.000Z'),
      getAssignments: async () => collectionResult('2024-06-01T02:00:00.000Z'),
      getStudyMaterials: async () => collectionResult('2024-06-01T03:00:00.000Z'),
      getLevelProgressions: async () => collectionResult('2024-06-01T04:00:00.000Z'),
      getVoiceActors: async () => collectionResult('2024-06-01T05:00:00.000Z'),
      getReviewStatistics: async () => collectionResult('2024-06-01T06:00:00.000Z'),
    });

    const progress: SyncProgress[] = [];
    await runIncrementalSync({ db, client: mockApi as unknown as WaniKaniClient, onProgress: (p) => progress.push(p) });

    const steps = progress.map((p) => p.step);
    expect(steps).toContain('user');
    expect(steps).toContain('subjects');
    expect(steps).toContain('assignments');
    expect(steps).toContain('study-materials');
    expect(steps).toContain('level-progressions');
    expect(steps).toContain('voice-actors');
    expect(steps).toContain('review-statistics');
    expect(steps).toContain('complete');
  });

  it('fires checkpoint callback after each collection save', async () => {
    const user = makeUser();
    const mockApi = createMockApi({
      getUser: async () => user,
      getSubjects: async () => collectionResult('2024-06-01T01:00:00.000Z'),
      getAssignments: async () => collectionResult('2024-06-01T02:00:00.000Z'),
      getStudyMaterials: async () => collectionResult('2024-06-01T03:00:00.000Z'),
      getLevelProgressions: async () => collectionResult('2024-06-01T04:00:00.000Z'),
      getVoiceActors: async () => collectionResult('2024-06-01T05:00:00.000Z'),
      getReviewStatistics: async () => collectionResult('2024-06-01T06:00:00.000Z'),
    });

    let checkpointCount = 0;
    await runIncrementalSync({ db, client: mockApi as unknown as WaniKaniClient, onCheckpoint: () => { checkpointCount += 1; } });

    // One checkpoint per collection: subjects, assignments, study_materials, level_progressions, voice_actors, review_stats
    expect(checkpointCount).toBe(6);
  });

  it('normalizes kana_vocabulary subjects to vocabulary type', async () => {
    const user = makeUser();
    const kanaVocab = makeKanaVocabulary({ id: 100 });
    const mockApi = createMockApi({
      getUser: async () => user,
      getSubjects: async () => collectionResult('2024-06-01T01:00:00.000Z', [kanaVocab]),
      getAssignments: async () => collectionResult('2024-06-01T02:00:00.000Z'),
      getStudyMaterials: async () => collectionResult('2024-06-01T03:00:00.000Z'),
      getLevelProgressions: async () => collectionResult('2024-06-01T04:00:00.000Z'),
      getVoiceActors: async () => collectionResult('2024-06-01T05:00:00.000Z'),
      getReviewStatistics: async () => collectionResult('2024-06-01T06:00:00.000Z'),
    });

    await runIncrementalSync({ db, client: mockApi as unknown as WaniKaniClient });

    const subject = await db.getFirstAsync<{ id: number; subject_type: string }>('SELECT id, subject_type FROM subjects WHERE id = 100');
    expect(subject?.subject_type).toBe('vocabulary');
  });
});

// ── Pending Sync ─────────────────────────────────────────────────────────────

describe('runPendingSync', () => {
  let db: AppDatabase;

  beforeEach(async () => {
    resetIdCounter();
    db = await setupDb();
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('sends pending reviews and lesson starts, then deletes the rows', async () => {
    const vocab = makeVocabulary({ id: 500 });
    const assignment = makeAssignment(500, { id: 600, subject_id: 500, srs_stage: 1, started_at: '2024-01-01T00:00:00.000Z', available_at: '2024-01-01T00:00:00.000Z' });
    const lessonAssignment = makeAssignment(500, { id: 700, subject_id: 500, srs_stage: 0, started_at: null });

    await putSubjects(db, [vocab]);
    await putAssignments(db, [assignment, lessonAssignment]);

    await queueReviewResult(db, { assignmentId: 600, incorrectMeaningAnswers: 0, incorrectReadingAnswers: 0 });
    await queueLessonStart(db, 700);

    const mockApi = createMockApi();
    await runPendingSync({ db, client: mockApi as unknown as WaniKaniClient });

    // Both should have been sent
    const reviewCall = mockApi.calls.find((c) => c.method === 'createReview');
    const lessonCall = mockApi.calls.find((c) => c.method === 'startAssignment');
    expect(reviewCall).toBeDefined();
    expect(lessonCall).toBeDefined();

    // Both pending rows should be deleted
    const pending = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM pending_progress');
    expect(pending?.count).toBe(0);
  });

  it('skips sync when no pending writes exist', async () => {
    const mockApi = createMockApi();
    await runPendingSync({ db, client: mockApi as unknown as WaniKaniClient });

    const calls = mockApi.calls;
    expect(calls).toHaveLength(0);
  });
});

// ── Full Refresh ─────────────────────────────────────────────────────────────

describe('runFullRefresh', () => {
  let db: AppDatabase;

  beforeEach(async () => {
    resetIdCounter();
    db = await setupDb();
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('clears remote data then re-fetches everything', async () => {
    const user = makeUser({ username: 'old' });
    const vocab = makeVocabulary({ id: 100 });

    // Seed existing data
    await putSubjects(db, [vocab]);

    const newUser = makeUser({ username: 'refreshed', level: 10 });
    const newVocab = makeVocabulary({ id: 200, characters: '新しい' });
    const mockApi = createMockApi({
      getUser: async () => newUser,
      getSubjects: async () => collectionResult('2024-06-02T01:00:00.000Z', [newVocab]),
      getAssignments: async () => collectionResult('2024-06-02T02:00:00.000Z'),
      getStudyMaterials: async () => collectionResult('2024-06-02T03:00:00.000Z'),
      getLevelProgressions: async () => collectionResult('2024-06-02T04:00:00.000Z'),
      getVoiceActors: async () => collectionResult('2024-06-02T05:00:00.000Z'),
      getReviewStatistics: async () => collectionResult('2024-06-02T06:00:00.000Z'),
    });

    await runFullRefresh({ db, client: mockApi as unknown as WaniKaniClient });

    // Old subject should be gone
    const oldSubject = await db.getFirstAsync('SELECT id FROM subjects WHERE id = 100');
    expect(oldSubject).toBeNull();

    // New subject should exist
    const newSubject = await db.getFirstAsync<{ id: number; japanese: string }>('SELECT id, japanese FROM subjects WHERE id = 200');
    expect(newSubject?.japanese).toBe('新しい');

    // User should be refreshed
    const userRow = await db.getFirstAsync<{ username: string; level: number }>('SELECT username, level FROM user WHERE id = 1');
    expect(userRow?.username).toBe('refreshed');
    expect(userRow?.level).toBe(10);
  });

  it('preserves pending writes during full refresh', async () => {
    const vocab = makeVocabulary({ id: 500 });
    const assignment = makeAssignment(500, { id: 600, subject_id: 500, srs_stage: 1, started_at: '2024-01-01T00:00:00.000Z', available_at: '2024-01-01T00:00:00.000Z' });

    await putSubjects(db, [vocab]);
    await putAssignments(db, [assignment]);
    await queueReviewResult(db, { assignmentId: 600, incorrectMeaningAnswers: 0, incorrectReadingAnswers: 0 });

    const beforeCount = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM pending_progress');
    expect(beforeCount?.count).toBe(1);

    const mockApi = createMockApi({
      getUser: async () => makeUser(),
      getSubjects: async () => collectionResult('2024-06-01T01:00:00.000Z'),
      getAssignments: async () => collectionResult('2024-06-01T02:00:00.000Z'),
      getStudyMaterials: async () => collectionResult('2024-06-01T03:00:00.000Z'),
      getLevelProgressions: async () => collectionResult('2024-06-01T04:00:00.000Z'),
      getVoiceActors: async () => collectionResult('2024-06-01T05:00:00.000Z'),
      getReviewStatistics: async () => collectionResult('2024-06-01T06:00:00.000Z'),
    });

    await runFullRefresh({ db, client: mockApi as unknown as WaniKaniClient });

    const afterCount = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM pending_progress');
    expect(afterCount?.count).toBe(0);
    expect(mockApi.calls.find((c) => c.method === 'createReview')).toBeDefined();
  });

  it('flushes pending study material before clearing remote cache', async () => {
    const oldVocab = makeVocabulary({ id: 700 });
    await putSubjects(db, [oldVocab]);
    await queueStudyMaterialUpdate(db, {
      subjectId: 700,
      meaningSynonyms: ['queued'],
      meaningNote: 'queued note',
    });

    const newVocab = makeVocabulary({ id: 701 });
    const newAssignment = makeAssignment(701, { id: 702, subject_id: 701 });
    const mockApi = createMockApi({
      upsertStudyMaterial: async () => makeStudyMaterial(700, { id: 703, meaning_synonyms: ['queued'] }),
      getUser: async () => makeUser(),
      getSubjects: async () => collectionResult('2024-06-02T01:00:00.000Z', [newVocab]),
      getAssignments: async () => collectionResult('2024-06-02T02:00:00.000Z', [newAssignment]),
      getStudyMaterials: async () => collectionResult('2024-06-02T03:00:00.000Z'),
      getLevelProgressions: async () => collectionResult('2024-06-02T04:00:00.000Z'),
      getVoiceActors: async () => collectionResult('2024-06-02T05:00:00.000Z'),
      getReviewStatistics: async () => collectionResult('2024-06-02T06:00:00.000Z'),
    });

    await runFullRefresh({ db, client: mockApi as unknown as WaniKaniClient });

    expect(mockApi.calls.find((call) => call.method === 'upsertStudyMaterial')).toBeDefined();
    const pending = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM pending_study_materials');
    expect(pending?.count).toBe(0);
    expect(await db.getFirstAsync('SELECT id FROM subjects WHERE id = 700')).toBeNull();
    expect(await db.getFirstAsync('SELECT id FROM subjects WHERE id = 701')).toBeTruthy();
    expect(await db.getFirstAsync('SELECT id FROM assignments WHERE id = 702')).toBeTruthy();
  });

  it('postpones full refresh before clearing cache when study material creates exceed budget', async () => {
    const oldVocab = makeVocabulary({ id: 800 });
    await putSubjects(db, [oldVocab]);
    await queueStudyMaterialUpdate(db, {
      subjectId: 800,
      meaningNote: 'local note',
    });

    const mockApi = createMockApi({
      requestsRemainingInInterval: 1,
      getUser: async () => makeUser(),
      getSubjects: async () => collectionResult('2024-06-02T01:00:00.000Z'),
      getAssignments: async () => collectionResult('2024-06-02T02:00:00.000Z'),
      getStudyMaterials: async () => collectionResult('2024-06-02T03:00:00.000Z'),
      getLevelProgressions: async () => collectionResult('2024-06-02T04:00:00.000Z'),
      getVoiceActors: async () => collectionResult('2024-06-02T05:00:00.000Z'),
      getReviewStatistics: async () => collectionResult('2024-06-02T06:00:00.000Z'),
    });

    await expect(runFullRefresh({ db, client: mockApi as unknown as WaniKaniClient })).rejects.toMatchObject({
      name: 'SyncError',
      category: 'rate-limit',
      isRetryable: true,
    });

    expect(await db.getFirstAsync('SELECT id FROM subjects WHERE id = 800')).toBeTruthy();
    const pending = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM pending_study_materials');
    expect(pending?.count).toBe(1);
    expect(mockApi.calls.find((call) => call.method === 'getUser')).toBeUndefined();
  });

  it('preserves local subject_progress history across a full refresh', async () => {
    // Seed a subject and a local-only mistake record. subject_progress is never
    // repopulated by the download, so a full refresh must carry it across the
    // cache clear or recent-mistake/leech history is lost.
    const vocab = makeVocabulary({ id: 900 });
    await putSubjects(db, [vocab]);
    const lastMistakeAt = '2026-06-10T08:00:00.000Z';
    await db.runAsync(
      'INSERT INTO subject_progress (subject_id, level, srs_stage, subject_type, last_mistake_at) VALUES (?, ?, ?, ?, ?)',
      900,
      5,
      3,
      'vocabulary',
      lastMistakeAt,
    );

    const refreshedVocab = makeVocabulary({ id: 900, characters: '木' });
    const mockApi = createMockApi({
      getUser: async () => makeUser(),
      getSubjects: async () => collectionResult('2026-06-11T01:00:00.000Z', [refreshedVocab]),
      getAssignments: async () => collectionResult('2026-06-11T02:00:00.000Z'),
      getStudyMaterials: async () => collectionResult('2026-06-11T03:00:00.000Z'),
      getLevelProgressions: async () => collectionResult('2026-06-11T04:00:00.000Z'),
      getVoiceActors: async () => collectionResult('2026-06-11T05:00:00.000Z'),
      getReviewStatistics: async () => collectionResult('2026-06-11T06:00:00.000Z'),
    });

    await runFullRefresh({ db, client: mockApi as unknown as WaniKaniClient });

    const progress = await db.getFirstAsync<{ subject_id: number; last_mistake_at: string | null }>(
      'SELECT subject_id, last_mistake_at FROM subject_progress WHERE subject_id = ?',
      900,
    );
    expect(progress?.subject_id).toBe(900);
    expect(progress?.last_mistake_at).toBe(lastMistakeAt);
  });

  it('drops preserved subject_progress whose subject is gone after refresh', async () => {
    // A mistake record for a subject the refresh no longer returns must not be
    // restored — its subject_id FK into subjects(id) would have nothing to
    // point at.
    const vocab = makeVocabulary({ id: 910 });
    await putSubjects(db, [vocab]);
    await db.runAsync(
      'INSERT INTO subject_progress (subject_id, level, srs_stage, subject_type, last_mistake_at) VALUES (?, ?, ?, ?, ?)',
      910,
      5,
      3,
      'vocabulary',
      '2026-06-10T08:00:00.000Z',
    );

    const mockApi = createMockApi({
      getUser: async () => makeUser(),
      getSubjects: async () => collectionResult('2026-06-11T01:00:00.000Z', [makeVocabulary({ id: 911 })]),
      getAssignments: async () => collectionResult('2026-06-11T02:00:00.000Z'),
      getStudyMaterials: async () => collectionResult('2026-06-11T03:00:00.000Z'),
      getLevelProgressions: async () => collectionResult('2026-06-11T04:00:00.000Z'),
      getVoiceActors: async () => collectionResult('2026-06-11T05:00:00.000Z'),
      getReviewStatistics: async () => collectionResult('2026-06-11T06:00:00.000Z'),
    });

    await runFullRefresh({ db, client: mockApi as unknown as WaniKaniClient });

    const orphan = await db.getFirstAsync('SELECT subject_id FROM subject_progress WHERE subject_id = ?', 910);
    expect(orphan).toBeNull();
  });

  it('preserves subject_progress when full refresh download fails after cache clear', async () => {
    const vocab = makeVocabulary({ id: 920 });
    await putSubjects(db, [vocab]);
    const lastMistakeAt = '2026-06-10T09:00:00.000Z';
    await db.runAsync(
      'INSERT INTO subject_progress (subject_id, level, srs_stage, subject_type, last_mistake_at) VALUES (?, ?, ?, ?, ?)',
      920,
      5,
      3,
      'vocabulary',
      lastMistakeAt,
    );

    const mockApi = createMockApi({
      getUser: async () => {
        throw apiError(500, 'WaniKani unavailable');
      },
    });

    await expect(runFullRefresh({ db, client: mockApi as unknown as WaniKaniClient })).rejects.toBeTruthy();

    // Cache clear no longer deletes subject_progress, so a failed re-download
    // must leave local mistake history intact even though subjects are gone.
    const progress = await db.getFirstAsync<{ subject_id: number; last_mistake_at: string | null }>(
      'SELECT subject_id, last_mistake_at FROM subject_progress WHERE subject_id = ?',
      920,
    );
    expect(progress?.subject_id).toBe(920);
    expect(progress?.last_mistake_at).toBe(lastMistakeAt);
  });

  it('dedupes concurrent full refreshes', async () => {
    let releaseUser!: () => void;
    const blockedUser = new Promise<void>((resolve) => { releaseUser = resolve; });
    const mockApi = createMockApi({
      getUser: async () => {
        await blockedUser;
        return makeUser();
      },
      getSubjects: async () => collectionResult('2024-06-02T01:00:00.000Z'),
      getAssignments: async () => collectionResult('2024-06-02T02:00:00.000Z'),
      getStudyMaterials: async () => collectionResult('2024-06-02T03:00:00.000Z'),
      getLevelProgressions: async () => collectionResult('2024-06-02T04:00:00.000Z'),
      getVoiceActors: async () => collectionResult('2024-06-02T05:00:00.000Z'),
      getReviewStatistics: async () => collectionResult('2024-06-02T06:00:00.000Z'),
    });

    const first = runFullRefresh({ db, client: mockApi as unknown as WaniKaniClient });
    const second = runFullRefresh({ db, client: mockApi as unknown as WaniKaniClient });
    releaseUser();
    await Promise.all([first, second]);

    expect(mockApi.calls.filter((call) => call.method === 'getUser')).toHaveLength(1);
    expect(mockApi.calls.filter((call) => call.method === 'getSubjects')).toHaveLength(1);
  });

  it('dedupes full refreshes queued behind an active incremental sync', async () => {
    await putSubjects(db, [makeVocabulary({ id: 100, characters: '古い' })]);

    let releaseIncrementalUser!: () => void;
    const incrementalUserStarted = new Promise<void>((resolve) => {
      const waitForRelease = new Promise<void>((release) => {
        releaseIncrementalUser = release;
      });
      const incrementalApi = createMockApi({
        getUser: async () => {
          resolve();
          await waitForRelease;
          return makeUser({ username: 'incremental' });
        },
        getSubjects: async () => collectionResult('2024-06-02T01:00:00.000Z'),
        getAssignments: async () => collectionResult('2024-06-02T02:00:00.000Z'),
        getStudyMaterials: async () => collectionResult('2024-06-02T03:00:00.000Z'),
        getLevelProgressions: async () => collectionResult('2024-06-02T04:00:00.000Z'),
        getVoiceActors: async () => collectionResult('2024-06-02T05:00:00.000Z'),
        getReviewStatistics: async () => collectionResult('2024-06-02T06:00:00.000Z'),
      });
      void runIncrementalSync({ db, client: incrementalApi as unknown as WaniKaniClient });
    });

    await incrementalUserStarted;

    const refreshedSubject = makeVocabulary({ id: 200, characters: '新しい' });
    const refreshApi = createMockApi({
      getUser: async () => makeUser({ username: 'full-refresh' }),
      getSubjects: async () => collectionResult('2024-06-03T01:00:00.000Z', [refreshedSubject]),
      getAssignments: async () => collectionResult('2024-06-03T02:00:00.000Z'),
      getStudyMaterials: async () => collectionResult('2024-06-03T03:00:00.000Z'),
      getLevelProgressions: async () => collectionResult('2024-06-03T04:00:00.000Z'),
      getVoiceActors: async () => collectionResult('2024-06-03T05:00:00.000Z'),
      getReviewStatistics: async () => collectionResult('2024-06-03T06:00:00.000Z'),
    });

    const firstRefresh = runFullRefresh({ db, client: refreshApi as unknown as WaniKaniClient });
    const secondRefresh = runFullRefresh({ db, client: refreshApi as unknown as WaniKaniClient });
    releaseIncrementalUser();
    await Promise.all([firstRefresh, secondRefresh]);

    expect(await db.getFirstAsync('SELECT id FROM subjects WHERE id = 100')).toBeNull();
    const newSubject = await db.getFirstAsync<{ japanese: string }>('SELECT japanese FROM subjects WHERE id = 200');
    expect(newSubject?.japanese).toBe('新しい');
    expect(refreshApi.calls.filter((call) => call.method === 'getUser')).toHaveLength(1);
    expect(refreshApi.calls.filter((call) => call.method === 'getSubjects')).toHaveLength(1);
  });
});

// ── Clear Remote Cache ───────────────────────────────────────────────────────

describe('clearRemoteCache', () => {
  let db: AppDatabase;

  beforeEach(async () => {
    resetIdCounter();
    db = await setupDb();
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('clears remote data but preserves pending writes', async () => {
    const vocab = makeVocabulary({ id: 500 });
    const assignment = makeAssignment(500, { id: 600, subject_id: 500, srs_stage: 1, started_at: '2024-01-01T00:00:00.000Z', available_at: '2024-01-01T00:00:00.000Z' });

    await putSubjects(db, [vocab]);
    await putAssignments(db, [assignment]);
    await queueReviewResult(db, { assignmentId: 600, incorrectMeaningAnswers: 1, incorrectReadingAnswers: 0 });

    await clearRemoteCache(db);

    // Subjects and assignments should be gone
    const subjectCount = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM subjects');
    expect(subjectCount?.count).toBe(0);

    const assignmentCount = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM assignments');
    expect(assignmentCount?.count).toBe(0);

    // Pending writes should survive
    const pendingCount = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM pending_progress');
    expect(pendingCount?.count).toBe(1);

    // Sync cursors should be cleared
    const cursors = await getSyncCursors(db);
    expect(Object.keys(cursors)).toHaveLength(0);
  });

  it('refuses to clear the cache while study-material writes are unflushed', async () => {
    const vocab = makeVocabulary({ id: 500 });
    await putSubjects(db, [vocab]);
    await queueStudyMaterialUpdate(db, { subjectId: 500, meaningNote: 'note' });

    await expect(clearRemoteCache(db)).rejects.toThrow(/unflushed study-material writes/);

    // The cache must be left intact when the guard trips.
    const subjectCount = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM subjects');
    expect(subjectCount?.count).toBe(1);
    const pendingCount = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM pending_study_materials');
    expect(pendingCount?.count).toBe(1);
  });
});

// ── Error Handling ────────────────────────────────────────────────────────────

describe('sync error handling', () => {
  let db: AppDatabase;

  beforeEach(async () => {
    resetIdCounter();
    db = await setupDb();
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('wraps HTTP errors in SyncError with correct category', async () => {
    const client = createMockApi({
      getUser: async () => { throw new WaniKaniApiError(401, 'Unauthorized'); },
    }) as unknown as WaniKaniClient;

    const { SyncError } = await import('../../domain/sync/syncService');
    await expect(runIncrementalSync({ db, client })).rejects.toThrow(SyncError);
  });

  it('logs sync errors to the error log table', async () => {
    const client = createMockApi({
      getUser: async () => { throw new Error('Network failure'); },
    }) as unknown as WaniKaniClient;

    await expect(runIncrementalSync({ db, client })).rejects.toThrow();

    const errors = await db.getAllAsync<{ message: string; context: string }>('SELECT message, context FROM error_log');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.message).toContain('Network failure');
  });
});
