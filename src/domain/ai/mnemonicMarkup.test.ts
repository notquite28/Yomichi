import {
  normalizeMnemonicMarkup,
  parseMnemonicMarkup,
  stripMnemonicMarkup,
  type MnemonicToken,
} from './mnemonicMarkup';

describe('stripMnemonicMarkup', () => {
  test('strips WK subject tags keeping inner text', () => {
    const raw =
      "This looks like the guy from the <radical>big</radical> radical, but he's <meaning>fat</meaning>.";
    expect(stripMnemonicMarkup(raw)).toBe(
      "This looks like the guy from the big radical, but he's fat.",
    );
  });

  test('strips curly component refs', () => {
    expect(stripMnemonicMarkup('See {tree} and <kanji>木</kanji>.')).toBe('See tree and 木.');
  });

  test('strips vocabulary tags', () => {
    expect(
      stripMnemonicMarkup(
        'Strangely, this word means <vocabulary>thanks</vocabulary> and <vocabulary>gratitude</vocabulary>, though.',
      ),
    ).toBe('Strangely, this word means thanks and gratitude, though.');
  });

  test('strips tags with optional attributes', () => {
    expect(stripMnemonicMarkup('<vocabulary class="x">thanks</vocabulary>')).toBe('thanks');
  });

  test('strips tags whose quoted attributes contain >', () => {
    expect(stripMnemonicMarkup('<vocabulary title="a > b">thanks</vocabulary>')).toBe(
      'thanks',
    );
  });

  test('handles empty', () => {
    expect(stripMnemonicMarkup('')).toBe('');
  });
});

describe('normalizeMnemonicMarkup', () => {
  test('lowercases tag names', () => {
    expect(normalizeMnemonicMarkup('<Meaning>fat</Meaning>')).toBe('<meaning>fat</meaning>');
  });

  test('preserves quoted attributes containing >', () => {
    expect(
      normalizeMnemonicMarkup('<Vocabulary title="a > b">thanks</Vocabulary>'),
    ).toBe('<vocabulary title="a > b">thanks</vocabulary>');
  });
});

describe('parseMnemonicMarkup', () => {
  const dualVocab =
    'Strangely, this word means <vocabulary>thanks</vocabulary> and <vocabulary>gratitude</vocabulary>, though.';

  function assertDualVocabTokens(tokens: MnemonicToken[]) {
    const tags = tokens.filter((t) => t.type === 'tag');
    expect(tags).toHaveLength(2);
    expect(tags[0]).toEqual({ type: 'tag', tag: 'vocabulary', text: 'thanks' });
    expect(tags[1]).toEqual({ type: 'tag', tag: 'vocabulary', text: 'gratitude' });
    for (const token of tokens) {
      expect(token.text).not.toContain('<vocabulary');
      expect(token.text).not.toContain('</vocabulary');
    }
  }

  test('extracts vocabulary tags without leaking raw markup', () => {
    assertDualVocabTokens(parseMnemonicMarkup(dualVocab));
  });

  test('sequential parses of the same string both extract tags (no lastIndex leak)', () => {
    const first = parseMnemonicMarkup(dualVocab);
    const second = parseMnemonicMarkup(dualVocab);
    assertDualVocabTokens(first);
    assertDualVocabTokens(second);
  });

  test('overlapping sequential parses do not corrupt later full parses', () => {
    // Partial string that would leave lastIndex mid-stream on a shared /g regex.
    parseMnemonicMarkup('<vocabulary>thanks</vocabulary> and <vocabulary>');
    const full = parseMnemonicMarkup(dualVocab);
    assertDualVocabTokens(full);
  });

  test('parses tags with optional attributes', () => {
    const tokens = parseMnemonicMarkup('<vocabulary class="x">thanks</vocabulary>');
    expect(tokens).toEqual([{ type: 'tag', tag: 'vocabulary', text: 'thanks' }]);
  });

  test('parses tags whose quoted attributes contain >', () => {
    const tokens = parseMnemonicMarkup(
      '<vocabulary title="a > b">thanks</vocabulary>',
    );
    expect(tokens).toEqual([{ type: 'tag', tag: 'vocabulary', text: 'thanks' }]);
  });

  test('parses curly refs and mixed tags', () => {
    const tokens = parseMnemonicMarkup('See {tree} and <kanji>木</kanji>.');
    expect(tokens).toEqual([
      { type: 'text', text: 'See ' },
      { type: 'curly', text: 'tree' },
      { type: 'text', text: ' and ' },
      { type: 'tag', tag: 'kanji', text: '木' },
      { type: 'text', text: '.' },
    ]);
  });

  test('empty string yields no tokens', () => {
    expect(parseMnemonicMarkup('')).toEqual([]);
  });

  test('unclosed tags remain plain text', () => {
    const tokens = parseMnemonicMarkup('Hello <vocabulary>thanks');
    expect(tokens).toEqual([{ type: 'text', text: 'Hello <vocabulary>thanks' }]);
  });

  test('normalize + parse handles mixed-case tags', () => {
    const raw = 'A <Vocabulary>thanks</Vocabulary> and <MEANING>gratitude</MEANING>.';
    const tokens = parseMnemonicMarkup(normalizeMnemonicMarkup(raw));
    const tags = tokens.filter((t) => t.type === 'tag');
    expect(tags).toEqual([
      { type: 'tag', tag: 'vocabulary', text: 'thanks' },
      { type: 'tag', tag: 'meaning', text: 'gratitude' },
    ]);
  });
});
