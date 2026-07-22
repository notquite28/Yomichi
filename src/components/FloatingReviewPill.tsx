import { LiquidGlassView, isLiquidGlassSupported } from '@callstack/liquid-glass';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, FadeOutDown, LinearTransition } from 'react-native-reanimated';

import { TooltipPressable } from './TooltipPressable';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { useAppTheme } from '../theme/AppThemeProvider';
import { compositeAlpha, readableOnColor, withAlpha } from '../theme/colorUtils';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

type Props = {
  subjectColor: string;
  visible: boolean;

  feedback: { correct: boolean; message: string; detail: string } | null;
  isContinuing: boolean;
  ankiMode: boolean;
  ankiRevealed: boolean;
  answerEmpty: boolean;
  canWrapUp: boolean;
  wrappingUp: boolean;
  showCheats: boolean;
  canAddSynonym: boolean;
  showExplainMistake?: boolean;
  isOffline: boolean;
  isVocabulary: boolean;

  onSubmit: () => void;
  onContinue: () => void;
  onAnkiMark: (correct: boolean) => void;
  onWrapUp: () => void;
  onPlayAudio: () => void;
  onOverrideCorrect: () => void;
  onAskAgainLater: () => void;
  onAddSynonym: () => void;
  onExplainMistake?: () => void;
};

const AnimatedView = Animated.View;

const pillMotion = () => LinearTransition.springify().damping(24).stiffness(210).mass(0.72);
const pillEntrance = () => FadeInDown.springify().damping(22).stiffness(230).mass(0.78);
const pillExit = () => FadeOutDown.duration(140);
const controlMotion = () => LinearTransition.springify().damping(26).stiffness(240).mass(0.7);
const controlEntrance = () => FadeIn.duration(160).delay(35);
const controlExit = () => FadeOut.duration(110);

