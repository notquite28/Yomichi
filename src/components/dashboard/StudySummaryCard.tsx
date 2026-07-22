import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  cancelGeneration,
  getCoachStatus,
  runCoachAction,
} from '../../domain/ai/coachService';
import { useCoachStore } from '../../domain/ai/coachStore';
import type { StudySummaryPayloadV1 } from '../../domain/ai/types';
import { openAppDatabase } from '../../domain/db/database';
import { logErrorBestEffort } from '../../domain/db/errorLog';
import { useSettingsStore } from '../../domain/settings/settingsStore';
import {
  buildStudySummaryFacts,
  renderDeterministicSummary,
  studySummaryFactRefAllowlist,
  type StudySummaryFacts,
} from '../../domain/dashboard/studySummary';
import { useLearningHistoryStore } from '../../domain/study/learningHistoryStore';
import { useAppTheme } from '../../theme/AppThemeProvider';

type Props = {
  syncRevision?: number;
};

export function StudySummaryCard({ syncRevision = 0 }: Props) {
  const { colors } = useAppTheme();
  const studyCoachEnabled = useSettingsStore((s) => s.studyCoachEnabled);
  const coachStatus = useCoachStore((s) => s.status);
  const learningHistoryRevision = useLearningHistoryStore((state) => state.revision);
  const observedLearningHistoryRevision = useRef(learningHistoryRevision);

  const [facts, setFacts] = useState<StudySummaryFacts | null>(null);
  const [deterministic, setDeterministic] = useState<ReturnType<typeof renderDeterministicSummary> | null>(null);
  const [structured, setStructured] = useState<StudySummaryPayloadV1 | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleHint, setStaleHint] = useState(false);
  const [factsRevision, setFactsRevision] = useState<{ attempt: number; sync: number } | null>(null);

  useEffect(() => {
    if (observedLearningHistoryRevision.current === learningHistoryRevision) {
      return;
    }
    observedLearningHistoryRevision.current = learningHistoryRevision;
    cancelGeneration();
    setFacts(null);
    setDeterministic(null);
    setStructured(null);
    setIsRunning(false);
    setError(null);
    setStaleHint(false);
    setFactsRevision(null);
  }, [learningHistoryRevision]);

  const ensureFacts = useCallback(async () => {
    const db = await openAppDatabase();
    const next = await buildStudySummaryFacts(db, { syncRevision });
    if (useLearningHistoryStore.getState().revision !== learningHistoryRevision) {
      throw new Error('Study summary cancelled because learning history changed.');
    }
    setFacts(next);
    setDeterministic(renderDeterministicSummary(next));
    if (
      factsRevision &&
      (factsRevision.attempt !== next.attemptRevision || factsRevision.sync !== next.syncRevision)
    ) {
      setStaleHint(true);
    }
    setFactsRevision({ attempt: next.attemptRevision, sync: next.syncRevision });
    return next;
  }, [factsRevision, learningHistoryRevision, syncRevision]);

  const handleGenerate = async () => {
    if (isRunning) {
      cancelGeneration();
      setIsRunning(false);
      return;
    }

    setError(null);
    setIsRunning(true);
    try {
      const generationHistoryRevision = learningHistoryRevision;
      const nextFacts = await ensureFacts();
      const canGenerate =
        studyCoachEnabled &&
        (coachStatus === 'ready' || coachStatus === 'loaded' || getCoachStatus() === 'ready' || getCoachStatus() === 'loaded');

      if (!canGenerate) {
        setStructured(null);
        return;
      }

      const allow = [...studySummaryFactRefAllowlist(nextFacts)];
      const result = await runCoachAction({
        action: 'study_summary',
        evidence: {
          summaryFacts: nextFacts,
          factRefAllowlist: allow,
        },
        onToken: () => {},
      });
      if (useLearningHistoryStore.getState().revision !== generationHistoryRevision) {
        return;
      }
      if (result.structured && 'overview' in result.structured) {
        setStructured(result.structured);
        setStaleHint(false);
      } else {
        setStructured(null);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (!/cancel/i.test(message)) {
        setError(message);
        void logErrorBestEffort('warn', caught, 'StudySummaryCard.generate');
      }
    } finally {
      setIsRunning(false);
    }
  };

  const metrics = deterministic?.metrics ?? [
    { label: 'Reviews due', value: '—' },
    { label: 'Lessons available', value: '—' },
  ];

  return (
    <View className="rounded-[26px] p-[18px] bg-[#fffdf8] dark:bg-[#15141a] border border-[rgba(32,26,36,0.08)] dark:border-[rgba(255,255,255,0.08)] gap-3">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="text-text dark:text-text-dark text-2xl font-black tracking-tight">
          Study summary
        </Text>
        <Pressable
          onPress={() => {
            void handleGenerate();
          }}
          accessibilityRole="button"
          accessibilityLabel={isRunning ? 'Cancel AI study summary' : 'Generate AI study summary.'}
          hitSlop={8}
          className="w-10 h-10 rounded-full items-center justify-center bg-[#f2eee8] dark:bg-[#201e26]"
        >
          {isRunning ? (
            <ActivityIndicator color={colors.mutedText} />
          ) : (
            <Ionicons name="sparkles" size={18} color={colors.kanji} />
          )}
        </Pressable>
      </View>

      <View className="flex-row flex-wrap gap-2">
        {metrics.map((metric) => (
          <View
            key={metric.label}
            className="rounded-full px-3 py-1.5 bg-[#f2eee8] dark:bg-[#201e26] border border-[rgba(32,26,36,0.06)] dark:border-[rgba(255,255,255,0.08)]"
          >
            <Text className="text-[12px] font-black text-text dark:text-text-dark">
              {metric.label}: {metric.value}
            </Text>
          </View>
        ))}
      </View>

      {staleHint ? (
        <Text className="text-[12px] font-bold text-text-muted dark:text-text-muted-dark">
          Study data changed since the last AI summary. Tap sparkles to refresh.
        </Text>
      ) : null}

      {error ? (
        <Text className="text-[13px] font-bold text-danger dark:text-danger-dark">{error}</Text>
      ) : null}

      {structured ? (
        <View className="gap-1.5">
          <Text className="text-[14px] leading-[20px] font-heavy text-text dark:text-text-dark">
            {structured.overview}
          </Text>
          {structured.wins.map((win) => (
            <Text key={win} className="text-[13px] font-bold text-text-muted dark:text-text-muted-dark">
              • {win}
            </Text>
          ))}
          {structured.focus.map((item) => (
            <Text key={item} className="text-[13px] font-bold text-text-muted dark:text-text-muted-dark">
              • Focus: {item}
            </Text>
          ))}
          <Text className="text-[13px] font-black text-text dark:text-text-dark">
            Next: {structured.nextAction}
          </Text>
        </View>
      ) : deterministic ? (
        <View className="gap-1.5">
          <Text className="text-[14px] leading-[20px] font-heavy text-text dark:text-text-dark">
            {deterministic.overview}
          </Text>
          {deterministic.wins.map((win) => (
            <Text key={win} className="text-[13px] font-bold text-text-muted dark:text-text-muted-dark">
              • {win}
            </Text>
          ))}
          {deterministic.focus.map((item) => (
            <Text key={item} className="text-[13px] font-bold text-text-muted dark:text-text-muted-dark">
              • Focus: {item}
            </Text>
          ))}
          <Text className="text-[13px] font-black text-text dark:text-text-dark">
            Next: {deterministic.nextAction}
          </Text>
        </View>
      ) : (
        <Text className="text-[13px] font-bold text-text-muted dark:text-text-muted-dark">
          Tap sparkles for metrics{studyCoachEnabled ? ' and an optional AI summary' : ''}. Coach stays off until you ask.
        </Text>
      )}

      {!facts ? (
        <Pressable
          onPress={() => {
            void ensureFacts().catch((caught) => {
              void logErrorBestEffort('warn', caught, 'StudySummaryCard.ensureFacts');
            });
          }}
          accessibilityRole="button"
          accessibilityLabel="Load study summary metrics"
        >
          <Text className="text-[12px] font-heavy text-kanji">Load metrics</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
