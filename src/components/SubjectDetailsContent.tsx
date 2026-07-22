import React from 'react';
import { Image, Pressable, Text, TextInput, View } from 'react-native';

import { SubjectAnswerData } from '../domain/answers/answerChecker';
import {
  normalizeMnemonicMarkup,
  parseMnemonicMarkup,
  type MnemonicToken,
} from '../domain/ai/mnemonicMarkup';
import { useAppTheme } from '../theme/AppThemeProvider';
import { colorForSubjectType } from '../theme/subjectColors';

export type SubjectDetailsContentProps = {
  subject: SubjectAnswerData;
  componentSubjects: Map<number, SubjectAnswerData>;
  amalgamationSubjects: Map<number, SubjectAnswerData>;
  studyMaterial: { meaningSynonyms: string[]; meaningNote: string; readingNote: string };
  meaningAttempted: boolean;
  readingAttempted: boolean;
  showFullAnswer: boolean;
  isReview: boolean;
  useKatakanaForOnyomi?: boolean;
  showAllReadings?: boolean;
  onNavigateToSubject?: (subjectId: number) => void;
  onEditMeaningSynonyms?: (value: string[]) => Promise<void> | void;
  onEditMeaningNote?: (value: string) => Promise<void> | void;
  onEditReadingNote?: (value: string) => Promise<void> | void;

};

