import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	ActivityIndicator,
	AppState,
	type AppStateStatus,
	View,
} from "react-native";

import { WaniKaniClient } from "../domain/api/WaniKaniClient";
import { getLastSyncTime, openAppDatabase } from "../domain/db/database";
import { describeSyncError, logErrorBestEffort, logSyncError } from "../domain/db/errorLog";
import {
	ensureReviewNotificationChannel,
	getNotificationPermissionStatus,
	requestNotificationPermissions,
	rescheduleReviewNotifications,
} from "../domain/notifications";
import { deleteApiToken, getApiToken } from "../domain/storage/secureToken";
import {
	hasPendingWrites,
	isSyncAuthError,
	runIncrementalSync,
	runPendingSync,
} from "../domain/sync/syncService";
import { useSyncStore } from "../domain/sync/syncStore";
import { DashboardScreen } from "../screens/DashboardScreen";
import { DiagnosticsScreen } from "../screens/DiagnosticsScreen";
import { LessonPickerScreen } from "../screens/LessonPickerScreen";
import { LessonSessionScreen } from "../screens/LessonSessionScreen";
import { LoginScreen } from "../screens/LoginScreen";
import { RadicalImagePreviewScreen } from "../screens/RadicalImagePreviewScreen";
import { ReviewSessionScreen } from "../screens/ReviewSessionScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { SubjectCatalogScreen } from "../screens/SubjectCatalogScreen";
import { SubjectDetailScreen } from "../screens/SubjectDetailScreen";
import { SubjectSearchScreen } from "../screens/SubjectSearchScreen";
import { SubjectBrowseScreen } from "../screens/SubjectBrowseScreen";
import { BurnedItemsScreen } from "../screens/BurnedItemsScreen";
import { useAppTheme } from "../theme/AppThemeProvider";
import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();
const FOREGROUND_FULL_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const FOREGROUND_CHECK_INTERVAL_MS = 60 * 1000;
const BACKGROUND_PENDING_FLUSH_INTERVAL_MS = 60 * 1000;

