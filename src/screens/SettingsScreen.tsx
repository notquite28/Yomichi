import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	Alert,
	Linking,
	Pressable,
	ScrollView,
	Switch,
	Text,
	View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LiquidGlassButton } from "../components/LiquidGlassButton";
import { CoachDownloadCard } from "../components/coach/CoachDownloadCard";
import {
	getVoiceActorOptions,
	type VoiceActorOption,
} from "../domain/audio/vocabularyAudio";
import { openAppDatabase, resetLocalData } from "../domain/db/database";
import {
	clearReviewNotifications,
	getNotificationPermissionStatus,
	requestNotificationPermissions,
	rescheduleReviewNotifications,
} from "../domain/notifications";
import {
	type AppSettings,
	type BurnedPracticeOrder,
	type ReviewOrder,
	type SubjectType,
} from "../domain/settings/settings";
import { useSettingsStore } from "../domain/settings/settingsStore";
import { deleteApiToken } from "../domain/storage/secureToken";
import type { RootStackParamList } from "../navigation/types";
import { useAppTheme } from "../theme/AppThemeProvider";

type Props = NativeStackScreenProps<RootStackParamList, "Settings"> & {
	onLoggedOut: () => void;
};

const REVIEW_ORDER_LABELS: Record<ReviewOrder, string> = {
	random: "Random",
	ascendingSrsStage: "Ascending SRS",
	descendingSrsStage: "Descending SRS",
	alternatingSrsStage: "Alternating SRS",
	currentLevelFirst: "Current Level First",
	lowestLevelFirst: "Lowest Level First",
	newestAvailableFirst: "Newest Available",
	oldestAvailableFirst: "Oldest Available",
	longestRelativeWait: "Longest Wait",
};

const BURNED_PRACTICE_ORDER_LABELS: Record<BurnedPracticeOrder, string> = {
	oldestBurned: "Oldest burned",
	newestBurned: "Newest burned",
	random: "Random",
	levelAscending: "Level",
};

const LESSON_ORDER_LABELS: Record<SubjectType, string> = {
  radical: "Radicals",
  kanji: "Kanji",
  vocabulary: "Vocabulary",
};

