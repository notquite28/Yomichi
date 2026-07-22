import { COACH_PROMPT_VERSION, COACH_SYSTEM_PROMPT, TINYSWALLOW_MODEL } from './modelCatalog';
import { stripMnemonicMarkup } from './mnemonicMarkup';
import type { CoachAction, CoachChatMessage, CoachStudyMaterial, StudySummaryFacts } from './types';
import type { SubjectAnswerData } from '../answers/answerChecker';

export type PromptBuildInput = {
  action: CoachAction;
  subject?: SubjectAnswerData;
  studyMaterial?: CoachStudyMaterial;
  componentSubjects?: SubjectAnswerData[];
  taskType?: 'meaning' | 'reading';
  userAnswer?: string;
  contextSentenceIndex?: number;
  evidence?: {
    missCount?: number;
    recentAnswers?: string[];
    pair?: {
      otherSubject: SubjectAnswerData;
      wrongAnswer: string;
      taskType: 'meaning' | 'reading';
    };
    summaryFacts?: StudySummaryFacts;
    factRefAllowlist?: string[];
  };
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
  if (input.action === 'study_summary') {
    const facts = input.evidence?.summaryFacts;
    if (!facts) {
      return 'No study summary facts provided.';
    }
    const lines = [
      `facts.level = ${facts.level ?? 'unknown'}`,
      `facts.available_lessons = ${facts.availableLessons}`,
      `facts.available_reviews = ${facts.availableReviews}`,
      `facts.review_forecast_24h = ${facts.reviewForecast24h}`,
      `facts.srs.apprentice = ${facts.srs.apprentice}`,
      `facts.srs.guru = ${facts.srs.guru}`,
      `facts.srs.master = ${facts.srs.master}`,
      `facts.srs.enlightened = ${facts.srs.enlightened}`,
      `facts.srs.burned = ${facts.srs.burned}`,
      `facts.recent_mistakes_count = ${facts.recentMistakes.length}`,
      `facts.top_leeches_count = ${facts.topLeeches.length}`,
    ];
    if (facts.levelProgress) {
      lines.push(
        `facts.level_progress.radicals = ${facts.levelProgress.radicalsPassed}/${facts.levelProgress.radicalsTotal}`,
        `facts.level_progress.kanji = ${facts.levelProgress.kanjiPassed}/${facts.levelProgress.kanjiTotal}`,
      );
    }
    if (facts.recentWindow) {
      lines.push(
        `facts.recent_window.days = ${facts.recentWindow.days}`,
        `facts.recent_window.scored_attempts = ${facts.recentWindow.scoredAttempts}`,
        `facts.recent_window.correct = ${facts.recentWindow.correct}`,
        `facts.recent_window.incorrect = ${facts.recentWindow.incorrect}`,
      );
    } else {
      lines.push('facts.recent_window = none (do not claim improvement or decline)');
    }
    if (facts.recentMistakes.length > 0) {
      lines.push(
        'facts.recent_mistakes:',
        ...facts.recentMistakes.map(
          (item, index) =>
            `  ${index + 1}. ${item.japanese || item.primaryMeaning} (id ${item.subjectId})`,
        ),
      );
    }
    if (facts.topLeeches.length > 0) {
      lines.push(
        'facts.top_leeches:',
        ...facts.topLeeches.map(
          (item, index) =>
            `  ${index + 1}. ${item.japanese || item.primaryMeaning} score=${item.score}`,
        ),
      );
    }
    const allow = input.evidence?.factRefAllowlist ?? [];
    if (allow.length > 0) {
      lines.push(`Allowed factRefs: ${allow.join(', ')}`);
    }
    return lines.join('\n');
  }

  const subject = input.subject;
  if (!subject) {
    return 'No subject facts provided.';
  }

  const { studyMaterial, componentSubjects } = input;
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

  if (input.action === 'why_wrong' || input.action === 'mistake_lens') {
    const task = input.taskType ?? 'unknown';
    const typed = input.userAnswer?.trim() || '(empty)';
    lines.push(`Review task: ${task}`);
    lines.push(`What you typed: ${typed}`);
    lines.push(`facts.entered_answer = ${typed}`);
    lines.push(`facts.accepted_meanings = ${allM.join(', ') || '(none)'}`);
    lines.push(`facts.accepted_readings = ${allR.join(', ') || '(none)'}`);
    if (task === 'meaning') {
      lines.push(`Correct accepted meaning answer(s): ${allM.join(', ') || '(none)'}`);
    } else if (task === 'reading') {
      lines.push(`Correct accepted reading answer(s): ${allR.join(', ') || '(none)'}`);
    }
    if (input.evidence?.missCount != null) {
      lines.push(`facts.miss_count = ${input.evidence.missCount}`);
    }
    if (input.evidence?.recentAnswers?.length) {
      lines.push(`facts.recent_answers = ${input.evidence.recentAnswers.join(' | ')}`);
    }
    if (input.evidence?.pair) {
      const other = input.evidence.pair.otherSubject;
      const otherMeanings = acceptedMeanings(other).join(', ') || '(none)';
      const otherReadings = acceptedReadings(other).join(', ') || '(none)';
      lines.push(`facts.pair.other_japanese = ${other.japanese || '(none)'}`);
      lines.push(`facts.pair.other_primary_meaning = ${primaryMeanings(other).join(', ') || otherMeanings}`);
      lines.push(`facts.pair.other_accepted_meanings = ${otherMeanings}`);
      lines.push(`facts.pair.other_accepted_readings = ${otherReadings}`);
      lines.push(`facts.pair.wrong_answer = ${input.evidence.pair.wrongAnswer}`);
      lines.push(`facts.pair.task_type = ${input.evidence.pair.taskType}`);
    }
    if (isVocabularyLike(subject.type) && componentSubjects?.length && task === 'reading') {
      lines.push(
        'Note: for vocabulary, do not accept a reading made by gluing each kanji’s on/kun reading unless that exact string is in the accepted readings list. Whole-word readings often differ (jukujikun, irregular, or fixed kun compounds).',
      );
    }
    const allow = input.evidence?.factRefAllowlist ?? [];
    if (allow.length > 0) {
      lines.push(`Allowed factRefs: ${allow.join(', ')}`);
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
    case 'mistake_lens':
      return `Return ONLY a single JSON object (no markdown fences, no prose outside JSON) with this exact shape:
{"version":1,"explanation":"...","memoryCue":"...","factRefs":["facts.entered_answer",...]}

Rules:
- explanation: 2–4 short sentences, second person, about the repeated miss or confusion using ONLY provided facts.
- memoryCue: one short personal memory tip (not an example sentence).
- factRefs: only ids from Allowed factRefs in the facts block.
- Do not invent accepted answers, Japanese example sentences, or subjects not listed.
- No markdown. JSON only.`;
    case 'study_summary':
      return `Return ONLY a single JSON object (no markdown fences, no prose outside JSON) with this exact shape:
{"version":1,"overview":"...","wins":["..."],"focus":["..."],"nextAction":"...","factRefs":["facts.available_reviews",...]}

Rules:
- overview: 2–4 short sentences, second person, grounded only in provided facts.
- wins/focus: at most 5 short bullets each; empty arrays allowed.
- nextAction: one concrete next step from the facts (reviews/lessons/practice).
- Never claim improvement or decline unless both comparable windows are present in facts (v1 usually has only one window or none).
- factRefs: only ids from Allowed factRefs.
- No Japanese example sentences. No invented metrics. JSON only.`;
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
  const evidenceKey = input.evidence
    ? JSON.stringify({
        missCount: input.evidence.missCount ?? null,
        recentAnswers: input.evidence.recentAnswers ?? [],
        pair: input.evidence.pair
          ? {
              otherId: input.evidence.pair.otherSubject.id ?? null,
              wrongAnswer: input.evidence.pair.wrongAnswer,
              taskType: input.evidence.pair.taskType,
            }
          : null,
        summaryFacts: input.evidence.summaryFacts ?? null,
        factRefs: input.evidence.factRefAllowlist ?? [],
      })
    : '';
  const payload = [
    COACH_PROMPT_VERSION,
    TINYSWALLOW_MODEL.modelId,
    ...messages.map((m) => `${m.role}:${m.content}`),
    evidenceKey,
  ].join('\n---\n');
  return hashPromptPayload(payload);
}
