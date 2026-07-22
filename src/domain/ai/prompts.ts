import { COACH_SYSTEM_PROMPT } from './modelCatalog';
import { stripMnemonicMarkup } from './mnemonicMarkup';
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

function acceptedMeanings(subject: SubjectAnswerData): string[] {
  return subject.meanings
    .filter((m) => m.acceptedAnswer !== false && m.type !== 'blacklist')
    .map((m) => m.meaning);
}

function primaryMeanings(subject: SubjectAnswerData): string[] {
  return subject.meanings
    .filter(
      (m) =>
        m.acceptedAnswer !== false &&
        m.type !== 'blacklist' &&
        (m.type === 'primary' || m.type == null),
    )
    .map((m) => m.meaning);
}

function formatReading(r: { reading: string; type?: string; primary?: boolean }): string {
  const bits: string[] = [r.reading];
  if (r.type) bits.push(r.type);
  if (r.primary) bits.push('primary');
  return bits.length > 1 ? `${r.reading} (${bits.slice(1).join(', ')})` : r.reading;
}

function acceptedReadings(subject: SubjectAnswerData): string[] {
  return (subject.readings ?? [])
    .filter((r) => r.acceptedAnswer !== false)
    .map((r) => formatReading(r));
}

function primaryReadings(subject: SubjectAnswerData): string[] {
  return (subject.readings ?? [])
    .filter((r) => r.acceptedAnswer !== false && r.primary === true)
    .map((r) => formatReading(r));
}

function formatOneComponent(c: SubjectAnswerData): string {
  const label = c.japanese || c.type;
  const meanings = acceptedMeanings(c).join(', ') || '—';
  const readings = acceptedReadings(c);
  const readingPart = readings.length ? `; readings: ${readings.join(', ')}` : '';
  return `- ${label} (${c.type}): meanings: ${meanings}${readingPart}`;
}

function formatComponents(components: SubjectAnswerData[] | undefined): string {
  if (!components?.length) {
    return 'none listed';
  }
  return components.map(formatOneComponent).join('\n');
}

function isVocabularyLike(type: string): boolean {
  return type === 'vocabulary' || type === 'kana_vocabulary';
}

