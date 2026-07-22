/**
 * WK mnemonic markup: <kanji>…</kanji>, <radical>…</radical>, {component}, etc.
 * Strip for model input (keep inner text). Optionally re-emit simple tags for display.
 */

const TAG_OR_CURLY =
  /(<(vocabulary|reading|ja|jp|kanji|radical|kan|meaning|b|em|i|strong)>)([\s\S]*?)(<\/\2>)|(\{([^}]+)\})/gi;

/** Plain text for LLM context: tags/curlies become their inner content only. */
export function stripMnemonicMarkup(text: string): string {
  if (!text) return text;
  return text.replace(TAG_OR_CURLY, (_full, _open, _tag, inner, _close, _curlyFull, curlyInner) => {
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
  return text.replace(
    /<\/?([A-Za-z]+)>/g,
    (full, name: string) => full.replace(name, name.toLowerCase()),
  );
}
