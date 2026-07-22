import {
  actionInstruction,
  buildCoachMessages,
  buildPromptHash,
  buildSubjectContextBlock,
  hashPromptPayload,
} from './prompts';
import type { SubjectAnswerData } from '../answers/answerChecker';

const kanji: SubjectAnswerData = {
  id: 42,
  type: 'kanji',
  japanese: '木',
  meanings: [
    { meaning: 'tree', type: 'primary' },
    { meaning: 'wood', type: 'secondary' },
    { meaning: 'blacklist', type: 'blacklist', acceptedAnswer: false },
  ],
  readings: [
    { reading: 'もく', type: 'onyomi', primary: true },
    { reading: 'き', type: 'kunyomi', primary: false },
  ],
  // Markup like production WK text — must be stripped for the model.
  meaningMnemonic: 'This <radical>tree</radical> radical is a <meaning>tree</meaning>.',
  readingMnemonic: 'We chop wood with a <reading>machete</reading>.',
  contextSentences: [{ ja: '木が大きい。', en: 'The tree is big.' }],
  componentSubjectIds: [1],
};

const radical: SubjectAnswerData = {
  id: 1,
  type: 'radical',
  japanese: '木',
  meanings: [{ meaning: 'tree', type: 'primary' }],
};

const empty: SubjectAnswerData = {
  id: 900,
  type: 'vocabulary',
  japanese: '空き家',
  meanings: [
    { meaning: 'vacant house', type: 'primary' },
    { meaning: 'unoccupied house', type: 'secondary' },
  ],
  readings: [{ reading: 'あきや', primary: true }],
  meaningMnemonic: 'An empty house is a vacant house.',
  readingMnemonic: 'The empty house is akiya.',
  componentSubjectIds: [100, 101],
};

const emptyComponents: SubjectAnswerData[] = [
  {
    id: 100,
    type: 'kanji',
    japanese: '空',
    meanings: [
      { meaning: 'sky', type: 'primary' },
      { meaning: 'empty', type: 'secondary' },
    ],
    readings: [
      { reading: 'くう', type: 'onyomi', primary: true },
      { reading: 'そら', type: 'kunyomi' },
      { reading: 'あ', type: 'kunyomi' },
    ],
  },
  {
    id: 101,
    type: 'kanji',
    japanese: '家',
    meanings: [
      { meaning: 'house', type: 'primary' },
      { meaning: 'home', type: 'secondary' },
    ],
    readings: [
      { reading: 'か', type: 'onyomi', primary: true },
      { reading: 'いえ', type: 'kunyomi' },
      { reading: 'や', type: 'kunyomi' },
    ],
  },
];

describe('buildSubjectContextBlock', () => {
  test('includes meanings, readings, components, and user notes', () => {
    const block = buildSubjectContextBlock({
      action: 'explain',
      subject: kanji,
      componentSubjects: [radical],
      studyMaterial: {
        meaningSynonyms: ['timber'],
        meaningNote: 'forest vibe',
        readingNote: 'moku first',
      },
    });

    expect(block).toContain('Item type: kanji');
    expect(block).toContain('Characters / word: 木');
    expect(block).toContain('tree');
    expect(block).toContain('wood');
    expect(block).not.toContain('blacklist');
    expect(block).toContain('もく');
    expect(block).toContain('き');
    expect(block).toContain('木 (radical)');
    expect(block).toContain('Your meaning synonyms: timber');
    expect(block).toContain('Your meaning note: forest vibe');
    expect(block).toContain('Your reading note: moku first');
    expect(block).toContain('Official WK meaning mnemonic');
    expect(block).toContain('Context sentences');
    expect(block).toContain('All accepted meanings (inviolable)');
    // WK markup stripped before the model sees it
    expect(block).not.toContain('<radical>');
    expect(block).not.toContain('<meaning>');
    expect(block).not.toContain('<reading>');
    expect(block).toContain('This tree radical is a tree.');
    expect(block).toContain('We chop wood with a machete.');
  });

  test('why_wrong includes task type, typed answer, and vocab component caution', () => {
    const block = buildSubjectContextBlock({
      action: 'why_wrong',
      subject: empty,
      componentSubjects: emptyComponents,
      taskType: 'reading',
      userAnswer: 'くうきや',
    });
    expect(block).toContain('Review task: reading');
    expect(block).toContain('What you typed: くうきや');
    expect(block).toContain('Correct accepted reading answer(s): あきや');
    expect(block).toContain('空 (kanji)');
    expect(block).toContain('くう');
    expect(block).toContain('家 (kanji)');
    expect(block).toMatch(/whole-word/i);
    expect(block).toContain('App grading notes:');
    expect(block).toContain(
      'Reading tasks accept only the listed accepted readings (not component-glued readings unless listed).',
    );
  });

  test('why_wrong meaning context includes synonym grading hint', () => {
    const block = buildSubjectContextBlock({
      action: 'why_wrong',
      subject: empty,
      componentSubjects: emptyComponents,
      taskType: 'meaning',
      userAnswer: 'temp',
    });
    expect(block).toContain('Review task: meaning');
    expect(block).toContain('What you typed: temp');
    expect(block).toContain('App grading notes:');
    expect(block).toContain(
      "Meaning tasks accept official meanings plus the user's meaning synonyms listed above",
    );
    expect(block).toContain(
      'Hint for coach: if the typed English is a reasonable synonym or abbreviation of an accepted meaning, prefer a synonym-suggestion explanation over Japanese morphology.',
    );
  });

  test('does not classify readings without explicit primary flags as primary', () => {
    const block = buildSubjectContextBlock({
      action: 'explain',
      subject: {
        ...kanji,
        readings: [
          { reading: 'もく', type: 'onyomi' },
          { reading: 'き', type: 'kunyomi' },
        ],
      },
    });

    expect(block).not.toContain('Primary reading(s):');
    expect(block).toContain('Accepted reading(s): もく (onyomi), き (kunyomi)');
    expect(block).toContain(
      'All accepted readings (inviolable): もく (onyomi), き (kunyomi)',
    );
  });
});

