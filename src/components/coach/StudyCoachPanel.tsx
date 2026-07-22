import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';

import { cancelGeneration, runCoachAction } from '../../domain/ai/coachService';
import { useCoachStore } from '../../domain/ai/coachStore';
import type { CoachAction, CoachStudyMaterial } from '../../domain/ai/types';
import type { SubjectAnswerData } from '../../domain/answers/answerChecker';
import { DetailSection } from '../SubjectDetailsContent';
import { useAppTheme } from '../../theme/AppThemeProvider';

type Props = {
  subject: SubjectAnswerData;
  studyMaterial: CoachStudyMaterial;
  componentSubjects?: SubjectAnswerData[];
  onSaveNote: (field: 'meaningNote' | 'readingNote', value: string) => void | Promise<void>;
};

type ActionDef = {
  action: CoachAction;
  label: string;
  hidden?: boolean;
};

export function StudyCoachPanel({
  subject,
  studyMaterial,
  componentSubjects,
  onSaveNote,
}: Props) {
  const { colors } = useAppTheme();
  const status = useCoachStore((s) => s.status);
  const lastError = useCoachStore((s) => s.lastError);
  const [activeAction, setActiveAction] = useState<CoachAction | null>(null);
  const [text, setText] = useState('');
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const actions = useMemo(() => {
    const defs: ActionDef[] = [
      { action: 'explain', label: 'Explain this item' },
      { action: 'mnemonic', label: 'Draft mnemonic' },
      { action: 'examples', label: 'Extra examples' },
      {
        action: 'unpack_context',
        label: 'Unpack context',
        hidden: !(subject.contextSentences && subject.contextSentences.length > 0),
      },
    ];
    return defs.filter((a) => !a.hidden);
  }, [subject.contextSentences]);

  const busy = isRunning || status === 'loading' || status === 'generating';
  const modelUsable =
    status === 'ready' ||
    status === 'loaded' ||
    status === 'loading' ||
    status === 'generating' ||
    status === 'error';

  if (!modelUsable) {
    return (
      <DetailSection title="Study Coach">
        <Text className="text-[14px] leading-5 font-bold text-text-muted dark:text-text-muted-dark">
          Install Study Coach in Settings to get on-device explanations and mnemonic drafts.
        </Text>
      </DetailSection>
    );
  }

  const run = async (action: CoachAction, regenerate = false) => {
    setIsRunning(true);
    setActiveAction(action);
    setError(null);
    setFromCache(false);
    if (!regenerate) {
      setText('');
    }
    try {
      const result = await runCoachAction({
        action,
        subject,
        studyMaterial,
        componentSubjects,
        contextSentenceIndex: action === 'unpack_context' ? 0 : undefined,
        regenerate,
        onToken: (soFar) => setText(soFar),
      });
      setText(result.text);
      setFromCache(result.fromCache);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (!/cancel/i.test(message)) {
        setError(message);
      }
    } finally {
      setIsRunning(false);
    }
  };

  const confirmSave = (field: 'meaningNote' | 'readingNote') => {
    const draft = text.trim();
    if (!draft) {
      return;
    }
    const existing = field === 'meaningNote' ? studyMaterial.meaningNote : studyMaterial.readingNote;
    const label = field === 'meaningNote' ? 'meaning note' : 'reading note';
    if (!existing.trim()) {
      void onSaveNote(field, draft);
      return;
    }
    Alert.alert(`Save to ${label}`, 'Append to the existing note, or replace it?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Replace',
        style: 'destructive',
        onPress: () => {
          void onSaveNote(field, draft);
        },
      },
      {
        text: 'Append',
        onPress: () => {
          void onSaveNote(field, `${existing.trim()}\n\n${draft}`);
        },
      },
    ]);
  };

  return (
    <DetailSection title="Study Coach">
      <Text className="text-[13px] leading-[18px] font-bold text-text-muted dark:text-text-muted-dark mb-1">
        On-device help for this subject. Drafts never overwrite your notes unless you save them.
      </Text>

      <View className="flex-row flex-wrap gap-2">
        {actions.map((item) => {
          const selected = activeAction === item.action;
          return (
            <Pressable
              key={item.action}
              onPress={() => void run(item.action)}
              disabled={busy}
              className="min-h-[36px] items-center justify-center rounded-full px-3 border"
              style={{
                opacity: busy && !selected ? 0.5 : 1,
                backgroundColor: selected ? '#ff00aa' : colors.surface,
                borderColor: selected ? '#ff00aa' : colors.border,
              }}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={{ disabled: busy, busy: selected && isRunning }}
            >
              <Text
                className={`text-[13px] font-heavy ${selected ? 'text-white' : 'text-text dark:text-text-dark'}`}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {busy ? (
        <View className="flex-row items-center gap-2 mt-1">
          <ActivityIndicator color={colors.mutedText} />
          <Text className="text-[13px] font-bold text-text-muted dark:text-text-muted-dark">
            {status === 'loading' ? 'Loading model…' : 'Generating…'}
          </Text>
          <Pressable
            onPress={() => {
              cancelGeneration();
              setIsRunning(false);
            }}
            accessibilityRole="button"
            accessibilityLabel="Cancel generation"
          >
            <Text className="text-[13px] font-heavy text-danger dark:text-danger-dark">Cancel</Text>
          </Pressable>
        </View>
      ) : null}

      {error || (status === 'error' && lastError) ? (
        <Text className="text-[13px] font-bold text-danger dark:text-danger-dark mt-1">
          {error ?? lastError}
        </Text>
      ) : null}

      {text ? (
        <View className="mt-1 gap-2">
          <Text className="text-[15px] leading-[21px] font-heavy text-text dark:text-text-dark">
            {text}
          </Text>
          <View className="flex-row flex-wrap gap-2 items-center">
            {fromCache ? (
              <Text className="text-[12px] font-bold text-text-muted dark:text-text-muted-dark">
                From cache
              </Text>
            ) : null}
            {activeAction ? (
              <Pressable
                onPress={() => void run(activeAction, true)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Regenerate coach response"
              >
                <Text className="text-[13px] font-heavy text-text dark:text-text-dark underline">
                  Regenerate
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => confirmSave('meaningNote')}
              disabled={busy || !text.trim()}
              accessibilityRole="button"
              accessibilityLabel="Save to meaning note"
            >
              <Text className="text-[13px] font-heavy text-text dark:text-text-dark underline">
                Save to meaning note
              </Text>
            </Pressable>
            <Pressable
              onPress={() => confirmSave('readingNote')}
              disabled={busy || !text.trim()}
              accessibilityRole="button"
              accessibilityLabel="Save to reading note"
            >
              <Text className="text-[13px] font-heavy text-text dark:text-text-dark underline">
                Save to reading note
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </DetailSection>
  );
}
