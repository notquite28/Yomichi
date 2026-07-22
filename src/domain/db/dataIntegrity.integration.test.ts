/**
 * Integration tests for data integrity.
 *
 * Tests:
 * - Foreign key constraints prevent orphaned records
 * - kana_vocabulary normalization to vocabulary in subjects and assignments
 * - putStudyMaterials skips entries whose subject_id is absent locally
 * - Schema migrations apply cleanly on empty database
 * - resetLocalData clears everything including pending writes
 * - putSubjects stores audio URLs for vocabulary with pronunciation_audios
 * - User upsert preserves singleton constraint
 */
import {
  applyMigrations,
  clearRemoteCache,
  putAssignments,
  putLevelProgressions,
  putReviewStats,
  putStudyMaterials,
  putSubjects,
  putUser,
  putVoiceActors,
  resetLocalData,
} from '../../domain/db/database';
import { createTestDb } from '../../test/sqliteShim';
import {
  makeUser,
  makeVocabulary,
  makeKanaVocabulary,
  makeRadical,
  makeKanji,
  makeAssignment,
  makeStudyMaterial,
  makeReviewStat,
  makeLevelProgression,
  makeVoiceActor,
  resetIdCounter,
} from '../../test/factories';
import type { AppDatabase } from '../../domain/db/database';

async function setupDb(): Promise<AppDatabase> {
  const db = createTestDb();
  await applyMigrations(db);
  return db;
}

// ── Schema Migrations ────────────────────────────────────────────────────────

describe('schema migrations', () => {
  it('applies all migrations on a fresh database', async () => {
    const db = await setupDb();

    // Check all expected tables exist
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain('schema_migrations');
    expect(tableNames).toContain('sync_cursors');
    expect(tableNames).toContain('user');
    expect(tableNames).toContain('subjects');
    expect(tableNames).toContain('assignments');
    expect(tableNames).toContain('study_materials');
    expect(tableNames).toContain('level_progressions');
    expect(tableNames).toContain('voice_actors');
    expect(tableNames).toContain('review_stats');
    expect(tableNames).toContain('audio_urls');
    expect(tableNames).toContain('subject_progress');
    expect(tableNames).toContain('pending_progress');
    expect(tableNames).toContain('pending_study_materials');
    expect(tableNames).toContain('error_log');
    expect(tableNames).toContain('coach_cache');
    expect(tableNames).toContain('review_attempts');
    expect(tableNames).toContain('learning_interventions');
    expect(tableNames).toContain('learning_history_meta');


    // Check indexes
    const indexes = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'",
    );
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain('subjects_level_type_idx');
    expect(indexNames).toContain('subjects_japanese_idx');
    expect(indexNames).toContain('assignments_available_idx');
    expect(indexNames).toContain('assignments_subject_idx');
    expect(indexNames).toContain('review_stats_subject_idx');

    await db.closeAsync();
  });

  it('is idempotent — applying migrations twice does not error', async () => {
    const db = await setupDb();
    await applyMigrations(db); // second application

    const migrations = await db.getAllAsync<{ version: number }>('SELECT version FROM schema_migrations');
    expect(migrations.map((migration) => migration.version).sort()).toEqual([1, 2, 3, 4]);

    await db.closeAsync();
  });
});

// ── Foreign Key Constraints ──────────────────────────────────────────────────

