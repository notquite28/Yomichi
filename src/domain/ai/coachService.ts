import { openAppDatabase } from '../db/database';
import { logErrorBestEffort } from '../db/errorLog';
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
import {
  parseJsonObject,
  renderMistakeLensText,
  renderStudySummaryText,
  validateMistakeLensPayload,
  validateStudySummaryPayload,
} from './structuredOutput';
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
  await cancelDownload().catch((error) => {
    void logErrorBestEffort('warn', error, 'coachService.deleteModel.cancelDownload');
  });
  await releaseLlama().catch((error) => {
    void logErrorBestEffort('warn', error, 'coachService.deleteModel.releaseLlama');
  });
  await deleteModelFiles();
  try {
    const db = await openAppDatabase();
    await clearCoachCache(db);
  } catch (error) {
    void logErrorBestEffort('warn', error, 'coachService.deleteModel.clearCache');
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
  await stopGeneration().catch((error) => {
    void logErrorBestEffort('warn', error, 'coachService.releaseModel.stopGeneration');
  });
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

  const isGlobalSummary = input.action === 'study_summary';
  const subjectId = isGlobalSummary ? 0 : input.subject?.id;
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
    evidence: input.evidence,
  };
  const promptHash = buildPromptHash(promptInput);
  const messages = buildCoachMessages(promptInput);
  const allowedFactRefs = new Set(input.evidence?.factRefAllowlist ?? []);

  if (!input.regenerate) {
    try {
      const db = await openAppDatabase();
      const cached = await getCachedCoachResponse(db, subjectId, input.action, promptHash);
      if (cached) {
        if (input.action === 'mistake_lens') {
          const raw = parseJsonObject(cached);
          const structured = validateMistakeLensPayload(raw, allowedFactRefs);
          const text = renderMistakeLensText(structured);
          input.onToken?.(text);
          return { text, fromCache: true, structured };
        }
        if (input.action === 'study_summary') {
          const raw = parseJsonObject(cached);
          const structured = validateStudySummaryPayload(raw, allowedFactRefs);
          const text = renderStudySummaryText(structured);
          input.onToken?.(text);
          return { text, fromCache: true, structured };
        }
        input.onToken?.(cached);
        return { text: cached, fromCache: true };
      }
    } catch (error) {
      void logErrorBestEffort('warn', error, 'coachService.runCoachAction.cacheRead');
    }
  }

  // Single-flight: cancel any prior generation.
  generationToken += 1;
  const myToken = generationToken;
  await stopGeneration().catch((error) => {
    void logErrorBestEffort('warn', error, 'coachService.runCoachAction.stopPrior');
  });

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

    let resultText = trimmed;
    let structured: CoachGenerationResult['structured'];
    let cacheBody = trimmed;

    if (input.action === 'mistake_lens' || input.action === 'study_summary') {
      try {
        const raw = parseJsonObject(trimmed);
        if (input.action === 'mistake_lens') {
          const payload = validateMistakeLensPayload(raw, allowedFactRefs);
          structured = payload;
          resultText = renderMistakeLensText(payload);
          cacheBody = JSON.stringify(payload);
        } else {
          const payload = validateStudySummaryPayload(raw, allowedFactRefs);
          structured = payload;
          resultText = renderStudySummaryText(payload);
          cacheBody = JSON.stringify(payload);
        }
      } catch {
        throw new Error('Study Coach returned invalid structured output.');
      }
    }

    try {
      const db = await openAppDatabase();
      await putCachedCoachResponse(db, {
        subjectId,
        action: input.action,
        promptHash,
        response: cacheBody,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      void logErrorBestEffort('warn', error, 'coachService.runCoachAction.cacheWrite');
    }

    setStatus('loaded');
    return { text: resultText, fromCache: false, structured };
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
