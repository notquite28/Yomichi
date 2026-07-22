import { normalizeAnswer, type SubjectAnswerData } from '../answers/answerChecker';
import type { AppDatabase } from '../db/database';
import { parseSubjectPayload, safeParseSubjectPayload } from '../db/subjectRepository';
import type { AttemptTaskType } from './reviewAttempts';
import { findRecentByEvidenceHash } from './learningInterventions';

const REPEATED_MISS_WINDOW_DAYS = 14;
const COOLDOWN_HOURS = 24;
const MAX_RECENT_ANSWERS = 5;
const MAX_CONFUSION_MATCHES = 5;

export type MistakeLensEvidence = {
  kind: 'repeated_miss';
  subjectId: number;
  taskType: AttemptTaskType;
  missCount: number;
  recentAnswers: string[];
  lastMissAt: string;
  windowDays: number;
};

export type ConfusionMatch = {
  otherSubjectId: number;
  matchedAnswer: string;
  taskType: AttemptTaskType;
  matchCount: number;
};

export type ConfusionPairEvidence = {
  kind: 'confusion_pair';
  subjectId: number;
  taskType: AttemptTaskType;
  wrongAnswer: string;
  matches: ConfusionMatch[];
  lastMissAt: string;
};

export type InterventionOffer =
  | { type: 'mistake_lens'; evidence: MistakeLensEvidence; evidenceHash: string }
  | {
      type: 'confusion_pair';
      evidence: ConfusionPairEvidence;
      ambiguous: boolean;
      evidenceHash: string;
    };

export type DeterministicCardModel = {
  kind: 'mistake_lens' | 'confusion_pair';
  title: string;
  subjectId: number;
  otherSubjectId?: number;
  taskType: AttemptTaskType;
  primaryLabel: string;
  primaryAccepted: string[];
  otherLabel?: string;
  otherAccepted?: string[];
  enteredAnswer: string | null;
  missCount?: number;
  mnemonicSnippet: string | null;
  contrastBullets: string[];
  ambiguous: boolean;
  evidenceHash: string;
};

/** FNV-1a style hex hash for stable evidence keys (local copy; keep study free of AI imports). */
function hashEvidencePayload(payload: string): string {
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function subjectLabel(subject: SubjectAnswerData): string {
  if (subject.japanese) {
    return subject.japanese;
  }
  const primary = subject.meanings.find((m) => m.type === 'primary')?.meaning
    ?? subject.meanings[0]?.meaning;
  return primary ?? `Subject ${subject.id ?? '?'}`;
}

function acceptedForTask(subject: SubjectAnswerData, taskType: AttemptTaskType): string[] {
  if (taskType === 'reading') {
    return (subject.readings ?? [])
      .filter((reading) => reading.acceptedAnswer !== false)
      .map((reading) => reading.reading);
  }
  return subject.meanings
    .filter((meaning) => meaning.type !== 'blacklist' && meaning.acceptedAnswer !== false)
    .map((meaning) => meaning.meaning);
}

function mnemonicForTask(subject: SubjectAnswerData, taskType: AttemptTaskType): string | null {
  const raw =
    taskType === 'reading'
      ? subject.readingMnemonic ?? subject.meaningMnemonic
      : subject.meaningMnemonic ?? subject.readingMnemonic;
  if (!raw) {
    return null;
  }
  const stripped = raw.replace(/<[^>]+>/g, '').trim();
  if (!stripped) {
    return null;
  }
  return stripped.length > 220 ? `${stripped.slice(0, 217)}…` : stripped;
}

export function evidenceHashForOffer(
  kind: 'repeated_miss' | 'confusion_pair',
  args: {
    subjectId: number;
    taskType: AttemptTaskType;
    wrongAnswer?: string;
    otherIds?: number[];
  },
): string {
  const payload = JSON.stringify({
    kind,
    subjectId: args.subjectId,
    taskType: args.taskType,
    wrongAnswer: args.wrongAnswer ?? null,
    otherIds: args.otherIds ? [...args.otherIds].sort((a, b) => a - b) : [],
  });
  return hashEvidencePayload(payload);
}

async function isOnCooldown(db: AppDatabase, evidenceHash: string, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - COOLDOWN_HOURS * 3600_000).toISOString();
  const recent = await findRecentByEvidenceHash(db, evidenceHash, since);
  if (!recent) {
    return false;
  }
  return recent.state === 'shown' || recent.state === 'skipped' || recent.state === 'dismissed';
}

