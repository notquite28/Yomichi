import { ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView as RNScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LiquidGlassButton } from './LiquidGlassButton';
import { useAppTheme } from '../theme/AppThemeProvider';

export type SessionProgress = {
  label: string;
  current: number;
  total: number;
};


export function ScreenLayout({
  children,
  scrollable = false,
  keyboardShouldPersistTaps = false,
  keyboardAvoiding = false,
  scrollViewRef,
  overlay,
  footer,
}: {
  children: ReactNode;
  scrollable?: boolean;
  keyboardShouldPersistTaps?: boolean;
  keyboardAvoiding?: boolean;
  scrollViewRef?: React.RefObject<RNScrollView | null>;
  overlay?: ReactNode;
  footer?: ReactNode;
}) {
  if (scrollable) {
    const scrollView = (
      <RNScrollView
        ref={scrollViewRef}
        className="flex-1"
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 20,
          paddingTop: 20,
          paddingBottom: footer ? 32 : 20,
          gap: 18,
        }}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps ? 'handled' : undefined}
      >
        {children}
      </RNScrollView>
    );

    const bodyContent = footer ? (
      <View className="flex-1">
        {scrollView}
        {footer}
      </View>
    ) : (
      scrollView
    );

    const body = keyboardAvoiding ? (
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {bodyContent}
      </KeyboardAvoidingView>
    ) : (
      bodyContent
    );

    return (
      <SafeAreaView className="flex-1 bg-background dark:bg-background-dark">
        {body}
        {overlay}
      </SafeAreaView>
    );
  }

  const bodyContent = footer ? (
    <View className="flex-1">
      <View className="flex-1">{children}</View>
      {footer}
    </View>
  ) : (
    <View className="flex-1">{children}</View>
  );

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-background-dark">
      {bodyContent}
      {overlay}
    </SafeAreaView>
  );
}

export function CenteredMessage({
  label,
  actionLabel,
  onAction,
}: {
  label: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <ScreenLayout>
      <View className="flex-1 items-center justify-center p-6 gap-4">
        <ActivityIndicator
          color="#ff00aa"
          className={actionLabel ? 'opacity-0' : ''}
          accessibilityLabel={actionLabel ? undefined : label}
        />
        <Text className="text-lg font-heavy text-text dark:text-text-dark text-center" accessibilityRole="text">
          {label}
        </Text>
        {actionLabel ? (
          <Pressable
            onPress={onAction}
            className="min-h-[54px] items-center justify-center rounded-lg px-4.5 bg-kanji"
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
          >
            <Text className="text-white text-[16px] font-black">
              {actionLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </ScreenLayout>
  );
}

export function SessionHeader({
  onBack,
  progress,
  onSettings,
  dimmed = false,
}: {
  onBack: () => void;
  progress: string | SessionProgress;
  onSettings?: () => void;
  dimmed?: boolean;
}) {
  const { colors } = useAppTheme();
  const completion = typeof progress === 'string' || progress.total <= 0
    ? 0
    : Math.min(1, Math.max(0, progress.current / progress.total));

  return (
    <View className="flex-row items-center justify-between">
      <LiquidGlassButton
        label="Back"
        onPress={onBack}
        disabled={dimmed}
        accessibilityLabel="Go back"
        style={{ paddingHorizontal: 14, paddingVertical: 10, minHeight: 38, justifyContent: 'center' }}
        contentClassName="font-black"
      />
      {typeof progress === 'string' ? (
        <Text className="text-text-muted dark:text-text-muted-dark font-black">
          {progress}
        </Text>
      ) : (
        <View className="items-center gap-1">
          <Text
            accessibilityRole="text"
            accessibilityLabel={progress.label}
            className="text-text-muted dark:text-text-muted-dark font-black"
          >
            {progress.label}
          </Text>
          {progress.total > 0 ? (
            <View
              accessible={false}
              importantForAccessibility="no"
              style={{
                width: 72,
                height: 4,
                borderRadius: 9999,
                overflow: 'hidden',
                backgroundColor: colors.border,
              }}
            >
              <View
                style={{
                  width: `${completion * 100}%`,
                  height: '100%',
                  borderRadius: 9999,
                  backgroundColor: colors.kanji,
                }}
              />
            </View>
          ) : null}
        </View>
      )}
      {onSettings ? (
        <LiquidGlassButton
          tooltip="Quick settings"
          accessibilityHint="Wrap up, end session, or change answer mode"
          onPress={onSettings}
          accessibilityLabel="Quick settings"
          style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text className="text-text dark:text-text-dark text-lg">⚙</Text>
        </LiquidGlassButton>
      ) : (
        <View className="w-[38px]" />
      )}
    </View>
  );
}
