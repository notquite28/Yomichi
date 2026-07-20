import { create } from 'zustand';
import { AppSettings, defaultSettings, loadSettings, saveSettings } from './settings';

export type SettingsState = AppSettings & {
  /** True once loadSettings() has completed at least once after app launch */
  _hydrated: boolean;
  /** Persist a single setting. Calls saveSettings() for AsyncStorage persistence. */
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  /** Hydrate the store from AsyncStorage. Called once by AppThemeProvider on mount. */
  hydrate: () => Promise<void>;
};

/** Keys dirtied by updateSetting while hydrate is in flight; hydrate must not clobber them. */
const dirtyKeys = new Set<keyof AppSettings>();
let hydratePromise: Promise<void> | null = null;

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...defaultSettings,
  _hydrated: false,

  hydrate: async () => {
    if (get()._hydrated) return;
    if (hydratePromise) return hydratePromise;

    hydratePromise = (async () => {
      try {
        const settings = await loadSettings();
        // Preserve any in-memory updates that landed while loadSettings awaited.
        const current = get();
        const merged: Partial<AppSettings> = { ...settings };
        for (const key of dirtyKeys) {
          (merged as Record<string, unknown>)[key] = current[key];
        }
        dirtyKeys.clear();
        set({ ...merged, _hydrated: true });
      } catch {
        // On error, stay with defaults (plus any dirty updates) but unblock the app
        dirtyKeys.clear();
        set({ _hydrated: true });
      } finally {
        hydratePromise = null;
      }
    })();

    return hydratePromise;
  },

  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    if (!get()._hydrated) {
      dirtyKeys.add(key);
    }
    set({ [key]: value } as Partial<SettingsState>);
    // Fire-and-forget persistence; write failures are non-critical
    saveSettings({ [key]: value }).catch(() => {});
  },
}));
