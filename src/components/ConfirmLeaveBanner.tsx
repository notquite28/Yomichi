import { Pressable, Text, View } from 'react-native';
import { LiquidGlassButton } from './LiquidGlassButton';


type Props = {
  /** Shown when the banner is visible and the user needs to confirm. */
  visible: boolean;
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * Inline confirmation banner displayed at the bottom of the screen when the
 * user initiates a back action that requires confirmation (e.g., ending an
 * active review/lesson session).
 *
 * This replaces Alert.alert dialogs which interfere with Android predictive
 * back gesture animations.
 */
export function ConfirmLeaveBanner({
  visible,
  title,
  message,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
}: Props) {
  if (!visible) {
    return null;
  }

  return (
    <View
      className="absolute inset-0 justify-end px-5 pb-9 bg-[rgba(0,0,0,0.45)]"
      accessibilityViewIsModal
    >
      <Pressable
        className="absolute inset-0"
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel={cancelLabel}
        accessibilityHint="Dismisses this confirmation and returns to the active session."
      />

      <View className="bg-surface-elevated dark:bg-surface-elevated-dark rounded-2xl border border-border dark:border-border-dark p-5 gap-3 shadow-lg">

        <Text
          accessibilityRole="alert"
          accessibilityLabel={`${title}. ${message}`}
          className="text-[17px] font-black text-text dark:text-text-dark"
        >
          {title}
        </Text>
        <Text className="text-[14px] leading-5 text-text-muted dark:text-text-muted-dark">
          {message}
        </Text>
        <View className="flex-row gap-3 mt-1">
          <LiquidGlassButton
            label={cancelLabel}
            onPress={onCancel}
            className="flex-1"
            style={{ minHeight: 48, justifyContent: 'center' }}
            contentClassName="text-base font-black text-center"
            accessibilityLabel={cancelLabel}
          />

          <Pressable
            onPress={onConfirm}
            className="flex-1 min-h-[48px] rounded-full items-center justify-center bg-danger dark:bg-danger-dark"
            style={({ pressed }) =>
              pressed ? { opacity: 0.72, transform: [{ scale: 0.99 }] } : undefined
            }
            accessibilityRole="button"
            accessibilityLabel={confirmLabel}
          >
            <Text className="text-base font-black text-white text-center">
              {confirmLabel}
            </Text>
          </Pressable>

        </View>
      </View>
    </View>
  );
}
