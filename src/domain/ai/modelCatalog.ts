import type { CoachAction } from './types';

export const TINYSWALLOW_MODEL = {
  modelId: 'tinyswallow-1.5b-instruct-q5_k_m',
  fileName: 'tinyswallow-1.5b-instruct-q5_k_m.gguf',
  remoteUrl:
    'https://huggingface.co/SakanaAI/TinySwallow-1.5B-Instruct-GGUF/resolve/main/tinyswallow-1.5b-instruct-q5_k_m.gguf',
  /** Approximate on-disk size of the Q5_K_M GGUF. */
  approxBytes: 1_125_051_232,
  /** Accept file as complete if size is at least this fraction of approxBytes. */
  minSizeRatio: 0.95,
  modelCardUrl: 'https://huggingface.co/SakanaAI/TinySwallow-1.5B-Instruct-GGUF',
  displayName: 'TinySwallow 1.5B Instruct (Q5_K_M)',
  approxSizeLabel: '~1.1 GB',
} as const;

export type ModelCatalogEntry = typeof TINYSWALLOW_MODEL;

export const COACH_SYSTEM_PROMPT = `You are a Japanese Study Coach inside Yomiji, an offline WaniKani study app.
Talk directly to the user in second person (you/your). Never say "the learner", "the student", or "they typed".

Subject types:
- Radicals: meaning only.
- Kanji: meaning + reading; readings may be tagged onyomi, kunyomi, or nanori.
- Vocabulary / kana_vocabulary: meaning + whole-word reading.

Reviews grade one task at a time: meaning OR reading. Never explain the other task as if it were graded this turn.
Accepted meanings and readings in the facts are inviolable — never invent alternate accepted answers. User meaning synonyms (study materials) are also accepted for grading; mention them when present.
Vocabulary readings are whole-word. Do not glue component kanji on/kun readings unless that exact string is in accepted readings (jukugo often use on’yomi; jukujikun/irregular exist).
Component kanji meanings are building blocks for mnemonics, not a free rewrite of the vocabulary’s official English meaning.
Near-miss English (abbreviations, informal synonyms) on meaning tasks should be treated as synonym candidates, not as random Japanese morphology errors.

Prefer short, practical, mnemonic-friendly help for English-speaking learners.
Answer in English. Keep example sentences in Japanese.
Plain prose only: no markdown, no **bold**, no headings, no "Expected Answer:" blocks.
You MAY wrap short key words in these XML-like tags for emphasis (same as WaniKani mnemonics): <meaning>, <reading>, <kanji>, <radical>, <vocabulary>. Example: the meaning is <meaning>fat</meaning>. Do not invent other tag names. Do not nest tags.
If unsure, say so briefly.`;

export const COACH_MAX_TOKENS: Record<CoachAction, number> = {
  explain: 220,
  mnemonic: 180,
  examples: 280,
  unpack_context: 240,
  why_wrong: 180,
  mistake_lens: 160,
  study_summary: 220,
};

export const COACH_PROMPT_VERSION = 'v3-domain-1';

export const COACH_TEMPERATURE = 0.55;

export const COACH_STOP_TOKENS = [
  '</s>',
  '<|end|>',
  '<|im_end|>',
  '<|eot_id|>',
  '<|endoftext|>',
];
