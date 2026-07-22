export const documentDirectory = 'file:///mock-documents/';
export const cacheDirectory = 'file:///mock-cache/';

export async function getInfoAsync() {
  return { exists: false, isDirectory: false, uri: '', size: 0 };
}

export async function makeDirectoryAsync() {}
export async function deleteAsync() {}
export async function moveAsync() {}
export async function downloadAsync() {
  return { uri: '', status: 200, headers: {}, mimeType: null };
}

export function createDownloadResumable() {
  return {
    downloadAsync: async () => ({ uri: '', status: 200, headers: {}, mimeType: null }),
    cancelAsync: async () => {},
    pauseAsync: async () => ({ url: '', fileUri: '', options: {}, resumeData: undefined }),
    resumeAsync: async () => ({ uri: '', status: 200, headers: {}, mimeType: null }),
    savable: async () => ({ url: '', fileUri: '', options: {}, resumeData: undefined }),
  };
}
