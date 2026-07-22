import type * as DatabaseModule from './database';

jest.mock('./database', () => {
  const actual = jest.requireActual('./database') as typeof DatabaseModule;
  return {
    ...actual,
    openAppDatabase: jest.fn(),
  };
});

import { WaniKaniApiError } from '../api/WaniKaniClient';
import { createTestDb } from '../../test/sqliteShim';
import { applyMigrations, openAppDatabase } from './database';
import { classifySyncError, describeSyncError, logErrorBestEffort, sanitize, SyncErrorCategory } from './errorLog';

describe('sanitize', () => {
  test('redacts Token token= patterns', () => {
    const input = 'Authorization: Token token=abcdef01-2345-6789-abcd-ef0123456789';
    expect(sanitize(input)).toBe('Authorization: Token token=[REDACTED]');
  });

  test('redacts multiple token occurrences', () => {
    const input = 'Token token=abc12345-def6-7890-abcd-ef1234567890 and Token token=00000000-0000-0000-0000-000000000000';
    const result = sanitize(input);
    expect(result).toBe('Token token=[REDACTED] and Token token=[REDACTED]');
  });

  test('redacts Authorization Bearer patterns', () => {
    expect(sanitize('Authorization: Bearer abc123.secret-token')).toBe('Authorization: Bearer [REDACTED]');
  });

  test('redacts bare Bearer patterns', () => {
    expect(sanitize('request failed with Bearer abc123.secret-token')).toBe('request failed with Bearer [REDACTED]');
  });

  test('redacts api_key query parameters', () => {
    const input = 'https://example.com/api?api_key=secret123&other=value';
    expect(sanitize(input)).toBe('https://example.com/api?api_key=[REDACTED]&other=value');
  });

  test('preserves plain text without secrets', () => {
    const input = 'WaniKani request timed out after 45 seconds';
    expect(sanitize(input)).toBe(input);
  });

  test('truncates messages exceeding max length', () => {
    const input = 'x'.repeat(3000);
    expect(sanitize(input).length).toBe(2000);
  });

  test('handles empty string', () => {
    expect(sanitize('')).toBe('');
  });
});

describe('classifySyncError', () => {
  function expectCategory(error: unknown, category: SyncErrorCategory) {
    expect(classifySyncError(error)).toBe(category);
  }

  test('classifies WaniKaniApiError status 0 as timeout', () => {
    expectCategory(new WaniKaniApiError(0, 'timed out'), 'timeout');
  });

  test('classifies 401 as auth', () => {
    expectCategory(new WaniKaniApiError(401, 'Unauthorized'), 'auth');
  });

  test('classifies 403 as auth', () => {
    expectCategory(new WaniKaniApiError(403, 'Forbidden'), 'auth');
  });

  test('classifies 401 with hibernation message as hibernating', () => {
    expectCategory(new WaniKaniApiError(401, 'Account has been hibernated'), 'hibernating');
  });

  test('classifies 403 with inactive subscription as hibernating', () => {
    expectCategory(new WaniKaniApiError(403, 'Inactive subscription'), 'hibernating');
  });

  test('classifies 401 without hibernation as auth', () => {
    expectCategory(new WaniKaniApiError(401, 'Unauthorized'), 'auth');
  });

  test('classifies 429 as rate-limit', () => {
    expectCategory(new WaniKaniApiError(429, 'Too Many Requests'), 'rate-limit');
  });

  test('classifies 500 as server', () => {
    expectCategory(new WaniKaniApiError(500, 'Internal Server Error'), 'server');
  });

  test('classifies 502 as server', () => {
    expectCategory(new WaniKaniApiError(502, 'Bad Gateway'), 'server');
  });

  test('classifies 503 as server', () => {
    expectCategory(new WaniKaniApiError(503, 'Service Unavailable'), 'server');
  });

  test('classifies 422 as unknown', () => {
    expectCategory(new WaniKaniApiError(422, 'Unprocessable Entity'), 'unknown');
  });

  test('classifies 404 as unknown', () => {
    expectCategory(new WaniKaniApiError(404, 'Not Found'), 'unknown');
  });

  test('classifies network-related Error messages as offline', () => {
    expectCategory(new Error('Network request failed'), 'offline');
    expectCategory(new Error('Network error'), 'offline');
    expectCategory(new Error('You are offline'), 'offline');
    expectCategory(new Error('No connection available'), 'offline');
    expectCategory(new Error('Could not connect to server'), 'offline');
    expectCategory(new Error('DNS resolution failed'), 'offline');
    expectCategory(new Error('Host unreachable'), 'offline');
  });

  test('classifies generic Error as unknown', () => {
    expectCategory(new Error('something went wrong'), 'unknown');
  });

  test('classifies non-Error values as unknown', () => {
    expectCategory('string error', 'unknown');
    expectCategory(42, 'unknown');
    expectCategory(null, 'unknown');
    expectCategory(undefined, 'unknown');
  });

  test('classifies wrapped SyncError-like values by category', () => {
    const error = new Error('Too Many Requests');
    error.name = 'SyncError';
    Object.assign(error, { category: 'rate-limit', isRetryable: true });

    expectCategory(error, 'rate-limit');
  });

});

