import { Platform } from 'react-native';

import { logErrorBestEffort } from '../db/errorLog';

import {
  COACH_STOP_TOKENS,
  COACH_TEMPERATURE,
} from './modelCatalog';
import { getInstalledModelInfo } from './modelStorage';
import type { CoachChatMessage } from './types';

type LlamaModule = typeof import('llama.rn');
type LlamaContext = import('llama.rn').LlamaContext;

let llamaModule: LlamaModule | null | undefined;
let context: LlamaContext | null = null;
let loadPromise: Promise<LlamaContext> | null = null;
let generating = false;

export type RuntimeLoadProgress = (progress: number) => void;

function tryLoadLlamaModule(): LlamaModule | null {
  if (llamaModule !== undefined) {
    return llamaModule;
  }
  try {
    // Lazy require so Jest/web never touch the native binary at import time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    llamaModule = require('llama.rn') as LlamaModule;
    return llamaModule;
  } catch {
    llamaModule = null;
    return null;
  }
}

export function isNativeRuntimeAvailable(): boolean {
  if (Platform.OS === 'web') {
    return false;
  }
  return tryLoadLlamaModule() != null;
}

export function isModelLoaded(): boolean {
  return context != null;
}

export function isGenerating(): boolean {
  return generating;
}

function defaultGpuLayers(): number {
  // Prefer GPU offload on Apple Silicon / Metal; keep Android conservative for v1.
  if (Platform.OS === 'ios') {
    return 99;
  }
  if (Platform.OS === 'android') {
    return 16;
  }
  return 0;
}

export async function ensureLlamaLoaded(onProgress?: RuntimeLoadProgress): Promise<LlamaContext> {
  if (context) {
    return context;
  }
  if (loadPromise) {
    return loadPromise;
  }

  const mod = tryLoadLlamaModule();
  if (!mod) {
    throw new Error('On-device Study Coach is unavailable on this platform.');
  }

  const installed = await getInstalledModelInfo();
  if (!installed.complete) {
    throw new Error('Study Coach model is not installed. Install it from Settings.');
  }

  loadPromise = (async () => {
    try {
      const next = await mod.initLlama(
        {
          model: installed.uri,
          n_ctx: 2048,
          n_gpu_layers: defaultGpuLayers(),
          use_mmap: true,
        },
        (progress) => {
          onProgress?.(Math.max(0, Math.min(100, progress)) / 100);
        },
      );
      context = next;
      return next;
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

export async function releaseLlama(): Promise<void> {
  if (generating && context) {
    try {
      await context.stopCompletion();
    } catch (error) {
      void logErrorBestEffort('warn', error, 'llamaRuntime.releaseLlama.stopCompletion');
    }
    generating = false;
  }

  const current = context;
  context = null;
  loadPromise = null;
  if (current) {
    try {
      await current.release();
    } catch (error) {
      void logErrorBestEffort('warn', error, 'llamaRuntime.releaseLlama.release');
    }
  }
}

export async function stopGeneration(): Promise<void> {
  if (!context) {
    return;
  }
  try {
    await context.stopCompletion();
  } catch (error) {
    void logErrorBestEffort('warn', error, 'llamaRuntime.stopGeneration');
  }
}

export async function generateChatCompletion(input: {
  messages: CoachChatMessage[];
  nPredict: number;
  temperature?: number;
  onToken?: (token: string, textSoFar: string) => void;
}): Promise<string> {
  const ctx = await ensureLlamaLoaded();
  if (generating) {
    try {
      await ctx.stopCompletion();
    } catch (error) {
      void logErrorBestEffort('warn', error, 'llamaRuntime.generateChatCompletion.stopPrior');
    }
  }

  generating = true;
  let textSoFar = '';
  try {
    // Clear prior conversation KV so subject prompts do not bleed into each other.
    try {
      await ctx.clearCache(true);
    } catch (error) {
      void logErrorBestEffort('debug', error, 'llamaRuntime.clearCache');
    }

    const result = await ctx.completion(
      {
        messages: input.messages,
        n_predict: input.nPredict,
        temperature: input.temperature ?? COACH_TEMPERATURE,
        top_k: 40,
        top_p: 0.95,
        stop: [...COACH_STOP_TOKENS],
      },
      (data) => {
        const token = data.token ?? '';
        if (!token) {
          return;
        }
        textSoFar += token;
        input.onToken?.(token, textSoFar);
      },
    );

    const finalText = (result.content || result.text || textSoFar).trim();
    return finalText;
  } finally {
    generating = false;
  }
}