export function FloatingReviewPill({
  subjectColor,
  visible,
  feedback,
  isContinuing,
  ankiMode,
  ankiRevealed,
  answerEmpty,
  canWrapUp,
  wrappingUp,
  showCheats,
  canAddSynonym,
  showExplainMistake = false,
  isOffline,
  isVocabulary,
  onSubmit,
  onContinue,
  onAnkiMark,
  onWrapUp,
  onPlayAudio,
  onOverrideCorrect,
  onAskAgainLater,
  onAddSynonym,
  onExplainMistake,
}: Props) {
  const { colors, isDark } = useAppTheme();
  const keyboardHeight = useKeyboardHeight();

  const accentColor = feedback ? (feedback.correct ? colors.success : colors.danger) : subjectColor;
  const tintColor = withAlpha(accentColor, feedback ? (isDark ? 0.22 : 0.12) : (isDark ? 0.14 : 0.08));
  const glassBg = isDark ? 'rgba(32, 30, 38, 0.34)' : 'rgba(255, 255, 255, 0.78)';
  const glassBorder = isDark ? 'rgba(255,255,255,0.16)' : 'rgba(32,26,36,0.22)';
  const fallbackBg = isDark ? 'rgba(32, 30, 38, 0.72)' : 'rgba(255, 255, 255, 0.88)';
  const fallbackBorder = isDark ? 'rgba(255,255,255,0.16)' : 'rgba(32,26,36,0.28)';
  const pillBg = isLiquidGlassSupported ? glassBg : fallbackBg;
  const effectivePillBg = compositeAlpha(pillBg, colors.background);

  if (!visible) {
    return null;
  }

  const disabled = isContinuing;
  const showAnkiReveal = ankiMode && !feedback && !ankiRevealed;
  const showAnkiMarks = ankiMode && ankiRevealed && !feedback;

  const primaryLabel = showAnkiReveal
    ? 'Show Answer'
    : feedback
      ? isContinuing
        ? 'Saving answer'
        : feedback.correct
          ? 'Continue after correct answer'
          : 'Continue after incorrect answer'
      : 'Submit Answer';

  const primaryIcon = 'arrow-forward';
  const bottomPadding = Platform.OS === 'android' ? Math.max(20, keyboardHeight) : 20;

  return (
    <AnimatedView
      className="px-5"
      entering={pillEntrance()}
      exiting={pillExit()}
      layout={pillMotion()}
      style={{ paddingBottom: bottomPadding }}
    >
      <AnimatedView layout={pillMotion()}>
        <AnimatedView layout={pillMotion()}>
          {feedback && (
            <AnimatedView
              entering={FadeIn.duration(250).springify().damping(20).stiffness(180)}
              exiting={FadeOut.duration(180)}
              style={[
                styles.glow,
                {
                  backgroundColor: withAlpha(accentColor, isDark ? 0.35 : 0.22),
                  shadowColor: accentColor,
                  shadowOpacity: isDark ? 0.65 : 0.5,
                  shadowRadius: 28,
                  shadowOffset: { width: 0, height: 0 },
                },
              ]}
            />
          )}
          <LiquidGlassView
            interactive
            effect={isDark ? 'regular' : 'clear'}
            colorScheme={isDark ? 'dark' : 'light'}
            tintColor={tintColor}
            style={[
              styles.pillGlass,
              {
                backgroundColor: glassBg,
                borderWidth: 1,
                borderColor: glassBorder,
                shadowColor: '#000',
                shadowOpacity: isDark ? 0.18 : 0.12,
                shadowRadius: 14,
                shadowOffset: { width: 0, height: 7 },
                elevation: 4,
              },
              !isLiquidGlassSupported && {
                backgroundColor: fallbackBg,
                borderWidth: 1,
                borderColor: fallbackBorder,
              },
            ]}
          >
            {feedback && (
              <AnimatedView
                entering={FadeInDown.springify().damping(22).stiffness(200).mass(0.8)}
                exiting={FadeOut.duration(120)}
                layout={controlMotion()}
                accessible
                accessibilityLiveRegion="polite"
                accessibilityLabel={`${feedback.message}. ${feedback.detail}`}
                className="px-5 pt-3 pb-1 gap-0.5 items-center"
              >
                <Text className="text-base font-black" style={{ color: accentColor }}>
                  {feedback.message}
                </Text>
                <ScrollView
                  className="max-h-20 self-stretch"
                  showsVerticalScrollIndicator={false}
                  nestedScrollEnabled
                >
                  <Text className="text-sm font-bold text-text-muted dark:text-text-muted-dark text-center">
                    {feedback.detail}
                  </Text>
                </ScrollView>
              </AnimatedView>
            )}
            <AnimatedView
              className="flex-row items-center justify-between px-5 py-2.5"
              layout={controlMotion()}
            >
            {isVocabulary && feedback && (
              <AnimatedIconButton
                icon="play"
                label={isOffline ? 'Audio unavailable offline' : 'Play audio'}
                onPress={onPlayAudio}
                disabled={disabled || isOffline}
                effectivePillBg={effectivePillBg}
              />
            )}

            {showCheats && (
              <>
                <AnimatedIconButton
                  icon="refresh-circle"
                  label="Try again later"
                  onPress={onAskAgainLater}
                  disabled={disabled}
                  effectivePillBg={effectivePillBg}
                />
                <AnimatedIconButton
                  icon="shield-checkmark"
                  label="My answer was correct"
                  onPress={onOverrideCorrect}
                  disabled={disabled}
                  effectivePillBg={effectivePillBg}
                />
                {canAddSynonym && (
                  <AnimatedIconButton
                    icon="git-merge"
                    label="Add as synonym"
                    onPress={onAddSynonym}
                    disabled={disabled}
                    effectivePillBg={effectivePillBg}
                  />
                )}
                {showExplainMistake && onExplainMistake ? (
                  <AnimatedIconButton
                    icon="help-circle"
                    label="Why was this wrong?"
                    onPress={onExplainMistake}
                    disabled={disabled}
                    effectivePillBg={effectivePillBg}
                  />
                ) : null}
              </>
            )}

            {canWrapUp && !wrappingUp && !feedback && (
              <AnimatedIconButton icon="timer-outline" label="Wrap up" onPress={onWrapUp} disabled={disabled} effectivePillBg={effectivePillBg} />
            )}

            {showAnkiMarks ? (
              <>
                <AnimatedIconButton
                  icon="close"
                  label="Incorrect"
                  onPress={() => onAnkiMark(false)}
                  bgColor={colors.danger}
                  disabled={disabled}
                  effectivePillBg={effectivePillBg}
                />
                <AnimatedIconButton
                  icon="checkmark"
                  label="Correct"
                  onPress={() => onAnkiMark(true)}
                  bgColor={colors.success}
                  disabled={disabled}
                  effectivePillBg={effectivePillBg}
                />
              </>
            ) : (
              <AnimatedIconButton
                icon={primaryIcon}
                label={primaryLabel}
                onPress={feedback ? onContinue : onSubmit}
                disabled={disabled || (!feedback && !ankiMode && answerEmpty)}
                bgColor={accentColor}
                size="lg"
                effectivePillBg={effectivePillBg}
                iconColor={feedback ? readableOnColor(effectivePillBg) : undefined}
              />
            )}
            </AnimatedView>
          </LiquidGlassView>
        </AnimatedView>
      </AnimatedView>
    </AnimatedView>
  );
}

