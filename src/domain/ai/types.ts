import type { SubjectAnswerData } from '../answers/answerChecker';

export type CoachAction =
  | 'explain'
  | 'mnemonic'
  | 'examples'
  | 'unpack_context'
  | 'why_wrong';

export type CoachStatus =
  | 'unavailable'
  | 'not_installed'
  | 'downloading'
  | 'ready'
  | 'loading'
  | 'loaded'
  | 'generating'
  | 'error';

export type CoachStudyMaterial = {
  meaningSynonyms: string[];
  meaningNote: string;
  readingNote: string;
};

export type CoachGenerationInput = {
  action: CoachAction;
  subject: SubjectAnswerData;
  studyMaterial?: CoachStudyMaterial;
  componentSubjects?: SubjectAnswerData[];
  taskType?: 'meaning' | 'reading';
  userAnswer?: string;
  contextSentenceIndex?: number;
  regenerate?: boolean;
  onToken?: (textSoFar: string) => void;
};

export type CoachGenerationResult = {
  text: string;
  fromCache: boolean;
};

export type CoachChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};
