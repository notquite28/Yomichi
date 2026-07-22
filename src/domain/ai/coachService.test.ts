const mockGenerate = jest.fn();
const mockEnsureLoaded = jest.fn();
const mockStopGeneration = jest.fn();
const mockReleaseLlama = jest.fn();
const mockIsNative = jest.fn(() => true);
const mockIsLoaded = jest.fn(() => false);
const mockGetInstalled = jest.fn();
const mockDeleteFiles = jest.fn();
const mockGetCached = jest.fn();
const mockPutCached = jest.fn();
const mockClearCache = jest.fn();
const mockOpenDb = jest.fn();
const mockStartDownload = jest.fn();
const mockCancelDownload = jest.fn();
const mockIsDownloading = jest.fn(() => false);
const mockGetDownloadProgress = jest.fn(() => null);
const mockSubscribeDownload = jest.fn((_listener?: unknown) => () => {});

jest.mock('./llamaRuntime', () => ({
  generateChatCompletion: (...args: unknown[]) => mockGenerate(...args),
  ensureLlamaLoaded: (...args: unknown[]) => mockEnsureLoaded(...args),
  stopGeneration: (...args: unknown[]) => mockStopGeneration(...args),
  releaseLlama: (...args: unknown[]) => mockReleaseLlama(...args),
  isNativeRuntimeAvailable: () => mockIsNative(),
  isModelLoaded: () => mockIsLoaded(),
  isGenerating: () => false,
}));

jest.mock('./modelStorage', () => ({
  getInstalledModelInfo: (...args: unknown[]) => mockGetInstalled(...args),
  deleteModelFiles: (...args: unknown[]) => mockDeleteFiles(...args),
}));

jest.mock('./modelDownloader', () => ({
  startModelDownload: (...args: unknown[]) => mockStartDownload(...args),
  cancelModelDownload: (...args: unknown[]) => mockCancelDownload(...args),
  isDownloadInProgress: () => mockIsDownloading(),
  getDownloadProgress: () => mockGetDownloadProgress(),
  subscribeDownloadProgress: (listener: unknown) => mockSubscribeDownload(listener),
}));

jest.mock('./coachCache', () => ({
  getCachedCoachResponse: (...args: unknown[]) => mockGetCached(...args),
  putCachedCoachResponse: (...args: unknown[]) => mockPutCached(...args),
  clearCoachCache: (...args: unknown[]) => mockClearCache(...args),
}));

jest.mock('../db/database', () => ({
  openAppDatabase: (...args: unknown[]) => mockOpenDb(...args),
}));

import {
  cancelGeneration,
  getCoachStatus,
  initCoachStatus,
  runCoachAction,
} from './coachService';
import type { SubjectAnswerData } from '../answers/answerChecker';

const subject: SubjectAnswerData = {
  id: 7,
  type: 'vocabulary',
  japanese: '水',
  meanings: [{ meaning: 'water', type: 'primary' }],
  readings: [{ reading: 'みず', primary: true }],
};

describe('coachService', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockIsNative.mockReturnValue(true);
    mockIsLoaded.mockReturnValue(false);
    mockIsDownloading.mockReturnValue(false);
    mockGetInstalled.mockResolvedValue({
      exists: true,
      size: 1_125_051_232,
      uri: 'file:///models/tinyswallow.gguf',
      complete: true,
    });
    mockOpenDb.mockResolvedValue({});
    mockGetCached.mockResolvedValue(null);
    mockPutCached.mockResolvedValue(undefined);
    mockEnsureLoaded.mockResolvedValue({});
    mockGenerate.mockResolvedValue('A short explanation.');
    mockStopGeneration.mockResolvedValue(undefined);
    await initCoachStatus();
  });

  test('status becomes ready when model file is complete', async () => {
    await initCoachStatus();
    expect(getCoachStatus()).toBe('ready');
  });

  test('runCoachAction returns cache hit without generation', async () => {
    mockGetCached.mockResolvedValueOnce('cached text');
    const tokens: string[] = [];
    const result = await runCoachAction({
      action: 'explain',
      subject,
      onToken: (t) => tokens.push(t),
    });
    expect(result).toEqual({ text: 'cached text', fromCache: true });
    expect(tokens).toEqual(['cached text']);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  test('runCoachAction generates, streams, and caches', async () => {
    mockGenerate.mockImplementation(async (input: { onToken?: (t: string, s: string) => void }) => {
      input.onToken?.('Hel', 'Hel');
      input.onToken?.('lo', 'Hello');
      return 'Hello';
    });
    const tokens: string[] = [];
    const result = await runCoachAction({
      action: 'explain',
      subject,
      regenerate: true,
      onToken: (t) => tokens.push(t),
    });
    expect(result.fromCache).toBe(false);
    expect(result.text).toBe('Hello');
    expect(tokens.length).toBeGreaterThan(0);
    expect(mockPutCached).toHaveBeenCalled();
    expect(getCoachStatus()).toBe('loaded');
  });

  test('runCoachAction rejects while downloading', async () => {
    mockIsDownloading.mockReturnValue(true);
    await expect(
      runCoachAction({ action: 'explain', subject }),
    ).rejects.toThrow(/download/i);
  });

  test('cancelGeneration bumps token without throwing', () => {
    expect(() => cancelGeneration()).not.toThrow();
  });
});
