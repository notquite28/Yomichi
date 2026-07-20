import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { AnswerCheckResult, checkAnswer, classifyAnswerResult, TaskType, SubjectAnswerData } from '../domain/answers/answerChecker';
import { convertRomajiToKanaInput } from '../domain/answers/kanaInput';
import { correctAnswerText, feedbackTitle } from '../domain/answers/feedbackMessages';
import { openAppDatabase } from '../domain/db/database';
import { AppSettings } from '../domain/settings/settings';
import { useSettingsStore } from '../domain/settings/settingsStore';
import {
  chunkLessonItems,
  getLessonItemsByIds,
  getLessonQueue,
  queueLessonStart,
  StudyQueueItem,
} from '../domain/study/studyRepository';
import { getSubjectsByIds } from '../domain/db/subjectRepository';
import {
  MarkResult,
  ReviewItem,
  ReviewSession,
  ReviewSessionSettings,
} from '../domain/study/reviewSession';
import { CenteredMessage, ScreenLayout, SessionHeader } from '../components/ScreenLayout';
import { ConfirmLeaveBanner } from '../components/ConfirmLeaveBanner';
import { LessonActionPill } from '../components/LessonActionPill';
import { useConfirmLeave } from '../hooks/useConfirmLeave';
import { useGuidanceMessage } from '../hooks/useGuidanceMessage';
import { SubjectHeroCard } from '../components/SubjectHeroCard';
import { RootStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/AppThemeProvider';
import { colorForSubjectType } from '../theme/subjectColors';

type Props = NativeStackScreenProps<RootStackParamList, 'LessonSession'>;
type LessonPhase = 'intro' | 'quiz';
type Feedback = {
  correct: boolean;
  message: string;
  detail: string;
  item: ReviewItem;
  taskType: TaskType;
  subjectFinished: boolean;
};

export function LessonSessionScreen({ navigation, route }: Props) {
  const { colors } = useAppTheme();
  const [queueItems, setQueueItems] = useState<StudyQueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const settings = useSettingsStore();

  const [phase, setPhase] = useState<LessonPhase>('intro');
  const [introIndex, setIntroIndex] = useState(0);
  const [componentSubjects, setComponentSubjects] = useState<Map<number, SubjectAnswerData>>(new Map());
  const [batchIndex, setBatchIndex] = useState(0);
  const [completedTasks, setCompletedTasks] = useState(0);
  const [completedTasksCorrectly, setCompletedTasksCorrectly] = useState(0);

  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const { guidanceMessage, showGuidance, clearGuidance } = useGuidanceMessage();
  const [isContinuing, setIsContinuing] = useState(false);

  const sessionRef = useRef<ReviewSession | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);

  const reviewSettings = useMemo<ReviewSessionSettings>(
    () => ({
      reviewOrder: settings.reviewOrder,
      reviewBatchSize: settings.reviewBatchSize,
      reviewItemsLimit: settings.reviewItemsLimit,
      reviewItemsLimitEnabled: settings.reviewItemsLimitEnabled,
      groupMeaningReading: settings.groupMeaningReading,
      meaningFirst: settings.meaningFirst,
      minimizeReviewPenalty: settings.minimizeReviewPenalty,
      enableCheats: false,
      ankiMode: false,
    }),
    [settings],
  );

  const subjectLookup = useMemo(
    () => {
      const map = new Map<number, SubjectAnswerData>();
      for (const item of queueItems) {
        map.set(item.subjectId, item.subject);
      }
      for (const [id, subject] of componentSubjects) {
        if (!map.has(id)) {
          map.set(id, subject);
        }
      }
      return map;
    },
    [queueItems, componentSubjects],
  );

  const lessonBatches = useMemo(
    () => chunkLessonItems(queueItems, settings.lessonBatchSize),
    [queueItems, settings.lessonBatchSize],
  );
  const activeBatch = lessonBatches[batchIndex] ?? [];

  useEffect(() => {
    let isMounted = true;
    const selectedIds = route.params?.selectedIds;
    const selectedSet = selectedIds ? new Set(selectedIds) : null;

    openAppDatabase()
      .then(async (db) => {
        const currentSettings = useSettingsStore.getState();
        const items = selectedSet && selectedSet.size > 0
          ? await getLessonItemsByIds(db, currentSettings, selectedSet)
          : await getLessonQueue(db, currentSettings, currentSettings.lessonSessionSize);
        if (isMounted) {
          setQueueItems(items);
        }
        const relatedSubjectIds = [
          ...new Set(
            items.flatMap((item) => [
              ...(item.subject.componentSubjectIds ?? []),
              ...(item.subject.amalgamationSubjectIds ?? []),
            ]),
          ),
        ].filter((id) => !items.some((i) => i.subjectId === id));
        if (relatedSubjectIds.length > 0) {
          const components = await getSubjectsByIds(db, relatedSubjectIds);
          if (isMounted) {
            setComponentSubjects(components);
          }
        }
      })
      .catch((caught: unknown) => {
        if (isMounted) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const startQuiz = () => {
    const session = new ReviewSession(activeBatch, reviewSettings, true);
    sessionRef.current = session;
    session.nextTask();
    setPhase('quiz');
  };

  const session = sessionRef.current;
  const currentItem = session?.currentItem ?? null;
  const taskType = session?.currentTaskType ?? null;
  const displayItem = feedback?.item ?? currentItem;
  const displayTaskType = feedback?.taskType ?? taskType;
  const isQuizComplete = phase === 'quiz' && !feedback && (session?.isComplete ?? false);
  const hasNextBatch = batchIndex < lessonBatches.length - 1;
  const quizProgress = session
    ? `${Math.min(session.reviewsCompleted + (feedback?.subjectFinished ? 0 : 1), session.totalReviews)}/${session.totalReviews}`
    : '0/0';
  const currentCompletedTasks = completedTasks + (session?.tasksAnswered ?? 0);
  const currentCompletedTasksCorrectly = completedTasksCorrectly + (session?.tasksAnsweredCorrectly ?? 0);
  const overallSuccessRate = currentCompletedTasks > 0
    ? `${Math.round((currentCompletedTasksCorrectly / currentCompletedTasks) * 100)}%`
    : '100%';
  const shouldConfirmLeave = phase === 'intro' || (phase === 'quiz' && !isQuizComplete);
  const { confirmLeave, handleBack, handleCancelLeave, handleConfirmLeave } =
    useConfirmLeave(navigation, shouldConfirmLeave);

  const submitQuizAnswer = () => {
    if (!session || !currentItem || feedback) {
      return;
    }
    if (!answer.trim()) {
      return;
    }

    const result = checkAnswer(answer, currentItem.subject, {
      taskType: taskType ?? 'meaning',
      studyMaterials: currentItem.studyMaterials,
      lookupSubject: (subjectId) => subjectLookup.get(subjectId),
      exactMatch: false,
    });
    const outcome = classifyAnswerResult(result);

    // Guidance results (wrong reading type, invalid characters, okurigana
    // mismatch, reading typed for a meaning prompt) are not scored: show the
    // hint and let the user answer again without recording a mistake.
    if (outcome === 'retry') {
      showGuidance(feedbackTitle(result));
      return;
    }

    const correct = outcome === 'correct';
    clearGuidance();
    const markResult = session.markAnswer(correct);
    setFeedback({
      correct,
      message: feedbackTitle(result),
      detail: correct
        ? 'Continue to the next prompt.'
        : correctAnswerText(currentItem, taskType ?? 'meaning'),
      item: currentItem,
      taskType: taskType ?? 'meaning',
      subjectFinished: markResult.subjectFinished,
    });
    if (markResult.subjectFinished) {
      const finished = session.completedItems[session.completedItems.length - 1];
      if (finished) {
        void openAppDatabase()
          .then((db) => queueLessonStart(db, finished.assignmentId))
          .catch((caught: unknown) => {
            setError(caught instanceof Error ? caught.message : String(caught));
          });
      }
    }
  };

  const continueQuiz = async () => {
    if (!session || !feedback || isContinuing) {
      return;
    }

    setIsContinuing(true);
    setError(null);

    try {
      // Lesson starts are queued as soon as the item finishes; Continue only advances UI.
      setFeedback(null);
      setAnswer('');
      clearGuidance();
      session.nextTask();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsContinuing(false);
    }
  };

  const changeAnswer = (text: string) => {
    clearGuidance();
    setAnswer(taskType === 'reading' ? convertRomajiToKanaInput(text) : text);
  };

  const continueToNextBatch = () => {
    if (!session || !isQuizComplete || !hasNextBatch) {
      return;
    }

    setCompletedTasks((value) => value + session.tasksAnswered);
    setCompletedTasksCorrectly((value) => value + session.tasksAnsweredCorrectly);
    sessionRef.current = null;
    setAnswer('');
    setFeedback(null);
    clearGuidance();
    setIntroIndex(0);
    setBatchIndex((value) => value + 1);
    setPhase('intro');
  };

  if (isLoading) {
    return <CenteredMessage label="Loading lessons..." />;
  }

  if (error && queueItems.length === 0 && phase === 'intro') {
    return (
      <CenteredMessage label={error} actionLabel="Back" onAction={() => navigation.goBack()} />
    );
  }

  if (queueItems.length === 0) {
    return (
      <CenteredMessage
        label="No lessons are available in the local cache."
        actionLabel="Back"
        onAction={() => navigation.goBack()}
      />
    );
  }

  if (phase === 'intro') {
    return (
      <IntroPhase
        items={activeBatch}
        index={introIndex}
        batchIndex={batchIndex}
        batchCount={lessonBatches.length}
        onIndexChange={setIntroIndex}
        onStartQuiz={startQuiz}
        onBack={handleBack}
        subjectLookup={subjectLookup}
        dimmed={confirmLeave}
        confirmLeaveBanner={
          <ConfirmLeaveBanner
            visible={confirmLeave}
            title="End lesson session?"
            message="Progress from this active lesson session may be lost if you leave now."
            cancelLabel="Keep learning"
            confirmLabel="End session"
            onCancel={handleCancelLeave}
            onConfirm={handleConfirmLeave}
          />
        }
      />
    );
  }

  if (isQuizComplete) {
    const completedInBatch = session?.reviewsCompleted ?? 0;
    const completedBeforeBatch = lessonBatches
      .slice(0, batchIndex)
      .reduce((total, batch) => total + batch.length, 0);
    return (
      <LessonQuizSummary
        completed={hasNextBatch ? completedInBatch : completedBeforeBatch + completedInBatch}
        successRate={overallSuccessRate}
        totalItems={hasNextBatch ? activeBatch.length : queueItems.length}
        batchIndex={batchIndex}
        batchCount={lessonBatches.length}
        hasNextBatch={hasNextBatch}
        onContinue={continueToNextBatch}
        onBack={() => navigation.goBack()}
      />
    );
  }

  if (!displayItem) {
    return (
      <CenteredMessage
        label="No quiz items available."
        actionLabel="Back"
        onAction={() => navigation.goBack()}
      />
    );
  }

  const subjectColor = colorForSubjectType(colors, displayItem.subjectType);

  return (
    <ScreenLayout
      scrollable
      keyboardShouldPersistTaps
      keyboardAvoiding
      scrollViewRef={scrollViewRef}
      footer={
        <LessonActionPill
          subjectColor={subjectColor}
          feedback={feedback ? { correct: feedback.correct, message: feedback.message, detail: feedback.detail } : null}
          isContinuing={isContinuing}
          answerEmpty={!answer.trim()}
          onSubmit={submitQuizAnswer}
          onContinue={continueQuiz}
        />
      }
      overlay={
        <ConfirmLeaveBanner
          visible={confirmLeave}
          title="End lesson session?"
          message="Progress from this active lesson session may be lost if you leave now."
          cancelLabel="Keep learning"
          confirmLabel="End session"
          onCancel={handleCancelLeave}
          onConfirm={handleConfirmLeave}
        />
      }
    >
      <SessionHeader
        onBack={handleBack}
        progress={`Quiz ${quizProgress}`}
        dimmed={confirmLeave}
      />

      <SubjectHeroCard
        kicker={displayTaskType === 'meaning' ? 'Meaning' : 'Reading'}
        japanese={displayItem.subject.japanese}
        characterImageUrl={displayItem.subject.characterImageUrl}
        characterImageIsSvg={displayItem.subject.characterImageIsSvg}
        subjectType={displayItem.subjectType}
        level={displayItem.level}
        color={subjectColor}
        compact
      />

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
        accessibilityLabel={displayTaskType === 'meaning' ? 'Lesson meaning answer' : 'Lesson reading answer'}
        accessibilityHint="Enter your answer for the current lesson quiz prompt."
        onSubmitEditing={feedback ? continueQuiz : submitQuizAnswer}
      />

      {error ? (
        <Text className="text-danger dark:text-danger-dark font-heavy">{error}</Text>
      ) : null}

      {guidanceMessage && !feedback ? (
        <Text className="text-warning dark:text-warning-dark font-heavy">{guidanceMessage}</Text>
      ) : null}

    </ScreenLayout>
  );
}

function IntroPhase({
  items,
  index,
  batchIndex,
  batchCount,
  onIndexChange,
  onStartQuiz,
  onBack,
  subjectLookup,
  confirmLeaveBanner,
  dimmed,
}: {
  items: StudyQueueItem[];
  index: number;
  batchIndex: number;
  batchCount: number;
  onIndexChange: (index: number) => void;
  onStartQuiz: () => void;
  onBack: () => void;
  subjectLookup: Map<number, SubjectAnswerData>;
  confirmLeaveBanner?: React.ReactNode;
  dimmed?: boolean;
}) {
  const { colors } = useAppTheme();
  const item = items[index];
  if (!item) {
    return null;
  }

  const subjectColor = colorForSubjectType(colors, item.subjectType);
  const isLast = index === items.length - 1;
  const progress = batchCount > 1
    ? `Batch ${batchIndex + 1}/${batchCount} · ${index + 1}/${items.length}`
    : `${index + 1}/${items.length}`;

  return (
    <ScreenLayout scrollable overlay={confirmLeaveBanner}>
      <SessionHeader onBack={onBack} progress={progress} dimmed={dimmed} />

      <View className="flex-row flex-wrap gap-1.5">
        {items.map((chipItem, chipIndex) => {
          const chipColor = colorForSubjectType(colors, chipItem.subjectType);
          const isActive = chipIndex === index;
          return (
            <Pressable
              key={chipItem.subjectId}
              onPress={() => onIndexChange(chipIndex)}
              className="rounded-[12px] px-2.5 py-1.5 border"
              style={{
                backgroundColor: isActive ? chipColor : colors.surface,
                borderColor: isActive ? chipColor : colors.border,
              }}
            >
              <Text
                className="text-[14px] font-black"
                style={{ color: isActive ? '#ffffff' : colors.mutedText }}
              >
                {chipItem.subject.japanese || '?'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <SubjectHeroCard
        kicker={subjectTypeLabel(item.subjectType)}
        japanese={item.subject.japanese}
        characterImageUrl={item.subject.characterImageUrl}
        characterImageIsSvg={item.subject.characterImageIsSvg}
        subjectType={item.subjectType}
        level={item.level}
        color={subjectColor}
        minHeight={200}
      />

      <DetailSections item={item} subjectLookup={subjectLookup} />

      <View className="flex-row gap-3">
        <Pressable
          disabled={index === 0}
          onPress={() => onIndexChange(index - 1)}
          className={`flex-1 min-h-[52px] items-center justify-center rounded-lg border border-border dark:border-border-dark bg-surface dark:bg-surface-dark ${index === 0 ? 'opacity-40' : ''}`}
          style={({ pressed }) => pressed ? { opacity: index === 0 ? 0.4 : 0.58 } : undefined}
        >
          <Text
            className={`text-base font-black ${index === 0 ? 'text-text-muted dark:text-text-muted-dark' : 'text-text dark:text-text-dark'}`}
          >
            Back
          </Text>
        </Pressable>

        {isLast ? (
          <Pressable
            onPress={onStartQuiz}
            className="flex-1 min-h-[52px] items-center justify-center rounded-lg px-[18px]"
            style={({ pressed }) => [
              { backgroundColor: subjectColor },
              pressed && { opacity: 0.58 },
            ]}
          >
            <Text className="text-white text-base font-black">Start Quiz</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => onIndexChange(index + 1)}
            className="flex-1 min-h-[52px] items-center justify-center rounded-lg px-[18px]"
            style={({ pressed }) => [
              { backgroundColor: subjectColor },
              pressed && { opacity: 0.58 },
            ]}
          >
            <Text className="text-white text-base font-black">Next</Text>
          </Pressable>
        )}
      </View>
    </ScreenLayout>
  );
}

function DetailSections({
  item,
  subjectLookup,
}: {
  item: StudyQueueItem;
  subjectLookup: Map<number, SubjectAnswerData>;
}) {
  const { colors } = useAppTheme();
  const { subject } = item;
  const subjectType = item.subjectType;

  const primaryMeanings = subject.meanings
    .filter((m) => m.acceptedAnswer !== false && m.type !== 'blacklist' && m.type === 'primary')
    .map((m) => m.meaning);
  const secondaryMeanings = subject.meanings
    .filter((m) => m.acceptedAnswer !== false && m.type !== 'blacklist' && m.type !== 'primary')
    .map((m) => m.meaning);

  const primaryReadings = subject.readings
    ?.filter((r) => r.primary)
    .map((r) => r.reading) ?? [];
  const alternateReadings = subject.readings
    ?.filter((r) => !r.primary && r.acceptedAnswer !== false)
    .map((r) => r.reading) ?? [];

  const componentNames = (subject.componentSubjectIds ?? [])
    .map((id) => subjectLookup.get(id))
    .filter((s): s is SubjectAnswerData => s != null);

  const amalgamationNames = (subject.amalgamationSubjectIds ?? [])
    .slice(0, 10)
    .map((id) => subjectLookup.get(id))
    .filter((s): s is SubjectAnswerData => s != null);

  return (
    <View className="gap-4">
      <DetailSection title="Meaning">
        <Text className="text-[16px] leading-[22px] font-heavy text-text dark:text-text-dark">
          {primaryMeanings.join(', ')}
        </Text>
        {secondaryMeanings.length > 0 ? (
          <Text className="text-[14px] font-bold text-text-muted dark:text-text-muted-dark">
            {secondaryMeanings.join(', ')}
          </Text>
        ) : null}
      </DetailSection>

      {primaryReadings.length > 0 ? (
        <DetailSection title="Reading">
          <Text className="text-[16px] leading-[22px] font-heavy text-text dark:text-text-dark">
            {primaryReadings.join(', ')}
          </Text>
          {alternateReadings.length > 0 ? (
            <Text className="text-[14px] font-bold text-text-muted dark:text-text-muted-dark">
              {alternateReadings.join(', ')}
            </Text>
          ) : null}
        </DetailSection>
      ) : null}

      {componentNames.length > 0 ? (
        <DetailSection title={subjectType === 'kanji' ? 'Radical Combination' : 'Kanji'}>
          <View className="flex-row flex-wrap gap-2 items-center">
            {componentNames.map((comp, idx) => {
              const compMeaning = comp.meanings
                .find((m) => m.type === 'primary' && m.acceptedAnswer !== false)?.meaning;
              const compColor = colorForSubjectType(colors, comp.type);
              return (
                <View key={comp.id ?? comp.japanese} className="flex-row items-center gap-1.5">
                  {idx > 0 ? (
                    <Text className="text-[16px] font-heavy text-text-muted dark:text-text-muted-dark">+</Text>
                  ) : null}
                  <View
                    className="rounded-[10px] px-3 py-1.5 bg-surface dark:bg-surface-dark border-[1.5px]"
                    style={{ borderColor: compColor }}
                  >
                    <ComponentChipContent subject={comp} color={compColor} />
                  </View>
                  {compMeaning ? (
                    <Text className="text-[14px] font-bold text-text dark:text-text-dark">{compMeaning}</Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        </DetailSection>
      ) : null}

      {subject.meaningMnemonic ? (
        <DetailSection
          title={subjectType === 'radical' ? 'Mnemonic' : 'Meaning Explanation'}
        >
          <MnemonicText text={subject.meaningMnemonic} subjectLookup={subjectLookup} />
          {subject.meaningHint ? (
            <Text className="text-[13px] italic font-bold text-text-muted dark:text-text-muted-dark mt-1">
              Hint: {subject.meaningHint}
            </Text>
          ) : null}
        </DetailSection>
      ) : null}

      {subject.readingMnemonic ? (
        <DetailSection title="Reading Explanation">
          <MnemonicText text={subject.readingMnemonic} subjectLookup={subjectLookup} />
          {subject.readingHint ? (
            <Text className="text-[13px] italic font-bold text-text-muted dark:text-text-muted-dark mt-1">
              Hint: {subject.readingHint}
            </Text>
          ) : null}
        </DetailSection>
      ) : null}

      {subject.contextSentences && subject.contextSentences.length > 0 ? (
        <DetailSection title="Context Sentences">
          {subject.contextSentences.map((sentence, idx) => (
            <View key={idx} className="gap-0.5">
              <Text className="text-base font-heavy text-text dark:text-text-dark">{sentence.ja}</Text>
              <Text className="text-[14px] font-bold text-text-muted dark:text-text-muted-dark">{sentence.en}</Text>
            </View>
          ))}
        </DetailSection>
      ) : null}

      {subject.partsOfSpeech && subject.partsOfSpeech.length > 0 ? (
        <DetailSection title="Part of Speech">
          <Text className="text-[16px] leading-[22px] font-heavy text-text dark:text-text-dark">
            {subject.partsOfSpeech.join(', ')}
          </Text>
        </DetailSection>
      ) : null}

      {amalgamationNames.length > 0 ? (
        <DetailSection title="Used In">
          <View className="flex-row flex-wrap gap-2 items-center">
            {amalgamationNames.map((amalgam) => {
              const amColor = colorForSubjectType(colors, amalgam.type);
              return (
                <View
                  key={amalgam.id ?? amalgam.japanese}
                  className="rounded-[10px] px-3 py-1.5 bg-surface dark:bg-surface-dark border-[1.5px]"
                  style={{ borderColor: amColor }}
                >
                  <ComponentChipContent subject={amalgam} color={amColor} />
                </View>
              );
            })}
          </View>
        </DetailSection>
      ) : null}
    </View>
  );
}

function ComponentChipContent({
  subject,
  color,
}: {
  subject: SubjectAnswerData;
  color: string;
}) {
  if (!subject.japanese && subject.characterImageUrl && !subject.characterImageIsSvg) {
    return (
      <Image
        source={{ uri: subject.characterImageUrl }}
        className="w-6 h-6"
        resizeMode="contain"
      />
    );
  }

  return (
    <Text className="text-[16px] font-black" style={{ color }}>
      {subject.japanese || subject.type}
    </Text>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-[13px] font-black uppercase tracking-ultra text-text-muted dark:text-text-muted-dark">
        {title}
      </Text>
      <View className="rounded-md p-3.5 bg-surface-elevated dark:bg-surface-elevated-dark border border-border dark:border-border-dark gap-1">
        {children}
      </View>
    </View>
  );
}

function MnemonicText({
  text,
  subjectLookup,
}: {
  text: string;
  subjectLookup: Map<number, SubjectAnswerData>;
}) {
  const tagColors: Record<string, string> = {
    radical: '#00aaff',
    kanji: '#ff00aa',
    reading: '#aa00ff',
    meaning: '#ff00aa',
  };
  const defaultHighlightColor = '#ff00aa';

  const tokens = parseMnemonic(text);
  return (
    <Text className="text-[16px] leading-[22px] font-heavy text-text dark:text-text-dark">
      {tokens.map((token, idx) => {
        if (token.type === 'tag') {
          const color = tagColors[token.tag ?? ''] ?? defaultHighlightColor;
          return (
            <Text key={idx} className="font-black" style={{ color }}>
              {token.text}
            </Text>
          );
        }
        if (token.type === 'curly') {
          const content = token.text;
          const subject = [...subjectLookup.values()].find(
            (s) =>
              s.meanings.some((m) => m.meaning.toLowerCase() === content.toLowerCase()) ||
              s.japanese === content,
          );
          if (subject?.japanese) {
            return (
              <Text key={idx} className="font-black text-kanji">
                {subject.japanese}
              </Text>
            );
          }
          return (
            <Text key={idx} className="font-black text-kanji">
              {content}
            </Text>
          );
        }
        return <Text key={idx}>{token.text}</Text>;
      })}
    </Text>
  );
}

type MnemonicToken = { type: 'text'; text: string } | { type: 'tag'; tag: string; text: string } | { type: 'curly'; text: string };

function parseMnemonic(text: string): MnemonicToken[] {
  const tokens: MnemonicToken[] = [];
  const pattern = /(<(radical|kanji|reading|meaning)>)(.*?)(<\/\2>)|(\{([^}]+)\})/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }

    if (match[1] && match[3] !== undefined) {
      tokens.push({ type: 'tag', tag: match[2]!, text: match[3] });
    } else if (match[5] && match[6]) {
      tokens.push({ type: 'curly', text: match[6] });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', text: text.slice(lastIndex) });
  }

  return tokens;
}

function LessonQuizSummary({
  completed,
  successRate,
  totalItems,
  batchIndex,
  batchCount,
  hasNextBatch,
  onContinue,
  onBack,
}: {
  completed: number;
  successRate: string;
  totalItems: number;
  batchIndex: number;
  batchCount: number;
  hasNextBatch: boolean;
  onContinue: () => void;
  onBack: () => void;
}) {
  return (
    <ScreenLayout scrollable>
      <SessionHeader
        onBack={onBack}
        progress={hasNextBatch ? `Batch ${batchIndex + 1}/${batchCount}` : 'Complete'}
      />

      <View className="min-h-[210px] rounded-5xl items-center justify-center p-6 bg-lesson">
        <Text className="text-white text-[14px] font-black tracking-ultra4 uppercase">
          {hasNextBatch ? 'Batch Complete' : 'Lessons Complete'}
        </Text>
        <Text className="mt-2.5 text-white text-6xl font-black">{successRate}</Text>
        <Text className="text-white text-[16px] font-heavy" style={{ opacity: 0.86 }}>
          {completed} of {totalItems} lessons completed
        </Text>
      </View>

      <Pressable
        onPress={hasNextBatch ? onContinue : onBack}
        className="min-h-[54px] items-center justify-center rounded-lg px-[18px] bg-lesson"
        style={({ pressed }) => pressed ? { opacity: 0.58 } : undefined}
      >
        <Text className="text-white text-[16px] font-black">
          {hasNextBatch ? 'Continue Lessons' : 'Back to Dashboard'}
        </Text>
      </Pressable>
    </ScreenLayout>
  );
}

function subjectTypeLabel(type: string) {
  switch (type) {
    case 'radical':
      return 'Radical';
    case 'kanji':
      return 'Kanji';
    case 'vocabulary':
    case 'kana_vocabulary':
      return 'Vocabulary';
    default:
      return 'Lesson';
  }
}