function IconButton({
  icon,
  label,
  onPress,
  disabled,
  bgColor,
  size = 'md',
  effectivePillBg,
  iconColor: iconColorOverride,
}: {
  icon: IoniconsName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  bgColor?: string;
  size?: 'md' | 'lg';
  effectivePillBg?: string;
  iconColor?: string;
}) {
  const { colors, isDark } = useAppTheme();

  const hasBgColor = !!bgColor;
  const frostedBg = isDark ? 'rgba(255,255,255,0.22)' : 'rgba(32,26,36,0.18)';
  const frostedBorder = isDark ? 'rgba(255,255,255,0.32)' : 'rgba(32,26,36,0.30)';
  const disabledColoredBg = bgColor ? withAlpha(bgColor, isDark ? 0.45 : 0.40) : undefined;
  const disabledColoredBorder = bgColor ? withAlpha(bgColor, isDark ? 0.55 : 0.55) : undefined;
  const resolvedBg = disabled ? (disabledColoredBg ?? bgColor) : bgColor;
  const iconColor = iconColorOverride ?? (hasBgColor
    ? readableOnColor(resolvedBg, effectivePillBg)
    : colors.text);

  return (
    <TooltipPressable
      tooltip={label}
      onPress={onPress}
      disabled={disabled}
      className={`rounded-full items-center justify-center ${size === 'lg' ? 'w-12 h-12' : 'w-10 h-10'}`}
      style={({ pressed }) => [
        hasBgColor
          ? disabled
            ? { backgroundColor: disabledColoredBg, borderWidth: 1, borderColor: disabledColoredBorder }
            : { backgroundColor: bgColor }
          : { backgroundColor: frostedBg, borderWidth: 1, borderColor: frostedBorder },
        pressed ? { opacity: 0.5 } : undefined,
        disabled && !hasBgColor ? { opacity: 0.5 } : undefined,
      ]}
      accessibilityLabel={label}
    >
      <Ionicons
        name={icon}
        size={size === 'lg' ? 22 : 18}
        color={iconColor}
      />
    </TooltipPressable>
  );
}

function AnimatedIconButton({
  icon,
  label,
  onPress,
  disabled,
  bgColor,
  size = 'md',
  effectivePillBg,
  iconColor,
}: {
  icon: IoniconsName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  bgColor?: string;
  size?: 'md' | 'lg';
  effectivePillBg?: string;
  iconColor?: string;
}) {
  return (
    <AnimatedView
      className="flex-1 items-center"
      entering={controlEntrance()}
      exiting={controlExit()}
      layout={controlMotion()}
    >
      <IconButton
        icon={icon}
        label={label}
        onPress={onPress}
        disabled={disabled}
        bgColor={bgColor}
        size={size}
        effectivePillBg={effectivePillBg}
        iconColor={iconColor}
      />
    </AnimatedView>
  );
}


const styles = StyleSheet.create({
  pillGlass: {
    borderRadius: 9999,
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    top: -6,
    left: -6,
    right: -6,
    bottom: -6,
    borderRadius: 9999,
    zIndex: -1,
  },
});