function formatHour(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

export function SettingsScreen({ navigation, onLoggedOut }: Props) {
	const theme = useAppTheme();
	const settings = useSettingsStore();
	const updateSetting = useSettingsStore((s) => s.updateSetting);
	const [voiceActors, setVoiceActors] = useState<VoiceActorOption[]>([]);
	const [isLoggingOut, setIsLoggingOut] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let isMounted = true;
		(async () => {
			const db = await openAppDatabase();
			const loadedVoiceActors = await getVoiceActorOptions(db);
			if (!isMounted) {
				return;
			}
			setVoiceActors(loadedVoiceActors);
		})().catch(() => {});
		return () => {
			isMounted = false;
		};
	}, []);

	const hasWarnedRevoked = useRef(false);
	useEffect(() => {
		const unsubscribe = navigation.addListener("focus", async () => {
			if (hasWarnedRevoked.current) return;

			const currentSettings = useSettingsStore.getState();
			const hasNotificationEnabled =
				currentSettings.notificationsEnabled ||
				currentSettings.notificationsBadging ||
				currentSettings.notificationSounds;
			if (!hasNotificationEnabled) return;

			const status = await getNotificationPermissionStatus();
			if (status === "denied") {
				hasWarnedRevoked.current = true;
				Alert.alert(
					"Notifications Disabled",
					"Notification permission was revoked in system settings. Notifications won't be delivered until you re-enable them.",
					[
						{ text: "Dismiss", style: "cancel" },
						{
							text: "Open Settings",
							onPress: () => Linking.openSettings(),
						},
					],
				);
			}
		});
		return unsubscribe;
	}, [navigation]);

	const updateNotificationSetting = useCallback(
		async <
			K extends
				| "notificationsEnabled"
				| "notificationsBadging"
				| "notificationSounds"
				| "notificationThreshold"
				| "notificationDailyTime",
		>(
			key: K,
			value: AppSettings[K],
		) => {
			if (
				value === true &&
				(key === "notificationsEnabled" ||
					key === "notificationsBadging" ||
					key === "notificationSounds")
			) {
				const granted = await requestNotificationPermissions();
				if (!granted) {
					Alert.alert(
						"Notifications Disabled",
						"Open system settings to allow notifications for 読路.",
						[
							{ text: "Cancel", style: "cancel" },
							{
								text: "Open Settings",
								onPress: () => Linking.openSettings(),
							},
						],
					);
					return;
				}
			}

			const previousValue = useSettingsStore.getState()[key];
			updateSetting(key, value);
			try {
				await rescheduleReviewNotifications();
			} catch (caught) {
				updateSetting(key, previousValue);
				await rescheduleReviewNotifications().catch(() => {});
				Alert.alert(
					"Notification Update Failed",
					`Your notification setting was not changed because scheduling failed. ${caught instanceof Error ? caught.message : String(caught)}`,
				);
			}
		},
		[updateSetting],
	);

	const performLogout = async () => {
		setError(null);
		setIsLoggingOut(true);
		try {
			const db = await openAppDatabase();
			let tokenDeleteError: string | null = null;
			await deleteApiToken().catch((caught) => {
				tokenDeleteError = caught instanceof Error ? caught.message : String(caught);
			});
			try {
				await resetLocalData(db);
			} catch (caught) {
				const message =
					caught instanceof Error ? caught.message : String(caught);
				setError(`Token removed, but cache clear failed: ${message}`);
			}
			await clearReviewNotifications();
			if (tokenDeleteError) {
				Alert.alert(
					"Stored token could not be removed",
					`You're signed out in this session, but the token may still be stored on this device. Restarting the app may sign you back in. Try logging out again.\n\n${tokenDeleteError}`,
				);
			}
			onLoggedOut();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setIsLoggingOut(false);
		}
	};

	const confirmLogout = () => {
		Alert.alert(
			"Log out and clear cache?",
			"This removes your API token, local cache, pending queues, and scheduled review notifications from this device.",
			[
				{ text: "Cancel", style: "cancel" },
				{ text: "Log Out", style: "destructive", onPress: performLogout },
			],
		);
	};

	return (
		<SafeAreaView className="flex-1 bg-[#f7f4ef] dark:bg-[#0c0b0f]">
			<ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 28, gap: 14 }}>
				<LiquidGlassButton
					label="Back"
					onPress={() => navigation.goBack()}
					accessibilityLabel="Go back"
					className="self-start"
					style={{ paddingHorizontal: 13, paddingVertical: 9 }}
					contentClassName="font-black"
				/>

				<View className="px-0.5 pt-[14px] pb-1.5">
					<Text className="text-xs font-heavy tracking-ultra3 uppercase text-text-muted dark:text-text-muted-dark">読路</Text>
					<Text className="mt-1.5 text-5xl font-black tracking-tightest text-text dark:text-text-dark">Settings</Text>
					<Text className="mt-[10px] text-[16px] leading-[22px] font-bold text-text-muted dark:text-text-muted-dark">
						Account and study preferences.
					</Text>
				</View>

				<View
					className="rounded-[26px] p-[18px] bg-[#fffdf8] dark:bg-[#15141a] border border-[rgba(32,26,36,0.08)] dark:border-[rgba(255,255,255,0.08)] gap-[10px]"
					style={{
						shadowColor: "#000000",
						shadowOpacity: theme.isDark ? 0.16 : 0.05,
						shadowRadius: 18,
						shadowOffset: { width: 0, height: 10 },
						elevation: 4,
					}}
				>
					<Text className="text-2xl font-black tracking-tight text-text dark:text-text-dark">Reviews</Text>

					<Text className="text-xs font-black tracking-ultra uppercase text-text-muted dark:text-text-muted-dark mt-1.5">Review Order</Text>
					<View className="flex-row flex-wrap gap-2">
						{(
							Object.entries(REVIEW_ORDER_LABELS) as [ReviewOrder, string][]
						).map(([value, label]) => (
							<Pressable
								key={value}
								onPress={() => updateSetting("reviewOrder", value)}
								className={`rounded-full px-[14px] py-2 border ${
									settings.reviewOrder === value
										? "bg-kanji border-kanji"
										: "bg-surface dark:bg-surface-dark border-border dark:border-border-dark"
								}`}
								accessibilityRole="button"
								accessibilityLabel={label}
								accessibilityState={{ selected: settings.reviewOrder === value }}
							>
								<Text
									className={`text-[13px] font-heavy ${
										settings.reviewOrder === value ? "text-white" : "text-text dark:text-text-dark"
									}`}
								>
									{label}
								</Text>
							</Pressable>
						))}
					</View>

					<SettingToggle
						label="Anki Mode"
						detail="Reveal the answer first, then self-grade. One card per item."
						value={settings.ankiMode}
						onValueChange={(v) => updateSetting("ankiMode", v)}
					/>

					<SettingToggle
						label="Exact Match"
						detail="Disable fuzzy matching for meaning answers."
						value={settings.exactMatch}
						onValueChange={(v) => updateSetting("exactMatch", v)}
					/>

					{!settings.ankiMode ? (
						<>
							<SettingToggle
								label="Group Meaning & Reading"
								detail="Ask meaning and reading back-to-back for each item."
								value={settings.groupMeaningReading}
								onValueChange={(v) => updateSetting("groupMeaningReading", v)}
							/>

							{settings.groupMeaningReading ? (
								<SettingToggle
									label="Meaning First"
									detail="Ask meaning before reading when grouped."
									value={settings.meaningFirst}
									onValueChange={(v) => updateSetting("meaningFirst", v)}
								/>
							) : null}
						</>
					) : null}

					<SettingToggle
						label="Minimize Review Penalty"
						detail="Cap wrong counts to 1 per task type."
						value={settings.minimizeReviewPenalty}
						onValueChange={(v) => updateSetting("minimizeReviewPenalty", v)}
					/>

					<SettingToggle
						label="Enable Cheats"
						detail="Allow override correct, try again later, and add synonym."
						value={settings.enableCheats}
						onValueChange={(v) => updateSetting("enableCheats", v)}
					/>

					<SettingStepper
						label="Batch Size"
						detail="Items in the active review queue."
						value={settings.reviewBatchSize}
						min={1}
						max={15}
						onChange={(v) => updateSetting("reviewBatchSize", v)}
					/>

					<SettingToggle
						label="Limit Review Count"
						detail={`Cap reviews at ${settings.reviewItemsLimit} items.`}
						value={settings.reviewItemsLimitEnabled}
						onValueChange={(v) => updateSetting("reviewItemsLimitEnabled", v)}
					/>

					{settings.reviewItemsLimitEnabled ? (
						<SettingStepper
							label="Review Limit"
							detail="Maximum reviews per session."
							value={settings.reviewItemsLimit}
							min={5}
							max={500}
							step={5}
							onChange={(v) => updateSetting("reviewItemsLimit", v)}
						/>
					) : null}

					<SettingStepper
						label="Leech Threshold"
						detail="Incorrect/correct ratio threshold for leech detection."
						value={settings.leechThreshold}
						min={1}
						max={10}
						onChange={(v) => updateSetting("leechThreshold", v)}
					/>

					<Text className="text-xs font-black tracking-ultra uppercase text-text-muted dark:text-text-muted-dark mt-1.5 pt-[10px] border-t border-border dark:border-border-dark">Burned Practice</Text>

					<View className="flex-row flex-wrap gap-2">
						{(
							Object.entries(BURNED_PRACTICE_ORDER_LABELS) as [BurnedPracticeOrder, string][]
						).map(([value, label]) => (
							<Pressable
								key={value}
								onPress={() => updateSetting("burnedPracticeOrder", value)}
								className={`rounded-full px-[14px] py-2 border ${
									settings.burnedPracticeOrder === value
										? "bg-kanji border-kanji"
										: "bg-surface dark:bg-surface-dark border-border dark:border-border-dark"
								}`}
								accessibilityRole="button"
								accessibilityLabel={label}
								accessibilityState={{ selected: settings.burnedPracticeOrder === value }}
							>
								<Text
									className={`text-[13px] font-heavy ${
										settings.burnedPracticeOrder === value ? "text-white" : "text-text dark:text-text-dark"
									}`}
								>
									{label}
								</Text>
							</Pressable>
						))}
					</View>

					<SettingStepper
						label="Burned Session Size"
						detail="Maximum burned items per practice session."
						value={settings.burnedPracticeLimit}
						min={10}
						max={200}
						step={10}
						onChange={(v) => updateSetting("burnedPracticeLimit", v)}
					/>

					<SettingToggle
						label="Include Radicals"
						detail="Practice burned radicals."
						value={settings.burnedPracticeIncludeRadicals}
						onValueChange={(v) => updateSetting("burnedPracticeIncludeRadicals", v)}
					/>

					<SettingToggle
						label="Include Kanji"
						detail="Practice burned kanji."
						value={settings.burnedPracticeIncludeKanji}
						onValueChange={(v) => updateSetting("burnedPracticeIncludeKanji", v)}
					/>

					<SettingToggle
						label="Include Vocabulary"
						detail="Practice burned vocabulary."
						value={settings.burnedPracticeIncludeVocabulary}
						onValueChange={(v) => updateSetting("burnedPracticeIncludeVocabulary", v)}
					/>
				</View>

				<View
					className="rounded-[26px] p-[18px] bg-[#fffdf8] dark:bg-[#15141a] border border-[rgba(32,26,36,0.08)] dark:border-[rgba(255,255,255,0.08)] gap-[10px]"
					style={{
						shadowColor: "#000000",
						shadowOpacity: theme.isDark ? 0.16 : 0.05,
						shadowRadius: 18,
						shadowOffset: { width: 0, height: 10 },
						elevation: 4,
					}}
				>
					<Text className="text-2xl font-black tracking-tight text-text dark:text-text-dark">Audio</Text>
					<Text className="text-base leading-[21px] font-bold text-text-muted dark:text-text-muted-dark">
						Stream vocabulary pronunciation audio during reviews. Offline downloads are not enabled yet.
					</Text>

					<Text className="text-xs font-black tracking-ultra uppercase text-text-muted dark:text-text-muted-dark mt-1.5">Voice Actor</Text>
					<View className="flex-row flex-wrap gap-2">
						<Pressable
							onPress={() => updateSetting("preferredVoiceActorId", null)}
							className={`rounded-full px-[14px] py-2 border ${
								settings.preferredVoiceActorId === null
									? "bg-kanji border-kanji"
									: "bg-surface dark:bg-surface-dark border-border dark:border-border-dark"
							}`}
							accessibilityRole="button"
							accessibilityLabel="Auto"
						>
							<Text
								className={`text-[13px] font-heavy ${
									settings.preferredVoiceActorId === null ? "text-white" : "text-text dark:text-text-dark"
								}`}
							>
								Auto
							</Text>
						</Pressable>
						{voiceActors.map((voiceActor) => {
							const active = settings.preferredVoiceActorId === voiceActor.id;
							const subtitle = [voiceActor.description, voiceActor.gender]
								.filter(Boolean)
								.join(" - ");
							return (
								<Pressable
									key={voiceActor.id}
									onPress={() =>
										updateSetting("preferredVoiceActorId", voiceActor.id)
									}
									className={`rounded-full px-[14px] py-2 border ${
										active
											? "bg-kanji border-kanji"
											: "bg-surface dark:bg-surface-dark border-border dark:border-border-dark"
									}`}
									accessibilityLabel={
										subtitle
											? `${voiceActor.name}, ${subtitle}`
											: voiceActor.name
									}
									accessibilityRole="button"
								>
									<Text
										className={`text-[13px] font-heavy ${active ? "text-white" : "text-text dark:text-text-dark"}`}
									>
										{voiceActor.name}
									</Text>
								</Pressable>
							);
						})}
					</View>
					{voiceActors.length === 0 ? (
						<Text className="text-base leading-[21px] font-bold text-text-muted dark:text-text-muted-dark">
							Voice actors will appear after sync downloads them.
						</Text>
					) : null}

					<SettingToggle
						label="Play Audio Automatically"
						detail="Play vocabulary audio after correct reading answers."
						value={settings.playAudioAutomatically}
						onValueChange={(v) => updateSetting("playAudioAutomatically", v)}
					/>

					<SettingToggle
						label="Interrupt Background Audio"
						detail="Duck other audio while pronunciation audio plays."
						value={settings.interruptBackgroundAudio}
						onValueChange={(v) => updateSetting("interruptBackgroundAudio", v)}
					/>
				</View>

				<View
					className="rounded-[26px] p-[18px] bg-[#fffdf8] dark:bg-[#15141a] border border-[rgba(32,26,36,0.08)] dark:border-[rgba(255,255,255,0.08)] gap-[10px]"
					style={{
						shadowColor: "#000000",
						shadowOpacity: theme.isDark ? 0.16 : 0.05,
						shadowRadius: 18,
						shadowOffset: { width: 0, height: 10 },
						elevation: 4,
					}}
				>
					<Text className="text-2xl font-black tracking-tight text-text dark:text-text-dark">Study Coach</Text>
					<CoachDownloadCard />
				</View>

				<View
					className="rounded-[26px] p-[18px] bg-[#fffdf8] dark:bg-[#15141a] border border-[rgba(32,26,36,0.08)] dark:border-[rgba(255,255,255,0.08)] gap-[10px]"
					style={{
						shadowColor: "#000000",
						shadowOpacity: theme.isDark ? 0.16 : 0.05,
						shadowRadius: 18,
						shadowOffset: { width: 0, height: 10 },
						elevation: 4,
					}}
				>
					<Text className="text-2xl font-black tracking-tight text-text dark:text-text-dark">Notifications</Text>

					<SettingToggle
						label="Review Notifications"
						detail="Get notified when reviews are ready."
						value={settings.notificationsEnabled}
						onValueChange={(v) =>
							updateNotificationSetting("notificationsEnabled", v)
						}
					/>

					<SettingToggle
						label="Badge Icon"
						detail="Show review count on the app icon."
						value={settings.notificationsBadging}
						onValueChange={(v) =>
							updateNotificationSetting("notificationsBadging", v)
						}
					/>

					<SettingToggle
						label="Notification Sound"
						detail="Play a sound when the notification fires."
						value={settings.notificationSounds}
						onValueChange={(v) =>
							updateNotificationSetting("notificationSounds", v)
						}
					/>

				<Text className="text-xs font-black tracking-ultra uppercase text-text-muted dark:text-text-muted-dark mt-1.5">Triggers</Text>

				<Text className="text-base leading-[21px] font-bold text-text-muted dark:text-text-muted-dark">
					Notify when the threshold is reached, or via a daily reminder.
				</Text>

				<SettingStepper
					label="Review Threshold"
					detail={`Notify when ${settings.notificationThreshold} reviews are pending.`}
					value={settings.notificationThreshold}
					min={1}
					max={200}
					onChange={(v) =>
						updateNotificationSetting("notificationThreshold", v)
					}
				/>

				<SettingToggle
					label="Daily Reminder"
					detail={
						settings.notificationDailyTime != null
							? `Remind at ${formatHour(settings.notificationDailyTime)} each day.`
							: "Get a daily reminder to review."
					}
					value={settings.notificationDailyTime != null}
					onValueChange={(v) =>
						updateNotificationSetting(
							"notificationDailyTime",
							v ? 20 : null,
						)
					}
				/>

				{settings.notificationDailyTime != null ? (
					<SettingStepper
						label="Reminder Time"
						detail={`Daily reminder at ${formatHour(settings.notificationDailyTime)}.`}
						value={settings.notificationDailyTime}
						min={0}
						max={23}
						onChange={(v) =>
							updateNotificationSetting("notificationDailyTime", v)
						}
						displayValue={formatHour(settings.notificationDailyTime)}
					/>
				) : null}
				</View>

				<View
					className="rounded-[26px] p-[18px] bg-[#fffdf8] dark:bg-[#15141a] border border-[rgba(32,26,36,0.08)] dark:border-[rgba(255,255,255,0.08)] gap-[10px]"
					style={{
						shadowColor: "#000000",
						shadowOpacity: theme.isDark ? 0.16 : 0.05,
						shadowRadius: 18,
						shadowOffset: { width: 0, height: 10 },
						elevation: 4,
					}}
				>
					<Text className="text-2xl font-black tracking-tight text-text dark:text-text-dark">Lessons</Text>

					<SettingStepper
						label="New Items Per Quiz"
						detail="New lessons introduced before each lesson quiz."
						value={settings.lessonBatchSize}
						min={1}
						max={10}
						onChange={(v) => updateSetting("lessonBatchSize", v)}
					/>

					<SettingStepper
						label="Max Lessons Per Session"
						detail="Maximum lessons pulled from the dashboard Lessons card."
						value={settings.lessonSessionSize}
						min={1}
						max={50}
						onChange={(v) => updateSetting("lessonSessionSize", v)}
					/>

					<SettingToggle
						label="Prioritize Current Level"
						detail="Show current-level items first in lessons."
						value={settings.prioritizeCurrentLevel}
						onValueChange={(v) => updateSetting("prioritizeCurrentLevel", v)}
					/>

					<SettingToggle
						label="Interleave Lessons"
						detail="Randomize item order across types within each level."
						value={settings.interleaveLessons}
						onValueChange={(v) => updateSetting("interleaveLessons", v)}
					/>

					<SettingToggle
						label="Show Kana-Only Vocabulary"
						detail="Include kana-only vocabulary in lessons."
						value={settings.showKanaOnlyVocab}
						onValueChange={(v) => updateSetting("showKanaOnlyVocab", v)}
					/>

					<Text className="text-xs font-black tracking-ultra uppercase text-text-muted dark:text-text-muted-dark mt-1.5">Subject Type Order</Text>
					<Text className="text-base leading-[21px] font-bold text-text-muted dark:text-text-muted-dark">
						Use the up and down controls to set lesson priority.
					</Text>
					<LessonOrderEditor
						order={settings.lessonOrder}
						onChange={(order) => updateSetting("lessonOrder", order)}
					/>
				</View>

				<View
					className="rounded-[26px] p-[18px] bg-[#fffdf8] dark:bg-[#15141a] border border-[rgba(32,26,36,0.08)] dark:border-[rgba(255,255,255,0.08)] gap-[10px]"
					style={{
						shadowColor: "#000000",
						shadowOpacity: theme.isDark ? 0.16 : 0.05,
						shadowRadius: 18,
						shadowOffset: { width: 0, height: 10 },
						elevation: 4,
					}}
				>
					<Text className="text-2xl font-black tracking-tight text-text dark:text-text-dark">Subject Details</Text>

					<SettingToggle
						label="Katakana for Onyomi"
						detail="Display onyomi (Chinese-origin) kanji readings in katakana."
						value={settings.useKatakanaForOnyomi}
						onValueChange={(v) => updateSetting("useKatakanaForOnyomi", v)}
					/>

					<SettingToggle
						label="Show All Readings"
						detail="Show all accepted readings, not just primary."
						value={settings.showAllReadings}
						onValueChange={(v) => updateSetting("showAllReadings", v)}
					/>
				</View>

				<View
					className="rounded-[26px] p-[18px] bg-[#fffdf8] dark:bg-[#15141a] border border-[rgba(32,26,36,0.08)] dark:border-[rgba(255,255,255,0.08)] gap-[10px]"
					style={{
						shadowColor: "#000000",
						shadowOpacity: theme.isDark ? 0.16 : 0.05,
						shadowRadius: 18,
						shadowOffset: { width: 0, height: 10 },
						elevation: 4,
					}}
				>
					<Text className="text-2xl font-black tracking-tight text-text dark:text-text-dark">Diagnostics</Text>
					<Text className="text-base leading-[21px] font-bold text-text-muted dark:text-text-muted-dark">
						View cache stats, sync state, and error log.
					</Text>
					<Pressable
						onPress={() => navigation.navigate("Diagnostics")}
						className="min-h-[44px] items-center justify-center rounded bg-surface dark:bg-surface-dark border border-border dark:border-border-dark"
						style={({ pressed }) =>
							pressed ? { opacity: 0.72, transform: [{ scale: 0.99 }] } : undefined
						}
						accessibilityRole="button"
						accessibilityLabel="Open Diagnostics"
					>
						<Text className="text-[14px] font-black text-text dark:text-text-dark">Open Diagnostics</Text>
					</Pressable>
				</View>

				<View
					className="rounded-[26px] p-[18px] bg-[#fffdf8] dark:bg-[#15141a] border border-danger dark:border-danger-dark gap-3"
					style={{
						shadowColor: "#000000",
						shadowOpacity: theme.isDark ? 0.16 : 0.05,
						shadowRadius: 18,
						shadowOffset: { width: 0, height: 10 },
						elevation: 4,
					}}
				>
					<Text className="text-2xl font-black tracking-tight text-text dark:text-text-dark">Log Out</Text>
					<Text className="text-base leading-[21px] font-bold text-text-muted dark:text-text-muted-dark">
						Clears token, cache, and pending queues.
					</Text>
					{error ? <Text className="text-danger dark:text-danger-dark font-heavy">{error}</Text> : null}
					<Pressable
						disabled={isLoggingOut}
						onPress={confirmLogout}
						className="min-h-[54px] items-center justify-center rounded-[20px] bg-danger dark:bg-danger-dark"
						style={({ pressed }) => ({
							opacity: pressed || isLoggingOut ? 0.72 : 1,
							transform: [{ scale: pressed || isLoggingOut ? 0.99 : 1 }],
							shadowColor: "#000000",
							shadowOpacity: theme.isDark ? 0.2 : 0.12,
							shadowRadius: 12,
							shadowOffset: { width: 0, height: 6 },
							elevation: 4,
						})}
						accessibilityRole="button"
						accessibilityState={{ disabled: isLoggingOut, busy: isLoggingOut }}
						accessibilityHint="Asks for confirmation before removing your token and local cache."
					>
						<Text className="text-[16px] font-black text-white">
							{isLoggingOut ? "Logging out..." : "Log Out and Clear Cache"}
						</Text>
					</Pressable>
				</View>
			</ScrollView>
		</SafeAreaView>
	);
}

