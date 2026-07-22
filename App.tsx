import "./global.css";

import {
	createNavigationContainerRef,
	DarkTheme,
	DefaultTheme,
	NavigationContainer,
	type Theme,
} from "@react-navigation/native";
import { useEffect, useRef } from "react";
import { StatusBar, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ToastHost } from "./src/components/TooltipPressable";
import {
	setNotificationHandler,
	addNotificationResponseReceivedListener,
	getLastNotificationResponse,
	clearLastNotificationResponse,
} from "./src/domain/notifications/expoNotifications";
import { logErrorBestEffort } from "./src/domain/db/errorLog";
import { getApiToken } from "./src/domain/storage/secureToken";
import { AppNavigator } from "./src/navigation/AppNavigator";
import type { RootStackParamList } from "./src/navigation/types";
import { AppThemeProvider, useAppTheme } from "./src/theme/AppThemeProvider";

// Set the notification handler at module scope so Expo registers it
// before any notification arrives. This controls how notifications
// behave when the app is in the foreground.
// In Expo Go this is a no-op (the module is not loaded).
setNotificationHandler({
	handleNotification: async () => ({
		shouldShowBanner: true,
		shouldShowList: true,
		shouldPlaySound: false,
		// Badge is managed via setBadgeCountAsync / content.badge on scheduled
		// notifications — don't let foreground display override the cumulative count.
		shouldSetBadge: false,
	}),
});

/** Shared navigation ref for navigating from outside components (e.g. notification taps). */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

function navigationTheme(theme: ReturnType<typeof useAppTheme>): Theme {
	const baseTheme = theme.isDark ? DarkTheme : DefaultTheme;

	return {
		...baseTheme,
		dark: theme.isDark,
		colors: {
			...baseTheme.colors,
			primary: theme.colors.kanji,
			background: theme.colors.background,
			card: theme.colors.surface,
			text: theme.colors.text,
			border: theme.colors.border,
			notification: theme.colors.radical,
		},
	};
}

function Root() {
	const theme = useAppTheme();

	return (
		<NavigationContainer ref={navigationRef} theme={navigationTheme(theme)}>
			<StatusBar barStyle={theme.isDark ? "light-content" : "dark-content"} />
			<NotificationTapHandler />
			<AppNavigator />
			<ToastHost />
		</NavigationContainer>
	);
}

/**
 * Handles notification taps by navigating to the appropriate screen.
 * Lives inside NavigationContainer so the ref is ready.
 * In Expo Go these listeners are no-ops.
 *
 * Waits for both navigation readiness and a stored API token so cold-start
 * taps do not fire while the Login-only stack is still mounted.
 */
function NotificationTapHandler() {
	const handledInitial = useRef(false);

	useEffect(() => {
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		let cancelled = false;

		const navigateToReviewsWhenReady = () => {
			let attempts = 0;
			const tryNavigate = async () => {
				if (cancelled) return;
				if (!navigationRef.isReady()) {
					if (++attempts < 60) {
						timeoutId = setTimeout(() => {
							void tryNavigate();
						}, 50);
					}
					return;
				}

				// Auth gate is async: wait until SecureStore has been read and a token
				// exists before pushing ReviewSession onto the authenticated stack.
				const token = await getApiToken().catch((error) => {
					void logErrorBestEffort("warn", error, "App.NotificationTapHandler.getApiToken");
					return null;
				});
				if (cancelled) return;
				if (!token) {
					if (++attempts < 60) {
						timeoutId = setTimeout(() => {
							void tryNavigate();
						}, 50);
					}
					return;
				}

				if (navigationRef.isReady()) {
					navigationRef.navigate("ReviewSession", undefined);
				}
			};
			void tryNavigate();
		};

		// Handle notification taps while the app is running or brought from background.
		const subscription = addNotificationResponseReceivedListener((response) => {
			const data = response.notification.request.content.data as
				| Record<string, unknown>
				| undefined;
			if (data?.screen === "reviews") {
				navigateToReviewsWhenReady();
			}
		});

		// Handle cold start from a notification tap.
		if (!handledInitial.current) {
			handledInitial.current = true;
			const lastResponse = getLastNotificationResponse();
			if (lastResponse) {
				const data = lastResponse.notification.request.content.data as
					| Record<string, unknown>
					| undefined;
				if (data?.screen === "reviews") {
					navigateToReviewsWhenReady();
				}
				clearLastNotificationResponse();
			}
		}

		return () => {
			cancelled = true;
			subscription.remove();
			clearTimeout(timeoutId);
		};
	}, []);

	return null;
}

function AppContent() {
	const theme = useAppTheme();

	return (
		<View className={theme.isDark ? "dark" : ""} style={{ flex: 1 }}>
			<Root />
		</View>
	);
}

export default function App() {
	return (
		<SafeAreaProvider>
			<AppThemeProvider>
				<AppContent />
			</AppThemeProvider>
		</SafeAreaProvider>
	);
}