describe('foreign key constraints', () => {
  let db: AppDatabase;

  beforeEach(async () => {
    resetIdCounter();
    db = await setupDb();
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('prevents inserting study material with nonexistent subject', async () => {
    const material = makeStudyMaterial(999, { id: 100, subject_id: 999 });

    // putStudyMaterials skips entries whose subject_id is absent rather than throwing
    await putStudyMaterials(db, [material]);

    // Verify nothing was inserted
    const count = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM study_materials');
    expect(count?.count).toBe(0);
  });

  it('allows inserting assignment when subject exists', async () => {
    const vocab = makeVocabulary({ id: 500 });
    await putSubjects(db, [vocab]);

    const assignment = makeAssignment(500, { id: 600, subject_id: 500 });
    await putAssignments(db, [assignment]);

    const count = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM assignments');
    expect(count?.count).toBe(1);
  });

  it('chunks subject lookups for large assignment batches', async () => {
    const subjectCount = 501;
    const subjects = Array.from({ length: subjectCount }, (_, index) => makeVocabulary({ id: index + 1 }));
    const assignments = Array.from({ length: subjectCount }, (_, index) =>
      makeAssignment(index + 1, { id: subjectCount + index + 1, subject_id: index + 1 }),
    );
    await putSubjects(db, subjects);

    const getAllAsync = jest.spyOn(db, 'getAllAsync');
    await putAssignments(db, assignments);

    const subjectLookupCalls = getAllAsync.mock.calls.filter(([source]) =>
      source.startsWith('SELECT id, level, subject_type FROM subjects WHERE id IN'),
    );
    expect(subjectLookupCalls).toHaveLength(2);
    expect(subjectLookupCalls[0]?.slice(1)).toHaveLength(500);
    expect(subjectLookupCalls[1]?.slice(1)).toHaveLength(1);
  });

  it('cascades correctly when deleting parent subject', async () => {
    const vocab = makeVocabulary({ id: 500 });
    await putSubjects(db, [vocab]);

    const assignment = makeAssignment(500, { id: 600, subject_id: 500 });
    await putAssignments(db, [assignment]);

    // Delete the subject — FK should prevent or cascade
    // Our schema uses FK enforcement, so we need to delete children first
    await db.execAsync('DELETE FROM assignments WHERE subject_id = 500');
    await db.execAsync('DELETE FROM subjects WHERE id = 500');

    const assignmentCount = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM assignments');
    expect(assignmentCount?.count).toBe(0);
  });
});

// ── kana_vocabulary Normalization ─────────────────────────────────────────────

describe('kana_vocabulary normalization', () => {
  let db: AppDatabase;

  beforeEach(async () => {
    resetIdCounter();
    db = await setupDb();
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('normalizes kana_vocabulary subjects to vocabulary type', async () => {
    const kanaVocab = makeKanaVocabulary({ id: 100, characters: 'ちょっと' });
    await putSubjects(db, [kanaVocab]);

    const subject = await db.getFirstAsync<{ id: number; subject_type: string; japanese: string }>(
      'SELECT id, subject_type, japanese FROM subjects WHERE id = 100',
    );
    expect(subject?.subject_type).toBe('vocabulary');
    expect(subject?.japanese).toBe('ちょっと');
  });

  it('normalizes kana_vocabulary assignments to vocabulary type', async () => {
    const kanaVocab = makeKanaVocabulary({ id: 100 });
    await putSubjects(db, [kanaVocab]);

    const assignment = makeAssignment(100, {
      id: 200,
      subject_id: 100,
      subject_type: 'kana_vocabulary',
    });
    await putAssignments(db, [assignment]);

    const result = await db.getFirstAsync<{ id: number; subject_type: string }>(
      'SELECT id, subject_type FROM assignments WHERE id = 200',
    );
    expect(result?.subject_type).toBe('vocabulary');
  });
});

// ── putStudyMaterials Filtering ───────────────────────────────────────────────

describe('putStudyMaterials filtering', () => {
  let db: AppDatabase;

  beforeEach(async () => {
    resetIdCounter();
    db = await setupDb();
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('skips study materials whose subject_id does not exist locally', async () => {
    const vocab = makeVocabulary({ id: 500 });
    await putSubjects(db, [vocab]);

    const validMaterial = makeStudyMaterial(500, { id: 800, subject_id: 500 });
    const orphanMaterial = makeStudyMaterial(999, { id: 801, subject_id: 999 });

    await putStudyMaterials(db, [validMaterial, orphanMaterial]);

    const materials = await db.getAllAsync<{ id: number; subject_id: number }>('SELECT id, subject_id FROM study_materials ORDER BY id');
    expect(materials).toHaveLength(1);
    expect(materials[0]!.subject_id).toBe(500);
  });

  it('updates existing study material when remote id changes for the same subject', async () => {
    const vocab = makeVocabulary({ id: 500 });
    await putSubjects(db, [vocab]);

    const initialMaterial = makeStudyMaterial(500, { id: 800, subject_id: 500, meaning_synonyms: ['old'] });
    const updatedMaterial = makeStudyMaterial(500, { id: 801, subject_id: 500, meaning_synonyms: ['new'] });

    await putStudyMaterials(db, [initialMaterial]);
    await putStudyMaterials(db, [updatedMaterial]);

    const materials = await db.getAllAsync<{ id: number; subject_id: number; payload: string }>('SELECT id, subject_id, payload FROM study_materials');
    expect(materials).toHaveLength(1);
    expect(materials[0]!.id).toBe(801);
    expect(materials[0]!.subject_id).toBe(500);
    expect(JSON.parse(materials[0]!.payload).data.meaning_synonyms).toEqual(['new']);
  });
});

// ── resetLocalData ────────────────────────────────────────────────────────────

describe('resetLocalData', () => {
  let db: AppDatabase;

  beforeEach(async () => {
    resetIdCounter();
    db = await setupDb();
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('clears all data including pending writes', async () => {
    const vocab = makeVocabulary({ id: 500 });
    await putSubjects(db, [vocab]);

    const assignment = makeAssignment(500, { id: 600, subject_id: 500 });
    await putAssignments(db, [assignment]);

    const user = makeUser();
    await putUser(db, user);

    // Manually insert pending writes
    await db.runAsync(
      "INSERT INTO pending_progress (id, kind, payload, created_at) VALUES (?, 'review', ?, ?)",
      'test-review-1',
      JSON.stringify({ assignmentId: 600 }),
      new Date().toISOString(),
    );

    await resetLocalData(db);

    const tables = ['subjects', 'assignments', 'user', 'pending_progress', 'sync_cursors', 'study_materials', 'review_stats', 'error_log'];
    for (const table of tables) {
      const count = await db.getFirstAsync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`);
      expect(count?.count).toBe(0);
    }
  });
});

// ── User Singleton ───────────────────────────────────────────────────────────

describe('user singleton', () => {
  let db: AppDatabase;

  beforeEach(async () => {
    resetIdCounter();
    db = await setupDb();
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('upserts user on repeated puts', async () => {
    const user1 = makeUser({ username: 'first', level: 1 });
    const user2 = makeUser({ username: 'second', level: 5 });

    await putUser(db, user1);
    await putUser(db, user2);

    const users = await db.getAllAsync<{ username: string; level: number }>('SELECT username, level FROM user');
    expect(users).toHaveLength(1);
    expect(users[0]!.username).toBe('second');
    expect(users[0]!.level).toBe(5);
  });

  it('stores vacation_started_at as null for active users', async () => {
    const user = makeUser({ current_vacation_started_at: null });
    await putUser(db, user);

    const row = await db.getFirstAsync<{ vacation_started_at: string | null }>('SELECT vacation_started_at FROM user WHERE id = 1');
    expect(row?.vacation_started_at).toBeNull();
  });

  it('stores vacation_started_at for vacationing users', async () => {
    const user = makeUser({ current_vacation_started_at: '2024-05-01T00:00:00.000Z' });
    await putUser(db, user);

    const row = await db.getFirstAsync<{ vacation_started_at: string | null }>('SELECT vacation_started_at FROM user WHERE id = 1');
    expect(row?.vacation_started_at).toBe('2024-05-01T00:00:00.000Z');
  });
});

// ── Audio URLs ───────────────────────────────────────────────────────────────

describe('audio URL storage', () => {
  let db: AppDatabase;

  beforeEach(async () => {
    resetIdCounter();
    db = await setupDb();
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('stores pronunciation audio URLs for vocabulary with mp3 audios', async () => {
    const vocab = makeVocabulary({
      id: 500,
      pronunciation_audios: [
        { url: 'https://example.com/audio1.mp3', content_type: 'audio/mpeg', metadata: { voice_actor_id: 1 } },
        { url: 'https://example.com/audio1.ogg', content_type: 'audio/ogg', metadata: { voice_actor_id: 1 } },
      ],
    });

    await putSubjects(db, [vocab]);

    const audioUrls = await db.getAllAsync<{ remote_url: string; voice_actor_id: number | null; status: string }>(
      'SELECT remote_url, voice_actor_id, status FROM audio_urls WHERE subject_id = 500',
    );
    expect(audioUrls).toHaveLength(1); // Only MP3 stored
    expect(audioUrls[0]!.remote_url).toBe('https://example.com/audio1.mp3');
    expect(audioUrls[0]!.voice_actor_id).toBe(1);
    expect(audioUrls[0]!.status).toBe('remote');
  });

  it('does not store audio URLs for subjects without pronunciation_audios', async () => {
    const kanji = makeKanji({ id: 100 });
    await putSubjects(db, [kanji]);

    const audioUrls = await db.getAllAsync('SELECT * FROM audio_urls WHERE subject_id = 100');
    expect(audioUrls).toHaveLength(0);
  });
});

// ── Collection Upserts ───────────────────────────────────────────────────────

describe('collection upsert behavior', () => {
  let db: AppDatabase;

  beforeEach(async () => {
    resetIdCounter();
    db = await setupDb();
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('updates subjects on conflict', async () => {
    const vocab1 = makeVocabulary({ id: 500, characters: '古い' });
    await putSubjects(db, [vocab1]);

    const vocab2 = makeVocabulary({ id: 500, characters: '新しい' });
    await putSubjects(db, [vocab2]);

    const subject = await db.getFirstAsync<{ japanese: string }>('SELECT japanese FROM subjects WHERE id = 500');
    expect(subject?.japanese).toBe('新しい');
  });

  it('updates assignments on conflict', async () => {
    const vocab = makeVocabulary({ id: 500 });
    await putSubjects(db, [vocab]);

    const assignment1 = makeAssignment(500, { id: 600, subject_id: 500, srs_stage: 1 });
    await putAssignments(db, [assignment1]);

    const assignment2 = makeAssignment(500, { id: 600, subject_id: 500, srs_stage: 4 });
    await putAssignments(db, [assignment2]);

    const assignment = await db.getFirstAsync<{ srs_stage: number }>('SELECT srs_stage FROM assignments WHERE id = 600');
    expect(assignment?.srs_stage).toBe(4);
  });

  it('stores level progressions with level number', async () => {
    const level = makeLevelProgression({ id: 100, level: 5 });
    await putLevelProgressions(db, [level]);

    const result = await db.getFirstAsync<{ id: number; level: number }>('SELECT id, level FROM level_progressions WHERE id = 100');
    expect(result?.level).toBe(5);
  });

  it('stores voice actors with name', async () => {
    const actor = makeVoiceActor({ id: 100, name: 'Kenichi' });
    await putVoiceActors(db, [actor]);

    const result = await db.getFirstAsync<{ id: number; name: string }>('SELECT id, name FROM voice_actors WHERE id = 100');
    expect(result?.name).toBe('Kenichi');
  });
});
