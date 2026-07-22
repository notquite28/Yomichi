import { normalizeMnemonicMarkup, stripMnemonicMarkup } from './mnemonicMarkup';

describe('stripMnemonicMarkup', () => {
  test('strips WK subject tags keeping inner text', () => {
    const raw =
      'This looks like the guy from the <radical>big</radical> radical, but he\'s <meaning>fat</meaning>.';
    expect(stripMnemonicMarkup(raw)).toBe(
      "This looks like the guy from the big radical, but he's fat.",
    );
  });

  test('strips curly component refs', () => {
    expect(stripMnemonicMarkup('See {tree} and <kanji>木</kanji>.')).toBe('See tree and 木.');
  });

  test('handles empty', () => {
    expect(stripMnemonicMarkup('')).toBe('');
  });
});

describe('normalizeMnemonicMarkup', () => {
  test('lowercases tag names', () => {
    expect(normalizeMnemonicMarkup('<Meaning>fat</Meaning>')).toBe('<meaning>fat</meaning>');
  });
});
