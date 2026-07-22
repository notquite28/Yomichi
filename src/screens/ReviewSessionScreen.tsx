import { NativeStackScreenProps } from '@react-navigation/native-stack';
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { checkAnswer, classifyAnswerResult, normalizeAnswer, TaskType } from '../domain/answers/answerChecker';
import { correctAnswerText, feedbackTitle } from '../domain/answers/feedbackMessages';
import { convertRomajiToKanaInput } from '../domain/answers/kanaInput';
import { playVocabularyAudio, stopVocabularyAudio } from '../domain/audio/vocabularyAudio';
import { openAppDatabase } from '../domain/db/database';
import { logErrorBestEffort } from '../domain/db/errorLog';
import { AppSettings } from '../domain/settings/settings';
import { useSettingsStore } from '../domain/settings/settingsStore';
import {
  MarkResult,
  ReviewItem,
  ReviewSession,
  ReviewSessionSettings,
} from '../domain/study/reviewSession';
import { findBySubjectId } from '../domain/db/studyMaterialRepository';
import { getSubjectsByIds } from '../domain/db/subjectRepository';
import {
  discardAttempt,
  markAttemptOverridden,
  pruneLearningHistory,
  recordAttempt,
  type AttemptSource,
} from '../domain/study/reviewAttempts';
import {
  buildDeterministicCard,
  evaluateInterventionOffer,
  loadSubjectsForOffer,
  type DeterministicCardModel,
  type InterventionOffer,
} from '../domain/study/learningEvidence';
import {
  insertIntervention,
  updateInterventionState,
} from '../domain/study/learningInterventions';
import { getBurnedItemPracticeQueue, getLeechPracticeQueue, getPracticeQueueBySubjectIds, getRecentMistakePracticeQueue, getReviewQueue, queueReviewResult, queueStudyMaterialUpdate, StudyQueueItem } from '../domain/study/studyRepository';
import { CenteredMessage, ScreenLayout, SessionHeader } from '../components/ScreenLayout';
import { FloatingReviewPill } from '../components/FloatingReviewPill';
import { CoachMistakeCard } from '../components/coach/CoachMistakeCard';
import { MistakeLensCard } from '../components/coach/MistakeLensCard';
import { cancelGeneration, runCoachAction } from '../domain/ai/coachService';
import { useCoachStore } from '../domain/ai/coachStore';
import { useConfirmLeave } from '../hooks/useConfirmLeave';
import { useGuidanceMessage } from '../hooks/useGuidanceMessage';
import { ConfirmLeaveBanner } from '../components/ConfirmLeaveBanner';
import { SubjectDetailsContent } from '../components/SubjectDetailsContent';
import { SubjectHeroCard } from '../components/SubjectHeroCard';
import { ReviewQuickSettings } from '../components/ReviewQuickSettings';
import { RootStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/AppThemeProvider';
import { colorForSubjectType } from '../theme/subjectColors';

type Props = NativeStackScreenProps<RootStackParamList, 'ReviewSession'>;
type Feedback = {
  correct: boolean;
  item: ReviewItem;
  taskType: TaskType;
  subjectFinished: boolean;
  message: string;
  detail: string;
};

type PracticeSource = NonNullable<RootStackParamList['ReviewSession']>['practiceSource'];

function getQueueForSource(
  db: Awaited<ReturnType<typeof openAppDatabase>>,
  source: PracticeSource,
  settings: AppSettings,
  subjectIds?: number[],
) {
  if (source === 'recentMistakes') {
    return getRecentMistakePracticeQueue(db);
  }
  if (source === 'apprenticeLeeches') {
    return getLeechPracticeQueue(db, { apprenticeOnly: true, threshold: settings.leechThreshold });
  }
  if (source === 'allLeeches') {
    return getLeechPracticeQueue(db, { threshold: settings.leechThreshold });
  }
  if (source === 'burnedItems') {
    return getBurnedItemPracticeQueue(db, {
      order: settings.burnedPracticeOrder,
      limit: settings.burnedPracticeLimit,
      includeRadicals: settings.burnedPracticeIncludeRadicals,
      includeKanji: settings.burnedPracticeIncludeKanji,
      includeVocabulary: settings.burnedPracticeIncludeVocabulary,
    });
  }
  if (source === 'subjectIds') {
    return getPracticeQueueBySubjectIds(db, subjectIds ?? []);
  }
  return getReviewQueue(db);
}

function emptyStateLabel(source: PracticeSource) {
  if (source === 'recentMistakes') {
    return 'No recent mistakes are available for practice.';
  }
  if (source === 'apprenticeLeeches') {
    return 'No apprentice leeches are available for practice.';
  }
  if (source === 'allLeeches') {
    return 'No leeches are available for practice.';
  }
  if (source === 'burnedItems') {
    return 'No burned items are available for practice.';
  }
  if (source === 'subjectIds') {
    return 'No subjects available for pair practice.';
  }
  return 'No reviews are available in the local cache.';
}

function attemptSource(practiceSource: PracticeSource | undefined): AttemptSource {
  if (practiceSource === 'subjectIds') return 'practice_pair';
  if (practiceSource) return 'practice';
  return 'review';
}

export function ReviewSessionScreen({ navigation, route }: Props) {
  const { colors, isDark } = useAppTheme();
  const [queueItems, setQueueItems] = useState<StudyQueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [lastMarkResult, setLastMarkResult] = useState<MarkResult | null>(null);
  const [isContinuing, setIsContinuing] = useState(false);
  const [revision, setRevision] = useState(0);
  const appSettings = useSettingsStore();
  const [userLevel, setUserLevel] = useState<number | undefined>(undefined);
  const [ankiRevealed, setAnkiRevealed] = useState(false);
  const [quickSettingsOpen, setQuickSettingsOpen] = useState(false);
  const [showAllDetails, setShowAllDetails] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [audioMessage, setAudioMessage] = useState<string | null>(null);
  const [mistakeCoachText, setMistakeCoachText] = useState('');
  const [mistakeCoachError, setMistakeCoachError] = useState<string | null>(null);
  const [mistakeCoachRunning, setMistakeCoachRunning] = useState(false);
  const [lensCard, setLensCard] = useState<DeterministicCardModel | null>(null);
  const [lensInterventionId, setLensInterventionId] = useState<number | null>(null);
  const [lensGeneratedText, setLensGeneratedText] = useState('');
  const [lensError, setLensError] = useState<string | null>(null);
  const [lensRunning, setLensRunning] = useState(false);
  const offeredSubjectTasksRef = useRef<Set<string>>(new Set());
  const lastOfferRef = useRef<InterventionOffer | null>(null);
  const studyCoachEnabled = appSettings.studyCoachEnabled;
  const coachStatus = useCoachStore((s) => s.status);
  const { guidanceMessage, showGuidance, clearGuidance } = useGuidanceMessage();
  const [subjectDetailData, setSubjectDetailData] = useState<{
    componentSubjects: Map<number, import('../domain/answers/answerChecker').SubjectAnswerData>;
    amalgamationSubjects: Map<number, import('../domain/answers/answerChecker').SubjectAnswerData>;
    studyMaterial: { meaningSynonyms: string[]; meaningNote: string; readingNote: string };
  } | null>(null);

  const sessionRef = useRef<ReviewSession | null>(null);
  const sessionIdRef = useRef<number>(Date.now());
  const lastAttemptIdRef = useRef<number | null>(null);
  const pendingAttemptIdRef = useRef<Promise<number | null> | null>(null);
  const feedbackRevisionRef = useRef(0);
  const scrollViewRef = useRef<ScrollView>(null);
  const audioTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const practiceSource = route.params?.practiceSource;

  const settings = useMemo<ReviewSessionSettings>(
    () => ({
      reviewOrder: appSettings.reviewOrder,
      reviewBatchSize: appSettings.reviewBatchSize,
      reviewItemsLimit: appSettings.reviewItemsLimit,
      reviewItemsLimitEnabled:
        practiceSource === 'burnedItems' ? false : appSettings.reviewItemsLimitEnabled,
      groupMeaningReading: appSettings.groupMeaningReading,
      meaningFirst: appSettings.meaningFirst,
      minimizeReviewPenalty: appSettings.minimizeReviewPenalty,
      enableCheats: appSettings.enableCheats,
      ankiMode: appSettings.ankiMode,
    }),
    [appSettings, practiceSource],
  );

  const ankiMode = appSettings.ankiMode;

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const db = await openAppDatabase();
        const currentSettings = useSettingsStore.getState();
        const [items, userRow] = await Promise.all([
          getQueueForSource(db, practiceSource, currentSettings, route.params?.subjectIds),
          db.getFirstAsync<{ level: number }>('SELECT level FROM user WHERE id = 1'),
        ]);
        if (!isMounted) return;
        setQueueItems(items);
        setUserLevel(userRow?.level);
      } catch (caught) {
        if (isMounted) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [practiceSource, route.params?.subjectIds]);

  useEffect(() => {
    if (queueItems.length === 0 || sessionRef.current) {
      return;
    }

    const availableAtMap = new Map<number, string>();
    for (const item of queueItems) {
      if (item.availableAt) {
        availableAtMap.set(item.assignmentId, item.availableAt);
      }
    }

    sessionIdRef.current = Date.now();
    lastAttemptIdRef.current = null;
    pendingAttemptIdRef.current = null;
    const session = new ReviewSession(queueItems, settings, Boolean(practiceSource), availableAtMap, userLevel);
    sessionRef.current = session;
    session.nextTask();
    setRevision((r) => r + 1);
  }, [practiceSource, queueItems, settings, userLevel]);

  useEffect(() => () => {
    feedbackRevisionRef.current += 1;
    cancelGeneration();
    stopVocabularyAudio().catch((error) => {
      void logErrorBestEffort('debug', error, 'ReviewSessionScreen.unmount.stopVocabularyAudio');
    });
  }, []);

  useEffect(() => () => {
    void openAppDatabase()
      .then((db) => pruneLearningHistory(db))
      .catch((error) => {
        void logErrorBestEffort('debug', error, 'ReviewSessionScreen.pruneLearningHistory');
      });
  }, []);

  useEffect(() => () => {
    if (audioTimerRef.current) {
      clearTimeout(audioTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOffline(state.isConnected === false || state.isInternetReachable === false);
    });
    NetInfo.fetch().then((state) => {
      setIsOffline(state.isConnected === false || state.isInternetReachable === false);
    }).catch(() => {});
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!feedback?.item) {
      setSubjectDetailData(null);
      setShowAllDetails(false);
      return;
    }

    let isMounted = true;
    const item = feedback.item;
    (async () => {
      try {
        const db = await openAppDatabase();
        const compIds = item.subject.componentSubjectIds ?? [];
        const amalIds = (item.subject.amalgamationSubjectIds ?? []).slice(0, 10);
        const [compMap, amalMap] = await Promise.all([
          compIds.length > 0 ? getSubjectsByIds(db, compIds) : Promise.resolve(new Map()),
          amalIds.length > 0 ? getSubjectsByIds(db, amalIds) : Promise.resolve(new Map()),
        ]);
        const sm = await findBySubjectId(db, item.subjectId);
        const studyMaterial = sm
          ? (() => {
              const parsed = JSON.parse(sm.payload) as { data: { meaning_synonyms?: string[]; meaning_note?: string; reading_note?: string } };
              return { meaningSynonyms: parsed.data.meaning_synonyms ?? [], meaningNote: parsed.data.meaning_note ?? '', readingNote: parsed.data.reading_note ?? '' };
            })()
          : { meaningSynonyms: [] as string[], meaningNote: '', readingNote: '' };

        if (isMounted) {
          setSubjectDetailData({ componentSubjects: compMap, amalgamationSubjects: amalMap, studyMaterial });
        }
      } catch (error) {
        void logErrorBestEffort('warn', error, 'ReviewSessionScreen.loadSubjectDetailData');
        if (isMounted) {
          setSubjectDetailData(null);
        }
      }
    })();
    return () => { isMounted = false; };
  }, [feedback?.item?.subjectId]);

  const session = sessionRef.current;
  const currentItem = session?.currentItem ?? null;
  const taskType = session?.currentTaskType ?? null;
  const displayItem = feedback?.item ?? currentItem;
  const displayTaskType = feedback?.taskType ?? taskType;
  const mistakeSubjectLookup = useMemo(() => {
    const lookup = new Map(subjectDetailData?.componentSubjects);
    const reviewedSubject = feedback?.item.subject;
    if (reviewedSubject?.id != null) {
      lookup.set(reviewedSubject.id, reviewedSubject);
    }
    return lookup.size > 0 ? lookup : undefined;
  }, [feedback?.item.subject, subjectDetailData]);
  const subjectColor = displayItem
    ? colorForSubjectType(colors, displayItem.subjectType)
    : colors.vocabulary;
  const isComplete = !feedback && (session?.isComplete ?? false);
  const showPill = displayItem !== null && !isComplete;
  const isVocabulary = displayItem?.subjectType === 'vocabulary';
  const reviewPosition = session
    ? Math.min(session.reviewsCompleted + (feedback?.subjectFinished ? 0 : 1), session.totalReviews)
    : 0;
  const completedItems = session?.completedItems ?? [];
  const shouldConfirmLeave = session !== null && !isComplete;
  const { confirmLeave, allowLeavingRef, handleBack, handleCancelLeave, handleConfirmLeave: rawHandleConfirmLeave } =
    useConfirmLeave(navigation, shouldConfirmLeave);

  const handleConfirmLeave = () => {
    cancelGeneration();
    setAudioMessage(null);
    rawHandleConfirmLeave();
  };

  const subjectLookup = useMemo(
    () => new Map(queueItems.map((item) => [item.subjectId, item.subject])),
    [queueItems],
  );

  const playAudioForItem = async (item: ReviewItem) => {
    if (item.subjectType !== 'vocabulary') {
      return;
    }
    if (isOffline) {
      return;
    }

    try {
      const db = await openAppDatabase();
      const success = await playVocabularyAudio(db, item.subjectId, {
        interruptBackgroundAudio: appSettings.interruptBackgroundAudio,
        preferredVoiceActorId: appSettings.preferredVoiceActorId,
      });
      if (!success) {
        setAudioMessage('No audio is available for this vocabulary item');
        if (audioTimerRef.current) {
          clearTimeout(audioTimerRef.current);
          audioTimerRef.current = null;
        }
        audioTimerRef.current = setTimeout(() => setAudioMessage(null), 3000);
      }
    } catch (error) {
      void logErrorBestEffort('warn', error, 'ReviewSessionScreen.playAudio');
      setAudioMessage('Unable to play audio');
      if (audioTimerRef.current) {
        clearTimeout(audioTimerRef.current);
        audioTimerRef.current = null;
      }
      audioTimerRef.current = setTimeout(() => setAudioMessage(null), 3000);
    }
  };

  const maybeAutoplayAudio = (item: ReviewItem, answeredTaskType: TaskType, correct: boolean) => {
    if (!correct || !appSettings.playAudioAutomatically || isOffline) {
      return;
    }
    if (answeredTaskType !== 'reading' && (item.subject.readings?.length ?? 0) > 0) {
      return;
    }

    playAudioForItem(item);
  };

  const persistFinishedReview = async (item: ReviewItem) => {
    if (session?.isPracticeSession) {
      return;
    }
    const db = await openAppDatabase();
    await queueReviewResult(db, {
      assignmentId: item.assignmentId,
      incorrectMeaningAnswers: item.meaningWrongCount,
      incorrectReadingAnswers: item.readingWrongCount,
    });
  };

  const submit = () => {
    if (!session || !currentItem || feedback) {
      return;
    }

    if (ankiMode && !ankiRevealed) {
      setAnkiRevealed(true);
      return;
    }

    if (!ankiMode && !answer.trim()) {
      return;
    }

    const result = checkAnswer(answer, currentItem.subject, {
      taskType: taskType ?? 'meaning',
      studyMaterials: currentItem.studyMaterials,
      lookupSubject: (subjectId) => subjectLookup.get(subjectId),
      exactMatch: appSettings.exactMatch,
    });
    const outcome = classifyAnswerResult(result);

    // Guidance results (wrong reading type, invalid characters, okurigana
    // mismatch, reading typed for a meaning prompt) are not scored: shake the
    // field, show the hint, and let the user answer again. Scoring them here
    // would inflate the incorrect counts sent to WaniKani and over-demote items.
    if (outcome === 'retry') {
      showGuidance(feedbackTitle(result));
      return;
    }

    const correct = outcome === 'correct';
    const answeredTaskType = taskType ?? 'meaning';
    clearGuidance();
    const markResult = session.markAnswer(correct);
    setLastMarkResult(markResult);
    setFeedback({
      correct,
      item: currentItem,
      taskType: answeredTaskType,
      subjectFinished: markResult.subjectFinished,
      message: feedbackTitle(result),
      detail: correct
        ? 'Nice work — continue to the next prompt.'
        : correctAnswerText(currentItem, answeredTaskType),
    });
    maybeAutoplayAudio(currentItem, answeredTaskType, correct);
    setRevision((r) => r + 1);

    const sessionId = sessionIdRef.current;
    const subjectId = currentItem.subjectId;
    const assignmentId = currentItem.assignmentId;
    const srsStageBefore = currentItem.srsStage;
    const resultKind = result.kind;
    const feedbackRevision = ++feedbackRevisionRef.current;
    const persistence = (async () => {
      const db = await openAppDatabase();
      const normalizedWrong = correct ? null : normalizeAnswer(answer, answeredTaskType);
      const id = await recordAttempt(db, {
        sessionId,
        subjectId,
        assignmentId,
        source: attemptSource(practiceSource),
        taskType: answeredTaskType,
        normalizedAnswer: normalizedWrong,
        resultKind,
        scoredCorrect: correct,
        srsStageBefore,
      });
      return { db, id, normalizedWrong };
    })();
    pendingAttemptIdRef.current = persistence.then(
      ({ id }) => id,
      () => null,
    );

    void (async () => {
      try {
        const { db, id, normalizedWrong } = await persistence;
        if (feedbackRevisionRef.current !== feedbackRevision) {
          return;
        }
        lastAttemptIdRef.current = id;

        if (correct) {
          return;
        }
        const offerKey = `${subjectId}:${answeredTaskType}`;
        if (offeredSubjectTasksRef.current.has(offerKey)) {
          return;
        }
        const offer = await evaluateInterventionOffer(db, {
          subjectId,
          taskType: answeredTaskType,
          wrongAnswer: normalizedWrong,
          justMissed: true,
        });
        if (!offer || feedbackRevisionRef.current !== feedbackRevision) {
          return;
        }
        const subjects = await loadSubjectsForOffer(db, offer);
        if (feedbackRevisionRef.current !== feedbackRevision) {
          return;
        }
        const card = buildDeterministicCard(offer, subjects);
        const interventionId = await insertIntervention(db, {
          kind: offer.type === 'confusion_pair' ? 'confusion_pair' : 'mistake_lens',
          subjectIds:
            offer.type === 'confusion_pair'
              ? [offer.evidence.subjectId, ...offer.evidence.matches.map((m) => m.otherSubjectId)]
              : [offer.evidence.subjectId],
          evidenceHash: offer.evidenceHash,
          state: 'offered',
          payloadJson: JSON.stringify(card),
        });
        if (feedbackRevisionRef.current !== feedbackRevision) {
          return;
        }
        offeredSubjectTasksRef.current.add(offerKey);
        lastOfferRef.current = offer;
        setLensInterventionId(interventionId);
        setLensCard(card);
        setLensGeneratedText('');
        setLensError(null);
      } catch (error) {
        void logErrorBestEffort('warn', error, 'ReviewSessionScreen.recordAttempt');
      }
    })();
  };

  const handleAnkiMark = (correct: boolean) => {
    if (!session || !currentItem || feedback) {
      return;
    }

    const answeredTaskType = taskType ?? 'meaning';
    const markResult = session.markAnswer(correct);
    setLastMarkResult(markResult);
    setFeedback({
      correct,
      item: currentItem,
      taskType: answeredTaskType,
      subjectFinished: markResult.subjectFinished,
      message: correct ? 'Correct' : 'Incorrect',
      detail: correct
        ? 'Nice work — continue to the next prompt.'
        : correctAnswerText(currentItem, answeredTaskType),
    });
    maybeAutoplayAudio(currentItem, answeredTaskType, correct);
    setAnkiRevealed(false);
    setRevision((r) => r + 1);

    const sessionId = sessionIdRef.current;
    const subjectId = currentItem.subjectId;
    const assignmentId = currentItem.assignmentId;
    const srsStageBefore = currentItem.srsStage;
    const feedbackRevision = ++feedbackRevisionRef.current;
    const persistence = (async () => {
      const db = await openAppDatabase();
      return recordAttempt(db, {
        sessionId,
        subjectId,
        assignmentId,
        source: attemptSource(practiceSource),
        taskType: answeredTaskType,
        normalizedAnswer: null,
        resultKind: correct ? 'anki_correct' : 'anki_incorrect',
        scoredCorrect: correct,
        srsStageBefore,
      });
    })();
    pendingAttemptIdRef.current = persistence.catch(() => null);
    void persistence
      .then((id) => {
        if (feedbackRevisionRef.current === feedbackRevision) {
          lastAttemptIdRef.current = id;
        }
      })
      .catch((error) => {
        void logErrorBestEffort('warn', error, 'ReviewSessionScreen.recordAnkiAttempt');
      });
  };

  const changeAnswer = (text: string) => {
    clearGuidance();
    setAnswer(taskType === 'reading' ? convertRomajiToKanaInput(text) : text);
  };

  const continueSession = async () => {
    if (!session || !feedback || isContinuing) {
      return;
    }

    setIsContinuing(true);
    feedbackRevisionRef.current += 1;
    setError(null);

    try {
      // Queue a finished review only after the feedback decision is final, so
      // overrides, synonyms, and "ask again later" cannot create stale writes.
      if (feedback.subjectFinished) {
        await persistFinishedReview(feedback.item);
      }
      cancelGeneration();
      setMistakeCoachText('');
      setMistakeCoachError(null);
      setMistakeCoachRunning(false);
      setLensCard(null);
      setLensInterventionId(null);
      setLensGeneratedText('');
      setLensError(null);
      setLensRunning(false);
      lastOfferRef.current = null;
      setFeedback(null);
      setAnswer('');
      setLastMarkResult(null);
      lastAttemptIdRef.current = null;
      pendingAttemptIdRef.current = null;
      setAnkiRevealed(false);
      setAudioMessage(null);
      session.nextTask();
      setRevision((r) => r + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsContinuing(false);
    }
  };

  const handleOverrideCorrect = () => {
    if (!session || !feedback || feedback.correct || isContinuing) {
      return;
    }

    feedbackRevisionRef.current += 1;
    const attemptIdPromise = pendingAttemptIdRef.current;
    cancelGeneration();
    setMistakeCoachText('');
    setMistakeCoachError(null);
    setMistakeCoachRunning(false);
    setLensCard(null);
    setLensInterventionId(null);
    setLensGeneratedText('');
    setLensError(null);
    setLensRunning(false);
    lastOfferRef.current = null;
    const result = session.overrideCorrect();
    if (attemptIdPromise) {
      void attemptIdPromise.then(async (attemptId) => {
        if (attemptId == null) {
          return;
        }
        try {
          const db = await openAppDatabase();
          await markAttemptOverridden(db, attemptId);
        } catch (error) {
          void logErrorBestEffort('warn', error, 'ReviewSessionScreen.markAttemptOverridden');
        }
      });
    }
    setLastMarkResult(result);
    setFeedback({
      ...feedback,
      correct: true,
      subjectFinished: result.subjectFinished,
      message: 'Marked correct',
      detail: 'Nice work — continue to the next prompt.',
    });
    setRevision((r) => r + 1);
  };

  const handleAskAgainLater = async () => {
    if (!session || !feedback || isContinuing) {
      return;
    }

    setIsContinuing(true);
    feedbackRevisionRef.current += 1;
    const attemptIdPromise = pendingAttemptIdRef.current;
    setError(null);

    try {
      cancelGeneration();
      setMistakeCoachText('');
      setMistakeCoachError(null);
      setMistakeCoachRunning(false);
      setLensCard(null);
      setLensInterventionId(null);
      setLensGeneratedText('');
      setLensError(null);
      setLensRunning(false);
      lastOfferRef.current = null;
      session.moveActiveTaskToEnd();
      const attemptId = await attemptIdPromise;
      if (attemptId != null) {
        const db = await openAppDatabase();
        await discardAttempt(db, attemptId);
      }
      lastAttemptIdRef.current = null;
      pendingAttemptIdRef.current = null;
      setFeedback(null);
      setAnswer('');
      setLastMarkResult(null);
      setAnkiRevealed(false);
      setAudioMessage(null);
      session.nextTask();
      setRevision((r) => r + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsContinuing(false);
    }
  };

  const handleAddSynonym = async () => {
    if (!session || !feedback || feedback.correct || isContinuing) {
      return;
    }
    if (feedback.taskType !== 'meaning' || !answer.trim()) {
      return;
    }

    setIsContinuing(true);
    feedbackRevisionRef.current += 1;
    const attemptIdPromise = pendingAttemptIdRef.current;
    setError(null);

    try {
      cancelGeneration();
      setMistakeCoachText('');
      setMistakeCoachError(null);
      setMistakeCoachRunning(false);
      const item = feedback.item;
      const synonym = answer.trim();
      const result = session.addSynonym(synonym);
      const attemptId = await attemptIdPromise;
      if (attemptId != null) {
        const db = await openAppDatabase();
        await markAttemptOverridden(db, attemptId);
      }
      setLastMarkResult(result);
      setFeedback({
        ...feedback,
        correct: true,
        subjectFinished: result.subjectFinished,
        message: 'Synonym added',
        detail: 'Your answer was saved as a synonym and marked correct.',
      });

      const db = await openAppDatabase();
      await queueStudyMaterialUpdate(db, {
        subjectId: item.subjectId,
        meaningSynonyms: item.studyMaterials?.meaningSynonyms ?? [synonym],
      });

      setRevision((r) => r + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsContinuing(false);
    }
  };

  const wrapUp = () => {
    if (!session || feedback || session.wrappingUp || !session.canWrapUp) {
      return;
    }
    session.setWrappingUp(true);
    session.nextTask();
    setRevision((r) => r + 1);
  };

  const handleQuickWrapUp = () => {
    setQuickSettingsOpen(false);
    if (!feedback) {
      wrapUp();
    }
  };

  const handleEndSession = () => {
    setQuickSettingsOpen(false);
    cancelGeneration();
    setAudioMessage(null);
    allowLeavingRef.current = true;
    navigation.goBack();
  };

  const enableCheats = settings.enableCheats;
  const showCheats = Boolean(enableCheats && feedback && !feedback.correct);
  const canAddSynonym = Boolean(showCheats && feedback?.taskType === 'meaning' && answer.trim().length > 0);
  const showExplainMistake = Boolean(
    showCheats &&
      studyCoachEnabled &&
      (coachStatus === 'ready' ||
        coachStatus === 'loaded' ||
        coachStatus === 'loading' ||
        coachStatus === 'generating' ||
        coachStatus === 'error'),
  );

  const handleExplainMistake = async () => {
    if (!feedback || feedback.correct || mistakeCoachRunning) {
      return;
    }
    setMistakeCoachRunning(true);
    setMistakeCoachError(null);
    setMistakeCoachText('');
    try {
      const components = subjectDetailData
        ? [...subjectDetailData.componentSubjects.values()]
        : undefined;
      const result = await runCoachAction({
        action: 'why_wrong',
        subject: feedback.item.subject,
        studyMaterial: subjectDetailData?.studyMaterial,
        componentSubjects: components,
        taskType: feedback.taskType,
        userAnswer: answer,
        onToken: (soFar) => setMistakeCoachText(soFar),
      });
      setMistakeCoachText(result.text);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (!/cancel/i.test(message)) {
        setMistakeCoachError(message);
      }
    } finally {
      setMistakeCoachRunning(false);
    }
  };

  const handleLensGenerate = async () => {
    if (!lensCard || !feedback || lensRunning) {
      return;
    }
    const offer = lastOfferRef.current;
    setLensRunning(true);
    setLensError(null);
    setLensGeneratedText('');
    if (lensInterventionId != null) {
      void openAppDatabase()
        .then((db) => updateInterventionState(db, lensInterventionId, 'generating'))
        .catch((error) => {
          void logErrorBestEffort('warn', error, 'ReviewSessionScreen.lensGenerating');
        });
    }
    try {
      const factRefs = [
        'facts.entered_answer',
        'facts.accepted_meanings',
        'facts.accepted_readings',
        'facts.miss_count',
        'facts.recent_answers',
        'facts.pair.other_japanese',
        'facts.pair.other_primary_meaning',
        'facts.pair.other_accepted_meanings',
        'facts.pair.other_accepted_readings',
        'facts.pair.wrong_answer',
        'facts.pair.task_type',
      ];
      const pairSubject =
        offer?.type === 'confusion_pair' && !offer.ambiguous && offer.evidence.matches[0]
          ? (await openAppDatabase().then((db) =>
              loadSubjectsForOffer(db, offer),
            )).get(offer.evidence.matches[0]!.otherSubjectId)
          : undefined;
      const result = await runCoachAction({
        action: 'mistake_lens',
        subject: feedback.item.subject,
        studyMaterial: subjectDetailData?.studyMaterial,
        componentSubjects: subjectDetailData
          ? [...subjectDetailData.componentSubjects.values()]
          : undefined,
        taskType: feedback.taskType,
        userAnswer: answer,
        evidence: {
          missCount: lensCard.missCount,
          recentAnswers: offer?.type === 'mistake_lens' ? offer.evidence.recentAnswers : undefined,
          pair:
            offer?.type === 'confusion_pair' && pairSubject
              ? {
                  otherSubject: pairSubject,
                  wrongAnswer: offer.evidence.wrongAnswer,
                  taskType: offer.evidence.taskType,
                }
              : undefined,
          factRefAllowlist: factRefs,
        },
        onToken: (soFar) => setLensGeneratedText(soFar),
      });
      setLensGeneratedText(result.text);
      if (lensInterventionId != null) {
        void openAppDatabase()
          .then((db) =>
            updateInterventionState(db, lensInterventionId, 'shown', {
              payloadJson: JSON.stringify({
                card: lensCard,
                structured: result.structured ?? null,
                text: result.text,
              }),
            }),
          )
          .catch((error) => {
            void logErrorBestEffort('warn', error, 'ReviewSessionScreen.lensShown');
          });
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (!/cancel/i.test(message)) {
        setLensError(message);
        if (lensInterventionId != null) {
          void openAppDatabase()
            .then((db) => updateInterventionState(db, lensInterventionId, 'failed'))
            .catch((error) => {
              void logErrorBestEffort('warn', error, 'ReviewSessionScreen.lensFailed');
            });
        }
      }
    } finally {
      setLensRunning(false);
    }
  };

  const handleLensNotNow = () => {
    if (lensInterventionId != null) {
      void openAppDatabase()
        .then((db) => updateInterventionState(db, lensInterventionId, 'skipped'))
        .catch((error) => {
          void logErrorBestEffort('warn', error, 'ReviewSessionScreen.lensSkipped');
        });
    }
    setLensCard(null);
    setLensInterventionId(null);
    setLensGeneratedText('');
    setLensError(null);
    setLensRunning(false);
    lastOfferRef.current = null;
  };

  const handleLensHelpful = (helpful: boolean) => {
    if (lensInterventionId != null) {
      void openAppDatabase()
        .then((db) =>
          updateInterventionState(db, lensInterventionId, 'shown', { helpful }),
        )
        .catch((error) => {
          void logErrorBestEffort('warn', error, 'ReviewSessionScreen.lensHelpful');
        });
    }
  };

  if (isLoading) {
    return <CenteredMessage label={practiceSource ? 'Loading practice...' : 'Loading reviews...'} />;
  }

  if (error && !displayItem && !isComplete) {
    return (
      <CenteredMessage label={error} actionLabel="Back" onAction={() => navigation.goBack()} />
    );
  }

  if (isComplete) {
    const rate = session?.successRateText ?? '100%';
    const completed = session?.reviewsCompleted ?? 0;
    return (
      <ReviewSummary
        completed={completed}
        successRate={rate}
        completedItems={completedItems}
        wrappedUp={session?.wrappingUp ?? false}
        onBack={() => navigation.goBack()}
      />
    );
  }

  if (!displayItem) {
    return (
      <CenteredMessage
        label={emptyStateLabel(practiceSource)}
        actionLabel="Back"
        onAction={() => navigation.goBack()}
      />
    );
  }

  const acceptedMeanings = displayItem.subject.meanings
    .filter((m) => m.acceptedAnswer !== false && m.type !== 'blacklist')
    .map((m) => m.meaning)
    .join(', ');
  const acceptedReadings = displayItem.subject.readings
    ?.filter((r) => r.acceptedAnswer !== false)
    .map((r) => r.reading)
    .join(', ') ?? '';
  const showsReadingInAnki = Boolean(acceptedReadings);
  return (
    <ScreenLayout
      scrollable
      keyboardShouldPersistTaps
      keyboardAvoiding
      scrollViewRef={scrollViewRef}
      footer={
        <FloatingReviewPill
          subjectColor={subjectColor}
          visible={showPill}
          feedback={feedback ? { correct: feedback.correct, message: feedback.message, detail: feedback.detail } : null}
          isContinuing={isContinuing}
          ankiMode={ankiMode}
          ankiRevealed={ankiRevealed}
          answerEmpty={!answer.trim()}
          canWrapUp={session?.canWrapUp ?? false}
          wrappingUp={session?.wrappingUp ?? false}
          showCheats={showCheats}
          canAddSynonym={canAddSynonym}
          isOffline={isOffline}
          isVocabulary={isVocabulary}
          onSubmit={submit}
          onContinue={continueSession}
          onAnkiMark={handleAnkiMark}
          onWrapUp={wrapUp}
          onPlayAudio={() => displayItem && playAudioForItem(displayItem)}
          onOverrideCorrect={handleOverrideCorrect}
          onAskAgainLater={handleAskAgainLater}
          onAddSynonym={handleAddSynonym}
          showExplainMistake={showExplainMistake}
          onExplainMistake={() => {
            void handleExplainMistake();
          }}
        />
      }
      overlay={
        <ConfirmLeaveBanner
          visible={confirmLeave}
          title="End review session?"
          message="Progress from this active session may be lost if you leave now."
          cancelLabel="Keep reviewing"
          confirmLabel="End session"
          onCancel={handleCancelLeave}
          onConfirm={handleConfirmLeave}
        />
      }
    >
      <SessionHeader
        onBack={handleBack}
        progress={{
          label: `Review ${reviewPosition} of ${session?.totalReviews ?? 0}`,
          current: reviewPosition,
          total: session?.totalReviews ?? 0,
        }}
        dimmed={confirmLeave}
        onSettings={() => setQuickSettingsOpen(true)}
      />

      <SubjectHeroCard
        kicker={ankiMode && showsReadingInAnki ? 'Meaning + Reading' : displayTaskType === 'meaning' ? 'Meaning' : 'Reading'}
        japanese={displayItem.subject.japanese}
        characterImageUrl={displayItem.subject.characterImageUrl}
        characterImageIsSvg={displayItem.subject.characterImageIsSvg}
        subjectType={displayItem.subjectType}
        level={displayItem.level}
        color={subjectColor}
        compact
      />

      {ankiMode ? (
        ankiRevealed && !feedback ? (
          <View
            className="rounded-lg border-2 bg-surface-elevated dark:bg-surface-elevated-dark p-[16px] gap-1"
            style={{ borderColor: subjectColor }}
          >
            <Text className="text-text-muted dark:text-text-muted-dark text-[13px] font-black uppercase">
              Meaning
            </Text>
            <Text className="text-text dark:text-text-dark text-xl font-black">{acceptedMeanings}</Text>
            {showsReadingInAnki ? (
              <>
                <Text className="text-text-muted dark:text-text-muted-dark text-[13px] font-black uppercase mt-2">Reading</Text>
                <Text className="text-text dark:text-text-dark text-xl font-black">{acceptedReadings}</Text>
              </>
            ) : null}
          </View>
        ) : null
      ) : (
        <TextInput
          value={answer}
          onChangeText={(text) => {
            if (!feedback) {
              changeAnswer(text);
            }
          }}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect={false}
          spellCheck={false}
          importantForAutofill="no"
          keyboardType="default"
          placeholder={displayTaskType === 'meaning' ? 'Type the meaning' : '答え'}
          placeholderTextColor={colors.mutedText}
          className="min-h-[58px] rounded-lg border border-border dark:border-border-dark bg-surface-elevated dark:bg-surface-elevated-dark text-text dark:text-text-dark px-[16px] text-lg font-bold"
          onFocus={() => {
            scrollViewRef.current?.scrollToEnd({ animated: true });
          }}
          returnKeyType="next"
          submitBehavior="submit"
          accessibilityLabel={displayTaskType === 'meaning' ? 'Review meaning answer' : 'Review reading answer'}
          accessibilityHint={guidanceMessage ? `${guidanceMessage}. Edit your answer and submit again.` : 'Enter your answer for the current review prompt.'}
          onSubmitEditing={feedback ? continueSession : submit}
        />
      )}

      {error ? (
        <Text className="text-danger dark:text-danger-dark font-heavy">{error}</Text>
      ) : null}

      {audioMessage ? (
        <Text className="text-text-muted dark:text-text-muted-dark font-heavy">{audioMessage}</Text>
      ) : null}

      {guidanceMessage && !feedback ? (
        <Text
          accessibilityLiveRegion="polite"
          className="text-warning dark:text-warning-dark font-heavy"
        >
          {guidanceMessage}
        </Text>
      ) : null}

      {lensCard && feedback && !feedback.correct ? (
        <MistakeLensCard
          card={lensCard}
          generatedText={lensGeneratedText}
          isRunning={lensRunning}
          error={lensError}
          canGenerate={Boolean(
            studyCoachEnabled &&
              (coachStatus === 'ready' ||
                coachStatus === 'loaded' ||
                coachStatus === 'loading' ||
                coachStatus === 'generating' ||
                coachStatus === 'error'),
          )}
          onGenerate={() => {
            void handleLensGenerate();
          }}
          onNotNow={handleLensNotNow}
          onHelpful={() => handleLensHelpful(true)}
          onNotHelpful={() => handleLensHelpful(false)}
          onPracticePair={
            lensCard.otherSubjectId != null
              ? () => {
                  navigation.push('ReviewSession', {
                    practiceSource: 'subjectIds',
                    subjectIds: [lensCard.subjectId, lensCard.otherSubjectId!],
                  });
                }
              : undefined
          }
        />
      ) : null}

      {(mistakeCoachText || mistakeCoachRunning || mistakeCoachError) && feedback && !feedback.correct ? (
        <CoachMistakeCard
          text={mistakeCoachText}
          isRunning={mistakeCoachRunning}
          error={mistakeCoachError}
          subjectLookup={mistakeSubjectLookup}
          onDismiss={() => {
            cancelGeneration();
            setMistakeCoachText('');
            setMistakeCoachError(null);
            setMistakeCoachRunning(false);
          }}
        />
      ) : null}
      {feedback && subjectDetailData && displayItem ? (
        showAllDetails || appSettings.showFullAnswer ? (
          <SubjectDetailsContent
            subject={displayItem.subject}
            componentSubjects={subjectDetailData.componentSubjects}
            amalgamationSubjects={subjectDetailData.amalgamationSubjects}
            studyMaterial={subjectDetailData.studyMaterial}
            meaningAttempted={true}
            readingAttempted={true}
            showFullAnswer={true}
            isReview={true}
            useKatakanaForOnyomi={appSettings.useKatakanaForOnyomi}
            showAllReadings={appSettings.showAllReadings}
            onNavigateToSubject={(id) => navigation.navigate('SubjectDetail', { subjectId: id })}
          />
        ) : (
          <InlineReviewDetails
            item={displayItem}
            taskType={feedback.taskType}
            subjectDetailData={subjectDetailData}
            onShowAll={() => setShowAllDetails(true)}
            onNavigateToSubject={(id) => navigation.navigate('SubjectDetail', { subjectId: id })}
            appSettings={appSettings}
          />
        )
      ) : null}

      <ReviewQuickSettings
        visible={quickSettingsOpen}
        onClose={() => setQuickSettingsOpen(false)}
        onEndSession={handleEndSession}
        onWrapUp={handleQuickWrapUp}
        canWrapUp={session?.canWrapUp ?? false}
        wrappingUp={session?.wrappingUp ?? false}
        hasFeedback={feedback !== null}
        remainingInBatch={session?.activeQueueLength ?? 0}
      />
    </ScreenLayout>
  );
}

function ReviewSummary({
  completed,
  successRate,
  completedItems,
  wrappedUp,
  onBack,
}: {
  completed: number;
  successRate: string;
  completedItems: readonly ReviewItem[];
  wrappedUp: boolean;
  onBack: () => void;
}) {
  const incorrectItems = completedItems.filter((item) => item.meaningWrongCount > 0 || item.readingWrongCount > 0);
  const incorrectByLevel = groupIncorrectByLevel(incorrectItems);

  return (
    <ScreenLayout scrollable>
      <SessionHeader onBack={onBack} progress="Complete" />

      <View className="min-h-[210px] rounded-5xl items-center justify-center p-6 bg-kanji">
        <Text className="text-white text-[14px] font-black tracking-ultra4 uppercase">
          {wrappedUp ? 'Wrap-Up Complete' : 'Reviews Complete'}
        </Text>
        <Text className="mt-2.5 text-white text-6xl font-black">{successRate}</Text>
        <Text className="text-white text-[16px] font-heavy" style={{ opacity: 0.86 }}>
          {completed} reviews completed
        </Text>
      </View>

      <View className="flex-row gap-3">
        <SummaryStat label="Correct" value={String(Math.max(0, completedItems.length - incorrectItems.length))} />
        <SummaryStat label="Needs Review" value={String(incorrectItems.length)} />
      </View>

      <View className="rounded-[24px] p-[18px] bg-surface-elevated dark:bg-surface-elevated-dark border border-border dark:border-border-dark gap-3">
        <Text className="text-text dark:text-text-dark text-lg font-black">Incorrect Items</Text>
        {incorrectByLevel.length ? (
          incorrectByLevel.map((group) => (
            <View key={group.level} className="gap-2">
              <Text className="text-text-muted dark:text-text-muted-dark text-[13px] font-black uppercase">{group.level}</Text>
              {group.items.map((item) => (
                <View key={item.assignmentId} className="flex-row justify-between gap-3 rounded-md p-3 bg-surface dark:bg-surface-dark">
                  <Text className="flex-1 text-text dark:text-text-dark text-base font-black">
                    {primaryMeaning(item) || item.subject.japanese || item.subjectType}
                  </Text>
                  <Text className="text-text-muted dark:text-text-muted-dark text-[13px] font-heavy">
                    {wrongCountText(item)}
                  </Text>
                </View>
              ))}
            </View>
          ))
        ) : (
          <Text className="text-text-muted dark:text-text-muted-dark text-base font-bold">No incorrect answers this session.</Text>
        )}
      </View>

      <Pressable
        onPress={onBack}
        className="min-h-[54px] items-center justify-center rounded-lg px-[18px] bg-kanji"
        style={({ pressed }) => pressed ? { opacity: 0.58 } : undefined}
      >
        <Text className="text-white text-[16px] font-black">Back to Dashboard</Text>
      </Pressable>
    </ScreenLayout>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 rounded-2xl p-[16px] bg-surface-elevated dark:bg-surface-elevated-dark border border-border dark:border-border-dark">
      <Text className="text-text dark:text-text-dark text-3xl font-black">{value}</Text>
      <Text className="mt-0.5 text-text-muted dark:text-text-muted-dark text-[13px] font-heavy uppercase">{label}</Text>
    </View>
  );
}

function groupIncorrectByLevel(items: ReviewItem[]) {
  const groups = new Map<string, ReviewItem[]>();
  for (const item of items) {
    const key = `Level ${item.level ?? '?'}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()].map(([level, groupItems]) => ({ level, items: groupItems }));
}

function primaryMeaning(item: ReviewItem) {
  return item.subject.meanings.find((meaning) => meaning.acceptedAnswer !== false && meaning.type !== 'blacklist')?.meaning;
}

function wrongCountText(item: ReviewItem) {
  const parts: string[] = [];
  if (item.meaningWrongCount > 0) {
    parts.push(`${item.meaningWrongCount} meaning`);
  }
  if (item.readingWrongCount > 0) {
    parts.push(`${item.readingWrongCount} reading`);
  }
  return parts.join(' · ');
}


function InlineReviewDetails({
  item,
  taskType,
  subjectDetailData,
  onShowAll,
  onNavigateToSubject,
  appSettings,
}: {
  item: ReviewItem;
  taskType: TaskType;
  subjectDetailData: {
    componentSubjects: Map<number, import('../domain/answers/answerChecker').SubjectAnswerData>;
    amalgamationSubjects: Map<number, import('../domain/answers/answerChecker').SubjectAnswerData>;
    studyMaterial: { meaningSynonyms: string[]; meaningNote: string; readingNote: string };
  };
  onShowAll: () => void;
  onNavigateToSubject: (subjectId: number) => void;
  appSettings: AppSettings;
}) {
  const meaningAttempted = taskType === 'meaning' || item.answeredMeaning || item.meaningWrong;
  const readingAttempted = taskType === 'reading' || item.answeredReading || item.readingWrong;

  const hasHidden = !meaningAttempted || !readingAttempted;

  return (
    <View className="gap-3">
      <SubjectDetailsContent
        subject={item.subject}
        componentSubjects={subjectDetailData.componentSubjects}
        amalgamationSubjects={subjectDetailData.amalgamationSubjects}
        studyMaterial={subjectDetailData.studyMaterial}
        meaningAttempted={meaningAttempted}
        readingAttempted={readingAttempted}
        showFullAnswer={false}
        isReview={true}
        useKatakanaForOnyomi={appSettings.useKatakanaForOnyomi}
        showAllReadings={appSettings.showAllReadings}
        onNavigateToSubject={onNavigateToSubject}
      />
      {hasHidden ? (
        <Pressable
          onPress={onShowAll}
          className="items-center py-2.5 rounded-full bg-[rgba(128,128,128,0.08)]"
          style={({ pressed }) => pressed ? { opacity: 0.72 } : undefined}
        >
          <Text className="text-[#666] text-[13px] font-heavy">Show all information</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