function SettingToggle({
	label,
	detail,
	value,
	onValueChange,
}: {
	label: string;
	detail?: string;
	value: boolean;
	onValueChange: (value: boolean) => void;
}) {
	const { colors } = useAppTheme();
	return (
		<View className="flex-row items-center justify-between gap-3 pt-[10px] border-t border-border dark:border-border-dark">
			<View className="flex-1 gap-0.5">
				<Text className="text-base font-heavy text-text dark:text-text-dark">{label}</Text>
				{detail ? <Text className="text-[13px] leading-[18px] font-bold text-text-muted dark:text-text-muted-dark">{detail}</Text> : null}
			</View>
			<Switch
				value={value}
				onValueChange={onValueChange}
				trackColor={{ false: colors.border, true: "#ff00aa" }}
				thumbColor="#ffffff"
			/>
		</View>
	);
}

function SettingStepper({
	label,
	detail,
	value,
	min,
	max,
	step = 1,
	onChange,
	displayValue,
}: {
	label: string;
	detail?: string;
	value: number;
	min: number;
	max: number;
	step?: number;
	onChange: (value: number) => void;
	displayValue?: string;
}) {
	return (
		<View className="flex-row items-center justify-between gap-3 pt-[10px] border-t border-border dark:border-border-dark">
			<View className="flex-1 gap-0.5">
				<Text className="text-base font-heavy text-text dark:text-text-dark">{label}</Text>
				{detail ? <Text className="text-[13px] leading-[18px] font-bold text-text-muted dark:text-text-muted-dark">{detail}</Text> : null}
			</View>
			<View className="flex-row items-center gap-2">
				<Pressable
					disabled={value <= min}
					onPress={() => onChange(Math.max(min, value - step))}
					className="w-[36px] h-[36px] items-center justify-center rounded-[12px] bg-surface-elevated dark:bg-surface-elevated-dark border border-border dark:border-border-dark"
					style={value <= min ? { opacity: 0.4 } : undefined}
					accessibilityLabel={`Decrease ${label}`}
					accessibilityHint={`Current value: ${displayValue ?? String(value)}`}
					accessibilityRole="button"
				>
					<Text className="text-lg font-black text-text dark:text-text-dark">-</Text>
				</Pressable>
				<Text
					className="text-[16px] font-black text-text dark:text-text-dark min-w-[32px] text-center"
					accessibilityLabel={`${label}: ${displayValue ?? value}`}
				>
					{displayValue ?? value}
				</Text>
				<Pressable
					disabled={value >= max}
					onPress={() => onChange(Math.min(max, value + step))}
					className="w-[36px] h-[36px] items-center justify-center rounded-[12px] bg-surface-elevated dark:bg-surface-elevated-dark border border-border dark:border-border-dark"
					style={value >= max ? { opacity: 0.4 } : undefined}
					accessibilityLabel={`Increase ${label}`}
					accessibilityHint={`Current value: ${displayValue ?? String(value)}`}
					accessibilityRole="button"
				>
					<Text className="text-lg font-black text-text dark:text-text-dark">+</Text>
				</Pressable>
			</View>
		</View>
	);
}

