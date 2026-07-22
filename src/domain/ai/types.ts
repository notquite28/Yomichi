import type { SubjectAnswerData } from '../answers/answerChecker';

export type CoachAction =
  | 'explain'
  | 'mnemonic'
  | 'examples'
  | 'unpack_context'
  | 'why_wrong'
  | 'mistake_lens'
  | 'study_summary';

export type MistakeLensPayloadV1 = {
  version: 1;
  explanation: string;
  memoryCue: string;
  factRefs: string[];
};

export type StudySummaryPayloadV1 = {
  version: 1;
  overview: string;
  wins: string[];
  focus: string[];
  nextAction: string;
  factRefs: string[];
};

export type CoachStructuredResult<T> = {
  payload: T;
  fromCache: boolean;
  text: string;
};

export type StudySummaryFacts = {
  level: number | null;
  username: string | null;
  availableLessons: number;
  availableReviews: number;
  reviewForecast24h: number;
  srs: {
    apprentice: number;
    guru: number;
    master: number;
    enlightened: number;
    burned: number;
  };
  levelProgress: {
    radicalsPassed: number;
    radicalsTotal: number;
    kanjiPassed: number;
    kanjiTotal: number;
  } | null;
  recentMistakes: Array<{
    subjectId: number;
    japanese: string;
    primaryMeaning: string;
  }>;
  topLeeches: Array<{
    subjectId: number;
    japanese: string;
    primaryMeaning: string;
    score: number;
  }>;
  recentWindow: {
    days: number;
    scoredAttempts: number;
    correct: number;
    incorrect: number;
  } | null;
  lastSyncedAt: string | null;
  attemptRevision: number;
  syncRevision: number;
};

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
  /** Optional for global actions such as study_summary (cached under subject_id 0). */
  subject?: SubjectAnswerData;
  studyMaterial?: CoachStudyMaterial;
  componentSubjects?: SubjectAnswerData[];
  taskType?: 'meaning' | 'reading';
  userAnswer?: string;
  contextSentenceIndex?: number;
  regenerate?: boolean;
  onToken?: (textSoFar: string) => void;
  evidence?: {
    missCount?: number;
    recentAnswers?: string[];
    pair?: {
      otherSubject: SubjectAnswerData;
      wrongAnswer: string;
      taskType: 'meaning' | 'reading';
    };
    summaryFacts?: StudySummaryFacts;
    factRefAllowlist?: string[];
  };
};

export type CoachGenerationResult = {
  text: string;
  fromCache: boolean;
  structured?: MistakeLensPayloadV1 | StudySummaryPayloadV1;
};

export type CoachChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};
