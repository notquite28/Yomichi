# SQLite Schema Mapping: Legacy iOS Protobuf vs 読路 (Yomiji) JSON

Both apps follow the same pattern: store full API responses as serialized blobs alongside extracted SQL columns for querying. The original uses protobuf (`pb BLOB`), the new app uses JSON (`payload TEXT`).

## Column Naming Conventions

| Protobuf (iOS) | JSON (RN) | Notes |
|---|---|---|
| `pb BLOB` | `payload TEXT` | Serialized API response |
| `type INTEGER` | `subject_type TEXT` | iOS uses proto enum int, RN uses string ('radical','kanji','vocabulary') |
| Int32 Unix timestamps | ISO 8601 TEXT | iOS stores seconds-since-epoch, RN stores ISO strings |
| `id` (subject ID) | `id` (resource ID) | iOS uses subject ID as PK for some tables, RN uses API resource ID |
| Singleton `CHECK (id = 0)` | Singleton `CHECK (id = 1)` | Minor convention difference |

## Table-by-Table Mapping

### sync / sync_cursors

| iOS (`sync`) | RN (`sync_cursors`) |
|---|---|
| Single-row table, one column per collection | One row per collection, `(collection, updated_after, synced_at)` |
| `assignments_updated_after TEXT` | Row where `collection = 'assignments'` |
| `study_materials_updated_after TEXT` | Row where `collection = 'study_materials'` |
| `subjects_updated_after TEXT` | Row where `collection = 'subjects'` |
| `voice_actors_updated_after TEXT` | Row where `collection = 'voice_actors'` |
| *(added v12)* `review_stats_updated_after TEXT` | Row where `collection = 'review_stats'` |
| *(none)* | `synced_at TEXT` — tracks when cursor was last written |

### subjects

| iOS | RN | Notes |
|---|---|---|
| `id INTEGER PK` | `id INTEGER PK` | Same |
| `japanese TEXT` | `japanese TEXT` | Same; empty string for image-only radicals |
| `level INTEGER` | `level INTEGER` | Same |
| `type INTEGER` | `subject_type TEXT` | iOS: proto enum (1=radical, 2=kanji, 3=vocabulary). RN: string |
| `pb BLOB` | `payload TEXT` | Protobuf `TKMSubject` vs full API JSON |
| *(none)* | `updated_at TEXT` | RN tracks per-subject update time for incremental sync |

**Indexes:** Both index `(level, type/subject_type)` and `(japanese)`.

**Key difference:** The iOS `TKMSubject` is a discriminated union (`oneof radical/kanji/vocabulary`). The RN app stores the full API JSON and parses fields on demand. Both map `kana_vocabulary` to `vocabulary`.

### assignments

| iOS | RN | Notes |
|---|---|---|
| `id INTEGER PK` | `id INTEGER PK` | Same |
| `subject_id INTEGER` | `subject_id INTEGER` | Same |
| `pb BLOB` (contains level, srs_stage, etc.) | Extracted columns below | RN denormalizes more fields into SQL |
| *(in pb)* | `level INTEGER` | Extracted from joined subject in RN |
| *(in pb)* | `subject_type TEXT` | Extracted from joined subject in RN |
| *(in pb)* | `srs_stage INTEGER` | Extracted for query in RN |
| *(in pb)* | `available_at TEXT` | Extracted for query in RN |
| *(in pb)* | `started_at TEXT` | Extracted in RN |
| *(in pb)* | `passed_at TEXT` | Extracted in RN |
| *(in pb)* | `burned_at TEXT` | Extracted in RN |
| *(in pb)* | `payload TEXT` | Full API JSON |
| *(in pb)* | `updated_at TEXT` | For incremental sync |

**Indexes:**
- iOS: `(subject_id)`
- RN: `(available_at, srs_stage)`, `(subject_id)`, `(level, subject_type)`