describe('buildCoachMessages', () => {
  test('system + user messages with second-person instructions', () => {
    const messages = buildCoachMessages({
      action: 'mnemonic',
      subject: kanji,
      componentSubjects: [radical],
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('second person');
    expect(messages[0]?.content).toMatch(/no markdown/i);
    expect(messages[0]?.content).toMatch(/radicals/i);
    expect(messages[0]?.content).toMatch(/kanji/i);
    expect(messages[0]?.content).toMatch(/vocabulary/i);
    expect(messages[0]?.content).toMatch(/meaning OR reading/i);
    expect(messages[0]?.content).toMatch(/synonym/i);
    expect(messages[1]?.role).toBe('user');
    expect(messages[1]?.content).toContain('personal mnemonic');
    expect(messages[1]?.content).toContain('Characters / word: 木');
  });

  test('why_wrong instruction is second person and forbids learner wording', () => {
    const text = actionInstruction('why_wrong', {
      action: 'why_wrong',
      subject: empty,
      taskType: 'reading',
      userAnswer: 'くうきや',
    });
    expect(text).toMatch(/you/i);
    expect(text).toMatch(/Never write "the learner"/i);
    expect(text).toMatch(/No markdown/i);
    expect(text).toContain('くうきや');
  });

  test('why_wrong meaning instruction steers toward Add as synonym', () => {
    const text = actionInstruction('why_wrong', {
      action: 'why_wrong',
      subject: empty,
      taskType: 'meaning',
      userAnswer: 'temp',
    });
    expect(text).toContain('Add as synonym');
    expect(text).toContain('Do not invent Japanese morphology');
    expect(text).toMatch(/meaning review/i);
    expect(text).not.toMatch(/wrong on\/kun for a kanji/i);
  });

  test('why_wrong reading instruction stays on whole-word readings', () => {
    const text = actionInstruction('why_wrong', {
      action: 'why_wrong',
      subject: empty,
      taskType: 'reading',
      userAnswer: 'けいおん',
    });
    expect(text).toMatch(/reading review/i);
    expect(text).toMatch(/whole-word accepted reading/i);
    expect(text).toContain('Do not digress into English meaning explanations');
    expect(text).toContain('Do not invent component readings');
    expect(text).not.toContain('Add as synonym');
  });

  test('actionInstruction covers all actions', () => {
    expect(actionInstruction('explain', { action: 'explain', subject: kanji })).toMatch(/Explain/i);
    expect(actionInstruction('examples', { action: 'examples', subject: kanji })).toMatch(/example/i);
    expect(
      actionInstruction('unpack_context', {
        action: 'unpack_context',
        subject: kanji,
        contextSentenceIndex: 0,
      }),
    ).toMatch(/Unpack/i);
    expect(
      actionInstruction('why_wrong', {
        action: 'why_wrong',
        subject: kanji,
        taskType: 'reading',
        userAnswer: 'も',
      }),
    ).toMatch(/missed/i);
  });
});

describe('prompt hashing', () => {
  test('hashPromptPayload is stable for same input', () => {
    expect(hashPromptPayload('abc')).toBe(hashPromptPayload('abc'));
    expect(hashPromptPayload('abc')).not.toBe(hashPromptPayload('abd'));
  });

  test('buildPromptHash changes when answer changes for why_wrong', () => {
    const base = {
      action: 'why_wrong' as const,
      subject: empty,
      componentSubjects: emptyComponents,
      taskType: 'reading' as const,
      userAnswer: 'あきや',
    };
    const a = buildPromptHash(base);
    const b = buildPromptHash({ ...base, userAnswer: 'くうきや' });
    expect(a).not.toBe(b);
    expect(buildPromptHash(base)).toBe(a);
  });
});
