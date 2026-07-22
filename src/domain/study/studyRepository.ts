import { AssignmentData, StudyMaterialData } from '../api/types';
import { SubjectAnswerData, StudyMaterialAnswerData } from '../answers/answerChecker';
import { calculateLeechScore } from '../dashboard/dashboardRepository';
import { applyLocalReviewResult, markAssignmentStarted } from '../db/assignmentRepository';
import { AppDatabase, runInWriteTransaction } from '../db/database';
import { findBySubjectId, upsertWithSynonyms } from '../db/studyMaterialRepository';
import {
  normalizeSubjectType,
  parseSubjectPayload,
} from '../db/subjectRepository';
import { StudyMaterialPayload } from '../api/types';
import { AppSettings, BurnedPracticeOrder, SubjectType } from '../settings/settings';

type AssignmentResource = {
  id: number;
  data: AssignmentData;
};

type StudyMaterialResource = {
  id: number;
  data: StudyMaterialData;
};

type StudyQueueRow = {
  assignment_id: number;
  subject_id: number;
  subject_type: string;
  level: number | null;
  srs_stage: number;
  assignment_payload: string;
  subject_payload: string;
  study_material_payload: string | null;
  available_at: string | null;
};

export type StudyQueueItem = {
  assignmentId: number;
  subjectId: number;
  subjectType: string;
  level?: number;
  srsStage: number;
  subject: SubjectAnswerData;
  studyMaterials?: StudyMaterialAnswerData;
  availableAt?: string;
};

export type ReviewResult = {
  assignmentId: number;
  incorrectMeaningAnswers: number;
  incorrectReadingAnswers: number;
};

export async function getReviewQueue(db: AppDatabase, limit = 100) {
  const now = new Date().toISOString();
  const rows = await db.getAllAsync<StudyQueueRow>(
    `SELECT
       assignments.id AS assignment_id,
       assignments.subject_id,
       assignments.subject_type,
       assignments.level,
       assignments.srs_stage,
       assignments.available_at,
       assignments.payload AS assignment_payload,
       subjects.payload AS subject_payload,
       study_materials.payload AS study_material_payload
     FROM assignments
     INNER JOIN subjects ON subjects.id = assignments.subject_id
     LEFT JOIN study_materials ON study_materials.subject_id = assignments.subject_id
     WHERE assignments.srs_stage BETWEEN 1 AND 8
       AND assignments.available_at IS NOT NULL
       AND assignments.available_at <= ?
     ORDER BY assignments.available_at ASC, assignments.level ASC, assignments.id ASC
     LIMIT ?`,
    now,
    limit,
  );

  return rows.map(rowToStudyQueueItem).filter(hasPrompt);
}

export async function getRecentMistakePracticeQueue(db: AppDatabase, limit = 100) {
  const cutoff = recentMistakeCutoff().toISOString();
  const rows = await db.getAllAsync<StudyQueueRow>(
    `SELECT
       assignments.id AS assignment_id,
       assignments.subject_id,
       assignments.subject_type,
       assignments.level,
       assignments.srs_stage,
       assignments.available_at,
       assignments.payload AS assignment_payload,
       subjects.payload AS subject_payload,
       study_materials.payload AS study_material_payload
     FROM subject_progress
     INNER JOIN assignments ON assignments.subject_id = subject_progress.subject_id
     INNER JOIN subjects ON subjects.id = assignments.subject_id
     LEFT JOIN study_materials ON study_materials.subject_id = assignments.subject_id
     WHERE subject_progress.last_mistake_at IS NOT NULL
       AND subject_progress.last_mistake_at >= ?
       AND assignments.srs_stage BETWEEN 1 AND 8
     ORDER BY subject_progress.last_mistake_at DESC, assignments.id ASC
     LIMIT ?`,
    cutoff,
    limit,
  );

  return rows.map(rowToStudyQueueItem).filter(hasPrompt);
}

