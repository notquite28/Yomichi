export type Migration = {
  version: number;
  sql: string;
};

export const migrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS sync_cursors (
        collection TEXT PRIMARY KEY NOT NULL,
        updated_after TEXT NOT NULL DEFAULT '',
        synced_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        username TEXT NOT NULL,
        level INTEGER NOT NULL,
        vacation_started_at TEXT,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS subjects (
        id INTEGER PRIMARY KEY NOT NULL,
        japanese TEXT,
        level INTEGER NOT NULL,
        subject_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT
      );

      CREATE INDEX IF NOT EXISTS subjects_level_type_idx ON subjects (level, subject_type);
      CREATE INDEX IF NOT EXISTS subjects_japanese_idx ON subjects (japanese);

      CREATE TABLE IF NOT EXISTS assignments (
        id INTEGER PRIMARY KEY NOT NULL,
        subject_id INTEGER NOT NULL,
        level INTEGER,
        subject_type TEXT NOT NULL,
        srs_stage INTEGER NOT NULL,
        available_at TEXT,
        started_at TEXT,
        passed_at TEXT,
        burned_at TEXT,
        payload TEXT NOT NULL,
        updated_at TEXT,
        FOREIGN KEY (subject_id) REFERENCES subjects(id)
      );

      CREATE INDEX IF NOT EXISTS assignments_available_idx ON assignments (available_at, srs_stage);
      CREATE INDEX IF NOT EXISTS assignments_subject_idx ON assignments (subject_id);
      CREATE INDEX IF NOT EXISTS assignments_level_type_idx ON assignments (level, subject_type);

      CREATE TABLE IF NOT EXISTS study_materials (
        id INTEGER PRIMARY KEY NOT NULL,
        subject_id INTEGER NOT NULL UNIQUE,
        payload TEXT NOT NULL,
        updated_at TEXT,
        FOREIGN KEY (subject_id) REFERENCES subjects(id)
      );

      CREATE TABLE IF NOT EXISTS level_progressions (
        id INTEGER PRIMARY KEY NOT NULL,
        level INTEGER NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS voice_actors (
        id INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS review_stats (
        id INTEGER PRIMARY KEY NOT NULL,
        subject_id INTEGER NOT NULL,
        subject_type TEXT,
        percentage_correct INTEGER,
        payload TEXT NOT NULL,
        updated_at TEXT,
        FOREIGN KEY (subject_id) REFERENCES subjects(id)
      );

      CREATE INDEX IF NOT EXISTS review_stats_subject_idx ON review_stats (subject_id);

      CREATE TABLE IF NOT EXISTS audio_urls (
        subject_id INTEGER NOT NULL,
        voice_actor_id INTEGER,
        remote_url TEXT NOT NULL,
        local_file_path TEXT,
        status TEXT NOT NULL DEFAULT 'remote',
        PRIMARY KEY (subject_id, remote_url),
        FOREIGN KEY (subject_id) REFERENCES subjects(id)
      );

      CREATE TABLE IF NOT EXISTS subject_progress (
        subject_id INTEGER PRIMARY KEY NOT NULL,
        level INTEGER,
        srs_stage INTEGER,
        subject_type TEXT,
        last_mistake_at TEXT,
        FOREIGN KEY (subject_id) REFERENCES subjects(id)
      );

      CREATE TABLE IF NOT EXISTS pending_progress (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );

      CREATE TABLE IF NOT EXISTS pending_study_materials (
        id TEXT PRIMARY KEY NOT NULL,
        subject_id INTEGER NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        FOREIGN KEY (subject_id) REFERENCES subjects(id)
      );

      CREATE TABLE IF NOT EXISTS error_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        context TEXT,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    sql: `
      DELETE FROM pending_study_materials
      WHERE rowid NOT IN (
        SELECT keep_rowid
        FROM (
          SELECT (
            SELECT p2.rowid
            FROM pending_study_materials p2
            WHERE p2.subject_id = p1.subject_id
            ORDER BY p2.created_at DESC, p2.rowid DESC
            LIMIT 1
          ) AS keep_rowid
          FROM pending_study_materials p1
          GROUP BY p1.subject_id
        )
      );

      CREATE UNIQUE INDEX IF NOT EXISTS pending_study_materials_subject_idx
        ON pending_study_materials(subject_id);
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS coach_cache (
        subject_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        prompt_hash TEXT NOT NULL,
        response TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (subject_id, action, prompt_hash)
      );

      CREATE INDEX IF NOT EXISTS coach_cache_subject_idx
        ON coach_cache(subject_id);
    `,
  },
];
