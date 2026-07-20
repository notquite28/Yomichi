import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LiquidGlassButton } from '../components/LiquidGlassButton';
import { openAppDatabase } from '../domain/db/database';
import { SearchResult, searchSubjects } from '../domain/db/subjectRepository';
import { RootStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/AppThemeProvider';
import { colorForSubjectType } from '../theme/subjectColors';

type Props = NativeStackScreenProps<RootStackParamList, 'SubjectSearch'>;

export function SubjectSearchScreen({ navigation }: Props) {
  const { colors } = useAppTheme();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestQueryRef = useRef('');
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const handleSearch = useCallback(async (text: string) => {
    setQuery(text);
    latestQueryRef.current = text;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!text.trim()) {
      setResults([]);
      setSearched(false);
      setIsSearching(false);
      setError(null);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      if (!isMountedRef.current || latestQueryRef.current !== text) {
        return;
      }
      setIsSearching(true);
      setError(null);
      try {
        const db = await openAppDatabase();
        const rows = await searchSubjects(db, text);
        if (!isMountedRef.current || latestQueryRef.current !== text) {
          return;
        }
        setResults(rows);
        setSearched(true);
      } catch (caught) {
        if (!isMountedRef.current || latestQueryRef.current !== text) {
          return;
        }
        setError(caught instanceof Error ? caught.message : String(caught));
        setResults([]);
        setSearched(true);
      } finally {
        if (isMountedRef.current && latestQueryRef.current === text) {
          setIsSearching(false);
        }
      }
    }, 250);
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-[#f7f4ef] dark:bg-[#0c0b0f]">
      <View className="flex-row items-center gap-[10px] px-5 pt-3 pb-1">
        <LiquidGlassButton
          label="Back"
          onPress={() => navigation.goBack()}
          accessibilityLabel="Go back"
          style={{ paddingHorizontal: 13, paddingVertical: 9 }}
          contentClassName="font-black"
        />
        <TextInput
          className="flex-1 min-h-[48px] rounded-lg border border-border dark:border-border-dark bg-surface-elevated dark:bg-surface-elevated-dark text-text dark:text-text-dark px-4 text-[16px] font-bold"
          value={query}
          onChangeText={handleSearch}
          placeholder="Search Japanese, meaning, or reading..."
          placeholderTextColor={colors.mutedText}
          autoFocus
          returnKeyType="search"
          accessibilityLabel="Search subjects"
          accessibilityHint="Search by Japanese, meaning, or reading."
        />
      </View>

      <FlatList
        data={!error && !isSearching && query.trim() && !(searched && results.length === 0) ? results : []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 28, gap: 6 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          error ? (
            <Text className="text-base font-bold text-text-muted dark:text-text-muted-dark pt-6 text-center" accessibilityRole="alert">
              Could not search subjects: {error}
            </Text>
          ) : isSearching ? (
            <Text className="text-base font-bold text-text-muted dark:text-text-muted-dark pt-6 text-center">
              Searching...
            </Text>
          ) : !query.trim() ? (
            <Text className="text-base font-bold text-text-muted dark:text-text-muted-dark pt-6 text-center">
              Search synced subjects by Japanese, meaning, or reading. If this is your first launch, sync from the dashboard first.
            </Text>
          ) : searched && results.length === 0 ? (
            <Text className="text-base font-bold text-text-muted dark:text-text-muted-dark pt-6 text-center">
              No results found for "{query}". Try another spelling, or sync from the dashboard if local data is empty.
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
        keyboardDismissMode="on-drag"
      />
    </SafeAreaView>
  );
}