export async function getLeechPracticeQueue(db: AppDatabase, options?: { apprenticeOnly?: boolean; threshold?: number; limit?: number }) {
  const apprenticeOnly = options?.apprenticeOnly ?? false;
  const threshold = options?.threshold ?? 1;
  const limit = options?.limit ?? 100;

  const srsFilter = apprenticeOnly ? 'AND a.srs_stage BETWEEN 1 AND 4' : '';
  type LeechRow = StudyQueueRow & {
    meaning_incorrect: number;
    meaning_correct: number;
    reading_incorrect: number;
    reading_correct: number;
  };

  const rows = await db.getAllAsync<LeechRow>(
    `SELECT
       a.id AS assignment_id,
       a.subject_id,
       a.subject_type,
       a.level,
       a.srs_stage,
       a.available_at,
       a.payload AS assignment_payload,
       s.payload AS subject_payload,
       sm.payload AS study_material_payload,
       CAST(COALESCE(json_extract(rs.payload, '$.data.meaning_incorrect'), 0) AS INTEGER) AS meaning_incorrect,
       CAST(COALESCE(json_extract(rs.payload, '$.data.meaning_correct'), 0) AS INTEGER) AS meaning_correct,
       CAST(COALESCE(json_extract(rs.payload, '$.data.reading_incorrect'), 0) AS INTEGER) AS reading_incorrect,
       CAST(COALESCE(json_extract(rs.payload, '$.data.reading_correct'), 0) AS INTEGER) AS reading_correct
     FROM review_stats rs
     JOIN subjects s ON s.id = rs.subject_id
     JOIN assignments a ON a.subject_id = rs.subject_id
     LEFT JOIN study_materials sm ON sm.subject_id = a.subject_id
     WHERE (COALESCE(json_extract(rs.payload, '$.data.meaning_incorrect'), 0)
         + COALESCE(json_extract(rs.payload, '$.data.reading_incorrect'), 0)) > 0
       ${srsFilter}
       AND a.srs_stage BETWEEN 1 AND 9
     ORDER BY (COALESCE(json_extract(rs.payload, '$.data.meaning_incorrect'), 0)
         + COALESCE(json_extract(rs.payload, '$.data.reading_incorrect'), 0)) * 1.0
       / NULLIF(
         COALESCE(json_extract(rs.payload, '$.data.meaning_correct'), 0)
         + COALESCE(json_extract(rs.payload, '$.data.meaning_incorrect'), 0)
         + COALESCE(json_extract(rs.payload, '$.data.reading_correct'), 0)
         + COALESCE(json_extract(rs.payload, '$.data.reading_incorrect'), 0), 0) DESC
     LIMIT ?`,
    limit,
  );

  return rows
    .map((row) => ({
      item: rowToStudyQueueItem(row),
      score: calculateLeechScore(
        row.meaning_incorrect + row.reading_incorrect,
        row.meaning_correct + row.reading_correct,
      ),
    }))
    .filter((entry): entry is { item: StudyQueueItem; score: number } => hasPrompt(entry.item))
    .filter(({ score }) => threshold <= 0 || score >= threshold)
    .map(({ item }) => item);
}

export type BurnedPracticeOptions = {
  order: BurnedPracticeOrder;
  limit: number;
  includeRadicals: boolean;
  includeKanji: boolean;
  includeVocabulary: boolean;
};

