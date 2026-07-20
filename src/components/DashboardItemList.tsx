import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colorForSubjectType } from '../theme/subjectColors';
import type { AppColors } from '../theme/palette';
import type { RecentItem, LeechedItem } from '../domain/dashboard/dashboardRepository';

export function RecentItemList({
  items,
  colors,
  onPressItem,
}: {
  items: RecentItem[];
  colors: AppColors;
  onPressItem?: (subjectId: number) => void;
}) {
  if (items.length === 0) {
    return <Text style={[styles.empty, { color: colors.mutedText }]}>No recent items.</Text>;
  }

  return (
    <View style={styles.grid}>
      {items.map((item) => (
        <Pressable
          key={item.subjectId}
          onPress={() => onPressItem?.(item.subjectId)}
          disabled={!onPressItem}
          style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
          accessibilityRole={onPressItem ? 'button' : undefined}
          accessibilityLabel={`${item.japanese || 'subject'}, Level ${item.level}, ${item.subjectType}`}
        >
          <View style={[styles.typeDot, { backgroundColor: colorForSubjectType(colors, item.subjectType) }]} importantForAccessibility="no" />
          <Text style={[styles.chipJapanese, { color: colors.text }]}>{item.japanese || '?'}</Text>
          <Text style={[styles.chipMeta, { color: colors.mutedText }]}>L{item.level}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function LeechItemList({
  items,
  colors,
  onPressItem,
}: {
  items: LeechedItem[];
  colors: AppColors;
  onPressItem?: (subjectId: number) => void;
}) {
  if (items.length === 0) {
    return <Text style={[styles.empty, { color: colors.mutedText }]}>No leeches found.</Text>;
  }

  return (
    <View style={styles.grid}>
      {items.map((item) => (
        <Pressable
          key={item.subjectId}
          onPress={() => onPressItem?.(item.subjectId)}
          disabled={!onPressItem}
          style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
          accessibilityRole={onPressItem ? 'button' : undefined}
          accessibilityLabel={`${item.japanese || '?'}, Level ${item.level}, ${item.score}% incorrect`}
        >
          <View style={[styles.typeDot, { backgroundColor: colorForSubjectType(colors, item.subjectType) }]} importantForAccessibility="no" />
          <Text style={[styles.chipJapanese, { color: colors.text }]}>{item.japanese || '?'}</Text>
          <Text style={[styles.chipMeta, { color: colors.mutedText }]}>{item.score}%</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  empty: {
    fontSize: 13,
    fontWeight: '700',
    paddingTop: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.18)',
  },
  typeDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
  },
  chipJapanese: {
    fontSize: 15,
    fontWeight: '800',
  },
  chipMeta: {
    fontSize: 12,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.72,
  },
});
