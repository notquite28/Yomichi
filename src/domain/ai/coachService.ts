import { openAppDatabase } from '../db/database';
import { COACH_MAX_TOKENS, TINYSWALLOW_MODEL } from './modelCatalog';
import {
  cancelModelDownload as cancelDownload,
  getDownloadProgress as getRawDownloadProgress,
  isDownloadInProgress,
  startModelDownload as startDownload,
  subscribeDownloadProgress,
} from './modelDownloader';
import { deleteModelFiles, getInstalledModelInfo } from './modelStorage';
import {
  generateChatCompletion,
  isModelLoaded,
  isNativeRuntimeAvailable,
  ensureLlamaLoaded,
  releaseLlama,
  stopGeneration,
} from './llamaRuntime';
import { buildCoachMessages, buildPromptHash } from './prompts';
import { clearCoachCache, getCachedCoachResponse, putCachedCoachResponse } from './coachCache';
import type {
  CoachGenerationInput,
  CoachGenerationResult,
  CoachStatus,
} from './types';

type Listener = () => void;

let status: CoachStatus = 'not_installed';
let lastError: string | null = null;
let loadProgress: number | null = null;
const listeners = new Set<Listener>();
let generationToken = 0;
let statusInitPromise: Promise<void> | null = null;

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function setStatus(next: CoachStatus, error: string | null = null) {
  status = next;
  lastError = error;
  if (next !== 'loading') {
    loadProgress = null;
  }
  emit();
}

function setError(message: string) {
  lastError = message;
  status = 'error';
  emit();
}

