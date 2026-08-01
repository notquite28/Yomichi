# Repository Guidelines

## Project Overview

Yomiji (読路) is a private Expo/React Native + TypeScript WaniKani study app for Android/iOS. It authenticates with a WaniKani API token, downloads user/subject/assignment/study-material/review-stat data into SQLite, then runs dashboard, lessons, reviews, practice, search, details, diagnostics, notifications, an optional offline Study Coach (TinySwallow via `llama.rn`), and local study-material edits from cache.

Core domain logic (review state machine, answer checker, lesson flow, sync architecture, settings) was ported from the Tsurukame iOS app. `tsurukame/` is a gitignored behavior reference only — do not ship or import from it.

Distribution is direct: a signed arm64-v8a APK attached to GitHub Releases. There is no app store and no OTA. `expo-updates` is removed and `app.json` sets `updates.enabled: false`. The app checks GitHub Releases itself for an update banner (`src/domain/update/updateService.ts`).

## Architecture & Data Flow

- `App.tsx` is the root shell: imports `global.css`, registers Expo notification handling at module scope, wraps `AppNavigator` in `SafeAreaProvider` and `AppThemeProvider`, maps app theme colors into React Navigation, and hosts global toasts.
- `src/navigation/AppNavigator.tsx` owns auth gating (SecureStore token), route registration, foreground/background sync, notification permission/channel setup, learning-history prune, coach model unload on background, and force logout on sync auth errors.
- Durable data flow: WaniKani API → `src/domain/sync/syncService.ts` → SQLite repositories → screens. After login, SQLite is the source of truth. Screens open the DB and call domain functions; they never call the live WK API directly.
- Local writes are offline-first. Review results, lesson starts, and study-material edits update local DB immediately and queue outbound rows in `pending_progress` / `pending_study_materials`; sync flushes queues before remote downloads.
- Sync is single-flight/coalesced:
  - `runPendingSync` — flush pending writes only (used on background).
  - `runIncrementalSync` — flush pending, then download collections via `sync_cursors.updated_after` (user → subjects → assignments → study_materials → level_progressions → voice_actors → review_stats); stores full API JSON plus indexed columns; bumps `syncRevision` for UI refresh.
  - `runFullRefresh` (Diagnostics) — flush pending first (postpones if writes remain), snapshot local-only `subject_progress`, `clearRemoteCache`, full download, restore progress for subjects that still exist, prune orphan learning-history rows.
- Lifecycle: foreground incremental when stale ≥15m or pending; background pending flush only. Notifications reschedule from local assignment data even offline.
- Optional Study Coach is fully offline and never grades answers, writes SRS, or blocks Continue. Local attempt history (`review_attempts`) and intervention outcomes (`learning_interventions`) power Mistake Lens, confusion pairs, AI Study Summary, and Weak-Spot Clinic. Logout/`resetLocalData` clears them with the rest of local data; full refresh preserves them (`clearRemoteCache` does not wipe coach cache/history).
- Shared SQLite writes must use `runExclusive` or `runInWriteTransaction` from `src/domain/db/database.ts`. The lock is **non-reentrant**: never nest these wrappers inside an already locked transaction; inner helpers must use raw `db.runAsync`/`execAsync`.
- Global state is intentionally small: `useSettingsStore` (AsyncStorage prefs), `useSyncStore` (progress/error/revision), `useCoachStore`, `useLearningHistoryStore`. Review sessions keep in-memory state on the screen (`ReviewSession` class), not Zustand.
- Error handling: classify/sanitize sync/API failures in `src/domain/db/errorLog.ts` (never log tokens); clear SecureStore auth on WaniKani 401/403; notification scheduling/audio teardown are best-effort; 422 pending uploads are stale and discarded.

## Key Directories

