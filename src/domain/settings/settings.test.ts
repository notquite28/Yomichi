import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadSettings,
  saveSettings,
  defaultSettings,
  CURRENT_SETTINGS_VERSION,
  settingsMigrations,
  type SettingsMigration,
} from './settings';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

const mockedGetItem = AsyncStorage.getItem as jest.Mock;
const mockedSetItem = AsyncStorage.setItem as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('loadSettings', () => {
  test('fresh install returns defaultSettings', async () => {
    mockedGetItem.mockResolvedValueOnce(null);
    const result = await loadSettings();
    expect(result).toEqual(defaultSettings);
    expect(mockedSetItem).not.toHaveBeenCalled();
  });

  test('stored settings without _version (v0) trigger migration v1', async () => {
    const stored = {
      notificationsAllReviews: true,
      notificationsBadging: false,
      notificationMinReviewCount: 30,
    };
    mockedGetItem.mockResolvedValueOnce(JSON.stringify(stored));
    const result = await loadSettings();
    expect(result.notificationsEnabled).toBe(true);
    expect(result.notificationThreshold).toBe(30);
    expect(result.notificationDailyTime).toBe(null);
    // Stale keys should not appear in the result
    expect((result as Record<string, unknown>)['notificationsAllReviews']).toBeUndefined();
    // Should persist migrated version
    expect(mockedSetItem).toHaveBeenCalledTimes(1);
    const savedArg = JSON.parse(mockedSetItem.mock.calls[0][1]);
    expect(savedArg._version).toBe(CURRENT_SETTINGS_VERSION);
  });

  test('migration v1: badge-only users do not get alert notifications enabled', async () => {
    const stored = {
      notificationsAllReviews: false,
      notificationsBadging: true,
    };
    mockedGetItem.mockResolvedValueOnce(JSON.stringify(stored));
    const result = await loadSettings();
    expect(result.notificationsEnabled).toBe(false);
  });

  test('migration v1: stale keys are cleaned up', async () => {
    const stored = {
      notificationsEnabled: true,  // already migrated
      notificationQuietHoursEnabled: true,
      notificationQuietHoursStart: '22:00',
      notificationQuietHoursEnd: '08:00',
    };
    mockedGetItem.mockResolvedValueOnce(JSON.stringify(stored));
    const result = await loadSettings();
    const keys = Object.keys(result as Record<string, unknown>);
    expect(keys).not.toContain('notificationQuietHoursEnabled');
    expect(keys).not.toContain('notificationQuietHoursStart');
    expect(keys).not.toContain('notificationQuietHoursEnd');
  });

  test('settings at current version are not re-migrated', async () => {
    const stored = { ...defaultSettings, _version: CURRENT_SETTINGS_VERSION };
    mockedGetItem.mockResolvedValueOnce(JSON.stringify(stored));
    await loadSettings();
    // Should NOT call setItem since no migration ran
    expect(mockedSetItem).not.toHaveBeenCalled();
  });

  test('new fields are filled from defaultSettings via spread merge', async () => {
    const stored = {
      _version: CURRENT_SETTINGS_VERSION,
      reviewBatchSize: 7,
    };
    mockedGetItem.mockResolvedValueOnce(JSON.stringify(stored));
    const result = await loadSettings();
    expect(result.reviewBatchSize).toBe(7);
    // All other fields should come from defaults
    expect(result.reviewOrder).toBe(defaultSettings.reviewOrder);
    expect(result.lessonBatchSize).toBe(defaultSettings.lessonBatchSize);
    // _version should not appear on the returned object
    expect((result as Record<string, unknown>)['_version']).toBeUndefined();
  });

  test('legacy appearance setting is removed', async () => {
    const stored = {
      _version: CURRENT_SETTINGS_VERSION,
      appearance: 'dark' as const,
    };
    mockedGetItem.mockResolvedValueOnce(JSON.stringify(stored));
    const result = await loadSettings();
    expect((result as Record<string, unknown>)['appearance']).toBeUndefined();
  });

  test('migrations run in order', async () => {
    // Temporarily push a future migration to verify ordering
    const originalLength = settingsMigrations.length;
    const vNext: SettingsMigration = {
      version: CURRENT_SETTINGS_VERSION + 1,
      migrate(stored: Record<string, unknown>): Record<string, unknown> {
        const result = { ...stored };
        result['reviewBatchSize'] = 10;
        return result;
      },
    };
    settingsMigrations.push(vNext);

    try {
      // Stored at v0 — should trigger all migrations including the temporary one
      const stored = { notificationsAllReviews: true };
      mockedGetItem.mockResolvedValueOnce(JSON.stringify(stored));
      const result = await loadSettings();
      // v1 should have run
      expect(result.notificationsEnabled).toBe(true);
      // temporary migration should have run
      expect(result.reviewBatchSize).toBe(10);
      // Should persist with updated version
      const savedArg = JSON.parse(mockedSetItem.mock.calls[0][1]);
      expect(savedArg._version).toBe(CURRENT_SETTINGS_VERSION);
    } finally {
      // Remove the temporary migration to not pollute other tests
      settingsMigrations.splice(originalLength, 1);
    }
  });
});

describe('saveSettings', () => {
  test('includes _version in stored JSON', async () => {
    mockedGetItem.mockResolvedValueOnce(JSON.stringify({ ...defaultSettings, _version: CURRENT_SETTINGS_VERSION }));
    await saveSettings({ reviewBatchSize: 8 });
    expect(mockedSetItem).toHaveBeenCalledTimes(1);
    const savedArg = JSON.parse(mockedSetItem.mock.calls[0][1]);
    expect(savedArg._version).toBe(CURRENT_SETTINGS_VERSION);
    expect(savedArg.reviewBatchSize).toBe(8);
    expect(savedArg.appearance).toBeUndefined();
  });

  test('serializes concurrent patches so later keys are not lost', async () => {
    let stored = JSON.stringify({ ...defaultSettings, _version: CURRENT_SETTINGS_VERSION });
    mockedGetItem.mockImplementation(async () => stored);
    mockedSetItem.mockImplementation(async (_key: string, value: string) => {
      stored = value;
    });

    await Promise.all([
      saveSettings({ reviewBatchSize: 8 }),
      saveSettings({ lessonBatchSize: 3 }),
    ]);

    const saved = JSON.parse(stored);
    expect(saved.reviewBatchSize).toBe(8);
    expect(saved.lessonBatchSize).toBe(3);
  });
});