export async function getBurnedItemPracticeQueue(
  db: AppDatabase,
  options: BurnedPracticeOptions,
): Promise<StudyQueueItem[]> {
  const types: string[] = [];
  if (options.includeRadicals) types.push('radical');
  if (options.includeKanji) types.push('kanji');
  if (options.includeVocabulary) types.push('vocabulary');
  if (types.length === 0) return [];

  const limit = Math.min(200, Math.max(1, Math.floor(options.limit)));
  const typePlaceholders = types.map(() => '?').join(',');

  if (options.order === 'random') {
    const idRows = await db.getAllAsync<{ assignment_id: number }>(
      `SELECT a.id AS assignment_id
       FROM assignments a
       WHERE a.srs_stage = 9
         AND a.subject_type IN (${typePlaceholders})
       ORDER BY a.level ASC, a.subject_type ASC, a.subject_id ASC`,
      ...types,
    );
    if (idRows.length === 0) return [];

    const assignmentIds = idRows.map((row) => row.assignment_id);
    shuffleArray(assignmentIds);
    const selectedIds = assignmentIds.slice(0, limit);
    return loadStudyQueueItemsByAssignmentIds(db, selectedIds);
  }

  let orderClause: string;
  switch (options.order) {
    case 'oldestBurned':
      orderClause = 'ORDER BY a.burned_at IS NULL, a.burned_at ASC, a.subject_id ASC';
      break;
    case 'newestBurned':
      orderClause = 'ORDER BY a.burned_at IS NULL, a.burned_at DESC, a.subject_id DESC';
      break;
    case 'levelAscending':
    default:
      orderClause = 'ORDER BY a.level ASC, a.subject_type ASC, a.subject_id ASC';
      break;
  }

  const rows = await db.getAllAsync<StudyQueueRow>(
    `SELECT
       a.id AS assignment_id,
       a.subject_id,
       a.subject_type,
       a.level,
       a.srs_stage,
       a.available_at,
       a.payload AS assignment_payload,
       s.payload AS subject_payload,
       sm.payload AS study_material_payload
     FROM assignments a
     INNER JOIN subjects s ON s.id = a.subject_id
     LEFT JOIN study_materials sm ON sm.subject_id = a.subject_id
     WHERE a.srs_stage = 9
       AND a.subject_type IN (${typePlaceholders})
     ${orderClause}
     LIMIT ?`,
    ...types,
    limit,
  );

  return rows.map(rowToStudyQueueItem).filter(hasPrompt);
}

export async function getPracticeQueueBySubjectIds(
  db: AppDatabase,
  subjectIds: number[],
  limit = 20,
): Promise<StudyQueueItem[]> {
  const orderedUnique: number[] = [];
  const seen = new Set<number>();
  for (const id of subjectIds) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    orderedUnique.push(id);
  }
  if (orderedUnique.length === 0) {
    return [];
  }

  const bySubject = new Map<number, StudyQueueItem>();
  const CHUNK_SIZE = 500;
  for (let offset = 0; offset < orderedUnique.length; offset += CHUNK_SIZE) {
    const chunk = orderedUnique.slice(offset, offset + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = await db.getAllAsync<StudyQueueRow>(
      `SELECT
         a.id AS assignment_id,
         a.subject_id,
         a.subject_type,
         a.level,
         a.srs_stage,
         a.available_at,
         a.payload AS assignment_payload,
         s.payload AS subject_payload,
         sm.payload AS study_material_payload
       FROM assignments a
       INNER JOIN subjects s ON s.id = a.subject_id
       LEFT JOIN study_materials sm ON sm.subject_id = a.subject_id
       WHERE a.subject_id IN (${placeholders})
       ORDER BY a.srs_stage DESC, a.id ASC`,
      ...chunk,
    );

    for (const row of rows) {
      if (bySubject.has(row.subject_id)) {
        continue;
      }
      const item = rowToStudyQueueItem(row);
      if (hasPrompt(item)) {
        bySubject.set(row.subject_id, item);
      }
    }
  }

  // Repeat the ordered pair so practice sessions have enough tasks.
  const base = orderedUnique
    .map((id) => bySubject.get(id))
    .filter((item): item is StudyQueueItem => item != null);
  if (base.length === 0) {
    return [];
  }
  const repeated: StudyQueueItem[] = [];
  while (repeated.length < Math.min(limit, Math.max(base.length * 2, base.length))) {
    for (const item of base) {
      repeated.push(item);
      if (repeated.length >= limit) {
        break;
      }
    }
    if (base.length === 0) {
      break;
    }
  }
  return repeated;
}

