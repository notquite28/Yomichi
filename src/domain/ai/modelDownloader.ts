import NetInfo from '@react-native-community/netinfo';
import * as FileSystem from 'expo-file-system/legacy';

import { TINYSWALLOW_MODEL } from './modelCatalog';
import {
  deleteModelFiles,
  ensureModelsDirectory,
  getInstalledModelInfo,
  getModelPartialFileUri,
  promotePartialModel,
} from './modelStorage';

export type DownloadProgress = {
  /** 0..1 when total is known; null when indeterminate. */
  progress: number | null;
  bytesWritten: number;
  totalBytes: number | null;
};

type DownloadListener = (progress: DownloadProgress | null) => void;

let activeDownload: FileSystem.DownloadResumable | null = null;
let downloadPromise: Promise<void> | null = null;
let lastProgress: DownloadProgress | null = null;
const listeners = new Set<DownloadListener>();

function emitProgress(progress: DownloadProgress | null) {
  lastProgress = progress;
  for (const listener of listeners) {
    listener(progress);
  }
}

export function getDownloadProgress(): DownloadProgress | null {
  return lastProgress;
}

export function subscribeDownloadProgress(listener: DownloadListener): () => void {
  listeners.add(listener);
  listener(lastProgress);
  return () => {
    listeners.delete(listener);
  };
}

export function isDownloadInProgress(): boolean {
  return downloadPromise != null;
}

export async function startModelDownload(opts?: {
  allowCellular?: boolean;
  wifiOnly?: boolean;
}): Promise<void> {
  if (downloadPromise) {
    return downloadPromise;
  }

  const installed = await getInstalledModelInfo();
  if (installed.complete) {
    emitProgress(null);
    return;
  }

  const net = await NetInfo.fetch();
  if (!net.isConnected) {
    throw new Error('Connect to download the model.');
  }

  const wifiOnly = opts?.wifiOnly ?? true;
  const allowCellular = opts?.allowCellular ?? false;
  const isWifi = net.type === 'wifi' || net.type === 'ethernet' || net.type === 'wimax';
  if (wifiOnly && !allowCellular && !isWifi) {
    throw new Error('Wi‑Fi is preferred for this ~1.1 GB download. Enable cellular downloads in Settings or connect to Wi‑Fi.');
  }

  downloadPromise = (async () => {
    try {
      await ensureModelsDirectory();
      // Drop any previous partial/complete artifact before a fresh download.
      await deleteModelFiles();

      const partialUri = getModelPartialFileUri();
      const resumable = FileSystem.createDownloadResumable(
        TINYSWALLOW_MODEL.remoteUrl,
        partialUri,
        {},
        (data) => {
          const total = data.totalBytesExpectedToWrite > 0 ? data.totalBytesExpectedToWrite : null;
          const written = data.totalBytesWritten;
          emitProgress({
            progress: total != null && total > 0 ? Math.min(1, written / total) : null,
            bytesWritten: written,
            totalBytes: total,
          });
        },
      );
      activeDownload = resumable;

      emitProgress({ progress: 0, bytesWritten: 0, totalBytes: TINYSWALLOW_MODEL.approxBytes });
      const result = await resumable.downloadAsync();
      if (!result) {
        throw new Error('Model download was cancelled.');
      }
      if (result.status != null && result.status >= 400) {
        await deleteModelFiles();
        throw new Error(`Model download failed (HTTP ${result.status}).`);
      }

      await promotePartialModel();
      emitProgress({ progress: 1, bytesWritten: TINYSWALLOW_MODEL.approxBytes, totalBytes: TINYSWALLOW_MODEL.approxBytes });
    } catch (error) {
      // Leave partial deleted on hard failures; cancel path may already have cleaned.
      const message = error instanceof Error ? error.message : String(error);
      if (!/cancel/i.test(message)) {
        try {
          await deleteModelFiles();
        } catch {
          // ignore
        }
      }
      throw error instanceof Error ? error : new Error(message);
    } finally {
      activeDownload = null;
      downloadPromise = null;
      // Keep final 100% briefly readable by callers; UI may clear on status change.
    }
  })();

  return downloadPromise;
}

export async function cancelModelDownload(): Promise<void> {
  const current = activeDownload;
  activeDownload = null;
  if (current) {
    try {
      await current.cancelAsync();
    } catch {
      // Best-effort cancel.
    }
  }
  try {
    await deleteModelFiles();
  } catch {
    // ignore
  }
  emitProgress(null);
  // Let the in-flight promise settle; it will throw/cancel.
  if (downloadPromise) {
    try {
      await downloadPromise;
    } catch {
      // expected
    }
  }
}