export function SubjectDetailsContent({
  subject,
  componentSubjects,
  amalgamationSubjects,
  studyMaterial,
  meaningAttempted,
  readingAttempted,
  showFullAnswer,
  isReview,
  useKatakanaForOnyomi = false,
  showAllReadings = false,
  onNavigateToSubject,
  onEditMeaningSynonyms,
  onEditMeaningNote,
  onEditReadingNote,
}: SubjectDetailsContentProps) {
  const { colors } = useAppTheme();

  const primaryMeanings = subject.meanings
    .filter((m) => m.type === 'primary' && m.acceptedAnswer !== false)
    .map((m) => m.meaning);
  const secondaryMeanings = subject.meanings
    .filter((m) => m.type !== 'primary' && m.type !== 'blacklist' && m.acceptedAnswer !== false)
    .map((m) => m.meaning);
  const primaryReadings = (subject.readings ?? []).filter((r) => r.primary).map((r) => {
    if (useKatakanaForOnyomi && r.type === 'onyomi') return hiraganaToKatakana(r.reading);
    return r.reading;
  });
  const alternateReadings = showAllReadings
    ? (subject.readings ?? []).filter((r) => !r.primary && r.acceptedAnswer !== false).map((r) => {
        if (useKatakanaForOnyomi && r.type === 'onyomi') return hiraganaToKatakana(r.reading);
        return r.reading;
      })
    : [];

  const meaningShown = !isReview || showFullAnswer || meaningAttempted;
  const readingShown = !isReview || showFullAnswer || readingAttempted;

  const meaningSection = (
    <DetailSection key="meaning" title="Meaning">
      <Text className="text-[16px] leading-[22px] font-heavy text-text dark:text-text-dark">
        {primaryMeanings.join(', ')}
      </Text>
      {secondaryMeanings.length > 0 ? (
        <Text className="text-[14px] font-bold text-text-muted dark:text-text-muted-dark">
          {secondaryMeanings.join(', ')}
        </Text>
      ) : null}
      <DetailSynonymField
        value={studyMaterial.meaningSynonyms}
        onSave={onEditMeaningSynonyms}
      />
    </DetailSection>
  );

  const readingSection = primaryReadings.length > 0 ? (
    <DetailSection key="reading" title="Reading">
      <Text className="text-[16px] leading-[22px] font-heavy text-text dark:text-text-dark">
        {primaryReadings.join(', ')}
      </Text>
      {alternateReadings.length > 0 ? (
        <Text className="text-[14px] font-bold text-text-muted dark:text-text-muted-dark">
          {alternateReadings.join(', ')}
        </Text>
      ) : null}
    </DetailSection>
  ) : null;

  const componentSection = componentSubjects.size > 0 ? (
    <DetailSection
      key="components"
      title={subject.type === 'kanji' ? 'Radical Combination' : 'Components'}
    >
      <View className="flex-row flex-wrap gap-2 items-center">
        {[...componentSubjects.values()].map((comp, idx) => {
          const compMeaning = comp.meanings.find((m) => m.type === 'primary' && m.acceptedAnswer !== false)?.meaning;
          const compColor = colorForSubjectType(colors, comp.type);
          return (
            <View key={comp.id ?? comp.japanese} className="flex-row items-center gap-1.5">
              {idx > 0 ? <Text className="text-[16px] font-heavy text-text-muted dark:text-text-muted-dark">+</Text> : null}
              <Pressable
                onPress={() => comp.id && onNavigateToSubject?.(comp.id)}
                disabled={!onNavigateToSubject}
              >
                <View className="rounded-[10px] px-3 py-1.5 bg-surface dark:bg-surface-dark border-[1.5px]" style={{ borderColor: compColor }}>
                  <ComponentChipContent subject={comp} color={compColor} />
                </View>
              </Pressable>
              {compMeaning ? <Text className="text-[14px] font-bold text-text dark:text-text-dark">{compMeaning}</Text> : null}
            </View>
          );
        })}
      </View>
    </DetailSection>
  ) : null;

  const meaningMnemonicSection = subject.meaningMnemonic ? (
    <DetailSection
      key="meaningMnemonic"
      title={subject.type === 'radical' ? 'Mnemonic' : 'Meaning Explanation'}
    >
      <MnemonicText text={subject.meaningMnemonic} subjectLookup={componentSubjects} />
      {subject.meaningHint ? (
        <MnemonicText
          text={`Hint: ${subject.meaningHint}`}
          subjectLookup={componentSubjects}
          className="text-[13px] italic font-bold text-text-muted dark:text-text-muted-dark mt-1"
        />
      ) : null}
    </DetailSection>
  ) : null;

  const readingMnemonicSection = subject.readingMnemonic ? (
    <DetailSection key="readingMnemonic" title="Reading Explanation">
      <MnemonicText text={subject.readingMnemonic} subjectLookup={componentSubjects} />
      {subject.readingHint ? (
        <MnemonicText
          text={`Hint: ${subject.readingHint}`}
          subjectLookup={componentSubjects}
          className="text-[13px] italic font-bold text-text-muted dark:text-text-muted-dark mt-1"
        />
      ) : null}
    </DetailSection>
  ) : null;

  const hasMeaningNoteField = Boolean(onEditMeaningNote || studyMaterial.meaningNote) && meaningShown;
  const hasReadingNoteField = Boolean(onEditReadingNote || studyMaterial.readingNote) && readingShown;
  const notesSection = hasMeaningNoteField || hasReadingNoteField ? (
    <DetailSection key="studyMaterialNotes" title="Study Material Notes">
      {hasMeaningNoteField ? (
        <DetailNoteField
          label="Meaning Note"
          value={studyMaterial.meaningNote}
          onSave={onEditMeaningNote}
        />
      ) : null}
      {hasReadingNoteField ? (
        <DetailNoteField
          label="Reading Note"
          value={studyMaterial.readingNote}
          onSave={onEditReadingNote}
        />
      ) : null}
    </DetailSection>
  ) : null;

  const contextSentencesSection = subject.contextSentences && subject.contextSentences.length > 0 ? (
    <DetailSection key="context" title="Context Sentences">
      {subject.contextSentences.map((sentence, idx) => (
        <View key={idx} className="gap-0.5">
          <Text className="text-base font-heavy text-text dark:text-text-dark">{sentence.ja}</Text>
          <Text className="text-[14px] font-bold text-text-muted dark:text-text-muted-dark">{sentence.en}</Text>
        </View>
      ))}
    </DetailSection>
  ) : null;

  const partsOfSpeechSection = subject.partsOfSpeech && subject.partsOfSpeech.length > 0 ? (
    <DetailSection key="pos" title="Part of Speech">
      <Text className="text-[16px] leading-[22px] font-heavy text-text dark:text-text-dark">
        {subject.partsOfSpeech.join(', ')}
      </Text>
    </DetailSection>
  ) : null;

  const amalgamationSection = amalgamationSubjects.size > 0 ? (
    <DetailSection key="amalgamations" title="Used In">
      <View className="flex-row flex-wrap gap-2 items-center">
        {[...amalgamationSubjects.values()].map((amalgam) => {
          const amColor = colorForSubjectType(colors, amalgam.type);
          return (
            <Pressable
              key={amalgam.id ?? amalgam.japanese}
              onPress={() => amalgam.id && onNavigateToSubject?.(amalgam.id)}
              disabled={!onNavigateToSubject}
            >
              <View className="rounded-[10px] px-3 py-1.5 bg-surface dark:bg-surface-dark border-[1.5px]" style={{ borderColor: amColor }}>
                <ComponentChipContent subject={amalgam} color={amColor} />
              </View>
            </Pressable>
          );
        })}
      </View>
    </DetailSection>
  ) : null;

  type SectionEntry = { node: React.ReactNode; visible: boolean; key: string };
  const orderedSections: SectionEntry[] = [];

  if (meaningSection) orderedSections.push({ node: meaningSection, visible: meaningShown, key: 'meaning' });
  if (readingSection) orderedSections.push({ node: readingSection, visible: readingShown, key: 'reading' });
  if (componentSection) orderedSections.push({ node: componentSection, visible: true, key: 'components' });

  if (subject.type === 'radical') {
    if (meaningMnemonicSection) orderedSections.push({ node: meaningMnemonicSection, visible: meaningShown, key: 'meaningMnemonic' });
  } else {
    if (meaningMnemonicSection) orderedSections.push({ node: meaningMnemonicSection, visible: meaningShown, key: 'meaningMnemonic' });
    if (readingMnemonicSection) orderedSections.push({ node: readingMnemonicSection, visible: readingShown, key: 'readingMnemonic' });
  }

  if (notesSection) orderedSections.push({ node: notesSection, visible: true, key: 'studyMaterialNotes' });

  const visibleSections: React.ReactNode[] = [];
  const hiddenQueue: React.ReactNode[] = [];
  let hasHidden = false;

  for (const entry of orderedSections) {
    if (entry.visible) {
      visibleSections.push(entry.node);
    } else {
      hiddenQueue.push(entry.node);
      hasHidden = true;
    }
  }

  const alwaysVisibleSections = [contextSentencesSection, partsOfSpeechSection, amalgamationSection].filter(
    Boolean,
  ) as React.ReactNode[];

  if (isReview && hasHidden && !showFullAnswer) {
    return (
      <View className="gap-4">
        {visibleSections}
        {alwaysVisibleSections}
      </View>
    );
  }

  return (
    <View className="gap-4">
      {orderedSections.map((entry) => entry.node)}
      {alwaysVisibleSections}
    </View>
  );
}

