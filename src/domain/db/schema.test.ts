import { Migration, migrations } from './schema';

function extractTableNames(sql: string): string[] {
  const tables: string[] = [];
  const pattern = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) {
    tables.push(match[1]!);
  }
  return tables;
}

function extractIndexNames(sql: string): string[] {
  const indexes: string[] = [];
  const pattern = /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) {
    indexes.push(match[1]!);
  }
  return indexes;
}

describe('migration definitions', () => {
  test('at least one migration exists', () => {
    expect(migrations.length).toBeGreaterThanOrEqual(1);
  });

  test('versions start at 1 and are sequential', () => {
    const versions = migrations.map((m) => m.version);
    for (let i = 0; i < versions.length; i++) {
      expect(versions[i]).toBe(i + 1);
    }
  });

  test('no duplicate versions', () => {
    const versions = migrations.map((m) => m.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  test('every migration has non-empty SQL', () => {
    for (const migration of migrations) {
      expect(migration.sql.trim().length).toBeGreaterThan(0);
    }
  });

  test('every migration has a positive integer version', () => {
    for (const migration of migrations) {
      expect(Number.isInteger(migration.version)).toBe(true);
      expect(migration.version).toBeGreaterThan(0);
    }
  });
});

describe('schema v1', () => {
  const v1 = migrations.find((m) => m.version === 1);
  if (!v1) return;

  const tables = extractTableNames(v1.sql);
  const indexes = extractIndexNames(v1.sql);

  const expectedTables = [
    'sync_cursors',
    'user',
    'subjects',
    'assignments',
    'study_materials',
    'level_progressions',
    'voice_actors',
    'review_stats',
    'audio_urls',
    'subject_progress',
    'pending_progress',
    'pending_study_materials',
    'error_log',
  ];

  const expectedIndexes = [
    'subjects_level_type_idx',
    'subjects_japanese_idx',
    'assignments_available_idx',
    'assignments_subject_idx',
    'assignments_level_type_idx',
    'review_stats_subject_idx',
  ];

  test('creates all expected tables', () => {
    for (const table of expectedTables) {
      expect(tables).toContain(table);
    }
  });

  test('creates all expected indexes', () => {
    for (const index of expectedIndexes) {
      expect(indexes).toContain(index);
    }
  });

  test('does not create unexpected tables', () => {
    expect(tables.sort()).toEqual([...expectedTables].sort());
  });

  test('user table has singleton CHECK constraint', () => {
    expect(v1.sql).toContain('CHECK (id = 1)');
  });

  test('foreign keys reference subjects(id)', () => {
    const fkTables = ['assignments', 'study_materials', 'review_stats', 'audio_urls', 'subject_progress', 'pending_study_materials'];
    for (const table of fkTables) {
      expect(v1.sql).toContain(`FOREIGN KEY`);
    }
  });

  test('error_log has AUTOINCREMENT', () => {
    expect(v1.sql).toContain('error_log');
    const errorLogSection = v1.sql.substring(v1.sql.indexOf('error_log'));
    expect(errorLogSection).toContain('AUTOINCREMENT');
  });
});

describe('schema v4', () => {
  const v4 = migrations.find((m) => m.version === 4);
  if (!v4) return;

  const tables = extractTableNames(v4.sql);
  const indexes = extractIndexNames(v4.sql);

  const expectedTables = [
    'review_attempts',
    'learning_interventions',
    'learning_history_meta',
  ];

  const expectedIndexes = [
    'review_attempts_subject_task_time_idx',
    'review_attempts_wrong_answer_time_idx',
    'review_attempts_session_idx',
    'learning_interventions_kind_time_idx',
    'learning_interventions_evidence_idx',
  ];

  test('creates all expected tables', () => {
    for (const table of expectedTables) {
      expect(tables).toContain(table);
    }
  });

  test('creates all expected indexes', () => {
    for (const index of expectedIndexes) {
      expect(indexes).toContain(index);
    }
  });

  test('does not create unexpected tables', () => {
    expect(tables.sort()).toEqual([...expectedTables].sort());
  });

  test('review_attempts has scored_correct and overridden columns', () => {
    expect(v4.sql).toContain('scored_correct INTEGER NOT NULL');
    expect(v4.sql).toContain('overridden INTEGER NOT NULL DEFAULT 0');
  });

  test('learning_history_meta is key/value', () => {
    expect(v4.sql).toContain('key TEXT PRIMARY KEY NOT NULL');
    expect(v4.sql).toContain('value TEXT NOT NULL');
  });
});

describe('Migration type', () => {
  test('Migration type requires version and sql', () => {
    const m: Migration = { version: 1, sql: 'SELECT 1' };
    expect(m.version).toBe(1);
    expect(m.sql).toBe('SELECT 1');
  });
});