async function loadRepeatedMiss(
  db: AppDatabase,
  subjectId: number,
  taskType: AttemptTaskType,
  now: Date,
): Promise<MistakeLensEvidence | null> {
  const cutoff = new Date(
    now.getTime() - REPEATED_MISS_WINDOW_DAYS * 24 * 3600_000,
  ).toISOString();
  const rows = await db.getAllAsync<{
    normalized_answer: string | null;
    occurred_at: string;
  }>(
    `SELECT normalized_answer, occurred_at
     FROM review_attempts
     WHERE subject_id = ?
       AND task_type = ?
       AND scored_correct = 0
       AND overridden = 0
       AND source IN ('review', 'lesson')
       AND occurred_at >= ?
     ORDER BY occurred_at DESC`,
    subjectId,
    taskType,
    cutoff,
  );
  if (rows.length < 2) {
    return null;
  }

  const recentAnswers: string[] = [];
  for (const row of rows) {
    if (!row.normalized_answer) {
      continue;
    }
    if (!recentAnswers.includes(row.normalized_answer)) {
      recentAnswers.push(row.normalized_answer);
    }
    if (recentAnswers.length >= MAX_RECENT_ANSWERS) {
      break;
    }
  }

  return {
    kind: 'repeated_miss',
    subjectId,
    taskType,
    missCount: rows.length,
    recentAnswers,
    lastMissAt: rows[0]!.occurred_at,
    windowDays: REPEATED_MISS_WINDOW_DAYS,
  };
}