export function AppNavigator() {
	const theme = useAppTheme();
	const [apiToken, setApiToken] = useState<string | null>(null);
	const [isBooting, setIsBooting] = useState(true);
	const appState = useRef<AppStateStatus>(AppState.currentState);
	const lastForegroundCheckAt = useRef(0);
	const lastPendingFlushAt = useRef(0);
	const activeLifecycleSyncCount = useRef(0);
	const clearAuthState = useCallback(() => {
		setApiToken(null);
		void deleteApiToken().catch((caught) => {
			const message = caught instanceof Error ? caught.message : String(caught);
			useSyncStore
				.getState()
				.setSyncError(`Signed out, but the stored token could not be removed from this device: ${message}`);
		});
	}, []);

	const handleSyncError = useCallback((caught: unknown) => {
		if (isSyncAuthError(caught)) {
			clearAuthState();
			return;
		}
		useSyncStore.getState().setSyncError(describeSyncError(caught).message);
	}, [clearAuthState]);

	const beginLifecycleSync = useCallback(() => {
		activeLifecycleSyncCount.current += 1;
		return () => {
			activeLifecycleSyncCount.current = Math.max(
				0,
				activeLifecycleSyncCount.current - 1,
			);
			if (activeLifecycleSyncCount.current === 0) {
				useSyncStore.getState().setSyncProgress(null);
			}
		};
	}, []);

	useEffect(() => {
		let isMounted = true;

		getApiToken()
			.then((token) => {
				if (isMounted) {
					setApiToken(token);
				}
			})
			.finally(() => {
				if (isMounted) {
					setIsBooting(false);
				}
			});

		return () => {
			isMounted = false;
		};
	}, []);

	const syncOnForeground = useCallback(async () => {
		if (!apiToken) {
			return;
		}

		const now = Date.now();
		if (now - lastForegroundCheckAt.current < FOREGROUND_CHECK_INTERVAL_MS) {
			return;
		}
		lastForegroundCheckAt.current = now;

		const finishLifecycleSync = beginLifecycleSync();
		useSyncStore.getState().setSyncError(null);

		let db: Awaited<ReturnType<typeof openAppDatabase>> | null = null;
		try {
			db = await openAppDatabase();
			const hasLocalWrites = await hasPendingWrites(db);
			const lastSyncTime = await getLastSyncTime(db);
			const cacheIsStale =
				lastSyncTime === 0 ||
				now - lastSyncTime >= FOREGROUND_FULL_SYNC_INTERVAL_MS;

			if (hasLocalWrites) {
				await runPendingSync({
					db,
					client: new WaniKaniClient(apiToken),
					onProgress: useSyncStore.getState().setSyncProgress,
				});
				useSyncStore.getState().bumpRevision();
			}

			if (cacheIsStale) {
				await runIncrementalSync({
					db,
					client: new WaniKaniClient(apiToken),
					onProgress: useSyncStore.getState().setSyncProgress,
					onCheckpoint: () => useSyncStore.getState().bumpRevision(),
				});
				useSyncStore.getState().bumpRevision();
			}
		} catch (caught) {
			if (db) {
				await logSyncError(db, caught, 'lifecycle_foreground').catch(() => {});
			}
			await handleSyncError(caught);
		} finally {
			finishLifecycleSync();
		}

		// Always reschedule notifications based on local data, regardless of
		// whether sync succeeded. The local DB may have stale-but-usable data
		// when offline; notification scheduling itself needs zero network.
		try {
			await rescheduleReviewNotifications();
		} catch (error) {
			void logErrorBestEffort(
				"warn",
				error,
				"AppNavigator.syncOnForeground.rescheduleNotifications",
			);
		}
	}, [apiToken, beginLifecycleSync, handleSyncError]);

	const syncOnBackground = useCallback(async () => {
		if (!apiToken) {
			return;
		}

		const now = Date.now();
		if (
			now - lastPendingFlushAt.current <
			BACKGROUND_PENDING_FLUSH_INTERVAL_MS
		) {
			return;
		}
		lastPendingFlushAt.current = now;

		const finishLifecycleSync = beginLifecycleSync();

		let db: Awaited<ReturnType<typeof openAppDatabase>> | null = null;
		try {
			db = await openAppDatabase();
			if (!(await hasPendingWrites(db))) {
				return;
			}

			await runPendingSync({
				db,
				client: new WaniKaniClient(apiToken),
				onProgress: useSyncStore.getState().setSyncProgress,
			});
			useSyncStore.getState().bumpRevision();
		} catch (caught) {
			if (db) {
				await logSyncError(db, caught, 'lifecycle_background').catch(() => {});
			}
			await handleSyncError(caught);
		} finally {
			finishLifecycleSync();
		}
	}, [apiToken, beginLifecycleSync, handleSyncError]);

	// Set up Android notification channel on mount.
	useEffect(() => {
		void ensureReviewNotificationChannel();
	}, []);

	// Request notification permission once after login. The permission dialog
	// is a local OS feature and should not depend on network availability.
	const hasRequestedPermission = useRef(false);
	useEffect(() => {
		if (!apiToken || hasRequestedPermission.current) {
			return;
		}

		hasRequestedPermission.current = true;
		void (async () => {
			try {
				const status = await getNotificationPermissionStatus();
				if (status === "undetermined") {
					await requestNotificationPermissions();
				}
			} catch (error) {
				void logErrorBestEffort(
					"info",
					error,
					"AppNavigator.requestNotificationPermissions",
				);
			}
		})();
	}, [apiToken]);

	useEffect(() => {
		if (apiToken) {
			void syncOnForeground();
		}
	}, [apiToken, syncOnForeground]);

	useEffect(() => {
		if (!apiToken) {
			return undefined;
		}

		const subscription = AppState.addEventListener("change", (nextState) => {
			const previousState = appState.current;
			appState.current = nextState;

			if (
				previousState.match(/inactive|background/) &&
				nextState === "active"
			) {
				void syncOnForeground();
			} else if (
				previousState === "active" &&
				nextState.match(/inactive|background/)
			) {
				// Flush pending writes. Reschedule notifications independently so
				// they still update from local data even when the network is offline.
				void syncOnBackground();
				void rescheduleReviewNotifications().catch((error) => {
					void logErrorBestEffort(
						"warn",
						error,
						"AppNavigator.background.rescheduleNotifications",
					);
				});
			}
		});

		return () => subscription.remove();
	}, [apiToken, syncOnBackground, syncOnForeground]);

	if (isBooting) {
		return (
			<View
				style={{
					flex: 1,
					alignItems: "center",
					justifyContent: "center",
					backgroundColor: theme.colors.background,
				}}
			>
				<ActivityIndicator color={theme.colors.kanji} />
			</View>
		);
	}

	return (
		<Stack.Navigator screenOptions={{ headerShown: false }}>
			{apiToken ? (
				<>
					<Stack.Screen name="Dashboard">
						{(props) => (
							<DashboardScreen
								{...props}
								apiToken={apiToken}
								onAuthError={clearAuthState}
							/>
						)}
					</Stack.Screen>
					<Stack.Screen name="Settings">
						{(props) => (
							<SettingsScreen
								{...props}
								onLoggedOut={() => setApiToken(null)}
							/>
						)}
					</Stack.Screen>
					<Stack.Screen name="Diagnostics">
						{(props) => (
							<DiagnosticsScreen
								{...props}
								onForceLogout={clearAuthState}
							/>
						)}
					</Stack.Screen>
					<Stack.Screen
						name="RadicalImagePreview"
						component={RadicalImagePreviewScreen}
					/>
					<Stack.Screen name="ReviewSession" component={ReviewSessionScreen} />
					<Stack.Screen name="LessonPicker" component={LessonPickerScreen} />
					<Stack.Screen name="LessonSession" component={LessonSessionScreen} />
					<Stack.Screen
						name="SubjectCatalog"
						component={SubjectCatalogScreen}
					/>
					<Stack.Screen name="SubjectSearch" component={SubjectSearchScreen} />
					<Stack.Screen name="SubjectBrowse" component={SubjectBrowseScreen} />
					<Stack.Screen name="BurnedItems" component={BurnedItemsScreen} />
					<Stack.Screen name="SubjectDetail" component={SubjectDetailScreen} />
				</>
			) : (
				<Stack.Screen name="Login">
					{(props) => <LoginScreen {...props} onAuthenticated={setApiToken} />}
				</Stack.Screen>
			)}
		</Stack.Navigator>
	);
}