- `src/domain/` — business logic, repositories, sync, API client, settings, notifications, audio, answer checking. Keep React/UI imports out of domain code.
- `src/domain/db/` — SQLite schema/migrations, write lock, persistence helpers, data integrity tests.
- `src/domain/sync/` — pending/incremental/full sync orchestration and sync UI store.
- `src/domain/study/` — review session state machine, lesson/review/practice queues, pending write queueing, attempt history, intervention offers.
- `src/domain/ai/` — TinySwallow model catalog/download, coach generation, structured-output validation, prompt builders, cache.
- `src/domain/dashboard/` — dashboard aggregation plus deterministic study-summary facts.
- `src/domain/answers/` — answer checker and romaji→kana input (`retry` results must not score or submit).
- `src/domain/api/` — WaniKani v2 REST client: Bearer auth, cursor pagination, 429 backoff, rate-limit budget.
- `src/domain/notifications/` — review notification scheduling behind an Expo-Go-safe wrapper (`expoNotifications.ts`; all notification code imports it, never `expo-notifications` directly).
- `src/domain/storage/` — SecureStore API token persistence.
- `src/domain/subjects/` — radical image and SVG helpers.
- `src/domain/update/` — GitHub release update check and banner dismissal.
- `src/screens/` — route-level UI orchestration; screens read repositories/services, not live WK API.
- `src/components/` — reusable themed UI: layout, session controls, charts, subject details, pills, toasts, coach panel.
- `src/navigation/` — typed native stack, auth gate, lifecycle sync.
- `src/theme/` — palette, dynamic theme provider, subject colors, color utilities.
- `src/hooks/` — shared UI hooks (leave confirmation, keyboard height, guidance messages).
- `src/test/` — Jest SQLite shim, factories, mock API client, native module mocks.
- `android/` — checked-in native Android project; release-relevant, not disposable Expo output.
- `config-plugins/` — Expo config plugins (Android predictive back gesture).
- `scripts/` — release/version helper scripts.
- Root docs — `README.md`, `ROADMAP.md` (Tsurukame parity), `USER_MANUAL.md`, `TINYSWALLOW_INTEGRATION_SPEC.md`; `docs/` itself is gitignored.

## Development Commands

Use pnpm.

```sh
pnpm install
pnpm start              # expo start --dev-client; requires a dev build
pnpm start -- --clear   # clear Metro cache
pnpm android            # expo run:android
pnpm ios                # expo run:ios
pnpm web                # expo start --web; experimental/unsupported
pnpm typecheck          # tsc --noEmit
pnpm test               # jest --runInBand
pnpm test -- <file>     # focused Jest run
pnpm exec expo install --check
pnpm version:bump patch # also supports minor|major; commits and tags release
```

No lint or formatter script is defined in `package.json`.

## Code Conventions & Common Patterns

- TypeScript is strict (`strict`, `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`). Handle indexed lookups and nullable DB/API fields explicitly; do not loosen config.
- Prefer boring repository/service functions that accept dependencies (`AppDatabase`, `WaniKaniClient`) over hidden globals. `WaniKaniClient` supports injected `fetcher` and `sleep` for tests.
- Preserve offline-first behavior: cached data must stay usable, local writes must queue, and network/auth/rate-limit errors should remain explicit and sanitized. Remote download must not clobber local progress/study materials while pending rows exist.
- Keep sync single-flight/coalesced. Pending writes flush before remote fetches; full refresh must clear/re-fetch after active syncs rather than silently becoming incremental; pending-only must never be returned as a substitute for incremental.
- Store remote resources as full JSON payloads plus indexed columns. Parse defensively in batch readers so one corrupt row does not break an entire cache-backed screen. Normalize `kana_vocabulary` → `vocabulary` everywhere.
- Practice paths never queue review progress to WaniKani; only real review/lesson mutations do.
- Answer semantics: `retry` kinds (other kanji reading, invalid chars, okurigana, reading-for-meaning) must not mark wrong or submit.
- Styling is NativeWind-first (`className`, `dark:` variants, Tailwind tokens). Use inline styles/`StyleSheet` only for dynamic values RN cannot express statically: subject colors, Switch colors, charts, shadows, placeholder/selection colors, glass effects.
- Theme access goes through `AppThemeProvider` / `useAppTheme`; navigation colors derive from the same theme.
- Screens should use `ScreenLayout` / existing session components before adding new layout conventions.
- Settings are AsyncStorage-backed and hydrated through Zustand with dirty-key race protection (`updateSetting`); sync progress uses a separate Zustand store.
- Notification scheduling reads local DB + settings and degrades safely when permissions/modules are unavailable.

