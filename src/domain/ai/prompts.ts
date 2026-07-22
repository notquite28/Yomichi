import { COACH_SYSTEM_PROMPT } from './modelCatalog';
import type { CoachAction, CoachChatMessage, CoachStudyMaterial } from './types';
import type { SubjectAnswerData } from '../answers/answerChecker';

export type PromptBuildInput = {
  action: CoachAction;
  subject: SubjectAnswerData;
  studyMaterial?: CoachStudyMaterial;
  componentSubjects?: SubjectAnswerData[];
  taskType?: 'meaning' | 'reading';
  userAnswer?: string;
  contextSentenceIndex?: number;
};

function primaryMeanings(subject: SubjectAnswerData): string[] {
  return subject.meanings
    .filter((m) => m.acceptedAnswer !== false && m.type !== 'blacklist')
    .map((m) => m.meaning);
}

function acceptedReadings(subject: SubjectAnswerData): string[] {
  return (subject.readings ?? [])
    .filter((r) => r.acceptedAnswer !== false)
    .map((r) => {
      const type = r.type ? ` (${r.type})` : '';
      return `${r.reading}${type}`;
    });
}

function formatComponents(components: SubjectAnswerData[] | undefined): string {
  if (!components?.length) {
    return 'none';
  }
  return components
    .map((c) => {
      const meanings = primaryMeanings(c).join(', ') || '—';
      return `${c.japanese || c.type}: ${meanings}`;
    })
    .join('; ');
}

export function buildSubjectContextBlock(input: PromptBuildInput): string {
  const { subject, studyMaterial, componentSubjects } = input;
  const lines: string[] = [
    `Type: ${subject.type}`,
    subject.id != null ? `Subject ID: ${subject.id}` : null,
    `Characters: ${subject.japanese || '(none)'}`,
    `Primary meanings: ${primaryMeanings(subject).join(', ') || '(none)'}`,
    `Accepted readings: ${acceptedReadings(subject).join(', ') || '(none)'}`,
    `Component subjects: ${formatComponents(componentSubjects)}`,
  ].filter((line): line is string => line != null);

  if (subject.meaningMnemonic) {
    lines.push(`WK meaning mnemonic: ${subject.meaningMnemonic}`);
  }
  if (subject.readingMnemonic) {
    lines.push(`WK reading mnemonic: ${subject.readingMnemonic}`);
  }
  if (subject.contextSentences?.length) {
    lines.push(
      `Context sentences:\n${subject.contextSentences
        .map((s, i) => `  ${i + 1}. JP: ${s.ja}\n     EN: ${s.en}`)
        .join('\n')}`,
    );
  }
  if (studyMaterial) {
    if (studyMaterial.meaningSynonyms.length) {
      lines.push(`User meaning synonyms: ${studyMaterial.meaningSynonyms.join(', ')}`);
    }
    if (studyMaterial.meaningNote.trim()) {
      lines.push(`User meaning note: ${studyMaterial.meaningNote.trim()}`);
    }
    if (studyMaterial.readingNote.trim()) {
      lines.push(`User reading note: ${studyMaterial.readingNote.trim()}`);
    }
  }

  if (input.action === 'why_wrong') {
    lines.push(`Task type: ${input.taskType ?? 'unknown'}`);
    lines.push(`User answer: ${input.userAnswer?.trim() || '(empty)'}`);
    if (input.taskType === 'meaning') {
      lines.push(`Accepted meaning answers: ${primaryMeanings(subject).join(', ') || '(none)'}`);
    } else if (input.taskType === 'reading') {
      lines.push(`Accepted reading answers: ${acceptedReadings(subject).join(', ') || '(none)'}`);
    }
  }

  if (input.action === 'unpack_context' && input.contextSentenceIndex != null) {
    const sentence = subject.contextSentences?.[input.contextSentenceIndex];
    if (sentence) {
      lines.push(`Focus context sentence JP: ${sentence.ja}`);
      lines.push(`Focus context sentence EN: ${sentence.en}`);
    }
  }

  return lines.join('\n');
}

export function actionInstruction(action: CoachAction, input: PromptBuildInput): string {
  switch (action) {
    case 'explain':
      return `Explain this WaniKani item in 3–6 short sentences for an English-speaking learner.
Cover meaning and reading using the provided components when present.
Do not invent readings or meanings outside the accepted lists.
Do not rewrite or replace the official mnemonic; you may reference it.`;
    case 'mnemonic':
      return `Draft one personal mnemonic (2–5 sentences) that helps remember meaning and reading together when possible.
Keep it vivid and practical. Do not contradict accepted meanings/readings.
If the user already has notes, make the draft complementary rather than ignoring them.`;
    case 'examples':
      return `Write 2–3 short Japanese example sentences that use this item with its accepted meaning/reading.
After each Japanese sentence, give a brief English gloss on the next line.
Do not invent alternate dictionary senses. Keep sentences intermediate-friendly.`;
    case 'unpack_context': {
      const idx = input.contextSentenceIndex ?? 0;
      return `Unpack context sentence #${idx + 1} for this subject.
Explain word roles briefly and why this reading/meaning fits here.
Stay under ~6 short sentences. Use English for explanation; quote Japanese as needed.`;
    }
    case 'why_wrong':
      return `The learner answered incorrectly on a review.
In 3–5 short sentences: compare expected answer vs their answer, note a common confusion if relevant, and give one memory tip.
Do not invent extra accepted answers. Be encouraging and concise.`;
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export function buildCoachMessages(input: PromptBuildInput): CoachChatMessage[] {
  const context = buildSubjectContextBlock(input);
  const instruction = actionInstruction(input.action, input);
  return [
    { role: 'system', content: COACH_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Subject facts:\n${context}\n\nTask:\n${instruction}`,
    },
  ];
}

/** Stable, non-crypto hash for cache keys (subject fields + action + optional answer). */
export function hashPromptPayload(payload: string): string {
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Unsigned 32-bit hex
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildPromptHash(input: PromptBuildInput): string {
  const messages = buildCoachMessages(input);
  const payload = messages.map((m) => `${m.role}:${m.content}`).join('\n---\n');
  return hashPromptPayload(payload);
}
