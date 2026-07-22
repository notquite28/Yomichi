import type { MistakeLensPayloadV1, StudySummaryPayloadV1 } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown, field: string, maxLen: number): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid structured output: ${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Invalid structured output: ${field} is empty.`);
  }
  if (trimmed.length > maxLen) {
    throw new Error(`Invalid structured output: ${field} is too long.`);
  }
  return trimmed;
}

function asStringArray(value: unknown, field: string, maxItems: number, maxItemLen: number): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid structured output: ${field} must be an array.`);
  }
  if (value.length > maxItems) {
    throw new Error(`Invalid structured output: ${field} has too many items.`);
  }
  return value.map((item, index) => asNonEmptyString(item, `${field}[${index}]`, maxItemLen));
}

function assertFactRefs(factRefs: string[], allowed: Set<string>): void {
  for (const ref of factRefs) {
    if (!allowed.has(ref)) {
      throw new Error(`Invalid structured output: unknown factRef "${ref}".`);
    }
  }
}

/** Strip optional markdown fences and return the first JSON object parse. */
export function parseJsonObject(text: string): unknown {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    raw = fence[1].trim();
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('Invalid structured output: no JSON object found.');
  }
  const slice = raw.slice(start, end + 1);
  try {
    return JSON.parse(slice) as unknown;
  } catch {
    throw new Error('Invalid structured output: JSON parse failed.');
  }
}

export function validateMistakeLensPayload(
  raw: unknown,
  allowedFactRefs: Set<string>,
): MistakeLensPayloadV1 {
  if (!isRecord(raw)) {
    throw new Error('Invalid structured output: expected object.');
  }
  if (raw.version !== 1) {
    throw new Error('Invalid structured output: version must be 1.');
  }
  const explanation = asNonEmptyString(raw.explanation, 'explanation', 600);
  const memoryCue = asNonEmptyString(raw.memoryCue, 'memoryCue', 400);
  const factRefs = asStringArray(raw.factRefs ?? [], 'factRefs', 20, 80);
  assertFactRefs(factRefs, allowedFactRefs);
  return { version: 1, explanation, memoryCue, factRefs };
}

export function validateStudySummaryPayload(
  raw: unknown,
  allowedFactRefs: Set<string>,
): StudySummaryPayloadV1 {
  if (!isRecord(raw)) {
    throw new Error('Invalid structured output: expected object.');
  }
  if (raw.version !== 1) {
    throw new Error('Invalid structured output: version must be 1.');
  }
  const overview = asNonEmptyString(raw.overview, 'overview', 600);
  const wins = asStringArray(raw.wins ?? [], 'wins', 5, 200);
  const focus = asStringArray(raw.focus ?? [], 'focus', 5, 200);
  const nextAction = asNonEmptyString(raw.nextAction, 'nextAction', 300);
  const factRefs = asStringArray(raw.factRefs ?? [], 'factRefs', 30, 80);
  assertFactRefs(factRefs, allowedFactRefs);
  return { version: 1, overview, wins, focus, nextAction, factRefs };
}

export function renderMistakeLensText(payload: MistakeLensPayloadV1): string {
  return `${payload.explanation.trim()}\n\nMemory cue: ${payload.memoryCue.trim()}`;
}

export function renderStudySummaryText(payload: StudySummaryPayloadV1): string {
  const wins = payload.wins.length > 0 ? `\nWins: ${payload.wins.join('; ')}` : '';
  const focus = payload.focus.length > 0 ? `\nFocus: ${payload.focus.join('; ')}` : '';
  return `${payload.overview.trim()}${wins}${focus}\nNext: ${payload.nextAction.trim()}`;
}