function LessonOrderEditor({
	order,
	onChange,
}: {
	order: SubjectType[];
	onChange: (order: SubjectType[]) => void;
}) {
	function move(fromIndex: number, toIndex: number) {
		const next = [...order];
		const removed = next.splice(fromIndex, 1);
		next.splice(toIndex, 0, removed[0]!);
		onChange(next);
	}

	return (
		<View className="gap-1.5">
			{order.map((type, idx) => (
				<View key={type} className="flex-row items-center justify-between rounded-[12px] px-3 py-[10px] bg-surface-elevated dark:bg-surface-elevated-dark border border-border dark:border-border-dark">
					<Text className="text-base font-heavy text-text dark:text-text-dark">
						{LESSON_ORDER_LABELS[type]}
					</Text>
					<View className="flex-row gap-1.5">
						<Pressable
							disabled={idx === 0}
							onPress={() => move(idx, idx - 1)}
							className="w-[36px] h-[36px] items-center justify-center rounded-[12px] bg-surface-elevated dark:bg-surface-elevated-dark border border-border dark:border-border-dark"
							style={idx === 0 ? { opacity: 0.4 } : undefined}
							accessibilityLabel={`Move ${LESSON_ORDER_LABELS[type]} up`}
							accessibilityRole="button"
						>
							<Text className="text-lg font-black text-text dark:text-text-dark">↑</Text>
						</Pressable>
						<Pressable
							disabled={idx === order.length - 1}
							onPress={() => move(idx, idx + 1)}
							className="w-[36px] h-[36px] items-center justify-center rounded-[12px] bg-surface-elevated dark:bg-surface-elevated-dark border border-border dark:border-border-dark"
							style={idx === order.length - 1 ? { opacity: 0.4 } : undefined}
							accessibilityLabel={`Move ${LESSON_ORDER_LABELS[type]} down`}
							accessibilityRole="button"
						>
							<Text className="text-lg font-black text-text dark:text-text-dark">↓</Text>
						</Pressable>
					</View>
				</View>
			))}
		</View>
	);
}