async function refreshInstalledStatus(): Promise<void> {
  if (!isNativeRuntimeAvailable()) {
    setStatus('unavailable');
    return;
  }
  if (isDownloadInProgress()) {
    setStatus('downloading');
    return;
  }
  if (status === 'generating' || status === 'loading') {
    return;
  }
  if (isModelLoaded()) {
    setStatus('loaded');
    return;
  }
  try {
    const info = await getInstalledModelInfo();
    if (info.complete) {
      setStatus('ready');
    } else {
      if (info.exists && !info.complete) {
        await deleteModelFiles();
      }
      setStatus('not_installed');
    }
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
}

export async function initCoachStatus(): Promise<void> {
  if (statusInitPromise) {
    return statusInitPromise;
  }
  statusInitPromise = refreshInstalledStatus().finally(() => {
    statusInitPromise = null;
  });
  return statusInitPromise;
}

// Kick off status probe once at module load for native; tests can re-init.
void initCoachStatus();

subscribeDownloadProgress(() => {
  if (isDownloadInProgress()) {
    if (status !== 'downloading') {
      setStatus('downloading');
    } else {
      emit();
    }
  }
});

export function getCoachStatus(): CoachStatus {
  return status;
}

export function subscribeCoach(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDownloadProgress(): number | null {
  const raw = getRawDownloadProgress();
  if (raw?.progress != null) {
    return raw.progress;
  }
  if (status === 'loading' && loadProgress != null) {
    return loadProgress;
  }
  return null;
}

export function getLastError(): string | null {
  return lastError;
}

export function getModelDisplayInfo() {
  return {
    displayName: TINYSWALLOW_MODEL.displayName,
    approxSizeLabel: TINYSWALLOW_MODEL.approxSizeLabel,
    modelCardUrl: TINYSWALLOW_MODEL.modelCardUrl,
    approxBytes: TINYSWALLOW_MODEL.approxBytes,
  };
}

export async function startModelDownload(opts?: {
  allowCellular?: boolean;
  wifiOnly?: boolean;
}): Promise<void> {
  if (!isNativeRuntimeAvailable()) {
    setStatus('unavailable', 'Study Coach is unavailable on this platform.');
    throw new Error('Study Coach is unavailable on this platform.');
  }
  setStatus('downloading');
  lastError = null;
  emit();
  try {
    await startDownload(opts);
    await refreshInstalledStatus();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/cancel/i.test(message)) {
      await refreshInstalledStatus();
      return;
    }
    setError(message);
    throw error instanceof Error ? error : new Error(message);
  }
}

export async function cancelModelDownload(): Promise<void> {
  await cancelDownload();
  await refreshInstalledStatus();
}

export async function deleteModel(): Promise<void> {
  await cancelDownload().catch(() => {});
  await releaseLlama().catch(() => {});
  await deleteModelFiles();
  try {
    const db = await openAppDatabase();
    await clearCoachCache(db);
  } catch {
    // Cache clear is best-effort if DB is unavailable.
  }
  setStatus('not_installed');
  lastError = null;
  emit();
}

export async function ensureModelLoaded(): Promise<void> {
  if (!isNativeRuntimeAvailable()) {
    setStatus('unavailable', 'Study Coach is unavailable on this platform.');
    throw new Error('Study Coach is unavailable on this platform.');
  }
  if (isModelLoaded()) {
    setStatus('loaded');
    return;
  }
  setStatus('loading');
  loadProgress = 0;
  emit();
  try {
    await ensureLlamaLoaded((progress) => {
      loadProgress = progress;
      emit();
    });
    setStatus('loaded');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setError(message);
    throw error instanceof Error ? error : new Error(message);
  }
}

export async function releaseModel(): Promise<void> {
  generationToken += 1;
  await stopGeneration().catch(() => {});
  await releaseLlama();
  await refreshInstalledStatus();
}

export function cancelGeneration(): void {
  generationToken += 1;
  void stopGeneration();
  if (status === 'generating') {
    void refreshInstalledStatus();
  }
}

export async function runCoachAction(input: CoachGenerationInput): Promise<CoachGenerationResult> {
  if (!isNativeRuntimeAvailable()) {
    throw new Error('Study Coach is unavailable on this platform.');
  }
  if (isDownloadInProgress() || status === 'downloading') {
    throw new Error('Wait for the model download to finish before generating.');
  }

  const subjectId = input.subject.id;
  if (subjectId == null) {
    throw new Error('Subject is missing an id; cannot run Study Coach.');
  }

  const promptInput = {
    action: input.action,
    subject: input.subject,
    studyMaterial: input.studyMaterial,
    componentSubjects: input.componentSubjects,
    taskType: input.taskType,
    userAnswer: input.userAnswer,
    contextSentenceIndex: input.contextSentenceIndex,
  };
  const promptHash = buildPromptHash(promptInput);
  const messages = buildCoachMessages(promptInput);

  if (!input.regenerate) {
    try {
      const db = await openAppDatabase();
      const cached = await getCachedCoachResponse(db, subjectId, input.action, promptHash);
      if (cached) {
        input.onToken?.(cached);
        return { text: cached, fromCache: true };
      }
    } catch {
      // Cache miss path continues to generation.
    }
  }

  // Single-flight: cancel any prior generation.
  generationToken += 1;
  const myToken = generationToken;
  await stopGeneration().catch(() => {});

  setStatus('generating');
  lastError = null;
  emit();

  try {
    await ensureModelLoaded();
    if (myToken !== generationToken) {
      throw new Error('Generation cancelled.');
    }

    const text = await generateChatCompletion({
      messages,
      nPredict: COACH_MAX_TOKENS[input.action],
      onToken: (_token, textSoFar) => {
        if (myToken !== generationToken) {
          return;
        }
        input.onToken?.(textSoFar);
      },
    });

    if (myToken !== generationToken) {
      throw new Error('Generation cancelled.');
    }

    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error('Study Coach returned an empty response.');
    }

    try {
      const db = await openAppDatabase();
      await putCachedCoachResponse(db, {
        subjectId,
        action: input.action,
        promptHash,
        response: trimmed,
        createdAt: new Date().toISOString(),
      });
    } catch {
      // Non-fatal: generation still succeeds without cache write.
    }

    setStatus('loaded');
    return { text: trimmed, fromCache: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/cancel/i.test(message)) {
      await refreshInstalledStatus();
      throw error instanceof Error ? error : new Error(message);
    }
    setError(message);
    throw error instanceof Error ? error : new Error(message);
  }
}
