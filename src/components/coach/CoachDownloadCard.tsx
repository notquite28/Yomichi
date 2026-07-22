import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, Text, View } from 'react-native';

import {
  cancelModelDownload,
  deleteModel,
  getModelDisplayInfo,
  releaseModel,
  startModelDownload,
} from '../../domain/ai/coachService';
import { useCoachStore } from '../../domain/ai/coachStore';
import type { CoachStatus } from '../../domain/ai/types';
import { useSettingsStore } from '../../domain/settings/settingsStore';
import { useAppTheme } from '../../theme/AppThemeProvider';

function statusLabel(status: CoachStatus, progress: number | null): string {
  switch (status) {
    case 'unavailable':
      return 'Unavailable on this platform';
    case 'not_installed':
      return 'Not installed';
    case 'downloading':
      return progress != null
        ? `Downloading ${Math.round(progress * 100)}%`
        : 'Downloading…';
    case 'ready':
      return 'Ready (not loaded)';
    case 'loading':
      return progress != null
        ? `Loading model ${Math.round(progress * 100)}%`
        : 'Loading model…';
    case 'loaded':
      return 'Loaded in memory';
    case 'generating':
      return 'Generating…';
    case 'error':
      return 'Error';
    default:
      return status;
  }
}

export function CoachDownloadCard() {
  const { colors } = useAppTheme();
  const status = useCoachStore((s) => s.status);
  const downloadProgress = useCoachStore((s) => s.downloadProgress);
  const lastError = useCoachStore((s) => s.lastError);
  const studyCoachEnabled = useSettingsStore((s) => s.studyCoachEnabled);
  const wifiOnly = useSettingsStore((s) => s.studyCoachWifiOnlyDownload);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const [busy, setBusy] = useState(false);
  const info = getModelDisplayInfo();

  const canInstall = status === 'not_installed' || status === 'error';
  const canCancel = status === 'downloading';
  const canDelete =
    status === 'ready' ||
    status === 'loaded' ||
    status === 'loading' ||
    status === 'generating' ||
    status === 'error';
  const canRelease = status === 'loaded' || status === 'generating';
  const modelReady =
    status === 'ready' ||
    status === 'loaded' ||
    status === 'loading' ||
    status === 'generating';

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert('Study Coach', message);
    } finally {
      setBusy(false);
    }
  };

  const handleInstall = () => {
    void run(async () => {
      await startModelDownload({
        wifiOnly,
        allowCellular: !wifiOnly,
      });
    });
  };

  const handleEnable = (value: boolean) => {
    if (value && !modelReady && status !== 'downloading') {
      Alert.alert(
        'Install Study Coach?',
        `Enable Study Coach and download ${info.displayName} (${info.approxSizeLabel})? Runs fully on device.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Install',
            onPress: () => {
              updateSetting('studyCoachEnabled', true);
              handleInstall();
            },
          },
        ],
      );
      return;
    }
    updateSetting('studyCoachEnabled', value);
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Study Coach model?',
      'Removes the on-device model and cached coach replies. Study continues without AI assist.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            updateSetting('studyCoachEnabled', false);
            void run(() => deleteModel());
          },
        },
      ],
    );
  };

  return (
    <View className="gap-2.5">
      <Text className="text-base leading-[21px] font-bold text-text-muted dark:text-text-muted-dark">
        Optional on-device Japanese study coach powered by Sakana AI TinySwallow. Nothing is sent to a
        server. Download is opt-in ({info.approxSizeLabel}).
      </Text>

      <View className="flex-row items-center justify-between gap-3 pt-[10px] border-t border-border dark:border-border-dark">
        <View className="flex-1 gap-0.5">
          <Text className="text-base font-heavy text-text dark:text-text-dark">Enable Study Coach</Text>
          <Text className="text-[13px] leading-[18px] font-bold text-text-muted dark:text-text-muted-dark">
            Show coach actions on subject detail and after incorrect reviews.
          </Text>
        </View>
        <Pressable
          onPress={() => handleEnable(!studyCoachEnabled)}
          disabled={status === 'unavailable' || busy}
          accessibilityRole="switch"
          accessibilityState={{ checked: studyCoachEnabled, disabled: status === 'unavailable' || busy }}
          className="min-h-[36px] min-w-[56px] items-center justify-center rounded-full px-3 border"
          style={{
            backgroundColor: studyCoachEnabled ? '#ff00aa' : colors.surfaceElevated,
            borderColor: studyCoachEnabled ? '#ff00aa' : colors.border,
            opacity: status === 'unavailable' || busy ? 0.5 : 1,
          }}
        >
          <Text className="text-[12px] font-black text-white">
            {studyCoachEnabled ? 'ON' : 'OFF'}
          </Text>
        </Pressable>
      </View>

      <View className="flex-row items-center justify-between gap-3 pt-[10px] border-t border-border dark:border-border-dark">
        <View className="flex-1 gap-0.5">
          <Text className="text-base font-heavy text-text dark:text-text-dark">Wi‑Fi only download</Text>
          <Text className="text-[13px] leading-[18px] font-bold text-text-muted dark:text-text-muted-dark">
            Prefer Wi‑Fi for the {info.approxSizeLabel} model download.
          </Text>
        </View>
        <Pressable
          onPress={() => updateSetting('studyCoachWifiOnlyDownload', !wifiOnly)}
          disabled={busy}
          accessibilityRole="switch"
          accessibilityState={{ checked: wifiOnly, disabled: busy }}
          className="min-h-[36px] min-w-[56px] items-center justify-center rounded-full px-3 border"
          style={{
            backgroundColor: wifiOnly ? '#ff00aa' : colors.surfaceElevated,
            borderColor: wifiOnly ? '#ff00aa' : colors.border,
            opacity: busy ? 0.5 : 1,
          }}
        >
          <Text className="text-[12px] font-black text-white">{wifiOnly ? 'ON' : 'OFF'}</Text>
        </Pressable>
      </View>

      <View className="rounded-md p-3 bg-surface-elevated dark:bg-surface-elevated-dark border border-border dark:border-border-dark gap-1">
        <Text className="text-[13px] font-black uppercase tracking-ultra text-text-muted dark:text-text-muted-dark">
          Status
        </Text>
        <Text className="text-[15px] font-heavy text-text dark:text-text-dark">
          {statusLabel(status, downloadProgress)}
        </Text>
        {lastError ? (
          <Text className="text-[13px] font-bold text-danger dark:text-danger-dark">{lastError}</Text>
        ) : null}
        {status === 'downloading' && downloadProgress != null ? (
          <View className="mt-1 h-2 rounded-full overflow-hidden bg-border dark:bg-border-dark">
            <View
              className="h-full rounded-full"
              style={{ width: `${Math.round(downloadProgress * 100)}%`, backgroundColor: '#ff00aa' }}
            />
          </View>
        ) : null}
      </View>

      <View className="flex-row flex-wrap gap-2">
        {canInstall ? (
          <ActionChip
            label={busy ? 'Working…' : `Install (${info.approxSizeLabel})`}
            onPress={handleInstall}
            disabled={busy}
            primary
          />
        ) : null}
        {canCancel ? (
          <ActionChip
            label="Cancel download"
            onPress={() => void run(() => cancelModelDownload())}
            disabled={busy}
          />
        ) : null}
        {canRelease ? (
          <ActionChip
            label="Release from memory"
            onPress={() => void run(() => releaseModel())}
            disabled={busy}
          />
        ) : null}
        {canDelete ? (
          <ActionChip label="Delete model & data" onPress={handleDelete} disabled={busy} danger />
        ) : null}
        {(status === 'downloading' || status === 'loading' || busy) && (
          <View className="min-h-[40px] justify-center px-1">
            <ActivityIndicator color={colors.mutedText} />
          </View>
        )}
      </View>

      <Pressable
        onPress={() => {
          void Linking.openURL(info.modelCardUrl);
        }}
        accessibilityRole="link"
        accessibilityLabel="Open TinySwallow model card"
      >
        <Text className="text-[13px] leading-[18px] font-bold text-text-muted dark:text-text-muted-dark underline">
          Apache-2.0 weights (Sakana AI TinySwallow). Training includes Gemma-derived data — see model card.
        </Text>
      </Pressable>
    </View>
  );
}

function ActionChip({
  label,
  onPress,
  disabled,
  primary,
  danger,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className="min-h-[40px] items-center justify-center rounded-full px-3.5 border"
      style={({ pressed }) => ({
        opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
        backgroundColor: primary ? '#ff00aa' : danger ? 'transparent' : undefined,
        borderColor: danger ? '#e11d48' : primary ? '#ff00aa' : 'rgba(32,26,36,0.16)',
      })}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      accessibilityLabel={label}
    >
      <Text
        className={`text-[13px] font-heavy ${
          primary ? 'text-white' : danger ? 'text-danger dark:text-danger-dark' : 'text-text dark:text-text-dark'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
