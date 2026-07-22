import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LiquidGlassButton } from '../components/LiquidGlassButton';
import { openAppDatabase } from '../domain/db/database';
import {
  BurnedSubjectListRow,
  getBurnedSubjects,
  getBurnedSubjectCount,
} from '../domain/db/subjectRepository';
import {
  BurnedPracticeOrder,
} from '../domain/settings/settings';
import { useSettingsStore } from '../domain/settings/settingsStore';
import { RootStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/AppThemeProvider';
import { colorForSubjectType } from '../theme/subjectColors';

type Props = NativeStackScreenProps<RootStackParamList, 'BurnedItems'>;

const ORDER_OPTIONS: Array<{ value: BurnedPracticeOrder; label: string }> = [
  { value: 'oldestBurned', label: 'Oldest burned' },
  { value: 'newestBurned', label: 'Newest burned' },
  { value: 'random', label: 'Random' },
  { value: 'levelAscending', label: 'Level' },
];

const PAGE_SIZE = 100;
const GRID_COLUMNS = 3;


function BurnedCard({
  item,
  onPress,
  mutedText,
}: {
  item: BurnedSubjectListRow;
  onPress: () => void;
  mutedText: string;
}) {
  const { colors } = useAppTheme();
  const color = colorForSubjectType(colors, item.subjectType);
  const meaning = item.primaryMeaning || 'Meaning unavailable';

  return (
    <Pressable
      onPress={onPress}
      className="flex-1 min-h-[96px] rounded-[16px] p-2.5 bg-[#fffdf8] dark:bg-[#15141a] border border-[rgba(32,26,36,0.06)] dark:border-[rgba(255,255,255,0.06)]"
      style={({ pressed }) => ({
        opacity: pressed ? 0.74 : 1,
        transform: [{ scale: pressed ? 0.985 : 1 }],
      })}
      accessibilityRole="button"
      accessibilityLabel={`${item.japanese || 'subject'}, ${meaning}${item.primaryReadings ? `, ${item.primaryReadings}` : ''}, level ${item.level}, ${item.subjectType}${item.percentageCorrect != null ? `, ${item.percentageCorrect}% correct` : ''}`}
    >
      <View className="flex-1 justify-between gap-1.5">
        <View className="gap-1.5">
          <View className="flex-row items-start justify-between gap-1">
            <View className="flex-row flex-1 items-center gap-1.5 min-w-0">
              <View className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <Text
                numberOfLines={1}
                className="flex-1 text-[22px] leading-7 font-black text-text dark:text-text-dark"
              >
                {item.japanese || '?'}
              </Text>
            </View>
            {item.percentageCorrect != null ? (
              <Text className="pt-0.5 text-[11px] font-heavy" style={{ color: mutedText }}>
                {item.percentageCorrect}%
              </Text>
            ) : null}
          </View>

          <View className="gap-0.5">
            <Text
              numberOfLines={1}
              className="text-[13px] leading-4 font-heavy text-text dark:text-text-dark"
            >
              {meaning}
            </Text>
            {item.primaryReadings ? (
              <Text
                numberOfLines={1}
                className="text-[11px] leading-[14px] font-bold text-text-muted dark:text-text-muted-dark"
              >
                {item.primaryReadings}
              </Text>
            ) : null}
          </View>
        </View>

        <Text className="text-[10px] font-black tracking-wide text-text-muted dark:text-text-muted-dark">
          L{item.level}
        </Text>
      </View>
    </Pressable>
  );
}

export function BurnedItemsScreen({ navigation }: Props) {
  const { colors } = useAppTheme();
  const settings = useSettingsStore();
  const updateSetting = useSettingsStore((s) => s.updateSetting);

  const [items, setItems] = useState<BurnedSubjectListRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const loadingMoreRef = useRef(false);

  const loadItems = useCallback(async () => {
    try {
      const db = await openAppDatabase();
      const [count, rows] = await Promise.all([
        getBurnedSubjectCount(db),
        getBurnedSubjects(db, { limit: PAGE_SIZE, offset: 0 }),
      ]);
      setTotalCount(count);
      setItems(rows);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const loadMore = useCallback(async () => {
    if (
      loadingMoreRef.current ||
      isLoading ||
      error ||
      items.length >= totalCount
    ) {
      return;
    }

    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    setLoadMoreError(null);
    try {
      const db = await openAppDatabase();
      const nextRows = await getBurnedSubjects(db, {
        limit: PAGE_SIZE,
        offset: items.length,
      });
      setItems((current) => [...current, ...nextRows]);
    } catch (caught) {
      setLoadMoreError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [error, isLoading, items.length, totalCount]);

  const anyTypeSelected =
    settings.burnedPracticeIncludeRadicals ||
    settings.burnedPracticeIncludeKanji ||
    settings.burnedPracticeIncludeVocabulary;

  const canStartPractice = !isLoading && !error && totalCount > 0 && anyTypeSelected;

  const gridRows = useMemo(() => {
    const rows: BurnedSubjectListRow[][] = [];
    for (let index = 0; index < items.length; index += GRID_COLUMNS) {
      rows.push(items.slice(index, index + GRID_COLUMNS));
    }
    return rows;
  }, [items]);

  const renderItem = useCallback(
    ({ item: row }: { item: BurnedSubjectListRow[] }) => {
      const fillers = Math.max(0, GRID_COLUMNS - row.length);
      return (
        <View className="w-full flex-row items-stretch gap-2">
          {row.map((item) => (
            <BurnedCard
              key={item.id}
              item={item}
              mutedText={colors.mutedText}
              onPress={() => navigation.navigate('SubjectDetail', { subjectId: item.id })}
            />
          ))}
          {Array.from({ length: fillers }, (_, index) => (
            <View key={`filler-${index}`} className="flex-1" />
          ))}
        </View>
      );
    },
    [colors.mutedText, navigation],
  );

  const listHeader = useMemo(
    () => (
      <View className="gap-4 pb-1">
        <View className="gap-1.5">
          <Text className="text-4xl font-black tracking-tighter text-text dark:text-text-dark">
            Burned Items
          </Text>
          {isLoading ? (
            <Text className="text-[16px] font-heavy text-text-muted dark:text-text-muted-dark">
              Loading...
            </Text>
          ) : error ? (
            <Text className="text-[14px] leading-5 font-bold text-danger dark:text-danger-dark pt-3">
              {error}
            </Text>
          ) : (
            <Text className="text-[13px] font-heavy text-text-muted dark:text-text-muted-dark">
              {totalCount} items
            </Text>
          )}
        </View>

        <View className="rounded-[26px] p-[18px] bg-[#fffdf8] dark:bg-[#15141a] border border-[rgba(32,26,36,0.08)] dark:border-[rgba(255,255,255,0.08)]">
          <Text className="mb-4 text-xl font-black tracking-tight text-text dark:text-text-dark">
            Practice
          </Text>

          <View className="gap-2 pb-3">
            <Text className="text-xs font-black tracking-ultra uppercase text-text-muted dark:text-text-muted-dark">
              Order
            </Text>
            <View className="flex-row flex-wrap justify-between gap-y-2">
              {ORDER_OPTIONS.map((option) => {
                const active = settings.burnedPracticeOrder === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => updateSetting('burnedPracticeOrder', option.value)}
                    className={`min-h-[44px] w-[48.5%] items-center justify-center rounded-[14px] px-3 py-2 border ${
                      active
                        ? 'bg-kanji border-kanji'
                        : 'bg-surface dark:bg-surface-dark border-border dark:border-border-dark'
                    }`}
                    style={({ pressed }) =>
                      pressed ? { opacity: 0.78, transform: [{ scale: 0.98 }] } : undefined
                    }
                    accessibilityRole="button"
                    accessibilityLabel={option.label}
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      className={`text-[13px] text-center font-heavy ${
                        active ? 'text-white' : 'text-text dark:text-text-dark'
                      }`}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View className="flex-row items-center justify-between gap-3 py-3 border-t border-border dark:border-border-dark">
            <View className="flex-1 gap-0.5">
              <Text className="text-base font-heavy text-text dark:text-text-dark">
                Session size
              </Text>
              <Text className="text-[13px] leading-[18px] font-bold text-text-muted dark:text-text-muted-dark">
                Items per practice session.
              </Text>
            </View>
            <View className="flex-row items-center gap-2">
              <Pressable
                disabled={settings.burnedPracticeLimit <= 10}
                onPress={() =>
                  updateSetting(
                    'burnedPracticeLimit',
                    Math.max(10, settings.burnedPracticeLimit - 10),
                  )
                }
                className="w-[44px] h-[44px] items-center justify-center rounded-[14px] bg-surface-elevated dark:bg-surface-elevated-dark border border-border dark:border-border-dark"
                style={({ pressed }) =>
                  settings.burnedPracticeLimit <= 10
                    ? { opacity: 0.4 }
                    : pressed
                      ? { opacity: 0.72, transform: [{ scale: 0.96 }] }
                      : undefined
                }
                accessibilityLabel="Decrease session size"
                accessibilityRole="button"
              >
                <Text className="text-lg font-black text-text dark:text-text-dark">-</Text>
              </Pressable>
              <Text
                className="text-[16px] font-black text-text dark:text-text-dark min-w-[32px] text-center"
                accessibilityLabel={`Session size: ${settings.burnedPracticeLimit}`}
              >
                {settings.burnedPracticeLimit}
              </Text>
              <Pressable
                disabled={settings.burnedPracticeLimit >= 200}
                onPress={() =>
                  updateSetting(
                    'burnedPracticeLimit',
                    Math.min(200, settings.burnedPracticeLimit + 10),
                  )
                }
                className="w-[44px] h-[44px] items-center justify-center rounded-[14px] bg-surface-elevated dark:bg-surface-elevated-dark border border-border dark:border-border-dark"
                style={({ pressed }) =>
                  settings.burnedPracticeLimit >= 200
                    ? { opacity: 0.4 }
                    : pressed
                      ? { opacity: 0.72, transform: [{ scale: 0.96 }] }
                      : undefined
                }
                accessibilityLabel="Increase session size"
                accessibilityRole="button"
              >
                <Text className="text-lg font-black text-text dark:text-text-dark">+</Text>
              </Pressable>
            </View>
          </View>

          <View className="gap-2 pt-3 border-t border-border dark:border-border-dark">
            <Text className="text-xs font-black tracking-ultra uppercase text-text-muted dark:text-text-muted-dark">
              Types
            </Text>
            <View className="flex-row justify-between">
              {(
                [
                  {
                    key: 'burnedPracticeIncludeRadicals' as const,
                    label: 'Radical',
                    value: settings.burnedPracticeIncludeRadicals,
                  },
                  {
                    key: 'burnedPracticeIncludeKanji' as const,
                    label: 'Kanji',
                    value: settings.burnedPracticeIncludeKanji,
                  },
                  {
                    key: 'burnedPracticeIncludeVocabulary' as const,
                    label: 'Vocabulary',
                    value: settings.burnedPracticeIncludeVocabulary,
                  },
                ] as const
              ).map((option) => (
                <Pressable
                  key={option.key}
                  onPress={() => updateSetting(option.key, !option.value)}
                  className={`min-h-[44px] w-[31.5%] items-center justify-center rounded-[14px] px-2 py-2 border ${
                    option.value
                      ? 'bg-kanji border-kanji'
                      : 'bg-surface dark:bg-surface-dark border-border dark:border-border-dark'
                  }`}
                  style={({ pressed }) =>
                    pressed ? { opacity: 0.78, transform: [{ scale: 0.98 }] } : undefined
                  }
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected: option.value }}
                >
                  <Text
                    className={`text-[13px] text-center font-heavy ${
                      option.value ? 'text-white' : 'text-text dark:text-text-dark'
                    }`}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {!anyTypeSelected ? (
              <Text className="text-[13px] font-bold text-text-muted dark:text-text-muted-dark">
                Select at least one type
              </Text>
            ) : null}
          </View>

          <Pressable
            disabled={!canStartPractice}
            onPress={() => navigation.navigate('ReviewSession', { practiceSource: 'burnedItems' })}
            className="min-h-[48px] items-center justify-center rounded-full bg-kanji mt-4"
            style={({ pressed }) =>
              !canStartPractice
                ? { opacity: 0.4 }
                : pressed
                  ? { opacity: 0.8, transform: [{ scale: 0.99 }] }
                  : undefined
            }
            accessibilityRole="button"
            accessibilityLabel="Start Practice"
            accessibilityState={{ disabled: !canStartPractice }}
          >
            <Text className="text-white text-[15px] font-black tracking-wide">
              Start Practice
            </Text>
          </Pressable>
        </View>
      </View>
    ),
    [
      anyTypeSelected,
      canStartPractice,
      error,
      isLoading,
      totalCount,
      navigation,
      settings.burnedPracticeIncludeKanji,
      settings.burnedPracticeIncludeRadicals,
      settings.burnedPracticeIncludeVocabulary,
      settings.burnedPracticeLimit,
      settings.burnedPracticeOrder,
      updateSetting,
    ],
  );

  return (
    <SafeAreaView className="flex-1 bg-[#f7f4ef] dark:bg-[#0c0b0f]">
      <LiquidGlassButton
        label="Back"
        onPress={() => navigation.goBack()}
        accessibilityLabel="Go back"
        className="self-start mx-5 mt-3"
        style={{ paddingHorizontal: 13, paddingVertical: 9 }}
        contentClassName="font-black"
      />
      <FlatList
        data={isLoading || error ? [] : gridRows}
        keyExtractor={(row) => String(row[0]?.id)}
        contentContainerStyle={{
          width: '100%',
          alignItems: 'stretch',
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: 28,
          gap: 8,
        }}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          !isLoading && !error ? (
            <Text className="text-base font-bold text-text-muted dark:text-text-muted-dark pt-6 text-center">
              No burned items found.
            </Text>
          ) : null
        }
        ListFooterComponent={
          isLoadingMore ? (
            <View className="items-center py-5">
              <ActivityIndicator color={colors.mutedText} />
            </View>
          ) : loadMoreError ? (
            <View className="items-center gap-2 py-5">
              <Text className="text-[13px] text-center font-bold text-danger dark:text-danger-dark">
                Could not load more items.
              </Text>
              <Pressable
                onPress={() => void loadMore()}
                className="min-h-[44px] justify-center rounded-full px-5 bg-surface-elevated dark:bg-surface-elevated-dark border border-border dark:border-border-dark"
                accessibilityRole="button"
                accessibilityLabel="Retry loading burned items"
              >
                <Text className="font-heavy text-text dark:text-text-dark">Try again</Text>
              </Pressable>
            </View>
          ) : null
        }
        renderItem={renderItem}
        onEndReached={() => {
          if (!loadMoreError) {
            void loadMore();
          }
        }}
        onEndReachedThreshold={0.6}
        initialNumToRender={12}
        windowSize={7}
        maxToRenderPerBatch={12}
      />
    </SafeAreaView>
  );
}