async function loadStudyQueueItemsByAssignmentIds(
  db: AppDatabase,
  assignmentIds: number[],
): Promise<StudyQueueItem[]> {
  if (assignmentIds.length === 0) return [];

  const byId = new Map<number, StudyQueueItem>();
  const CHUNK_SIZE = 500;
  for (let offset = 0; offset < assignmentIds.length; offset += CHUNK_SIZE) {
    const chunk = assignmentIds.slice(offset, offset + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = await db.getAllAsync<StudyQueueRow>(
      `SELECT
         a.id AS assignment_id,
         a.subject_id,
         a.subject_type,
         a.level,
         a.srs_stage,
         a.available_at,
         a.payload AS assignment_payload,
         s.payload AS subject_payload,
         sm.payload AS study_material_payload
       FROM assignments a
       INNER JOIN subjects s ON s.id = a.subject_id
       LEFT JOIN study_materials sm ON sm.subject_id = a.subject_id
       WHERE a.id IN (${placeholders})`,
      ...chunk,
    );

    for (const row of rows) {
      const item = rowToStudyQueueItem(row);
      if (hasPrompt(item)) {
        byId.set(row.assignment_id, item);
      }
    }
  }

  return assignmentIds
    .map((id) => byId.get(id))
    .filter((item): item is StudyQueueItem => item != null);
}


export async function getLessonQueue(db: AppDatabase, settings: AppSettings, limit = 100) {
  const rows = await db.getAllAsync<StudyQueueRow>(
    `SELECT
       assignments.id AS assignment_id,
       assignments.subject_id,
       assignments.subject_type,
       assignments.level,
       assignments.srs_stage,
       assignments.available_at,
       assignments.payload AS assignment_payload,
       subjects.payload AS subject_payload,
       study_materials.payload AS study_material_payload
     FROM assignments
     INNER JOIN subjects ON subjects.id = assignments.subject_id
     LEFT JOIN study_materials ON study_materials.subject_id = assignments.subject_id
     WHERE assignments.srs_stage = 0
       AND assignments.started_at IS NULL`,
  );

  let items = rows
    .map((row) => rowToLessonEntry(row))
    .filter((entry): entry is LessonEntry =>
      entry !== null && hasPrompt(entry.item) && !isLessonFiltered(entry.item, entry.isKanaOnly, entry.isHidden, settings));

  if (settings.interleaveLessons) {
    shuffleArray(items);
  }

  items = sortLessonItems(items, settings);

  return items.slice(0, limit).map(({ item }) => item);
}

export async function getLessonItemsByIds(db: AppDatabase, settings: AppSettings, subjectIds: Set<number>) {
  const rows = await db.getAllAsync<StudyQueueRow>(
    `SELECT
       assignments.id AS assignment_id,
       assignments.subject_id,
       assignments.subject_type,
       assignments.level,
       assignments.srs_stage,
       assignments.available_at,
       assignments.payload AS assignment_payload,
       subjects.payload AS subject_payload,
       study_materials.payload AS study_material_payload
     FROM assignments
     INNER JOIN subjects ON subjects.id = assignments.subject_id
     LEFT JOIN study_materials ON study_materials.subject_id = assignments.subject_id
     WHERE assignments.srs_stage = 0
       AND assignments.started_at IS NULL`,
  );

  return rows
    .map((row) => rowToLessonEntry(row))
    .filter((entry): entry is LessonEntry =>
      entry !== null && hasPrompt(entry.item) && !isLessonFiltered(entry.item, entry.isKanaOnly, entry.isHidden, settings) && subjectIds.has(entry.item.subjectId))
    .map(({ item }) => item);
}

export function isLessonFiltered(item: StudyQueueItem, isKanaOnlySubject: boolean, isHiddenSubject: boolean, settings: AppSettings): boolean {
  if (!settings.showKanaOnlyVocab && item.subjectType === 'vocabulary' && isKanaOnlySubject) {
    return true;
  }
  if (item.subjectType === 'vocabulary' && isHiddenSubject) {
    return true;
  }
  return false;
}

export function sortLessonItems<T extends { item: StudyQueueItem }>(items: T[], settings: AppSettings): T[] {
  const typeOrder = new Map(settings.lessonOrder.map((type, idx) => [type, idx]));

  items.sort((a, b) => {
    const levelA = a.item.level ?? 0;
    const levelB = b.item.level ?? 0;
    if (levelA !== levelB) {
      return settings.prioritizeCurrentLevel ? levelB - levelA : levelA - levelB;
    }
    if (settings.interleaveLessons) {
      return 0;
    }
    const typeIdxA = typeOrder.get(a.item.subjectType as SubjectType) ?? 0;
    const typeIdxB = typeOrder.get(b.item.subjectType as SubjectType) ?? 0;
    if (typeIdxA !== typeIdxB) {
      return typeIdxA - typeIdxB;
    }
    return a.item.subjectId - b.item.subjectId;
  });

  return items;
}

export function chunkLessonItems<T>(items: T[], batchSize: number): T[][] {
  const size = Math.max(1, Math.floor(batchSize));
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function queueReviewResult(db: AppDatabase, result: ReviewResult) {
  const createdAt = new Date().toISOString();
  await runInWriteTransaction(db, async () => {
    await db.runAsync(
      `INSERT INTO pending_progress (id, kind, payload, created_at)
       VALUES (?, 'review', ?, ?)`,
      `review:${result.assignmentId}:${Date.now()}`,
      JSON.stringify({
        assignmentId: result.assignmentId,
        incorrectMeaningAnswers: result.incorrectMeaningAnswers,
        incorrectReadingAnswers: result.incorrectReadingAnswers,
        createdAt,
      }),
      createdAt,
    );
    await applyLocalReviewResult(
      db,
      result.assignmentId,
      result.incorrectMeaningAnswers,
      result.incorrectReadingAnswers,
      createdAt,
    );
  });
}


export function recentMistakeCutoff(now = new Date()) {
  return new Date(now.getTime() - 24 * 3600_000);
}

export async function queueLessonStart(db: AppDatabase, assignmentId: number) {
  const startedAt = new Date().toISOString();
  await runInWriteTransaction(db, async () => {
    await db.runAsync(
      `INSERT INTO pending_progress (id, kind, payload, created_at)
       VALUES (?, 'lesson-start', ?, ?)`,
      `lesson-start:${assignmentId}:${Date.now()}`,
      JSON.stringify({ assignmentId, startedAt }),
      startedAt,
    );
    await markAssignmentStarted(db, assignmentId, startedAt);
  });
}

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
}

export async function queueStudyMaterialUpdate(db: AppDatabase, payload: StudyMaterialPayload) {
  const createdAt = new Date().toISOString();
  await runInWriteTransaction(db, async () => {
    const existingPending = await db.getFirstAsync<{ payload: string }>(
      'SELECT payload FROM pending_study_materials WHERE subject_id = ?',
      payload.subjectId,
    );
    const pendingPayload = existingPending ? JSON.parse(existingPending.payload) as StudyMaterialPayload : undefined;
    const existing = await findBySubjectId(db, payload.subjectId);
    const localId = existing && existing.id > 0 ? existing.id : undefined;
    const payloadId = payload.id && payload.id > 0 ? payload.id : undefined;
    const pendingId = pendingPayload?.id && pendingPayload.id > 0 ? pendingPayload.id : undefined;
    const remoteId = payloadId ?? pendingId ?? localId;

    const queuedPayload: StudyMaterialPayload = { subjectId: payload.subjectId };
    const meaningSynonyms = firstDefined(payload.meaningSynonyms, pendingPayload?.meaningSynonyms);
    const meaningNote = firstDefined(payload.meaningNote, pendingPayload?.meaningNote);
    const readingNote = firstDefined(payload.readingNote, pendingPayload?.readingNote);
    const hasEditableField = meaningSynonyms !== undefined || meaningNote !== undefined || readingNote !== undefined;

    if (!hasEditableField && (!existingPending || !remoteId)) {
      return;
    }

    if (meaningSynonyms !== undefined) queuedPayload.meaningSynonyms = meaningSynonyms;
    if (meaningNote !== undefined) queuedPayload.meaningNote = meaningNote;
    if (readingNote !== undefined) queuedPayload.readingNote = readingNote;
    if (remoteId) queuedPayload.id = remoteId;

    await db.runAsync(
      `INSERT INTO pending_study_materials (id, subject_id, payload, created_at, attempts, last_error)
       VALUES (?, ?, ?, ?, 0, NULL)
       ON CONFLICT(subject_id) DO UPDATE SET
         payload = excluded.payload,
         created_at = excluded.created_at,
         attempts = 0,
         last_error = NULL`,
      `study-material:${queuedPayload.subjectId}`,
      queuedPayload.subjectId,
      JSON.stringify(queuedPayload),
      createdAt,
    );
    if (hasEditableField) {
      await upsertWithSynonyms(db, payload);
    }
  });
}

function rowToStudyQueueItem(row: StudyQueueRow): StudyQueueItem | null {
  let assignment: AssignmentResource;
  let studyMaterial: StudyMaterialResource | undefined;
  try {
    assignment = JSON.parse(row.assignment_payload) as AssignmentResource;
    studyMaterial = row.study_material_payload ? (JSON.parse(row.study_material_payload) as StudyMaterialResource) : undefined;
  } catch {
    return null;
  }
  return buildStudyQueueItem(row, assignment, studyMaterial);
}

function buildStudyQueueItem(
  row: StudyQueueRow,
  assignment: AssignmentResource,
  studyMaterial: StudyMaterialResource | undefined,
): StudyQueueItem | null {
  try {
    const parsed = parseSubjectPayload(row.subject_id, row.subject_payload);
    const subjectType = normalizeSubjectType(row.subject_type || assignment.data.subject_type);

    return {
      assignmentId: row.assignment_id,
      subjectId: row.subject_id,
      subjectType,
      level: row.level ?? undefined,
      srsStage: row.srs_stage,
      subject: parsed,
      studyMaterials: studyMaterial
        ? {
            meaningSynonyms: studyMaterial.data.meaning_synonyms ?? [],
          }
        : undefined,
      availableAt: row.available_at ?? undefined,
    };
  } catch {
    // A corrupt/truncated payload should drop just this item, not the whole
    // queue. The caller filters nulls out.
    return null;
  }
}

export type LessonEntry = {
  item: StudyQueueItem;
  isKanaOnly: boolean;
  isHidden: boolean;
};

/**
 * Parses a lesson row's subject and study-material payloads exactly once and
 * derives the kana-only/hidden flags from the same parsed objects, instead of
 * re-parsing them in separate isKanaOnly/isHidden passes.
 */
function rowToLessonEntry(row: StudyQueueRow): LessonEntry | null {
  let assignment: AssignmentResource;
  let subjectRaw: { object?: string };
  let studyMaterial: StudyMaterialResource | undefined;
  let studyMaterialRaw: { data?: { hidden?: boolean } } | undefined;
  try {
    assignment = JSON.parse(row.assignment_payload) as AssignmentResource;
    subjectRaw = JSON.parse(row.subject_payload) as { object?: string };
    if (row.study_material_payload) {
      studyMaterialRaw = JSON.parse(row.study_material_payload) as { data?: { hidden?: boolean } };
      studyMaterial = studyMaterialRaw as StudyMaterialResource;
    }
  } catch {
    return null;
  }

  const item = buildStudyQueueItem(row, assignment, studyMaterial);
  if (!item) {
    return null;
  }

  return {
    item,
    isKanaOnly: subjectRaw.object === 'kana_vocabulary',
    isHidden: studyMaterialRaw?.data?.hidden === true,
  };
}

function hasPrompt(item: StudyQueueItem | null): item is StudyQueueItem {
  return item != null && Boolean(item.subject.japanese || item.subject.characterImageUrl);
}

function shuffleArray<T>(array: T[]): void {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = array[i]!;
    array[i] = array[j]!;
    array[j] = temp;
  }
}

export { getCharacterImageUrl, isCharacterImageSvg } from '../db/subjectRepository';
