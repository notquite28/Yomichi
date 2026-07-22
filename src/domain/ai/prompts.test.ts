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
  meaningMnemonic: 'This tree radical is a tree.',
  readingMnemonic: 'We chop wood with a machete.',
  contextSentences: [{ ja: '木が大きい。', en: 'The tree is big.' }],
  componentSubjectIds: [1],
};

const radical: SubjectAnswerData = {
  id: 1,
  type: 'radical',
  japanese: '木',
  meanings: [{ meaning: 'tree', type: 'primary' }],
};

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

    expect(block).toContain('Type: kanji');
    expect(block).toContain('Characters: 木');
    expect(block).toContain('tree');
    expect(block).toContain('wood');
    expect(block).not.toContain('blacklist');
    expect(block).toContain('もく');
    expect(block).toContain('き');
    expect(block).toContain('Component subjects: 木: tree');
    expect(block).toContain('User meaning synonyms: timber');
    expect(block).toContain('User meaning note: forest vibe');
    expect(block).toContain('User reading note: moku first');
    expect(block).toContain('WK meaning mnemonic');
    expect(block).toContain('Context sentences');
  });

  test('why_wrong includes task type and user answer', () => {
    const block = buildSubjectContextBlock({
      action: 'why_wrong',
      subject: kanji,
      taskType: 'meaning',
      userAnswer: 'forest',
    });
    expect(block).toContain('Task type: meaning');
    expect(block).toContain('User answer: forest');
    expect(block).toContain('Accepted meaning answers');
  });
});

describe('buildCoachMessages', () => {
  test('system + user messages with action instruction', () => {
    const messages = buildCoachMessages({
      action: 'mnemonic',
      subject: kanji,
      componentSubjects: [radical],
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('Yomiji Study Coach');
    expect(messages[1]?.role).toBe('user');
    expect(messages[1]?.content).toContain('Draft one personal mnemonic');
    expect(messages[1]?.content).toContain('Characters: 木');
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
    ).toMatch(/incorrectly/i);
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
      subject: kanji,
      taskType: 'meaning' as const,
      userAnswer: 'tree',
    };
    const a = buildPromptHash(base);
    const b = buildPromptHash({ ...base, userAnswer: 'wood' });
    expect(a).not.toBe(b);
    expect(buildPromptHash(base)).toBe(a);
  });
});
