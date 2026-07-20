import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LiquidGlassButton } from '../components/LiquidGlassButton';
import {
  SubjectListRow,
  getExcludedSubjects,
  getRemainingSubjects,
  getSubjectsBySrsBucket,
} from '../domain/db/subjectRepository';
import { openAppDatabase } from '../domain/db/database';
import { RootStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/AppThemeProvider';
import { colorForSubjectType } from '../theme/subjectColors';

type Props = NativeStackScreenProps<RootStackParamList, 'SubjectBrowse'>;

export function SubjectBrowseScreen({ navigation, route }: Props) {
  const { colors } = useAppTheme();
  const { title, srsMin, srsMax, excluded, remaining } = route.params;
  const [items, setItems] = useState<SubjectListRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    try {
      const db = await openAppDatabase();
      let rows: SubjectListRow[];
      if (excluded) {
        rows = await getExcludedSubjects(db);
      } else if (remaining) {
        rows = await getRemainingSubjects(db);
      } else if (srsMin != null && srsMax != null) {
        rows = await getSubjectsBySrsBucket(db, srsMin, srsMax);
      } else {
        rows = [];
      }
      setItems(rows);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoading(false);
    }
  }, [excluded, remaining, srsMin, srsMax]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

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
        data={isLoading || error ? [] : items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 28, gap: 6 }}
        ListHeaderComponent={
          <View className="gap-1.5 pb-1">
            <Text className="text-4xl font-black tracking-tighter text-text dark:text-text-dark">
              {title}
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
              <Text className="text-[13px] font-heavy text-text-muted dark:text-text-muted-dark pb-[10px]">
                {items.length} items
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={
          !isLoading && !error ? (
            <Text className="text-base font-bold text-text-muted dark:text-text-muted-dark pt-6 text-center">
              No items found.
            </Text>
          ) : null
        }
        renderItem={({ item }) => {
          const color = colorForSubjectType(colors, item.subjectType);
          return (
            <Pressable
              onPress={() => navigation.navigate('SubjectDetail', { subjectId: item.id })}
              className="flex-row items-center gap-3 py-3 px-[14px] rounded-md bg-[#fffdf8] dark:bg-[#15141a] border border-[rgba(32,26,36,0.06)] dark:border-[rgba(255,255,255,0.06)]"
              style={({ pressed }) =>
                pressed ? { opacity: 0.72, transform: [{ scale: 0.99 }] } : undefined
              }
              accessibilityRole="button"
              accessibilityLabel={`${item.japanese || 'subject'}, level ${item.level}, ${item.subjectType}${item.percentageCorrect != null ? `, ${item.percentageCorrect}% correct` : ''}`}
            >
              <View className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
              <View className="flex-1 gap-0.5">
                <Text className="text-lg font-black text-text dark:text-text-dark">
                  {item.japanese || '?'}
                </Text>
                <Text className="text-xs font-bold text-text-muted dark:text-text-muted-dark capitalize">
                  L{item.level} · {item.subjectType}
                </Text>
              </View>
              {item.percentageCorrect != null ? (
                <Text className="text-[13px] font-heavy text-text-muted dark:text-text-muted-dark">
                  {item.percentageCorrect}%
                </Text>
              ) : null}
            </Pressable>
          );
        }}
        initialNumToRender={20}
        windowSize={10}
        maxToRenderPerBatch={20}
      />
    </SafeAreaView>
  );
}
