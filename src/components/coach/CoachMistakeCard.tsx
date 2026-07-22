import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { cancelGeneration } from '../../domain/ai/coachService';
import { useAppTheme } from '../../theme/AppThemeProvider';

type Props = {
  text: string;
  isRunning: boolean;
  error: string | null;
  onDismiss?: () => void;
};

export function CoachMistakeCard({ text, isRunning, error, onDismiss }: Props) {
  const { colors } = useAppTheme();

  return (
    <View className="rounded-md p-3.5 bg-surface-elevated dark:bg-surface-elevated-dark border border-border dark:border-border-dark gap-1.5">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="text-[13px] font-black uppercase tracking-ultra text-text-muted dark:text-text-muted-dark">
          Why wrong?
        </Text>
        {isRunning ? (
          <Pressable
            onPress={() => {
              cancelGeneration();
            }}
            accessibilityRole="button"
            accessibilityLabel="Cancel mistake explanation"
          >
            <Text className="text-[12px] font-heavy text-danger dark:text-danger-dark">Cancel</Text>
          </Pressable>
        ) : onDismiss ? (
          <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss explanation">
            <Text className="text-[12px] font-heavy text-text-muted dark:text-text-muted-dark">Dismiss</Text>
          </Pressable>
        ) : null}
      </View>

      {isRunning && !text ? (
        <View className="flex-row items-center gap-2">
          <ActivityIndicator color={colors.mutedText} />
          <Text className="text-[13px] font-bold text-text-muted dark:text-text-muted-dark">
            Thinking…
          </Text>
        </View>
      ) : null}

      {error ? (
        <Text className="text-[13px] font-bold text-danger dark:text-danger-dark">{error}</Text>
      ) : null}

      {text ? (
        <Text className="text-[15px] leading-[21px] font-heavy text-text dark:text-text-dark">{text}</Text>
      ) : null}
    </View>
  );
}
