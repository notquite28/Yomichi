import {
  parseJsonObject,
  validateMistakeLensPayload,
  validateStudySummaryPayload,
} from './structuredOutput';

describe('structuredOutput', () => {
  const mistakeAllow = new Set(['facts.entered_answer', 'facts.miss_count']);
  const summaryAllow = new Set(['facts.available_reviews', 'facts.level']);

  test('parseJsonObject strips fences', () => {
    const raw = '```json\n{"version":1,"explanation":"x","memoryCue":"y","factRefs":[]}\n```';
    expect(parseJsonObject(raw)).toEqual({
      version: 1,
      explanation: 'x',
      memoryCue: 'y',
      factRefs: [],
    });
  });

  test('validateMistakeLensPayload accepts valid JSON', () => {
    const payload = validateMistakeLensPayload(
      {
        version: 1,
        explanation: 'You mixed the reading again.',
        memoryCue: 'Link 大 to dai.',
        factRefs: ['facts.entered_answer'],
      },
      mistakeAllow,
    );
    expect(payload.version).toBe(1);
    expect(payload.explanation).toContain('mixed');
  });

  test('validateMistakeLensPayload rejects unknown factRef', () => {
    expect(() =>
      validateMistakeLensPayload(
        {
          version: 1,
          explanation: 'ok',
          memoryCue: 'ok',
          factRefs: ['facts.invented'],
        },
        mistakeAllow,
      ),
    ).toThrow(/unknown factRef/);
  });

  test('validateStudySummaryPayload accepts valid JSON', () => {
    const payload = validateStudySummaryPayload(
      {
        version: 1,
        overview: 'You have reviews ready.',
        wins: ['Burned items retained'],
        focus: ['Clear due reviews'],
        nextAction: 'Start reviews.',
        factRefs: ['facts.available_reviews'],
      },
      summaryAllow,
    );
    expect(payload.nextAction).toBe('Start reviews.');
  });

  test('invalid JSON object throws', () => {
    expect(() => parseJsonObject('not json')).toThrow(/no JSON object/);
  });
});
