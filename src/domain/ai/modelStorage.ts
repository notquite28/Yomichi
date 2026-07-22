import * as FileSystem from 'expo-file-system/legacy';

import { TINYSWALLOW_MODEL } from './modelCatalog';

export function getModelsDirectoryUri(): string {
  const root = FileSystem.documentDirectory;
  if (!root) {
    throw new Error('Document directory is unavailable on this platform.');
  }
  return `${root}models/`;
}

export function getModelFileUri(fileName: string = TINYSWALLOW_MODEL.fileName): string {
  return `${getModelsDirectoryUri()}${fileName}`;
}

export function getModelPartialFileUri(fileName: string = TINYSWALLOW_MODEL.fileName): string {
  return `${getModelFileUri(fileName)}.partial`;
}

export async function ensureModelsDirectory(): Promise<string> {
  const dir = getModelsDirectoryUri();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

export type ModelFileInfo = {
  exists: boolean;
  size: number;
  uri: string;
  complete: boolean;
};

export async function getInstalledModelInfo(
  fileName: string = TINYSWALLOW_MODEL.fileName,
): Promise<ModelFileInfo> {
  const uri = getModelFileUri(fileName);
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists || info.isDirectory) {
      return { exists: false, size: 0, uri, complete: false };
    }
    const size = typeof info.size === 'number' ? info.size : 0;
    const minBytes = Math.floor(TINYSWALLOW_MODEL.approxBytes * TINYSWALLOW_MODEL.minSizeRatio);
    return {
      exists: true,
      size,
      uri,
      complete: size >= minBytes,
    };
  } catch {
    return { exists: false, size: 0, uri, complete: false };
  }
}

export async function deleteModelFiles(fileName: string = TINYSWALLOW_MODEL.fileName): Promise<void> {
  const targets = [getModelFileUri(fileName), getModelPartialFileUri(fileName)];
  for (const uri of targets) {
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch {
      // Best-effort cleanup.
    }
  }
}

export async function promotePartialModel(
  fileName: string = TINYSWALLOW_MODEL.fileName,
): Promise<ModelFileInfo> {
  const partialUri = getModelPartialFileUri(fileName);
  const finalUri = getModelFileUri(fileName);
  const partialInfo = await FileSystem.getInfoAsync(partialUri);
  if (!partialInfo.exists || partialInfo.isDirectory) {
    throw new Error('Downloaded model file is missing.');
  }
  const size = typeof partialInfo.size === 'number' ? partialInfo.size : 0;
  const minBytes = Math.floor(TINYSWALLOW_MODEL.approxBytes * TINYSWALLOW_MODEL.minSizeRatio);
  if (size < minBytes) {
    await FileSystem.deleteAsync(partialUri, { idempotent: true });
    throw new Error('Downloaded model file is incomplete or corrupt.');
  }

  await FileSystem.deleteAsync(finalUri, { idempotent: true });
  await FileSystem.moveAsync({ from: partialUri, to: finalUri });
  return getInstalledModelInfo(fileName);
}
