import type { SQLiteBindValue } from 'expo-sqlite';
import { SubjectData } from '../api/types';
import { SubjectAnswerData } from '../answers/answerChecker';
import { AppDatabase } from './database';

type SubjectResource = {
  id: number;
  object: string;
  data: SubjectData;
};

export async function getSubjectById(db: AppDatabase, id: number): Promise<SubjectAnswerData | null> {
  const row = await db.getFirstAsync<{ id: number; payload: string }>(
    'SELECT id, payload FROM subjects WHERE id = ?',
    id,
  );
  if (!row) return null;
  return parseSubjectPayload(row.id, row.payload);
}

export async function getSubjectsByIds(db: AppDatabase, ids: number[]): Promise<Map<number, SubjectAnswerData>> {
  if (ids.length === 0) return new Map();

  const result = new Map<number, SubjectAnswerData>();
  // Chunk to stay under SQLite's bound-variable limit (SQLITE_MAX_VARIABLE_NUMBER,
  // 999 on older builds). High-level vocab can reference large component sets.
  const CHUNK_SIZE = 500;
  for (let offset = 0; offset < ids.length; offset += CHUNK_SIZE) {
    const chunk = ids.slice(offset, offset + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = await db.getAllAsync<{ id: number; payload: string }>(
      `SELECT id, payload FROM subjects WHERE id IN (${placeholders})`,
      ...chunk,
    );

    for (const row of rows) {
      const parsed = safeParseSubjectPayload(row.id, row.payload);
      if (parsed) result.set(row.id, parsed);
    }
  }
  return result;
}

export async function countSubjects(db: AppDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ value: number }>('SELECT COUNT(*) AS value FROM subjects');
  return row?.value ?? 0;
}

export type RadicalImageRow = {
  id: number;
  level: number;
  payload: string;
};

export async function getImageOnlyRadicals(db: AppDatabase, limit = 100): Promise<RadicalImageRow[]> {
  return db.getAllAsync<RadicalImageRow>(
    `SELECT id, level, payload
     FROM subjects
     WHERE subject_type = 'radical'
       AND (japanese IS NULL OR japanese = '')
     ORDER BY level ASC, id ASC
     LIMIT ?`,
    limit,
  );
}

export function parseSubjectPayload(id: number, payload: string): SubjectAnswerData {
  const resource = JSON.parse(payload) as SubjectResource;
  const subjectType = normalizeSubjectType(resource.object);
  return {
    id,
    type: subjectType,
    japanese: resource.data.characters ?? '',
    characterImageUrl: getCharacterImageUrl(resource.data),
    characterImageIsSvg: isCharacterImageSvg(resource.data),
    meanings: [
      ...(resource.data.meanings ?? []).map((meaning) => ({
        meaning: meaning.meaning,
        type: meaning.primary ? 'primary' as const : 'secondary' as const,
        acceptedAnswer: meaning.accepted_answer ?? true,
      })),
      ...(resource.data.auxiliary_meanings ?? []).map((meaning) => ({
        meaning: meaning.meaning,
        type: meaning.type === 'blacklist' ? 'blacklist' as const : 'auxiliary_whitelist' as const,
        acceptedAnswer: meaning.type !== 'blacklist',
      })),
    ],
    readings: (resource.data.readings ?? []).map((reading) => ({
      reading: reading.reading,
      primary: reading.primary ?? reading.accepted_answer ?? false,
      acceptedAnswer: reading.accepted_answer ?? reading.primary ?? true,
      type: reading.type,
    })),
    componentSubjectIds: resource.data.component_subject_ids ?? [],
    meaningMnemonic: resource.data.meaning_mnemonic,
    meaningHint: resource.data.meaning_hint,
    readingMnemonic: resource.data.reading_mnemonic,
    readingHint: resource.data.reading_hint,
    contextSentences: resource.data.context_sentences,
    partsOfSpeech: resource.data.parts_of_speech,
    amalgamationSubjectIds: resource.data.amalgamation_subject_ids ?? [],
  };
}

export function parseSubjectResource(payload: string): SubjectResource {
  return JSON.parse(payload) as SubjectResource;
}

/**
 * Parses a subject payload, returning null instead of throwing if the stored
 * JSON is corrupt or truncated. Use this in batch row mappings so one bad row
 * is skipped rather than failing the entire query (offline-first: cached data
 * must keep working).
 */
