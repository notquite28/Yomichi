import { ApiResource, AssignmentData, LessonStartPayload, ReviewProgressPayload, StudyMaterialPayload, WaniKaniUserData } from '../api/types';
import { WaniKaniClient } from '../api/WaniKaniClient';

jest.mock('../db/database', () => ({
  clearRemoteCache: jest.fn(),
  getSyncCursors: jest.fn(),
  putAssignments: jest.fn(),
  putLevelProgressions: jest.fn(),
  putReviewStats: jest.fn(),
  putStudyMaterials: jest.fn(),
  putSubjects: jest.fn(),
  putUser: jest.fn(),
  putVoiceActors: jest.fn(),
  setSyncCursor: jest.fn(),
  runExclusive: jest.fn((task: () => Promise<unknown>) => task()),
  runInWriteTransaction: jest.fn((_db: unknown, task: () => Promise<unknown>) => task()),
}));

import {
  getSyncCursors,
  putAssignments,
  putLevelProgressions,
  putReviewStats,
  putStudyMaterials,
  putSubjects,
  putUser,
  putVoiceActors,
  setSyncCursor,
} from '../db/database';
import { runIncrementalSync, runPendingSync } from './syncService';

type PendingProgressRow = { id: string; kind: string; payload: string };
type PendingStudyMaterialRow = { id: string; subject_id: number; payload: string };

class FakePendingDb {
  pendingProgress: PendingProgressRow[] = [];
  pendingStudyMaterials: PendingStudyMaterialRow[] = [];
  localStudyMaterials = new Map<number, { id: number; payload: string }>();
  updates: Array<{ table: string; id: string; error: string }> = [];

  async getFirstAsync<T>(sql?: string, ...args: unknown[]) {
    if (sql?.includes('FROM study_materials')) {
      return (this.localStudyMaterials.get(Number(args[0])) ?? null) as T;
    }
    return { value: this.pendingProgress.length + this.pendingStudyMaterials.length } as T;
  }

  async getAllAsync<T>(sql: string, limit?: number) {
    if (sql.includes('FROM pending_progress')) {
      return this.pendingProgress.slice(0, limit).map((row) => ({ ...row })) as T[];
    }
    if (sql.includes('FROM pending_study_materials')) {
      return this.pendingStudyMaterials.slice(0, limit).map((row) => ({ ...row })) as T[];
    }
    return [] as T[];
  }

  async runAsync(sql: string, ...args: unknown[]) {
    if (sql.includes('DELETE FROM pending_progress')) {
      const id = String(args[0]);
      this.pendingProgress = this.pendingProgress.filter((row) => row.id !== id);
      return;
    }
    if (sql.includes('DELETE FROM pending_study_materials')) {
      const id = String(args[0]);
      this.pendingStudyMaterials = this.pendingStudyMaterials.filter((row) => row.id !== id);
      return;
    }
    if (sql.includes('UPDATE pending_progress')) {
      this.updates.push({ table: 'pending_progress', error: String(args[0]), id: String(args[1]) });
      return;
    }
    if (sql.includes('UPDATE pending_study_materials')) {
      this.updates.push({ table: 'pending_study_materials', error: String(args[0]), id: String(args[1]) });
    }
  }

  async execAsync() {}
}

function collectionResult<T>(dataUpdatedAt: string, items: Array<ApiResource<T>> = []) {
  return { items, dataUpdatedAt, totalCount: items.length };
}

function user(): ApiResource<WaniKaniUserData> {
  return {
    id: 1,
    object: 'user',
    data_updated_at: '2024-01-01T00:00:00.000Z',
    data: { username: 'quiet', level: 10 },
  };
}

