import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { DeterministicCardModel } from '../../domain/study/learningEvidence';
import { useAppTheme } from '../../theme/AppThemeProvider';

type Props = {
  card: DeterministicCardModel;
  generatedText?: string;
  isRunning?: boolean;
  error?: string | null;
  onPracticePair?: () => void;
  onNotNow: () => void;
  onHelpful?: () => void;
  onNotHelpful?: () => void;
  onGenerate?: () => void;
  canGenerate?: boolean;
};

export function MistakeLensCard({
  card,
  generatedText,
  isRunning = false,
  error = null,
  onPracticePair,
  onNotNow,
  onHelpful,
  onNotHelpful,
  onGenerate,
  canGenerate = false,
}: Props) {
  const { colors } = useAppTheme();

  return (
    <View className="rounded-md p-3.5 bg-surface-elevated dark:bg-surface-elevated-dark border border-border dark:border-border-dark gap-2">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="text-[13px] font-black uppercase tracking-ultra text-text-muted dark:text-text-muted-dark">
          {card.title}
        </Text>
        <View className="flex-row items-center gap-2">
          {canGenerate && onGenerate ? (
            <Pressable
              onPress={onGenerate}
              disabled={isRunning}
              accessibilityRole="button"
              accessibilityLabel="AI: Generate mistake lens explanation"
              hitSlop={6}
            >
              {isRunning ? (
                <ActivityIndicator color={colors.mutedText} size="small" />
              ) : (
                <Ionicons name="sparkles" size={18} color={colors.kanji} />
              )}
            </Pressable>
          ) : null}
          <Pressable onPress={onNotNow} accessibilityRole="button" accessibilityLabel="Dismiss mistake lens">
            <Text className="text-[12px] font-heavy text-text-muted dark:text-text-muted-dark">Not now</Text>
          </Pressable>
        </View>
      </View>

      <Text className="text-[15px] font-black text-text dark:text-text-dark">
        {card.primaryLabel}
        {card.otherLabel ? ` ↔ ${card.otherLabel}` : ''}
      </Text>

      {card.enteredAnswer ? (
        <Text className="text-[13px] font-bold text-text-muted dark:text-text-muted-dark">
          You entered: {card.enteredAnswer}
        </Text>
      ) : null}

      {card.missCount != null ? (
        <Text className="text-[13px] font-bold text-text-muted dark:text-text-muted-dark">
          Miss count ({card.taskType}): {card.missCount}
        </Text>
      ) : null}

      {card.primaryAccepted.length > 0 ? (
        <Text className="text-[13px] font-bold text-text dark:text-text-dark">
          Accepted: {card.primaryAccepted.join(', ')}
        </Text>
      ) : null}

      {card.otherAccepted && card.otherAccepted.length > 0 ? (
        <Text className="text-[13px] font-bold text-text dark:text-text-dark">
          Other accepted: {card.otherAccepted.join(', ')}
        </Text>
      ) : null}

      {card.contrastBullets.map((bullet) => (
        <Text
          key={bullet}
          className="text-[13px] leading-[18px] font-bold text-text-muted dark:text-text-muted-dark"
        >
          • {bullet}
        </Text>
      ))}

      {card.mnemonicSnippet ? (
        <Text className="text-[12px] leading-[17px] font-bold text-text-muted dark:text-text-muted-dark">
          Official mnemonic: {card.mnemonicSnippet}
        </Text>
      ) : null}

      {error ? (
        <Text className="text-[13px] font-bold text-danger dark:text-danger-dark">{error}</Text>
      ) : null}

      {generatedText ? (
        <Text className="text-[14px] leading-[20px] font-heavy text-text dark:text-text-dark">
          {generatedText}
        </Text>
      ) : null}

      <View className="flex-row flex-wrap gap-2 mt-1">
        {onPracticePair && !card.ambiguous && card.otherSubjectId != null ? (
          <Pressable
            onPress={onPracticePair}
            accessibilityRole="button"
            accessibilityLabel="Practice this confusion pair"
            className="rounded-full px-3 py-1.5 bg-kanji"
          >
            <Text className="text-white text-[12px] font-black">Practice pair</Text>
          </Pressable>
        ) : null}
        {onHelpful ? (
          <Pressable
            onPress={onHelpful}
            accessibilityRole="button"
            accessibilityLabel="Mark helpful"
            className="rounded-full px-3 py-1.5 bg-[#f2eee8] dark:bg-[#201e26]"
          >
            <Text className="text-text dark:text-text-dark text-[12px] font-black">Helpful</Text>
          </Pressable>
        ) : null}
        {onNotHelpful ? (
          <Pressable
            onPress={onNotHelpful}
            accessibilityRole="button"
            accessibilityLabel="Mark not helpful"
            className="rounded-full px-3 py-1.5 bg-[#f2eee8] dark:bg-[#201e26]"
          >
            <Text className="text-text dark:text-text-dark text-[12px] font-black">Not helpful</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
