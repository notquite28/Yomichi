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

export const COACH_SYSTEM_PROMPT = `You are Yomiji Study Coach, a concise Japanese-learning assistant embedded in a WaniKani client.
Only use the subject facts provided. Do not invent alternate dictionary meanings that contradict primary meanings.
Prefer short, practical help for English-speaking learners. Answer in English; keep example sentences in Japanese.
Use Japanese script when showing examples.
If unsure, say so briefly.`;

export const COACH_MAX_TOKENS: Record<CoachAction, number> = {
  explain: 220,
  mnemonic: 180,
  examples: 280,
  unpack_context: 240,
  why_wrong: 160,
};

export const COACH_TEMPERATURE = 0.7;

export const COACH_STOP_TOKENS = [
  '</s>',
  '<|end|>',
  '<|im_end|>',
  '<|eot_id|>',
  '<|endoftext|>',
];