function makeClient(overrides: Partial<Record<keyof WaniKaniClient, jest.Mock>> = {}) {
  return {
    get requestsRemainingInInterval() {
      return 60;
    },
    getUser: jest.fn().mockResolvedValue(user()),
    getSubjects: jest.fn().mockResolvedValue(collectionResult('2024-01-02T00:00:00.000Z')),
    getAssignments: jest.fn().mockResolvedValue(collectionResult<AssignmentData>('2024-01-03T00:00:00.000Z')),
    getStudyMaterials: jest.fn().mockResolvedValue(collectionResult('2024-01-04T00:00:00.000Z')),
    getLevelProgressions: jest.fn().mockResolvedValue(collectionResult('2024-01-05T00:00:00.000Z')),
    getVoiceActors: jest.fn().mockResolvedValue(collectionResult('2024-01-06T00:00:00.000Z')),
    getReviewStatistics: jest.fn().mockResolvedValue(collectionResult('2024-01-07T00:00:00.000Z')),
    startAssignment: jest.fn().mockResolvedValue(undefined),
    createReview: jest.fn().mockResolvedValue(undefined),
    upsertStudyMaterial: jest.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as WaniKaniClient;
}

describe('runIncrementalSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes stored updated_after cursors to each collection and stores returned cursors', async () => {
    (getSyncCursors as jest.Mock).mockResolvedValue({
      subjects: 'cursor-subjects',
      assignments: 'cursor-assignments',
      study_materials: 'cursor-study-materials',
      level_progressions: 'cursor-level-progressions',
      voice_actors: 'cursor-voice-actors',
      review_stats: 'cursor-review-stats',
    });
    const client = makeClient();
    const db = new FakePendingDb();

    await runIncrementalSync({ db: db as never, client });

    expect(client.getSubjects).toHaveBeenCalledWith('cursor-subjects', expect.any(Function));
    expect(client.getAssignments).toHaveBeenCalledWith('cursor-assignments', expect.any(Function));
    expect(client.getStudyMaterials).toHaveBeenCalledWith('cursor-study-materials', expect.any(Function));
    expect(client.getLevelProgressions).toHaveBeenCalledWith('cursor-level-progressions', expect.any(Function));
    expect(client.getVoiceActors).toHaveBeenCalledWith('cursor-voice-actors', expect.any(Function));
    expect(client.getReviewStatistics).toHaveBeenCalledWith('cursor-review-stats', expect.any(Function));
    expect(putUser).toHaveBeenCalledWith(db, expect.objectContaining({ object: 'user' }));
    expect(putSubjects).toHaveBeenCalled();
    expect(putAssignments).toHaveBeenCalled();
    expect(putStudyMaterials).toHaveBeenCalled();
    expect(putLevelProgressions).toHaveBeenCalled();
    expect(putVoiceActors).toHaveBeenCalled();
    expect(putReviewStats).toHaveBeenCalled();
    expect(setSyncCursor).toHaveBeenCalledWith(db, 'subjects', '2024-01-02T00:00:00.000Z');
    expect(setSyncCursor).toHaveBeenCalledWith(db, 'assignments', '2024-01-03T00:00:00.000Z');
    expect(setSyncCursor).toHaveBeenCalledWith(db, 'study_materials', '2024-01-04T00:00:00.000Z');
    expect(setSyncCursor).toHaveBeenCalledWith(db, 'level_progressions', '2024-01-05T00:00:00.000Z');
    expect(setSyncCursor).toHaveBeenCalledWith(db, 'voice_actors', '2024-01-06T00:00:00.000Z');
    expect(setSyncCursor).toHaveBeenCalledWith(db, 'review_stats', '2024-01-07T00:00:00.000Z');
  });

  it('runs the download after an in-flight pending-only sync instead of dropping it', async () => {
    (getSyncCursors as jest.Mock).mockResolvedValue({});
    const reviewPayload: ReviewProgressPayload = {
      assignmentId: 202,
      incorrectMeaningAnswers: 0,
      incorrectReadingAnswers: 0,
    };
    const db = new FakePendingDb();
    db.pendingProgress = [{ id: 'review', kind: 'review', payload: JSON.stringify(reviewPayload) }];
    let releaseReview!: () => void;
    const blockedReview = new Promise<void>((resolve) => { releaseReview = resolve; });
    const client = makeClient({
      createReview: jest.fn().mockReturnValue(blockedReview),
    });

    const pending = runPendingSync({ db: db as never, client });
    await Promise.resolve();
    const incremental = runIncrementalSync({ db: db as never, client });
    releaseReview();
    await Promise.all([pending, incremental]);

    // The pending-only sync flushes the queued review once; the incremental
    // sync chains the remote download afterward rather than silently degrading
    // into the pending-only promise.
    expect(client.createReview).toHaveBeenCalledTimes(1);
    expect(client.getUser).toHaveBeenCalledTimes(1);
  });

  it('skips pending writes when incremental sync needs the reserved download budget', async () => {
    (getSyncCursors as jest.Mock).mockResolvedValue({});
    const reviewPayload: ReviewProgressPayload = {
      assignmentId: 202,
      incorrectMeaningAnswers: 0,
      incorrectReadingAnswers: 0,
    };
    const db = new FakePendingDb();
    db.pendingProgress = [{ id: 'review', kind: 'review', payload: JSON.stringify(reviewPayload) }];
    const client = makeClient();
    Object.defineProperty(client, 'requestsRemainingInInterval', { get: () => 20 });

    await runIncrementalSync({ db: db as never, client });

    expect(client.createReview).not.toHaveBeenCalled();
    expect(client.getUser).toHaveBeenCalledTimes(1);
    expect(db.pendingProgress).toHaveLength(1);
  });

  it('reserves two requests for queued study material creates before downloads', async () => {
    (getSyncCursors as jest.Mock).mockResolvedValue({});
    const db = new FakePendingDb();
    db.pendingStudyMaterials = [{ id: 'create', subject_id: 1, payload: JSON.stringify({ subjectId: 1, meaningSynonyms: ['leafy'] }) }];
    db.localStudyMaterials.set(1, {
      id: -1,
      payload: JSON.stringify({ data: { subject_id: 1, meaning_synonyms: ['leafy'], meaning_note: '', reading_note: '' } }),
    });
    const client = makeClient();
    Object.defineProperty(client, 'requestsRemainingInInterval', { get: () => 22 });

    await runIncrementalSync({ db: db as never, client });

    expect(client.upsertStudyMaterial).not.toHaveBeenCalled();
    expect(client.getUser).toHaveBeenCalledTimes(1);
    expect(db.pendingStudyMaterials).toHaveLength(1);
  });
});