## Important Files

- `App.tsx` — app root, notification tap routing, providers.
- `src/navigation/AppNavigator.tsx` — auth gate, lifecycle sync, route registration, coach unload-on-background.
- `src/navigation/types.ts` — root stack route params (includes `WeakSpotClinic`, pair-practice `subjectIds`).
- `src/domain/api/WaniKaniClient.ts` — WaniKani REST client, pagination, rate-limit/retry behavior.
- `src/domain/db/schema.ts` — SQLite tables, indexes, migrations (v1 core, v2 pending study materials uniqueness, v3 `coach_cache`, v4 learning history).
- `src/domain/db/database.ts` — DB open/migrations, write lock, bulk put/clear/reset helpers (`resetLocalData` clears learning history + coach cache; `clearRemoteCache` does not).
- `src/domain/db/SCHEMA_MAPPING.md` — iOS protobuf vs RN JSON schema mapping and offline invariants.
- `src/domain/sync/syncService.ts` — pending/incremental/full sync and pending upload semantics.
- `src/domain/study/studyRepository.ts` — lesson/review/practice queues; local pending writes.
- `src/domain/study/reviewSession.ts` — review/practice session state machine.
- `src/domain/study/reviewAttempts.ts` — local attempt recording, retention prune, clear history.
- `src/domain/study/learningEvidence.ts` / `learningInterventions.ts` — Mistake Lens / confusion-pair evidence and intervention persistence.
- `src/domain/ai/coachService.ts` — model lifecycle and coach generation (validate-before-cache for structured actions).
- `src/domain/dashboard/studySummary.ts` — deterministic study-summary facts and fallback prose.
- `src/domain/settings/settings.ts` and `settingsStore.ts` — app settings defaults, migrations, storage.
- `src/domain/notifications/notificationService.ts` — review notification scheduling.
- `src/domain/update/updateService.ts` — GitHub latest-release check; `updateDismissal.ts` — per-version banner state.
- `src/screens/DashboardScreen.tsx`, `ReviewSessionScreen.tsx`, `LessonSessionScreen.tsx`, `SettingsScreen.tsx`, `WeakSpotClinicScreen.tsx`, `DiagnosticsScreen.tsx` — main user flows.
- `package.json`, `app.json`, `eas.json`, `tsconfig.json`, `jest.config.js`, `tailwind.config.js`, `metro.config.js`, `babel.config.js` — tooling/build config.
- `scripts/version-bump.sh` — bumps package/app/native versions, commits `Release vX.Y.Z`, tags `vX.Y.Z`.
- `.github/workflows/android-release.yml` — Android release: typecheck, test, Gradle `assembleRelease` with ABI splits, sign, GitHub Release (`yomiji-arm64-v8a.apk`).

## Runtime/Tooling Preferences

