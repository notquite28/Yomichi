import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import {
  getLeechedItems,
  getRecentMistakes,
  type LeechedItem,
  type RecentItem,
} from '../domain/dashboard/dashboardRepository';
import { openAppDatabase } from '../domain/db/database';
import { logErrorBestEffort } from '../domain/db/errorLog';
import { LiquidGlassButton } from '../components/LiquidGlassButton';
import { CenteredMessage, ScreenLayout } from '../components/ScreenLayout';
import { RootStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/AppThemeProvider';

type Props = NativeStackScreenProps<RootStackParamList, 'WeakSpotClinic'>;

type RecurringMiss = {
  subjectId: number;
  taskType: string;
  missCount: number;
  japanese: string;
  lastMissAt: string;
};

type ConfusionPairRow = {
  subjectA: number;
  subjectB: number;
  wrongAnswer: string;
  taskType: string;
  labelA: string;
  labelB: string;
  count: number;
};

export function WeakSpotClinicScreen({ navigation }: Props) {
  const { colors } = useAppTheme();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recentMistakes, setRecentMistakes] = useState<RecentItem[]>([]);
  const [leeches, setLeeches] = useState<LeechedItem[]>([]);
  const [recurring, setRecurring] = useState<RecurringMiss[]>([]);
  const [pairs, setPairs] = useState<ConfusionPairRow[]>([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const db = await openAppDatabase();
      const [mistakes, leechItems] = await Promise.all([
        getRecentMistakes(db, 12),
        getLeechedItems(db, { limit: 12 }),
      ]);
      setRecentMistakes(mistakes);
      setLeeches(leechItems);

      const cutoff = new Date(Date.now() - 14 * 24 * 3600_000).toISOString();
      const recurringRows = await db.getAllAsync<{
        subject_id: number;
        task_type: string;
        miss_count: number;
        last_miss_at: string;
        japanese: string | null;
      }>(
        `SELECT
           ra.subject_id,
           ra.task_type,
           COUNT(*) AS miss_count,
           MAX(ra.occurred_at) AS last_miss_at,
           s.japanese
         FROM review_attempts ra
         LEFT JOIN subjects s ON s.id = ra.subject_id
         WHERE ra.scored_correct = 0
           AND ra.overridden = 0
           AND ra.source IN ('review', 'lesson')
           AND ra.occurred_at >= ?
         GROUP BY ra.subject_id, ra.task_type
         HAVING miss_count >= 2
         ORDER BY miss_count DESC, last_miss_at DESC
         LIMIT 20`,
        cutoff,
      );
      setRecurring(
        recurringRows.map((row) => ({
          subjectId: row.subject_id,
          taskType: row.task_type,
          missCount: row.miss_count,
          japanese: row.japanese ?? `Subject ${row.subject_id}`,
          lastMissAt: row.last_miss_at,
        })),
      );

      const wrongRows = await db.getAllAsync<{
        subject_id: number;
        task_type: string;
        normalized_answer: string;
        count: number;
        japanese: string | null;
      }>(
        `SELECT
           ra.subject_id,
           ra.task_type,
           ra.normalized_answer,
           COUNT(*) AS count,
           s.japanese
         FROM review_attempts ra
         LEFT JOIN subjects s ON s.id = ra.subject_id
         WHERE ra.scored_correct = 0
           AND ra.overridden = 0
           AND ra.normalized_answer IS NOT NULL
           AND ra.source IN ('review', 'lesson')
           AND ra.occurred_at >= ?
         GROUP BY ra.subject_id, ra.task_type, ra.normalized_answer
         ORDER BY count DESC
         LIMIT 40`,
        cutoff,
      );

      const pairMap = new Map<string, ConfusionPairRow>();
      for (const wrong of wrongRows) {
        if (!wrong.normalized_answer) {
          continue;
        }
        // Find other learned subjects that accept this answer (cheap JSON scan limited).
        const matches = await db.getAllAsync<{ id: number; japanese: string | null }>(
          `SELECT s.id, s.japanese
           FROM subjects s
           INNER JOIN assignments a ON a.subject_id = s.id
           WHERE a.srs_stage BETWEEN 1 AND 9
             AND s.id != ?
           GROUP BY s.id
           LIMIT 80`,
          wrong.subject_id,
        );
        // Lightweight client-side filter would need payloads; keep pair list from exact
        // same wrong answer used on two different subjects in attempts.
        for (const other of wrongRows) {
          if (
            other.subject_id === wrong.subject_id ||
            other.task_type !== wrong.task_type ||
            other.normalized_answer !== wrong.normalized_answer
          ) {
            continue;
          }
          const a = Math.min(wrong.subject_id, other.subject_id);
          const b = Math.max(wrong.subject_id, other.subject_id);
          const key = `${a}:${b}:${wrong.task_type}:${wrong.normalized_answer}`;
          if (pairMap.has(key)) {
            continue;
          }
          const labelA =
            a === wrong.subject_id
              ? wrong.japanese ?? `Subject ${a}`
              : other.japanese ?? `Subject ${a}`;
          const labelB =
            b === wrong.subject_id
              ? wrong.japanese ?? `Subject ${b}`
              : other.japanese ?? `Subject ${b}`;
          pairMap.set(key, {
            subjectA: a,
            subjectB: b,
            wrongAnswer: wrong.normalized_answer,
            taskType: wrong.task_type,
            labelA,
            labelB,
            count: wrong.count + other.count,
          });
        }
        void matches;
      }
      setPairs([...pairMap.values()].sort((left, right) => right.count - left.count).slice(0, 12));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      void logErrorBestEffort('warn', caught, 'WeakSpotClinicScreen.load');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      void load();
    }, [load]),
  );

  if (isLoading) {
    return <CenteredMessage label="Loading weak spots..." />;
  }

  return (
    <ScreenLayout scrollable>
      <View className="gap-3 pb-8">
        <LiquidGlassButton
          label="Back"
          onPress={() => navigation.goBack()}
          accessibilityLabel="Go back"
          className="self-start"
          style={{ paddingHorizontal: 13, paddingVertical: 9 }}
          contentClassName="font-black"
        />

        <Text className="text-5xl font-black tracking-tightest text-text dark:text-text-dark">
          Weak-Spot Clinic
        </Text>
        <Text className="text-[15px] font-bold text-text-muted dark:text-text-muted-dark">
          Deterministic practice queues from local mistakes, leeches, and recurring misses.
        </Text>

        {error ? (
          <Text className="text-danger dark:text-danger-dark font-heavy">{error}</Text>
        ) : null}

        <Section title="Recent mistakes">
          {recentMistakes.length === 0 ? (
            <Empty label="No recent mistakes in the last 24 hours." />
          ) : (
            recentMistakes.map((item) => (
              <Row
                key={`m-${item.subjectId}`}
                title={item.japanese || `Subject ${item.subjectId}`}
                detail={`${item.subjectType} · L${item.level}`}
                onPractice={() =>
                  navigation.navigate('ReviewSession', { practiceSource: 'recentMistakes' })
                }
                color={colors.kanji}
              />
            ))
          )}
        </Section>

        <Section title="Leeches">
          {leeches.length === 0 ? (
            <Empty label="No leeches found in local review stats." />
          ) : (
            leeches.map((item) => (
              <Row
                key={`l-${item.subjectId}`}
                title={item.japanese || `Subject ${item.subjectId}`}
                detail={`Score ${item.score}% · ${item.subjectType}`}
                onPractice={() =>
                  navigation.navigate('ReviewSession', { practiceSource: 'allLeeches' })
                }
                color={colors.vocabulary}
              />
            ))
          )}
        </Section>

        <Section title="Recurring task misses (14d)">
          {recurring.length === 0 ? (
            <Empty label="No recurring scored misses yet. Keep reviewing." />
          ) : (
            recurring.map((item) => (
              <Row
                key={`r-${item.subjectId}-${item.taskType}`}
                title={item.japanese}
                detail={`${item.taskType} · ${item.missCount} misses`}
                onPractice={() =>
                  navigation.navigate('ReviewSession', {
                    practiceSource: 'subjectIds',
                    subjectIds: [item.subjectId],
                  })
                }
                color={colors.radical}
              />
            ))
          )}
        </Section>

        <Section title="Confusion pairs">
          {pairs.length === 0 ? (
            <Empty label="No shared wrong-answer pairs detected yet." />
          ) : (
            pairs.map((pair) => (
              <Row
                key={`${pair.subjectA}-${pair.subjectB}-${pair.wrongAnswer}`}
                title={`${pair.labelA} ↔ ${pair.labelB}`}
                detail={`“${pair.wrongAnswer}” · ${pair.taskType} · n=${pair.count}`}
                onPractice={() =>
                  navigation.navigate('ReviewSession', {
                    practiceSource: 'subjectIds',
                    subjectIds: [pair.subjectA, pair.subjectB],
                  })
                }
                color={colors.kanji}
              />
            ))
          )}
        </Section>
      </View>
    </ScreenLayout>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="rounded-[22px] p-4 bg-[#fffdf8] dark:bg-[#15141a] border border-[rgba(32,26,36,0.08)] dark:border-[rgba(255,255,255,0.08)] gap-2">
      <Text className="text-xl font-black text-text dark:text-text-dark">{title}</Text>
      {children}
    </View>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <Text className="text-[13px] font-bold text-text-muted dark:text-text-muted-dark">{label}</Text>
  );
}

function Row({
  title,
  detail,
  onPractice,
  color,
}: {
  title: string;
  detail: string;
  onPractice: () => void;
  color: string;
}) {
  return (
    <View className="flex-row items-center justify-between gap-2 py-1.5">
      <View className="flex-1">
        <Text className="text-[15px] font-black text-text dark:text-text-dark">{title}</Text>
        <Text className="text-[12px] font-bold text-text-muted dark:text-text-muted-dark">{detail}</Text>
      </View>
      <Pressable
        onPress={onPractice}
        accessibilityRole="button"
        accessibilityLabel={`Practice ${title}`}
        className="rounded-full px-3 py-1.5"
        style={{ backgroundColor: color }}
      >
        <Text className="text-white text-[12px] font-black">Practice</Text>
      </Pressable>
    </View>
  );
}