function DetailNoteField({ label, value, onSave }: {
  label: string;
  value: string;
  onSave?: (value: string) => Promise<void> | void;
}) {

  const [editing, setEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(value);
  const [isSaving, setIsSaving] = React.useState(false);

  const saveEdit = async () => {
    if (!onSave || isSaving) return;
    setIsSaving(true);
    try {
      await onSave(editValue);
      setEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  if (!onSave) {
    if (!value) return null;
    return (
      <View className="mt-2 gap-0.5">
        <Text className="text-sm font-heavy text-text-muted dark:text-text-muted-dark">{label}</Text>
        <Text className="text-[14px] font-bold text-text dark:text-text-dark">{value}</Text>
      </View>
    );
  }

  if (!editing) {
    return (
      <View className="mt-2 gap-1">
        <Text className="text-sm font-heavy text-text-muted dark:text-text-muted-dark">{label}</Text>
        {value ? <Text className="text-[14px] font-bold text-text dark:text-text-dark">{value}</Text> : null}
        <Pressable onPress={() => { setEditing(true); setEditValue(value); }}>
          <Text className="text-sm font-bold text-text-muted dark:text-text-muted-dark">
            {value ? 'Edit' : `Add ${label}`}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="mt-2 gap-1.5">
      <Text className="text-sm font-heavy text-text-muted dark:text-text-muted-dark">{label}</Text>
      <TextInput
        className="min-h-[44px] rounded-[12px] border border-border dark:border-border-dark bg-surface-elevated dark:bg-surface-elevated-dark text-text dark:text-text-dark px-3 text-[14px] font-bold"
        value={editValue}
        onChangeText={setEditValue}
        autoFocus
        multiline
        editable={!isSaving}

      />
      <View className="flex-row gap-2">
        <Pressable
          onPress={() => { if (!isSaving) setEditing(false); }}
          className="px-3 py-1.5 rounded-[10px] border border-border dark:border-border-dark"
          disabled={isSaving}

        >
          <Text className="text-[13px] font-bold text-text dark:text-text-dark">Cancel</Text>
        </Pressable>
        <Pressable
          onPress={saveEdit}
          className="px-3 py-1.5 rounded-[10px] bg-kanji"
          disabled={isSaving}
        >
          <Text className="text-[13px] font-bold text-white">{isSaving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function DetailSynonymField({ value, onSave }: {
  value: string[];
  onSave?: (value: string[]) => Promise<void> | void;
}) {
  const { colors } = useAppTheme();

  const [editing, setEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(value.join(', '));
  const [isSaving, setIsSaving] = React.useState(false);

  const saveEdit = async () => {
    if (!onSave || isSaving) return;
    setIsSaving(true);
    try {
      await onSave(editValue.split(',').map((s) => s.trim()).filter(Boolean));
      setEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  if (!onSave) {
    if (value.length === 0) return null;
    return (
      <Text className="text-[14px] font-bold text-text-muted dark:text-text-muted-dark">
        Synonyms: {value.join(', ')}
      </Text>
    );
  }

  if (!editing) {
    return (
      <View className="mt-2 gap-1">
        <Text className="text-sm font-heavy text-text-muted dark:text-text-muted-dark">Synonyms</Text>
        {value.length > 0 ? (
          <Text className="text-[14px] font-bold text-text dark:text-text-dark">{value.join(', ')}</Text>
        ) : null}
        <Pressable onPress={() => { setEditing(true); setEditValue(value.join(', ')); }}>
          <Text className="text-sm font-bold text-text-muted dark:text-text-muted-dark">
            {value.length > 0 ? 'Edit' : 'Add Synonyms'}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="mt-2 gap-1.5">
      <Text className="text-sm font-heavy text-text-muted dark:text-text-muted-dark">Synonyms</Text>
      <TextInput
        className="min-h-[44px] rounded-[12px] border border-border dark:border-border-dark bg-surface-elevated dark:bg-surface-elevated-dark text-text dark:text-text-dark px-3 text-[14px] font-bold"
        value={editValue}
        onChangeText={setEditValue}
        placeholder="comma, separated, synonyms"
        placeholderTextColor={colors.mutedText}
        autoFocus
        editable={!isSaving}
      />
      <View className="flex-row gap-2">
        <Pressable
          onPress={() => { if (!isSaving) setEditing(false); }}
          className="px-3 py-1.5 rounded-[10px] border border-border dark:border-border-dark"
          disabled={isSaving}
        >
          <Text className="text-[13px] font-bold text-text dark:text-text-dark">Cancel</Text>
        </Pressable>
        <Pressable
          onPress={saveEdit}
          className="px-3 py-1.5 rounded-[10px] bg-kanji"
          disabled={isSaving}
        >
          <Text className="text-[13px] font-bold text-white">{isSaving ? 'Saving...' : 'Save'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function DetailSection({ title, children }: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-[13px] font-black uppercase tracking-ultra text-text-muted dark:text-text-muted-dark">
        {title}
      </Text>
      <View className="rounded-md p-3.5 bg-surface-elevated dark:bg-surface-elevated-dark border border-border dark:border-border-dark gap-1">
        {children}
      </View>
    </View>
  );
}

export function ComponentChipContent({ subject, color }: {
  subject: SubjectAnswerData;
  color: string;
}) {
  if (!subject.japanese && subject.characterImageUrl && !subject.characterImageIsSvg) {
    return <Image source={{ uri: subject.characterImageUrl }} className="w-6 h-6" resizeMode="contain" />;
  }
  return <Text className="text-[16px] font-black" style={{ color }}>{subject.japanese || subject.type}</Text>;
}

const EMPTY_SUBJECT_LOOKUP = new Map<number, SubjectAnswerData>();

export type { MnemonicToken };

const tagColors: Record<string, string> = {
  radical: '#00aaff',
  kanji: '#ff00aa',
  kan: '#ff00aa',
  vocabulary: '#aa00ff',
  reading: '#aa00ff',
  ja: '#aa00ff',
  jp: '#aa00ff',
  meaning: '#ff00aa',
};

export function MnemonicText({
  text,
  subjectLookup,
  className = 'text-[16px] leading-[22px] font-heavy text-text dark:text-text-dark',
}: {
  text: string;
  subjectLookup?: Map<number, SubjectAnswerData>;
  className?: string;
}) {
  const tokens = parseMnemonicMarkup(normalizeMnemonicMarkup(text));
  const lookup = subjectLookup ?? EMPTY_SUBJECT_LOOKUP;
  return (
    <Text className={className}>
      {tokens.map((token, idx) => {
        if (token.type === 'tag') {
          const tag = token.tag ?? '';
          const color = tagColors[tag];
          return (
            <Text key={idx} className="font-black" style={color ? { color } : undefined}>
              {token.text}
            </Text>
          );
        }
        if (token.type === 'curly') {
          const content = token.text;
          const subj = [...lookup.values()].find(
            (s) => s.meanings.some((m) => m.meaning.toLowerCase() === content.toLowerCase()) || s.japanese === content,
          );
          if (subj?.japanese) {
            return <Text key={idx} className="font-black text-kanji">{subj.japanese}</Text>;
          }
          return <Text key={idx} className="font-black text-kanji">{content}</Text>;
        }
        return <Text key={idx}>{token.text}</Text>;
      })}
    </Text>
  );
}

function hiraganaToKatakana(text: string): string {
  const HIRAGANA_OFFSET = 0x3041;
  const KATAKANA_OFFSET = 0x30a1;
  const HIRAGANA_END = 0x3096;
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= HIRAGANA_OFFSET && code <= HIRAGANA_END) {
      result += String.fromCharCode(code - HIRAGANA_OFFSET + KATAKANA_OFFSET);
    } else {
      result += text[i];
    }
  }
  return result;
}