describe('describeSyncError', () => {
  test('returns friendly offline message', () => {
    const info = describeSyncError(new Error('Network request failed'));
    expect(info.category).toBe('offline');
    expect(info.message).toBe('No internet connection. Check your network and try again.');
    expect(info.isRetryable).toBe(true);
  });

  test('returns friendly timeout message', () => {
    const info = describeSyncError(new WaniKaniApiError(0, 'timed out'));
    expect(info.category).toBe('timeout');
    expect(info.message).toBe('Request timed out. Try again later.');
    expect(info.isRetryable).toBe(true);
  });

  test('returns friendly auth message for 401', () => {
    const info = describeSyncError(new WaniKaniApiError(401, 'Unauthorized'));
    expect(info.category).toBe('auth');
    expect(info.message).toBe('Session expired or token invalid. Please log in again.');
    expect(info.isRetryable).toBe(false);
  });

  test('returns friendly auth message for 403', () => {
    const info = describeSyncError(new WaniKaniApiError(403, 'Forbidden'));
    expect(info.category).toBe('auth');
    expect(info.isRetryable).toBe(false);
  });

  test('returns friendly rate-limit message', () => {
    const info = describeSyncError(new WaniKaniApiError(429, 'Too Many Requests'));
    expect(info.category).toBe('rate-limit');
    expect(info.message).toBe('Too many requests.');
    expect(info.isRetryable).toBe(true);
  });

  test('returns rate-limit message with retry timing', () => {
    const info = describeSyncError(new WaniKaniApiError(429, 'Too Many Requests', undefined, 30000));
    expect(info.category).toBe('rate-limit');
    expect(info.message).toBe('Too many requests. Try again in 30 seconds.');
    expect(info.isRetryable).toBe(true);
  });

  test('returns friendly server error message', () => {
    const info = describeSyncError(new WaniKaniApiError(503, 'Service Unavailable'));
    expect(info.category).toBe('server');
    expect(info.message).toBe('WaniKani server error. Try again later.');
    expect(info.isRetryable).toBe(true);
  });

  test('returns sanitized raw message for unknown errors', () => {
    const info = describeSyncError(new Error('Token token=deadbeef-dead-dead-dead-deaddeafbeef in header'));
    expect(info.category).toBe('unknown');
    expect(info.message).toBe('Token token=[REDACTED] in header');
    expect(info.isRetryable).toBe(true);
  });

  test('returns sanitized string for non-Error values', () => {
    const info = describeSyncError('some weird error');
    expect(info.category).toBe('unknown');
    expect(info.message).toBe('some weird error');
  });

  test('returns friendly hibernating message', () => {
    const info = describeSyncError(new WaniKaniApiError(401, 'Account has been hibernated'));
    expect(info.category).toBe('hibernating');
    expect(info.message).toContain('wanikani.com');
    expect(info.isRetryable).toBe(false);
  });

  test('returns friendly message for wrapped SyncError-like values', () => {
    const error = new Error('Too Many Requests');
    error.name = 'SyncError';
    Object.assign(error, { category: 'rate-limit', isRetryable: false });

    const info = describeSyncError(error);

    expect(info.category).toBe('rate-limit');
    expect(info.message).toBe('Too many requests.');
    expect(info.isRetryable).toBe(false);
  });
});

describe('logErrorBestEffort', () => {
  afterEach(() => {
    jest.mocked(openAppDatabase).mockReset();
  });

  test('writes sanitized entry when DB is available', async () => {
    const db = createTestDb();
    await applyMigrations(db);
    jest.mocked(openAppDatabase).mockResolvedValue(db);

    await logErrorBestEffort('warn', new Error('disk full'), 'modelStorage.deleteModelFiles');

    const rows = await db.getAllAsync<{ level: string; message: string; context: string | null }>(
      'SELECT level, message, context FROM error_log',
    );
    expect(rows).toEqual([
      {
        level: 'warn',
        message: 'disk full',
        context: 'modelStorage.deleteModelFiles',
      },
    ]);
    await db.closeAsync();
  });

  test('uses a fallback when error coercion throws', async () => {
    const db = createTestDb();
    await applyMigrations(db);
    jest.mocked(openAppDatabase).mockResolvedValue(db);
    const uncoercible = {
      toString(): string {
        throw new Error('coercion failed');
      },
    };

    await expect(logErrorBestEffort('warn', uncoercible, 'test.context')).resolves.toBeUndefined();

    const row = await db.getFirstAsync<{ message: string }>('SELECT message FROM error_log');
    expect(row?.message).toBe('Unknown error');
    await db.closeAsync();
  });

  test('swallows open/write failures', async () => {
    jest.mocked(openAppDatabase).mockRejectedValue(new Error('db locked'));
    await expect(logErrorBestEffort('error', 'boom', 'test.context')).resolves.toBeUndefined();
  });
});