export function safeParseSubjectPayload(id: number, payload: string): SubjectAnswerData | null {
  try {
    return parseSubjectPayload(id, payload);
  } catch {
    return null;
  }
}

export function normalizeSubjectType(subjectType: string): string {
  return subjectType === 'kana_vocabulary' ? 'vocabulary' : subjectType;
}

export function getCharacterImageUrl(subject: SubjectData): string | undefined {
  const images = subject.character_images ?? [];

  const svgWithInlineStyles = images.find(
    (image) => image.content_type === 'image/svg+xml' && image.metadata?.inline_styles === true,
  );
  if (svgWithInlineStyles?.url) return svgWithInlineStyles.url;

  const pngs = images.filter((image) => image.content_type === 'image/png');
  return (
    pngs.find((image) => image.metadata?.style_name === 'original')?.url ??
    pngs[0]?.url ??
    images.find((image) => image.content_type === 'image/svg+xml')?.url
  );
}

export function isCharacterImageSvg(subject: SubjectData): boolean {
  const images = subject.character_images ?? [];
  const url = getCharacterImageUrl(subject);
  if (!url) return false;
  return images.some((image) => image.url === url && image.content_type === 'image/svg+xml');
}

export type SubjectListRow = {
  id: number;
  japanese: string;
  level: number;
  subjectType: string;
  srsStage: number | null;
  meaningNote: string | null;
  readingNote: string | null;
  meaningSynonyms: string[];
  isHidden: boolean;
  percentageCorrect: number | null;
};

export type BurnedSubjectListRow = {
  id: number;
  japanese: string;
  level: number;
  subjectType: string;
  primaryReadings: string;
  primaryMeaning: string;
  burnedAt: string | null;
  percentageCorrect: number | null;
};
export type BurnedSubjectPage = {
  limit: number;
  offset: number;
};


