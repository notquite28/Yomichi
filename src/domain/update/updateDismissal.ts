import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Persistence for the "dismissed update banner" state.
 *
 * This is transient UI state, not a user preference, so it lives under its own
 * AsyncStorage key rather than inside AppSettings (avoids a settings migration
 * and keeps the typed settings shape clean). Dismissing an update version hides
 * the banner for that version only; a newer release re-shows it.
 */

const DISMISSED_UPDATE_KEY = 'updateDismissedVersion';

/** Read the last dismissed update version, or null if none/unavailable. */
export async function getDismissedUpdateVersion(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(DISMISSED_UPDATE_KEY);
  } catch {
    return null;
  }
}

/** Remember that the user dismissed the banner for the given version. */
export async function setDismissedUpdateVersion(version: string): Promise<void> {
  try {
    await AsyncStorage.setItem(DISMISSED_UPDATE_KEY, version);
  } catch {
    // Non-critical: worst case the banner reappears on next launch.
  }
}
