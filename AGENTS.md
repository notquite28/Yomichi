# Repository Guidelines

## Project Overview

Yomiji is a private Expo/React Native + TypeScript WaniKani study app for Android/iOS. It authenticates with a WaniKani API token, downloads user/subject/assignment/study-material/review-stat data into SQLite, then runs dashboard, lessons, reviews, practice, search, details, diagnostics, notifications, and local study-material edits from cache.

Core domain logic (review state machine, answer checker, lesson flow, sync architecture, settings) was ported from the Tsurukame iOS app; `tsurukame/` holds the original Swift/UIKit source as a behavior reference only — do not ship or import from it.

## Architecture & Data Flow

- `App.tsx` is the root shell: imports `global.css`, registers Expo notification handling at module scope, wraps `AppNavigator` in `SafeAreaProvider` and `AppThemeProvider`, maps app theme colors into React Navigation, and hosts global toasts.
- `src/navigation/AppNavigator.tsx` owns auth gating, route registration, app foreground/background sync, notification permission/channel setup, and force logout on sync auth errors.
- Durable data flow is WaniKani API -> `src/domain/sync/syncService.ts` -> SQLite repositories -> screens. After login, SQLite is the source of truth for screens.
- Local writes are offline-first. Review results, lesson starts, and study-material edits update local DB immediately and queue outbound rows in `pending_progress` / `pending_study_materials`; sync flushes queues before remote downloads.
- `runIncrementalSync` flushes pending writes, downloads collections using `sync_cursors.updated_after`, stores full API JSON payloads plus indexed columns, and bumps sync checkpoints for UI refreshes.
- `runFullRefresh` flushes pending writes first, postpones if writes remain, snapshots local-only `subject_progress`, clears remote cache, downloads, then restores progress rows that still have subjects.
- Shared SQLite writes must use `runExclusive` or `runInWriteTransaction` from `src/domain/db/database.ts`. The lock is non-reentrant: do not call these wrappers inside an already locked transaction; inner helpers must use raw `db.runAsync`/`execAsync`.
- Global state is intentionally small: `useSettingsStore` for AsyncStorage-backed preferences and `useSyncStore` for sync progress/error/revision. Route screens keep local UI/session state.
- Error handling convention: classify/sanitize sync/API failures in `src/domain/db/errorLog.ts`; clear stored auth token on WaniKani 401/403; treat notification scheduling/audio teardown as best-effort; 422 pending uploads are stale and discarded.

## Key Directories

- `src/domain/` — business logic, repositories, sync, API client, settings, notifications, audio, answer checking. Keep React/UI imports out of domain code.
- `src/domain/db/` — SQLite schema/migrations, write lock, persistence helpers, data integrity tests.
- `src/domain/sync/` — pending/incremental/full sync orchestration and sync UI store.
- `src/domain/study/` — review session state machine, lesson/review queues, pending write queueing.
- `src/screens/` — route-level UI orchestration; screens read repositories/services instead of direct WaniKani API calls.
- `src/components/` — reusable themed UI: layout, session controls, charts, subject details, pills, toasts.
- `src/navigation/` — typed native stack, auth gate, lifecycle sync.
- `src/theme/` — palette, dynamic theme provider, subject colors, color utilities.
- `src/hooks/` — shared UI hooks such as leave confirmation, keyboard height, guidance messages.
- `src/test/` — Jest SQLite shim, factories, mock API client, native module mocks.
- `android/` — checked-in native Android project; release-relevant, not disposable Expo output.
- `config-plugins/` — Expo config plugins, currently Android predictive back gesture support.
- `scripts/` — release/version helper scripts.

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
- Prefer boring repository/service functions that accept dependencies (`AppDatabase`, `WaniKaniClient`) over hidden globals. `WaniKaniClient` also supports injected `fetcher` and `sleep` for tests.
- Preserve offline-first behavior: cached data must stay usable, local writes must queue, and network/auth/rate-limit errors should remain explicit and sanitized.
- Keep sync single-flight/coalesced. Pending writes flush before remote fetches; full refresh must clear/re-fetch after active syncs rather than silently becoming incremental.
- Store remote resources as full JSON payloads plus indexed columns. Parse defensively in batch readers so one corrupt row does not break an entire cache-backed screen.
- Styling is NativeWind-first (`className`, `dark:` variants, Tailwind tokens). Use inline styles/`StyleSheet` only for dynamic values React Native cannot express statically: subject colors, Switch colors, charts, shadows, placeholder/selection colors, glass effects.
- Theme access goes through `AppThemeProvider` / `useAppTheme`; navigation colors are derived from the same theme.
- Screens should use `ScreenLayout` and existing components before adding new layout conventions.
- Settings are AsyncStorage-backed and hydrated through Zustand; sync progress uses a separate Zustand store.
- Notification scheduling reads local DB + settings and should degrade safely when permissions/modules are unavailable.