async function findConfusionMatches(
  db: AppDatabase,
  subjectId: number,
  taskType: AttemptTaskType,
  wrongAnswer: string,
): Promise<ConfusionMatch[]> {
  // Candidates: started (srs 1–9), not the current subject. Hidden filtering is
  // applied after parse via study_materials when present.
  const rows = await db.getAllAsync<{
    subject_id: number;
    subject_payload: string;
    hidden: number | null;
  }>(
    `SELECT
       s.id AS subject_id,
       s.payload AS subject_payload,
       CAST(COALESCE(json_extract(sm.payload, '$.data.hidden'), 0) AS INTEGER) AS hidden
     FROM subjects s
     INNER JOIN assignments a ON a.subject_id = s.id
     LEFT JOIN study_materials sm ON sm.subject_id = s.id
     WHERE a.srs_stage BETWEEN 1 AND 9
       AND s.id != ?
     GROUP BY s.id`,
    subjectId,
  );

  const matchCounts = new Map<number, { answer: string; count: number }>();

  for (const row of rows) {
    if ((row.hidden ?? 0) === 1) {
      continue;
    }
    const subject = safeParseSubjectPayload(row.subject_id, row.subject_payload);
    if (!subject) {
      continue;
    }

    let matched: string | null = null;
    if (taskType === 'reading') {
      for (const reading of subject.readings ?? []) {
        if (reading.acceptedAnswer === false) {
          continue;
        }
        if (normalizeAnswer(reading.reading, 'reading') === wrongAnswer) {
          matched = reading.reading;
          break;
        }
      }
    } else {
      for (const meaning of subject.meanings) {
        if (meaning.type === 'blacklist' || meaning.acceptedAnswer === false) {
          continue;
        }
        if (normalizeAnswer(meaning.meaning, 'meaning') === wrongAnswer) {
          matched = meaning.meaning;
          break;
        }
      }
    }

    if (!matched) {
      continue;
    }
    const existing = matchCounts.get(row.subject_id);
    if (existing) {
      existing.count += 1;
    } else {
      matchCounts.set(row.subject_id, { answer: matched, count: 1 });
    }
  }

  // How often this wrong answer was used for the primary subject.
  const primaryCountRow = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM review_attempts
     WHERE subject_id = ?
       AND task_type = ?
       AND scored_correct = 0
       AND overridden = 0
       AND normalized_answer = ?
       AND source IN ('review', 'lesson')`,
    subjectId,
    taskType,
    wrongAnswer,
  );
  const matchCount = Math.max(1, primaryCountRow?.count ?? 1);

  return [...matchCounts.entries()]
    .slice(0, MAX_CONFUSION_MATCHES)
    .map(([otherSubjectId, value]) => ({
      otherSubjectId,
      matchedAnswer: value.answer,
      taskType,
      matchCount,
    }));
}

export async function evaluateInterventionOffer(
  db: AppDatabase,
  args: {
    subjectId: number;
    taskType: AttemptTaskType;
    wrongAnswer: string | null;
    justMissed: boolean;
    now?: Date;
  },
): Promise<InterventionOffer | null> {
  if (!args.justMissed) {
    return null;
  }
  const now = args.now ?? new Date();

  let confusion: InterventionOffer | null = null;
  if (args.wrongAnswer) {
    const matches = await findConfusionMatches(
      db,
      args.subjectId,
      args.taskType,
      args.wrongAnswer,
    );
    if (matches.length > 0) {
      const lastMissRow = await db.getFirstAsync<{ occurred_at: string }>(
        `SELECT occurred_at
         FROM review_attempts
         WHERE subject_id = ?
           AND task_type = ?
           AND scored_correct = 0
           AND overridden = 0
           AND normalized_answer = ?
         ORDER BY occurred_at DESC
         LIMIT 1`,
        args.subjectId,
        args.taskType,
        args.wrongAnswer,
      );
      const evidence: ConfusionPairEvidence = {
        kind: 'confusion_pair',
        subjectId: args.subjectId,
        taskType: args.taskType,
        wrongAnswer: args.wrongAnswer,
        matches,
        lastMissAt: lastMissRow?.occurred_at ?? now.toISOString(),
      };
      const hash = evidenceHashForOffer('confusion_pair', {
        subjectId: args.subjectId,
        taskType: args.taskType,
        wrongAnswer: args.wrongAnswer,
        otherIds: matches.map((match) => match.otherSubjectId),
      });
      if (!(await isOnCooldown(db, hash, now))) {
        confusion = {
          type: 'confusion_pair',
          evidence,
          ambiguous: matches.length > 1,
          evidenceHash: hash,
        };
      }
    }
  }

  // Prefer unambiguous confusion pair.
  if (confusion && !confusion.ambiguous) {
    return confusion;
  }

  const repeated = await loadRepeatedMiss(db, args.subjectId, args.taskType, now);
  if (repeated) {
    const hash = evidenceHashForOffer('repeated_miss', {
      subjectId: repeated.subjectId,
      taskType: repeated.taskType,
    });
    if (!(await isOnCooldown(db, hash, now))) {
      return { type: 'mistake_lens', evidence: repeated, evidenceHash: hash };
    }
  }

  // Ambiguous confusion still surfaces without claiming a single pair.
  if (confusion) {
    return confusion;
  }

  return null;
}

export function buildDeterministicCard(
  offer: InterventionOffer,
  subjects: Map<number, SubjectAnswerData>,
): DeterministicCardModel {
  if (offer.type === 'mistake_lens') {
    const evidence = offer.evidence;
    const subject = subjects.get(evidence.subjectId);
    const accepted = subject ? acceptedForTask(subject, evidence.taskType) : [];
    return {
      kind: 'mistake_lens',
      title: 'Mistake Lens',
      subjectId: evidence.subjectId,
      taskType: evidence.taskType,
      primaryLabel: subject ? subjectLabel(subject) : `Subject ${evidence.subjectId}`,
      primaryAccepted: accepted,
      enteredAnswer: evidence.recentAnswers[0] ?? null,
      missCount: evidence.missCount,
      mnemonicSnippet: subject ? mnemonicForTask(subject, evidence.taskType) : null,
      contrastBullets: [
        `Missed ${evidence.taskType} ${evidence.missCount} times in the last ${evidence.windowDays} days.`,
        evidence.recentAnswers.length > 0
          ? `Recent answers: ${evidence.recentAnswers.join(', ')}.`
          : 'Recent wrong answers were not typed (Anki mode).',
      ],
      ambiguous: false,
      evidenceHash: offer.evidenceHash,
    };
  }

  const evidence = offer.evidence;
  const subject = subjects.get(evidence.subjectId);
  const primaryAccepted = subject ? acceptedForTask(subject, evidence.taskType) : [];
  const firstMatch = evidence.matches[0];
  const other = firstMatch ? subjects.get(firstMatch.otherSubjectId) : undefined;
  const otherAccepted = other ? acceptedForTask(other, evidence.taskType) : [];
  const bullets: string[] = [
    `You entered “${evidence.wrongAnswer}” for this ${evidence.taskType}.`,
  ];
  if (offer.ambiguous) {
    bullets.push(
      `That answer also matches ${evidence.matches.length} other learned items — compare carefully.`,
    );
    for (const match of evidence.matches.slice(0, 3)) {
      const matchSubject = subjects.get(match.otherSubjectId);
      bullets.push(
        matchSubject
          ? `Also accepted for ${subjectLabel(matchSubject)}.`
          : `Also accepted for subject ${match.otherSubjectId}.`,
      );
    }
  } else if (other) {
    bullets.push(
      `That answer is accepted for ${subjectLabel(other)} (${evidence.taskType}).`,
    );
    if (primaryAccepted.length > 0) {
      bullets.push(`This item accepts: ${primaryAccepted.join(', ')}.`);
    }
    if (otherAccepted.length > 0) {
      bullets.push(`The other item accepts: ${otherAccepted.join(', ')}.`);
    }
  }

  return {
    kind: 'confusion_pair',
    title: offer.ambiguous ? 'Possible confusions' : 'Confusion pair',
    subjectId: evidence.subjectId,
    otherSubjectId: offer.ambiguous ? undefined : firstMatch?.otherSubjectId,
    taskType: evidence.taskType,
    primaryLabel: subject ? subjectLabel(subject) : `Subject ${evidence.subjectId}`,
    primaryAccepted,
    otherLabel: other ? subjectLabel(other) : undefined,
    otherAccepted: other ? otherAccepted : undefined,
    enteredAnswer: evidence.wrongAnswer,
    mnemonicSnippet: subject ? mnemonicForTask(subject, evidence.taskType) : null,
    contrastBullets: bullets,
    ambiguous: offer.ambiguous,
    evidenceHash: offer.evidenceHash,
  };
}

export async function loadSubjectsForOffer(
  db: AppDatabase,
  offer: InterventionOffer,
): Promise<Map<number, SubjectAnswerData>> {
  const ids = new Set<number>([offer.evidence.subjectId]);
  if (offer.type === 'confusion_pair') {
    for (const match of offer.evidence.matches) {
      ids.add(match.otherSubjectId);
    }
  }
  const list = [...ids];
  if (list.length === 0) {
    return new Map();
  }
  const placeholders = list.map(() => '?').join(', ');
  const rows = await db.getAllAsync<{ id: number; payload: string }>(
    `SELECT id, payload FROM subjects WHERE id IN (${placeholders})`,
    ...list,
  );
  const map = new Map<number, SubjectAnswerData>();
  for (const row of rows) {
    try {
      map.set(row.id, parseSubjectPayload(row.id, row.payload));
    } catch {
      // skip corrupt
    }
  }
  return map;
}