export function buildSubjectContextBlock(input: PromptBuildInput): string {
  const { subject, studyMaterial, componentSubjects } = input;
  const primaryM = primaryMeanings(subject);
  const allM = acceptedMeanings(subject);
  const primaryR = primaryReadings(subject);
  const allR = acceptedReadings(subject);

  const lines: string[] = [
    `Item type: ${subject.type}`,
    `Characters / word: ${subject.japanese || '(none)'}`,
    `Primary meaning(s): ${primaryM.join(', ') || allM.join(', ') || '(none)'}`,
    `All accepted meanings (inviolable): ${allM.join(', ') || '(none)'}`,
  ];

  if (allR.length) {
    if (primaryR.length) {
      lines.push(`Primary reading(s): ${primaryR.join(', ')}`);
    } else {
      lines.push(`Accepted reading(s): ${allR.join(', ')}`);
    }
    lines.push(`All accepted readings (inviolable): ${allR.join(', ')}`);
  } else {
    lines.push('Accepted readings: (none — meaning-only item or radical)');
  }

  if (subject.partsOfSpeech?.length) {
    lines.push(`Part of speech: ${subject.partsOfSpeech.join(', ')}`);
  }

  if (componentSubjects?.length) {
    const role = isVocabularyLike(subject.type)
      ? 'Kanji/radical building blocks of this word (their own readings may differ from the whole word)'
      : subject.type === 'kanji'
        ? 'Radical components of this kanji'
        : 'Components';
    lines.push(`${role}:\n${formatComponents(componentSubjects)}`);
  } else {
    lines.push('Components: none listed');
  }

  if (subject.meaningMnemonic) {
    lines.push(
      `Official WK meaning mnemonic (reference only): ${stripMnemonicMarkup(subject.meaningMnemonic)}`,
    );
  }
  if (subject.meaningHint) {
    lines.push(`Official WK meaning hint: ${stripMnemonicMarkup(subject.meaningHint)}`);
  }
  if (subject.readingMnemonic) {
    lines.push(
      `Official WK reading mnemonic (reference only): ${stripMnemonicMarkup(subject.readingMnemonic)}`,
    );
  }
  if (subject.readingHint) {
    lines.push(`Official WK reading hint: ${stripMnemonicMarkup(subject.readingHint)}`);
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
      lines.push(`Your meaning synonyms: ${studyMaterial.meaningSynonyms.join(', ')}`);
    }
    if (studyMaterial.meaningNote.trim()) {
      lines.push(`Your meaning note: ${studyMaterial.meaningNote.trim()}`);
    }
    if (studyMaterial.readingNote.trim()) {
      lines.push(`Your reading note: ${studyMaterial.readingNote.trim()}`);
    }
  }

  if (input.action === 'why_wrong') {
    const task = input.taskType ?? 'unknown';
    const typed = input.userAnswer?.trim() || '(empty)';
    lines.push(`Review task: ${task}`);
    lines.push(`What you typed: ${typed}`);
    if (task === 'meaning') {
      lines.push(`Correct accepted meaning answer(s): ${allM.join(', ') || '(none)'}`);
    } else if (task === 'reading') {
      lines.push(`Correct accepted reading answer(s): ${allR.join(', ') || '(none)'}`);
    }
    if (isVocabularyLike(subject.type) && componentSubjects?.length && task === 'reading') {
      lines.push(
        'Note: for vocabulary, do not accept a reading made by gluing each kanji’s on/kun reading unless that exact string is in the accepted readings list. Whole-word readings often differ (jukujikun, irregular, or fixed kun compounds).',
      );
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
      return `Explain this item to the user in 3–6 short sentences.
Use second person (you/your). Plain prose — no markdown.
Cover meaning and reading using the component list when present.
For vocabulary, stress the whole-word reading/meaning; mention how component kanji readings can mislead if relevant.
Only use accepted meanings/readings from the facts. Do not invent others.
You may reference the official WK mnemonic; do not replace it.
You may emphasize key words with <meaning>, <reading>, <kanji>, <radical>, or <vocabulary> tags.`;
    case 'mnemonic':
      return `Write one personal mnemonic for the user (2–5 short sentences), second person (you/your).
Tie meaning and reading together when possible. Use the components and official WK mnemonics as raw material.
Vivid and practical. Do not contradict accepted meanings/readings.
If the user already has notes, complement them rather than ignore them.
Plain prose. You may use <meaning>/<reading>/<kanji>/<radical>/<vocabulary> tags for emphasis.`;
    case 'examples':
      return `Write 2–3 short Japanese example sentences that use this item with an accepted meaning/reading.
After each Japanese sentence, give a brief English gloss on the next line.
Do not invent senses. Intermediate-friendly. Plain prose only.`;
    case 'unpack_context': {
      const idx = input.contextSentenceIndex ?? 0;
      return `Unpack context sentence #${idx + 1} for the user in ~4–6 short sentences.
Second person. Explain word roles briefly and why this reading/meaning fits.
English explanation; quote Japanese as needed. Plain prose. Optional <kanji>/<vocabulary>/<meaning> tags for emphasis.`;
    }
    case 'why_wrong': {
      const task = input.taskType ?? 'unknown';
      const typed = input.userAnswer?.trim() || '(empty)';
      return `The user just missed a ${task} review.
They typed: "${typed}"
Correct accepted answer(s) are listed in the subject facts — treat those lists as inviolable.

Write 3–5 short sentences aimed at the user (you/your), plain prose:
1) State what was wrong in one clear line (your answer vs the correct reading/meaning).
2) Name the likely confusion using the facts (e.g. onyomi vs kunyomi, component kanji reading vs whole vocabulary reading, similar meaning, or a wrong radical meaning).
3) Give one concrete memory tip — prefer a mini-mnemonic that uses the components or the official WK mnemonic (facts already have tags stripped).

Rules:
- Always address the user as you/your. Never write "the learner", "the student", "they", or "the user".
- No markdown. You may emphasize the correct meaning/reading with <meaning>…</meaning> or <reading>…</reading> only.
- Do not invent extra accepted answers.
- For vocabulary readings, if they pieced together component readings, explain that the whole word has its own accepted reading from the list.
- Stay faithful to the official meaning (e.g. do not redefine "fat" as "strong" unless that is an accepted meaning).`;
    }
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
      content: `Subject facts (only source of truth):\n${context}\n\nYour task:\n${instruction}`,
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
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildPromptHash(input: PromptBuildInput): string {
  const messages = buildCoachMessages(input);
  const payload = messages.map((m) => `${m.role}:${m.content}`).join('\n---\n');
  return hashPromptPayload(payload);
}