## Important Files

- `App.tsx` — app root, notification tap routing, providers.
- `src/navigation/AppNavigator.tsx` — auth gate, app lifecycle sync, route registration.
- `src/navigation/types.ts` — root stack route params.
- `src/domain/api/WaniKaniClient.ts` — WaniKani REST client, pagination, rate-limit/retry behavior.
- `src/domain/db/schema.ts` — SQLite tables, indexes, migrations.
- `src/domain/db/database.ts` — DB open/migrations, write lock, bulk put/clear/reset helpers.
- `src/domain/sync/syncService.ts` — pending/incremental/full sync and pending upload semantics.
- `src/domain/study/studyRepository.ts` — lesson/review queues and local pending writes.
- `src/domain/study/reviewSession.ts` — review/practice session state machine.
- `src/domain/settings/settings.ts` and `settingsStore.ts` — app settings defaults, migrations, storage.
- `src/domain/notifications/notificationService.ts` — review notification scheduling.
- `src/screens/DashboardScreen.tsx`, `ReviewSessionScreen.tsx`, `LessonSessionScreen.tsx`, `SettingsScreen.tsx`, `DiagnosticsScreen.tsx` — main user flows.
- `package.json`, `app.json`, `eas.json`, `tsconfig.json`, `jest.config.js`, `tailwind.config.js`, `metro.config.js`, `babel.config.js` — tooling/build config.
- `scripts/version-bump.sh` — bumps package/app/native versions, commits `Release vX.Y.Z`, tags `vX.Y.Z`.
- `.github/workflows/android-release.yml` — Android release build/check/sign/publish workflow.

## Runtime/Tooling Preferences

- Runtime/toolchain: Node 22, pnpm 9, Java 17 in CI; Expo SDK 55, React 19, React Native 0.83, Hermes and RN New Architecture enabled for Android.
- `pnpm-lock.yaml` is the lockfile. Keep it current; do not switch package managers.
- `pnpm start` uses the Expo dev-client workflow, not plain Expo Go. Build/install a dev client with `pnpm android` or `pnpm ios` first.
- NativeWind is wired through `global.css`, `babel.config.js`, `metro.config.js`, `tailwind.config.js`, and `src/nativewind-env.d.ts`. Tailwind scans only `App.tsx` and `src/**/*.{ts,tsx}`.
- `app.json` controls Expo app identity, plugins, permissions, updates, and runtime versions. Keep native Android config aligned when changing release-relevant settings.
- Android release signing uses env vars/secrets (`EXPO_TOKEN`, `YOMIJI_KEYSTORE_BASE64`, `YOMIJI_KEYSTORE_PASSWORD`; alias `yomiji`).
- EAS uses remote app version source; prefer `pnpm version:bump <patch|minor|major>` over manual version edits.
- Watch native/runtime drift when editing release config: Android resources, Gradle version fields, `app.json`, and `package.json` must agree.

## Testing & QA

- Jest is Node + `ts-jest` (`jest.config.js`), matching `**/*.{test,spec}.{ts,tsx}` and running serially through `pnpm test`.
- `expo-sqlite` is mapped to `src/test/__mocks__/expo-sqlite.ts`; `openDatabaseAsync` intentionally throws in Jest. DB tests should create in-memory databases through `createTestDb()` or `createTestDatabase()` and close them in cleanup.
- Prefer real in-memory SQLite integration tests for persistence/sync behavior. Use `src/test/factories.ts` for WaniKani fixtures and `src/test/mockApi.ts` for API doubles with call tracking.
- Common DB test pattern: `resetIdCounter()` in `beforeEach`, `createTestDb()` + `applyMigrations(db)`, assert via `getFirstAsync`/`getAllAsync`, then `await db.closeAsync()` in `afterEach`.
- Focused integration examples:

```sh
pnpm test -- src/domain/db/dataIntegrity.integration.test.ts
pnpm test -- src/domain/sync/syncService.integration.test.ts
pnpm test -- src/domain/sync/errorHandling.integration.test.ts
pnpm test -- src/domain/study/pendingWrites.integration.test.ts
```

- Cover behavior that can break: pending-write durability, retry/discard paths, sync cursors/checkpoints/progress, migration idempotency/FKs, rate-limit/backoff math, settings migrations, notification permission/vacation/badge behavior, answer/kana/color edge cases.
- Run `pnpm typecheck` plus the focused tests for changed files before yielding non-trivial changes; CI runs frozen install, typecheck, tests, then Android release builds.
