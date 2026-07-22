/**
 * WK mnemonic markup: <kanji>…</kanji>, <radical>…</radical>, {component}, etc.
 * Strip for model input (keep inner text). Optionally re-emit simple tags for display.
 */

/** Allowlisted mnemonic / emphasis tag names (case-insensitive). */
export const MNEMONIC_TAG_NAMES =
  'vocabulary|reading|ja|jp|kanji|radical|kan|meaning|b|em|i|strong';

/** Optional opening-tag attributes; quoted values may contain angle brackets. */
const MNEMONIC_TAG_ATTRIBUTES = `(?:\\s(?:[^"'<>]|"[^"]*"|'[^']*')*)?`;

export type MnemonicToken =
  | { type: 'text'; text: string }
  | { type: 'tag'; tag: string; text: string }
  | { type: 'curly'; text: string };

/** Fresh regex per call — never share a mutable /g lastIndex across invocations. */
function createTagOrCurlyPattern(): RegExp {
  return new RegExp(
    `<(${MNEMONIC_TAG_NAMES})${MNEMONIC_TAG_ATTRIBUTES}>([\\s\\S]*?)<\\/\\1>|\\{([^}]+)\\}`,
    'gi',
  );
}

/** Plain text for LLM context: tags/curlies become their inner content only. */
export function stripMnemonicMarkup(text: string): string {
  if (!text) return text;
  const pattern = createTagOrCurlyPattern();
  return text.replace(pattern, (_full, _tag, inner, curlyInner) => {
    if (typeof inner === 'string') return inner;
    if (typeof curlyInner === 'string') return curlyInner;
    return '';
  });
}

/**
 * Normalize model/WK markup so display parsing is reliable:
 * - lowercase tag names
 * - drop unknown wrappers by keeping inner text only is already strip's job
 */
export function normalizeMnemonicMarkup(text: string): string {
  if (!text) return text;
  const pattern = new RegExp(
    `<\\/?([A-Za-z]+)${MNEMONIC_TAG_ATTRIBUTES}>`,
    'g',
  );
  return text.replace(pattern, (full, name: string) => {
    const lower = name.toLowerCase();
    if (full.startsWith('</')) return `</${lower}>`;
    return `<${lower}${full.slice(name.length + 1)}`;
  });
}

/**
 * Tokenize mnemonic markup for display.
 * Creates a fresh regex each call so concurrent/sequential parses cannot corrupt lastIndex.
 * Optional whitespace/attributes on open tags are accepted; bare tags remain the common case.
 * Unclosed tags stay as plain text. Nested known tags keep outer structure (inner text is not re-parsed).
 */
export function parseMnemonicMarkup(text: string): MnemonicToken[] {
  if (!text) return [];

  const pattern = createTagOrCurlyPattern();
  const tokens: MnemonicToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }
    if (match[1] != null && match[2] !== undefined) {
      tokens.push({ type: 'tag', tag: match[1].toLowerCase(), text: match[2] });
    } else if (match[3] != null) {
      tokens.push({ type: 'curly', text: match[3] });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', text: text.slice(lastIndex) });
  }

  return tokens;
}
