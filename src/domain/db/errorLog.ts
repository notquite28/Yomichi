import { WaniKaniApiError } from '../api/WaniKaniClient';
import { AppDatabase, openAppDatabase, runExclusive } from './database';

export type ErrorLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type ErrorLogEntry = {
  id: number;
  level: string;
  message: string;
  context: string | null;
  created_at: string;
};

export type SyncErrorCategory = 'offline' | 'timeout' | 'auth' | 'rate-limit' | 'server' | 'hibernating' | 'unknown';

export type SyncErrorInfo = {
  category: SyncErrorCategory;
  message: string;
  isRetryable: boolean;
};

const HIBERNATION_PATTERNS = ['hibernat', 'inactive subscription', 'account has been hibernated'];

const TOKEN_PATTERN = /Token token=[a-f0-9\-]{8,}/gi;
const AUTH_BEARER_PATTERN = /(Authorization:\s*Bearer\s+)[^\s,;]+/gi;
const BEARER_PATTERN = /(^|[^A-Za-z0-9_-])Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const URL_TOKEN_PATTERN = /([?&]api_key=)[^&\s]+/gi;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_CONTEXT_LENGTH = 2000;

type SyncErrorLike = Error & {
  category: SyncErrorCategory;
  isRetryable?: boolean;
};

export function describeSyncError(error: unknown): SyncErrorInfo {
  const category = classifySyncError(error);
  const raw = error instanceof Error ? error.message : String(error);
  const retryableOverride = isSyncErrorLike(error) ? error.isRetryable : undefined;
  switch (category) {
    case 'offline':
      return { category, message: 'No internet connection. Check your network and try again.', isRetryable: retryableOverride ?? true };
    case 'timeout':
      return { category, message: 'Request timed out. Try again later.', isRetryable: retryableOverride ?? true };
    case 'auth':
      return { category, message: 'Session expired or token invalid. Please log in again.', isRetryable: retryableOverride ?? false };
    case 'rate-limit': {
      const retryMs = error instanceof WaniKaniApiError ? error.retryAfterMs : undefined;
      const suffix = retryMs ? ` Try again in ${Math.ceil(retryMs / 1000)} seconds.` : '';
      return { category, message: `Too many requests.${suffix}`, isRetryable: retryableOverride ?? true };
    }
    case 'server':
      return { category, message: 'WaniKani server error. Try again later.', isRetryable: retryableOverride ?? true };
    case 'hibernating':
      return { category, message: 'Your WaniKani account is hibernating. Reactivate it at wanikani.com to continue.', isRetryable: retryableOverride ?? false };
    default:
      return { category, message: sanitize(raw), isRetryable: retryableOverride ?? true };
  }
}

export function sanitize(text: string): string {
  let result = text.replace(TOKEN_PATTERN, 'Token token=[REDACTED]');
  result = result.replace(AUTH_BEARER_PATTERN, '$1[REDACTED]');
  result = result.replace(BEARER_PATTERN, '$1Bearer [REDACTED]');
  result = result.replace(URL_TOKEN_PATTERN, '$1[REDACTED]');
  return result.slice(0, MAX_MESSAGE_LENGTH);
}

function isSyncErrorLike(error: unknown): error is SyncErrorLike {
  if (!(error instanceof Error) || error.name !== 'SyncError') {
    return false;
  }
  const category = (error as Error & { category?: unknown }).category;
  return typeof category === 'string' && isSyncErrorCategory(category);
}

function isSyncErrorCategory(value: string): value is SyncErrorCategory {
  return value === 'offline' ||
    value === 'timeout' ||
    value === 'auth' ||
    value === 'rate-limit' ||
    value === 'server' ||
    value === 'hibernating' ||
    value === 'unknown';
}

export function classifySyncError(error: unknown): SyncErrorCategory {
  if (error instanceof WaniKaniApiError) {
    if (error.status === 0) return 'timeout';
    if (error.status === 401 || error.status === 403) {
      if (isHibernationMessage(error.message)) return 'hibernating';
      return 'auth';
    }
    if (error.status === 429) return 'rate-limit';
    if (error.status >= 500) return 'server';
    return 'unknown';
  }

  if (isSyncErrorLike(error)) {
    return error.category;
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes('network') ||
      msg.includes('network request failed') ||
      msg.includes('offline') ||
      msg.includes('no connection') ||
      msg.includes('connect') ||
      msg.includes('dns') ||
      msg.includes('host unreachable')
    ) {
      return 'offline';
    }
  }

  return 'unknown';
}

function isHibernationMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return HIBERNATION_PATTERNS.some((pattern) => lower.includes(pattern));
}

export async function logError(db: AppDatabase, level: ErrorLogLevel, message: string, context?: string): Promise<void> {
  await runExclusive(() =>
    db.runAsync(
      'INSERT INTO error_log (level, message, context, created_at) VALUES (?, ?, ?, ?)',
      level,
      sanitize(message).slice(0, MAX_MESSAGE_LENGTH),
      context ? sanitize(context).slice(0, MAX_CONTEXT_LENGTH) : null,
      new Date().toISOString(),
    ),
  );
}

/**
 * Best-effort diagnostics write: opens the app DB and inserts an error_log row.
 * Never throws — logging must not break callers of cleanup/non-critical paths.
 */
export async function logErrorBestEffort(
  level: ErrorLogLevel,
  error: unknown,
  context: string,
): Promise<void> {
  try {
    let message = 'Unknown error';
    try {
      message = error instanceof Error ? error.message : String(error);
    } catch {
      // Keep the fallback when even inspecting/coercing the thrown value fails.
    }
    const db = await openAppDatabase();
    await logError(db, level, message, context);
  } catch {
    // Never let diagnostics logging break the caller.
  }
}

export async function logSyncError(db: AppDatabase, error: unknown, context: string): Promise<void> {
  const category = classifySyncError(error);
  const message = error instanceof Error ? error.message : String(error);
  const level: ErrorLogLevel = category === 'auth' ? 'error' : 'warn';
  const enrichedContext = `${context} [${category}]`;

  await logError(db, level, message, enrichedContext);
}

export async function getErrorLogEntries(db: AppDatabase, limit = 100, offset = 0): Promise<ErrorLogEntry[]> {
  return db.getAllAsync<ErrorLogEntry>(
    'SELECT * FROM error_log ORDER BY created_at DESC LIMIT ? OFFSET ?',
    limit,
    offset,
  );
}

export async function getErrorLogCount(db: AppDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM error_log');
  return row?.count ?? 0;
}

export async function pruneErrorLog(db: AppDatabase, maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const result = await runExclusive(() => db.runAsync('DELETE FROM error_log WHERE created_at < ?', cutoff));
  return result.changes;
}

export async function clearErrorLog(db: AppDatabase): Promise<void> {
  await runExclusive(() => db.execAsync('DELETE FROM error_log'));
}
