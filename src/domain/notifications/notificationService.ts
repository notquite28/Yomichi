import type * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { openAppDatabase } from "../db/database";
import { useSettingsStore } from "../settings/settingsStore";
import { defaultSettings } from "../settings/settings";
import * as ExpoNotifications from "./expoNotifications";

import type { NotificationConfig } from "./types";
import { NOTIFICATION_ID_REVIEW, NOTIFICATION_ID_DAILY } from "./types";

// ---------------------------------------------------------------------------
// Android notification channel
// ---------------------------------------------------------------------------

const REVIEW_CHANNEL_ID = "reviews";

export async function ensureReviewNotificationChannel(): Promise<void> {
	if (Platform.OS !== "android") return;

	await ExpoNotifications.setNotificationChannelAsync(REVIEW_CHANNEL_ID, {
		name: "Review Notifications",
		importance: ExpoNotifications.AndroidImportance?.HIGH ?? 4,
		vibrationPattern: [0, 250, 250, 250],
		showBadge: true,
		description: "Notifications when WaniKani reviews become available",
	});
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export type PermissionStatus = "granted" | "denied" | "undetermined";

export async function getNotificationPermissionStatus(): Promise<PermissionStatus> {
	const settings = await ExpoNotifications.getPermissionsAsync();
	if (settings.granted) return "granted";
	if (Platform.OS === "ios") {
		const iosStatus = settings.ios?.status;
		if (
			iosStatus === ExpoNotifications.IosAuthorizationStatus?.PROVISIONAL ||
			iosStatus === ExpoNotifications.IosAuthorizationStatus?.EPHEMERAL
		) {
			return "granted";
		}
		if (
			iosStatus === ExpoNotifications.IosAuthorizationStatus?.NOT_DETERMINED
		) {
			return "undetermined";
		}
		return "denied";
	}
	return "denied";
}

export async function requestNotificationPermissions(): Promise<boolean> {
	const result = await ExpoNotifications.requestPermissionsAsync({
		ios: {
			allowAlert: true,
			allowBadge: true,
			allowSound: true,
		},
	});
	return result.granted;
}

// ---------------------------------------------------------------------------
// Read notification config from app settings
// ---------------------------------------------------------------------------

function readNotificationConfig(): NotificationConfig {
	const state = useSettingsStore.getState();
	// Fall back to defaults if the store has not yet hydrated (rare race window
	// before AppThemeProvider triggers hydrate()).
	const settings = state._hydrated ? state : defaultSettings;
	return {
		enabled: settings.notificationsEnabled,
		badging: settings.notificationsBadging,
		sounds: settings.notificationSounds,
		threshold: settings.notificationThreshold,
		dailyTime: settings.notificationDailyTime,
	};
}

/**
 * Check whether the OS allows a specific notification capability.
 * On iOS, the granular allows* flags are available under settings.ios.
 * On Android, all capabilities are available once the permission is granted.
 */
function osAllowsCapability(
	systemSettings: Notifications.NotificationPermissionsStatus,
	capability: "alert" | "badge" | "sound",
): boolean {
	if (Platform.OS === "ios") {
		const ios = systemSettings.ios;
		if (!ios) return true;
		switch (capability) {
			case "alert":
				return ios.allowsAlert !== false;
			case "badge":
				return ios.allowsBadge !== false;
			case "sound":
				return ios.allowsSound !== false;
		}
	}
	return true;
}

// ---------------------------------------------------------------------------
// Core scheduling
// ---------------------------------------------------------------------------

/**
 * Schedule review notifications based on threshold and/or daily reminder.
 *
 * Two independent notifications at most:
 * 1. **Threshold** — one-shot DATE trigger, fires when the Nth future review
 *    becomes available. Re-scheduled each time the app foregrounds.
 * 2. **Daily reminder** — native DAILY trigger, fires every day at the
 *    configured hour without requiring app opens.
 */
let rescheduleGeneration = 0;
let rescheduleInFlight: Promise<void> | null = null;

export async function rescheduleReviewNotifications(): Promise<void> {
  // Coalesce concurrent reschedules (foreground + settings + background).
  // A later call bumps generation so an older cancel/schedule pair cannot wipe
  // notifications scheduled by a newer run.
  const generation = ++rescheduleGeneration;
  if (rescheduleInFlight) {
    try {
      await rescheduleInFlight;
    } catch {
      // Previous run's failure must not block this generation.
    }
    if (generation !== rescheduleGeneration) {
      return;
    }
  }

  const run = (async () => {
    const stillCurrent = () => generation === rescheduleGeneration;

    const config = await readNotificationConfig();
    if (!stillCurrent()) return;

    // If no notification feature is enabled, clear and bail.
    if (!config.enabled && !config.badging) {
      await clearReviewNotifications();
      return;
    }

    // Check OS-level permission.
    const permissionStatus = await getNotificationPermissionStatus();
    if (!stillCurrent()) return;
    if (permissionStatus === "denied") {
      await clearReviewNotifications();
      return;
    }
    if (permissionStatus === "undetermined") {
      // Don't schedule until the user grants permission via settings.
      return;
    }

    const db = await openAppDatabase();
    if (!stillCurrent()) return;

    // Check vacation mode.
    const user = await db.getFirstAsync<{ vacation_started_at: string | null }>(
      "SELECT vacation_started_at FROM user WHERE id = 1",
    );
    if (user?.vacation_started_at != null) {
      await clearReviewNotifications();
      return;
    }

    // Cancel all previously scheduled review notifications (including legacy).
    await cancelScheduledReviewNotifications();
    if (!stillCurrent()) return;

    // Use a single timestamp for all queries to avoid race between two clock reads.
    const now = new Date();

    // Current available reviews.
    const availableRow = await db.getFirstAsync<{ value: number }>(
      `SELECT COUNT(*) AS value
     FROM assignments
     WHERE srs_stage BETWEEN 1 AND 8
       AND available_at IS NOT NULL
       AND available_at <= ?`,
      now.toISOString(),
    );
    const availableReviewCount = availableRow?.value ?? 0;

    // Set badge immediately (not on the notification content — avoids stale counts).
    if (config.badging) {
      await ExpoNotifications.setBadgeCountAsync(availableReviewCount);
    }
    if (!stillCurrent()) return;

    if (!config.enabled) {
      // Badge-only mode, no notifications to schedule.
      return;
    }

    // Get system notification settings for capability checks.
    const systemSettings = await ExpoNotifications.getPermissionsAsync();
    if (!stillCurrent()) return;


    // --- Threshold notification (one-shot DATE trigger) ---
    if (availableReviewCount < config.threshold) {
      const remaining = config.threshold - availableReviewCount;
      const offset = remaining - 1; // 0-indexed OFFSET
      const row = await db.getFirstAsync<{ available_at: string }>(
        `SELECT available_at
       FROM assignments
       WHERE srs_stage BETWEEN 1 AND 8
         AND available_at IS NOT NULL
         AND available_at > ?
       ORDER BY available_at ASC
       LIMIT 1 OFFSET ?`,
        now.toISOString(),
        offset,
      );
      if (row?.available_at) {
        const triggerDate = new Date(row.available_at);
        if (triggerDate > now) {
          const triggerType =
            ExpoNotifications.SchedulableTriggerInputTypes?.DATE;
          if (triggerType) {
            const content: Notifications.NotificationContentInput = {
              title: "Reviews Available",
              data: { screen: "reviews" },
            };

            if (osAllowsCapability(systemSettings, "alert")) {
              content.body = `${config.threshold} reviews are waiting`;
            }

            if (
              Platform.OS === "ios" &&
              config.sounds &&
              osAllowsCapability(systemSettings, "sound")
            ) {
              content.sound = "default";
            }

            if (!stillCurrent()) return;
            await ExpoNotifications.scheduleNotificationAsync({
              identifier: NOTIFICATION_ID_REVIEW,
              content,
              trigger: {
                type: triggerType,
                date: triggerDate,
              },
            });
          }
        }
      }
    }

    // --- Daily reminder (native recurring DAILY trigger) ---
    if (config.dailyTime != null) {
      const triggerType =
        ExpoNotifications.SchedulableTriggerInputTypes?.DAILY;
      if (triggerType) {
        const content: Notifications.NotificationContentInput = {
          title: "Daily Reminder",
          data: { screen: "reviews" },
        };

        if (osAllowsCapability(systemSettings, "alert")) {
          content.body = "Check your reviews";
        }

        if (
          Platform.OS === "ios" &&
          config.sounds &&
          osAllowsCapability(systemSettings, "sound")
        ) {
          content.sound = "default";
        }

        if (!stillCurrent()) return;
        await ExpoNotifications.scheduleNotificationAsync({
          identifier: NOTIFICATION_ID_DAILY,
          content,
          trigger: {
            type: triggerType,
            hour: config.dailyTime,
            minute: 0,
          },
        });
      }
    }
  })();

  rescheduleInFlight = run.finally(() => {
    if (rescheduleInFlight === run) {
      rescheduleInFlight = null;
    }
  });
  await rescheduleInFlight;
}

/**
 * Clear all review notifications and reset the badge.
 */
export async function clearReviewNotifications(): Promise<void> {
	await cancelScheduledReviewNotifications();
	await ExpoNotifications.setBadgeCountAsync(0);
}

/**
 * Cancel our review notifications plus any legacy hourly notifications,
 * leaving other scheduled notifications intact.
 */
async function cancelScheduledReviewNotifications(): Promise<void> {
	// Cancel known notification IDs.
	const ids = [NOTIFICATION_ID_REVIEW, NOTIFICATION_ID_DAILY];
	await Promise.all(
		ids.map((id) => ExpoNotifications.cancelScheduledNotificationAsync(id)),
	);

	// Cancel legacy hourly notifications from the old scheduling model.
	const scheduled = await ExpoNotifications.getAllScheduledNotificationsAsync();
	const legacyIds = scheduled
		.filter((n) => n.identifier.startsWith("review-hour-"))
		.map((n) => n.identifier);
	await Promise.all(
		legacyIds.map((id) =>
			ExpoNotifications.cancelScheduledNotificationAsync(id),
		),
	);
}