- Runtime/toolchain: Node 22, pnpm 9, Java 17 in CI; Expo SDK 55, React 19, React Native 0.83, Hermes and RN New Architecture enabled for Android.
- `pnpm-lock.yaml` is the lockfile. Keep it current; do not switch package managers. `pnpm-workspace.yaml` allowlists native builds (`better-sqlite3`, `llama.rn`).
- `pnpm start` uses the Expo dev-client workflow, not plain Expo Go. Build/install a dev client with `pnpm android` or `pnpm ios` first.
- NativeWind v4 is wired through `global.css`, `babel.config.js` (`nativewind/babel`), `metro.config.js` (`withNativeWind`), `tailwind.config.js`, and `nativewind-env.d.ts`. Tailwind scans only `App.tsx` and `src/**/*.{ts,tsx}`.
- `app.json` controls Expo app identity, plugins (`expo-secure-store`, `expo-sqlite`, `expo-notifications`, `llama.rn`, predictive-back plugin), permissions, OTA updates, and runtime versions. Keep native Android config aligned when changing release-relevant settings.
- Android: checked-in native project, Gradle 9, arm64-v8a-only ABI splits (`reactNativeArchitectures=arm64-v8a`; llama.rn native libs are arm64-only), R8 minification on (`android.enableMinifyInReleaseBuilds=true`) with keep rules for `com.rnllama.**`, reanimated, and TurboModules. `android/app/src/main/assets/ggml-hexagon/` ships llama.rn's Hexagon NPU libs and `syncRNLlamaHtpAssets` refreshes them on build — do not disable the task or delete the assets; llama.rn auto-selects the Hexagon backend in native code on supported devices.
- Android release CI signs via secrets `YOMIJI_KEYSTORE_BASE64` and `YOMIJI_KEYSTORE_PASSWORD` (alias `yomiji`) and builds per-ABI APKs with `./gradlew :app:assembleRelease` (not EAS). Local/CI signing env vars: `KEYSTORE_FILE`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`.
- EAS is configured for APK profiles (`eas.json` `appVersionSource: local`); prefer `pnpm version:bump <patch|minor|major>` over manual version edits.
- Watch version drift across `package.json`, `app.json` (version/runtimeVersion/buildNumber/versionCode), and `android/app/build.gradle` (`versionName`/`versionCode`).

## Testing & QA

- Jest is Node + `ts-jest` (`jest.config.js`), matching `**/*.{test,spec}.{ts,tsx}` and running serially through `pnpm test` (`jest --runInBand`). No coverage thresholds; no component/UI tests by design.
- `expo-sqlite` is mapped to `src/test/__mocks__/expo-sqlite.ts`; `openDatabaseAsync` intentionally throws in Jest. DB tests create in-memory databases through `createTestDb()` (`src/test/sqliteShim.ts`, better-sqlite3) or `createTestDatabase()` (`src/test/testDb.ts`) and close them in cleanup.
- Prefer real in-memory SQLite integration tests for persistence/sync behavior. Use `src/test/factories.ts` for WaniKani fixtures and `src/test/mockApi.ts` for API doubles with call tracking.
- Common DB test pattern: `resetIdCounter()` in `beforeEach`, `createTestDb()` + `applyMigrations(db)`, assert via `getFirstAsync`/`getAllAsync`, then `await db.closeAsync()` in `afterEach`.
- Focused integration examples:

```sh
pnpm test -- src/domain/db/dataIntegrity.integration.test.ts
pnpm test -- src/domain/sync/syncService.integration.test.ts
pnpm test -- src/domain/sync/errorHandling.integration.test.ts
pnpm test -- src/domain/study/pendingWrites.integration.test.ts
pnpm test -- src/domain/study/reviewAttempts.integration.test.ts
pnpm test -- src/domain/study/learningEvidence.test.ts
pnpm test -- src/domain/ai/structuredOutput.test.ts
pnpm test -- src/domain/dashboard/studySummary.test.ts
```

- Cover behavior that can break: pending-write durability, retry/discard paths, sync cursors/checkpoints/progress, migration idempotency/FKs, rate-limit/backoff math, settings migrations, notification permission/vacation/badge behavior, answer/kana edge cases, attempt retention/override/discard, intervention cooldowns, structured coach validation, study-summary fact bounds.
- Run `pnpm typecheck` plus the focused tests for changed files before yielding non-trivial changes; CI (tag `v*`) runs frozen install, typecheck, tests, then signed Android release APK.