describe('runPendingSync', () => {
  it('sends queued lesson starts and reviews, then deletes successful rows', async () => {
    const lessonPayload: LessonStartPayload = { assignmentId: 101, startedAt: '2024-01-01T00:00:00.000Z' };
    const reviewPayload: ReviewProgressPayload = {
      assignmentId: 202,
      incorrectMeaningAnswers: 1,
      incorrectReadingAnswers: 0,
      createdAt: '2024-01-01T00:10:00.000Z',
    };
    const db = new FakePendingDb();
    db.pendingProgress = [
      { id: 'lesson', kind: 'lesson-start', payload: JSON.stringify(lessonPayload) },
      { id: 'review', kind: 'review', payload: JSON.stringify(reviewPayload) },
    ];
    const client = makeClient();

    await runPendingSync({ db: db as never, client });

    expect(client.startAssignment).toHaveBeenCalledWith(lessonPayload);
    expect(client.createReview).toHaveBeenCalledWith(reviewPayload);
    expect(db.pendingProgress).toEqual([]);
  });

  it('sends queued study material creates and updates, then deletes successful rows', async () => {
    const createPayload: StudyMaterialPayload = { subjectId: 1, meaningSynonyms: ['leafy'], meaningNote: '', readingNote: '' };
    const updatePayload: StudyMaterialPayload = { id: 22, subjectId: 2, meaningSynonyms: [], meaningNote: 'remember this', readingNote: '' };
    const db = new FakePendingDb();
    db.pendingStudyMaterials = [
      { id: 'create', subject_id: 1, payload: JSON.stringify(createPayload) },
      { id: 'update', subject_id: 2, payload: JSON.stringify(updatePayload) },
    ];
    db.localStudyMaterials.set(1, {
      id: -1,
      payload: JSON.stringify({ data: { subject_id: 1, meaning_synonyms: ['leafy'], meaning_note: '', reading_note: '' } }),
    });
    db.localStudyMaterials.set(2, {
      id: 22,
      payload: JSON.stringify({ data: { subject_id: 2, meaning_synonyms: [], meaning_note: 'remember this', reading_note: '' } }),
    });
    const client = makeClient();

    await runPendingSync({ db: db as never, client });

    expect(client.upsertStudyMaterial).toHaveBeenNthCalledWith(1, createPayload);
    expect(client.upsertStudyMaterial).toHaveBeenNthCalledWith(2, updatePayload);
    expect(db.pendingStudyMaterials).toEqual([]);
  });

  it('chains a second pending flush after an in-flight pending-only sync', async () => {
    const firstPayload: ReviewProgressPayload = {
      assignmentId: 202,
      incorrectMeaningAnswers: 0,
      incorrectReadingAnswers: 0,
    };
    const secondPayload: ReviewProgressPayload = {
      assignmentId: 203,
      incorrectMeaningAnswers: 1,
      incorrectReadingAnswers: 0,
    };
    const db = new FakePendingDb();
    db.pendingProgress = [{ id: 'review-1', kind: 'review', payload: JSON.stringify(firstPayload) }];
    let releaseFirst!: () => void;
    const blockedFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const client = makeClient({
      createReview: jest
        .fn()
        .mockImplementationOnce(() => blockedFirst)
        .mockResolvedValueOnce(undefined),
    });

    const first = runPendingSync({ db: db as never, client });
    await Promise.resolve();
    // Late write arrives while the first flush is still sending its SELECT batch.
    db.pendingProgress.push({ id: 'review-2', kind: 'review', payload: JSON.stringify(secondPayload) });
    const second = runPendingSync({ db: db as never, client });
    releaseFirst();
    await Promise.all([first, second]);

    expect(client.createReview).toHaveBeenCalledTimes(2);
    expect(client.createReview).toHaveBeenNthCalledWith(1, firstPayload);
    expect(client.createReview).toHaveBeenNthCalledWith(2, secondPayload);
    expect(db.pendingProgress).toEqual([]);
  });

  it('does not delete unknown pending_progress kinds', async () => {
    const db = new FakePendingDb();
    db.pendingProgress = [{ id: 'mystery', kind: 'future-kind', payload: '{}' }];
    const client = makeClient();

    await expect(runPendingSync({ db: db as never, client })).rejects.toThrow(/unknown pending_progress kind/);
    expect(db.pendingProgress).toHaveLength(1);
    expect(db.pendingProgress[0]?.id).toBe('mystery');
    expect(db.updates.some((update) => update.table === 'pending_progress' && update.id === 'mystery')).toBe(true);
  });
});