The RN app extracts more columns because it queries assignments by SRS stage and available_at directly in SQL, whereas the iOS app deserializes the protobuf and filters in Swift.

### study_materials

| iOS | RN | Notes |
|---|---|---|
| `id INTEGER PK` (subject ID) | `id INTEGER PK` (API resource ID) | iOS PKs by subject_id, RN by resource ID |
| `pb BLOB` | `subject_id INTEGER UNIQUE` | RN has explicit FK to subjects |
| *(none)* | `payload TEXT` | Full API JSON |
| *(none)* | `updated_at TEXT` | For incremental sync |

**Key difference:** iOS uses subject ID as PK (one study material per subject). RN uses API resource ID as PK with `subject_id UNIQUE`. Both enforce one study material per subject.

iOS uses a `#tsurukameExclude` hack in `meaningNote` to mark excluded items. Yomiji uses the API's `hidden` field from the study material payload directly.

### user

| iOS | RN | Notes |
|---|---|---|
| `CHECK (id = 0)` | `CHECK (id = 1)` | Minor convention difference |
| `pb BLOB` | Extracted columns + payload | RN denormalizes key fields |
| *(in pb)* | `username TEXT` | Extracted in RN |
| *(in pb)* | `level INTEGER` | Extracted in RN |
| *(in pb)* | `vacation_started_at TEXT` | Extracted in RN |
| *(none)* | `payload TEXT` | Full API JSON |
| *(none)* | `updated_at TEXT` | For incremental sync |

### level_progressions

| iOS | RN | Notes |
|---|---|---|
| `id INTEGER PK` | `id INTEGER PK` | Same |
| `level INTEGER` | `level INTEGER` | Same |
| `pb BLOB` | `payload TEXT` | Protobuf `TKMLevel` vs API JSON |
| *(none)* | `updated_at TEXT` | For incremental sync |

### voice_actors

| iOS | RN | Notes |
|---|---|---|
| `id INTEGER PK` | `id INTEGER PK` | Same |
| `pb BLOB` | `name TEXT` + `payload TEXT` | RN extracts name |
| *(none)* | `updated_at TEXT` | For incremental sync |

### review_stats

| iOS | RN | Notes |
|---|---|---|
| `id INTEGER PK` | `id INTEGER PK` | Same |
| `subject_id INTEGER` | `subject_id INTEGER` + FK | RN has explicit FK to subjects |
| `pb BLOB` | `subject_type TEXT`, `percentage_correct INTEGER`, `payload TEXT` | RN extracts more fields |
| *(none)* | `updated_at TEXT` | For incremental sync |
| Index: `(subject_id)` | Index: `(subject_id)` | Same |

### audio_urls

| iOS | RN | Notes |
|---|---|---|
| PK: `(subject_id, voice_actor_id)` | PK: `(subject_id, remote_url)` | Different composite key |
| `level INTEGER` | *(none)* | iOS indexes by level for audio download |
| `url STRING` | `remote_url TEXT` | Same |
| *(none)* | `local_file_path TEXT` | RN tracks cached local files |
| *(none)* | `status TEXT DEFAULT 'remote'` | RN tracks download status |

**Key difference:** iOS keys by `(subject_id, voice_actor_id)` and indexes by `(level, voice_actor_id)` for batch audio downloads. RN keys by `(subject_id, remote_url)` to deduplicate URLs directly.

### subject_progress

| iOS | RN | Notes |
|---|---|---|
| `id INTEGER PK` (subject ID) | `subject_id INTEGER PK` | Named differently |
| `level INTEGER` | `level INTEGER` | Same |
| `srs_stage INTEGER` | `srs_stage INTEGER` | Same |
| `subject_type INTEGER` | `subject_type TEXT` | Int vs string |
| `last_mistake_time TIMESTAMP` | `last_mistake_at TEXT` | Same purpose |

Both apps populate this client-side table from assignments + local review results. Neither syncs it to the API.

### pending_progress