export async function getBurnedSubjectCount(db: AppDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM assignments a
     INNER JOIN subjects s ON s.id = a.subject_id
     WHERE a.srs_stage = 9`,
  );
  return row?.count ?? 0;
}

export async function getBurnedSubjects(
  db: AppDatabase,
  page?: BurnedSubjectPage,
): Promise<BurnedSubjectListRow[]> {
  const paginationSql = page ? ' LIMIT ? OFFSET ?' : '';
  const paginationParams = page
    ? [Math.max(1, Math.floor(page.limit)), Math.max(0, Math.floor(page.offset))]
    : [];

  const rows = await db.getAllAsync<{
    id: number;
    japanese: string;
    level: number;
    subject_type: string;
    burned_at: string | null;
    percentageCorrect: number | null;
    primary_meaning: string | null;
    primary_readings_json: string | null;
  }>(

    `SELECT s.id, s.japanese, s.level, s.subject_type,
       a.burned_at,
       rs.percentage_correct AS percentageCorrect,
       (
         SELECT json_extract(value, '$.meaning')
         FROM json_each(
           CASE WHEN json_valid(s.payload) THEN s.payload ELSE '{}' END,
           '$.data.meanings'
         )
         WHERE json_extract(value, '$.primary') IN (1, 'true')
            OR json_extract(value, '$.accepted_answer') IN (1, 'true')
         ORDER BY CASE WHEN json_extract(value, '$.primary') IN (1, 'true') THEN 0 ELSE 1 END
         LIMIT 1
       ) AS primary_meaning,
       (
         SELECT json_group_array(json_extract(value, '$.reading'))
         FROM json_each(
           CASE WHEN json_valid(s.payload) THEN s.payload ELSE '{}' END,
           '$.data.readings'
         )
         WHERE json_extract(value, '$.primary') IN (1, 'true')
       ) AS primary_readings_json
     FROM assignments a
     INNER JOIN subjects s ON s.id = a.subject_id
     LEFT JOIN review_stats rs ON rs.subject_id = s.id
     WHERE a.srs_stage = 9
     ORDER BY a.burned_at IS NULL, a.burned_at ASC, s.level ASC, s.id ASC
     ${paginationSql}`,
    ...paginationParams,
  );

  return rows.map((r) => {
    let primaryReadings = '';
    if (r.primary_readings_json) {
      try {
        const parsed = JSON.parse(r.primary_readings_json) as unknown;
        if (Array.isArray(parsed)) {
          primaryReadings = parsed
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
            .join(' · ');
        }
      } catch {
        primaryReadings = '';
      }
    }

    return {
      id: r.id,
      japanese: r.japanese ?? '',
      level: r.level,
      subjectType: r.subject_type,
      primaryReadings,
      primaryMeaning: r.primary_meaning ?? '',
      burnedAt: r.burned_at,
      percentageCorrect: r.percentageCorrect,
    };
  });
}


export async function getSubjectsByLevel(db: AppDatabase, level: number): Promise<SubjectListRow[]> {
  return getAllSubjectRows(db, 'WHERE s.level = ? ORDER BY s.subject_type, s.id', level);
}

export async function getSubjectsBySrsBucket(db: AppDatabase, srsMin: number, srsMax: number): Promise<SubjectListRow[]> {
  return getAllSubjectRows(db, 'WHERE a.srs_stage BETWEEN ? AND ? ORDER BY a.srs_stage, s.level, s.id', srsMin, srsMax);
}

export async function getRemainingSubjects(db: AppDatabase, level?: number): Promise<SubjectListRow[]> {
  if (level != null) {
    return getAllSubjectRows(db, 'WHERE a.srs_stage BETWEEN 0 AND 8 AND s.level = ? ORDER BY s.level, s.subject_type, s.id', level);
  }
  return getAllSubjectRows(db, 'WHERE a.srs_stage BETWEEN 0 AND 8 ORDER BY s.level, s.subject_type, s.id');
}

export async function getExcludedSubjects(db: AppDatabase): Promise<SubjectListRow[]> {
  const rows = await db.getAllAsync<{
    id: number;
    japanese: string;
    level: number;
    subject_type: string;
    srsStage: number | null;
    meaningNote: string | null;
    readingNote: string | null;
    meaningSynonyms: string;
    isHidden: number;
    percentageCorrect: number | null;
  }>(
    `SELECT s.id, s.japanese, s.level, s.subject_type,
       NULL AS srsStage, NULL AS meaningNote, NULL AS readingNote,
       '[]' AS meaningSynonyms, 1 AS isHidden, NULL AS percentageCorrect
     FROM subjects s
     WHERE s.id IN (
       SELECT subject_id FROM study_materials
       WHERE json_extract(payload, '$.data.hidden') = 1
          OR json_extract(payload, '$.data.hidden') = 'true'
     )
     ORDER BY s.level, s.subject_type, s.id`,
  );
  return rows.map((r) => ({
    id: r.id,
    japanese: r.japanese ?? '',
    level: r.level,
    subjectType: r.subject_type,
    srsStage: r.srsStage,
    meaningNote: r.meaningNote,
    readingNote: r.readingNote,
    meaningSynonyms: parseSynonymJson(r.meaningSynonyms),
    isHidden: r.isHidden === 1,
    percentageCorrect: r.percentageCorrect,
  }));
}

export type SearchResult = SubjectListRow & {
  matchType: 'exact' | 'prefix' | 'contains';
};

export async function searchSubjects(db: AppDatabase, query: string, limit = 50): Promise<SearchResult[]> {
  if (!query.trim()) return [];

  const q = query.trim().toLowerCase();
  const likePrefix = `${q}%`;
  const likeContains = `%${q}%`;

  const rows = await db.getAllAsync<{
    id: number;
    japanese: string;
    level: number;
    subject_type: string;
    srsStage: number | null;
    meaningNote: string | null;
    readingNote: string | null;
    meaningSynonyms: string;
    isHidden: number;
    percentageCorrect: number | null;
    match_type: number;
  }>(
    `SELECT s.id, s.japanese, s.level, s.subject_type,
       a.srs_stage AS srsStage,
       json_extract(sm.payload, '$.data.meaning_note') AS meaningNote,
       json_extract(sm.payload, '$.data.reading_note') AS readingNote,
       COALESCE(json_extract(sm.payload, '$.data.meaning_synonyms'), '[]') AS meaningSynonyms,
       CASE WHEN json_extract(sm.payload, '$.data.hidden') IN (1, 'true') THEN 1 ELSE 0 END AS isHidden,
       rs.percentage_correct AS percentageCorrect,
       CASE
         WHEN LOWER(s.japanese) = ? THEN 0
         WHEN LOWER(s.japanese) LIKE ? THEN 1
         WHEN EXISTS (
           SELECT 1 FROM json_each(json_extract(s.payload, '$.data.readings'))
           WHERE LOWER(json_extract(value, '$.reading')) = ?
         ) THEN 0
         WHEN EXISTS (
           SELECT 1 FROM json_each(json_extract(s.payload, '$.data.readings'))
           WHERE LOWER(json_extract(value, '$.reading')) LIKE ?
         ) THEN 1
         WHEN EXISTS (
           SELECT 1 FROM json_each(json_extract(s.payload, '$.data.meanings'))
           WHERE LOWER(json_extract(value, '$.meaning')) = ?
         ) THEN 2
         WHEN EXISTS (
           SELECT 1 FROM json_each(json_extract(s.payload, '$.data.meanings'))
           WHERE LOWER(json_extract(value, '$.meaning')) LIKE ?
         ) THEN 3
         ELSE 4
       END AS match_type
     FROM subjects s
     LEFT JOIN assignments a ON a.subject_id = s.id
     LEFT JOIN study_materials sm ON sm.subject_id = s.id
     LEFT JOIN review_stats rs ON rs.subject_id = s.id
     WHERE s.japanese LIKE ?
        OR EXISTS (
          SELECT 1 FROM json_each(json_extract(s.payload, '$.data.readings'))
          WHERE LOWER(json_extract(value, '$.reading')) LIKE ?
        )
        OR EXISTS (
          SELECT 1 FROM json_each(json_extract(s.payload, '$.data.meanings'))
          WHERE LOWER(json_extract(value, '$.meaning')) LIKE ?
        )
     ORDER BY match_type, s.level, s.subject_type, s.id
     LIMIT ?`,
    q, likePrefix,
    q, likePrefix,
    q, likePrefix,
    likeContains,
    likeContains,
    likeContains,
    limit,
  );

  return rows.map((r) => ({
    id: r.id,
    japanese: r.japanese ?? '',
    level: r.level,
    subjectType: r.subject_type,
    srsStage: r.srsStage,
    meaningNote: r.meaningNote,
    readingNote: r.readingNote,
    meaningSynonyms: parseSynonymJson(r.meaningSynonyms),
    isHidden: r.isHidden === 1,
    percentageCorrect: r.percentageCorrect,
    matchType: r.match_type === 0 || r.match_type === 2 ? 'exact' : r.match_type === 1 || r.match_type === 3 ? 'prefix' : 'contains',
  }));
}

async function getAllSubjectRows(db: AppDatabase, whereClause: string, ...args: SQLiteBindValue[]): Promise<SubjectListRow[]> {
  const rows = await db.getAllAsync<{
    id: number;
    japanese: string;
    level: number;
    subject_type: string;
    srsStage: number | null;
    meaningNote: string | null;
    readingNote: string | null;
    meaningSynonyms: string;
    isHidden: number;
    percentageCorrect: number | null;
  }>(
    `SELECT s.id, s.japanese, s.level, s.subject_type,
       a.srs_stage AS srsStage,
       json_extract(sm.payload, '$.data.meaning_note') AS meaningNote,
       json_extract(sm.payload, '$.data.reading_note') AS readingNote,
       COALESCE(json_extract(sm.payload, '$.data.meaning_synonyms'), '[]') AS meaningSynonyms,
       CASE WHEN json_extract(sm.payload, '$.data.hidden') IN (1, 'true') THEN 1 ELSE 0 END AS isHidden,
       rs.percentage_correct AS percentageCorrect
     FROM subjects s
     LEFT JOIN assignments a ON a.subject_id = s.id
     LEFT JOIN study_materials sm ON sm.subject_id = s.id
     LEFT JOIN review_stats rs ON rs.subject_id = s.id
     ${whereClause}`,
    ...args,
  );

  return rows.map((r) => ({
    id: r.id,
    japanese: r.japanese ?? '',
    level: r.level,
    subjectType: r.subject_type,
    srsStage: r.srsStage,
    meaningNote: r.meaningNote,
    readingNote: r.readingNote,
    meaningSynonyms: parseSynonymJson(r.meaningSynonyms),
    isHidden: r.isHidden === 1,
    percentageCorrect: r.percentageCorrect,
  }));
}

export function parseSynonymJson(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}