| iOS | RN | Notes |
|---|---|---|
| `id INTEGER PK` (subject ID) | `id TEXT PK` (unique string) | RN uses composite text IDs like `review:123:timestamp` |
| `pb BLOB` (full `TKMProgress`) | `kind TEXT` + `payload TEXT` | iOS nests full assignment in proto; RN stores kind + JSON payload |
| *(none)* | `created_at TEXT` | For ordering |
| *(none)* | `attempts INTEGER DEFAULT 0` | RN tracks retry count |
| *(none)* | `last_error TEXT` | RN tracks last error message |

**Key difference:** iOS embeds the full `TKMAssignment` inside `TKMProgress`. RN stores just the review/lesson payload JSON with a `kind` discriminator.

### pending_study_materials

| iOS | RN | Notes |
|---|---|---|
| `id INTEGER PK` (subject ID) | `id TEXT PK` (unique string) | RN uses text IDs |
| *(none)* | `subject_id INTEGER` + FK | RN has FK to subjects |
| *(none)* | `payload TEXT` | Full edit payload |
| *(none)* | `created_at TEXT` | For ordering |
| *(none)* | `attempts INTEGER DEFAULT 0` | RN tracks retry count |
| *(none)* | `last_error TEXT` | RN tracks last error message |

iOS only stores the subject ID; the actual edit data is reconstructed from `study_materials.pb`. RN stores the full edit payload.

### error_log

| iOS | RN | Notes |
|---|---|---|
| `date TIMESTAMP` | `created_at TEXT` | Same |
| `stack TEXT` | *(none)* | iOS captures stack traces |
| `code INTEGER` | *(none)* | iOS stores error codes |
| `description TEXT` | `message TEXT` | Same |
| `request_url`, `response_url`, etc. | `context TEXT` | iOS stores detailed request/response data; RN stores sanitized context |
| *(none)* | `level TEXT` | RN has log levels (debug/info/warn/error) |
| Auto-trimmed to 100 rows | *(none)* | iOS auto-prunes; RN provides manual prune |

## Tables Present in RN but Not iOS

| RN Table | Purpose |
|---|---|
| `schema_migrations` | Tracks applied migration versions |
| `coach_cache` (migration v3) | Cached Study Coach responses keyed by `(subject_id, action, prompt_hash)`. Global actions such as `study_summary` use `subject_id = 0`. Cleared on logout and model delete; not part of remote sync. |
| `review_attempts` (migration v4) | Local scored attempt history (review/lesson/practice sources, task type, normalized wrong answer, override/discard). No FK to subjects so rows survive temporary subject absence during full refresh. Pruned at 90 days / 50k rows. Cleared on logout; preserved through full refresh (orphans pruned after subjects re-download). |
| `learning_interventions` (migration v4) | Offered Mistake Lens / confusion-pair / pair-practice interventions with state, helpfulness, evidence hash, and optional validated payload. Retention 180 days. |
| `learning_history_meta` (migration v4) | Key/value maintenance metadata (`last_maintenance_at`, `attempt_revision`). |

## Tables Present in iOS but Not RN

None — all iOS tables have RN equivalents.

## Local Learning History Notes

- Attempt recording is best-effort and never blocks grading or Continue. Feedback actions retain the pending insert promise so override, add-synonym, and ask-again-later decisions are applied after the attempt ID exists.
- Correct typed answers and Anki marks store `normalized_answer = NULL`; incorrect typed answers store the normalized form.
- Overrides / add-synonym set `scored_correct = 1` and `overridden = 1`; ask-again-later waits for the pending insert, then hard-deletes the attempt before advancing.
- Practice and pair-practice sources may store attempts but do not count toward Mistake Lens offer thresholds.
- Mistake Lens evaluation is guarded by the active feedback revision after each asynchronous stage; advancing or changing the feedback decision prevents stale cards from being published.
- `resetLocalData` (logout) deletes learning history and `coach_cache`. `clearRemoteCache` (full refresh) does not.
