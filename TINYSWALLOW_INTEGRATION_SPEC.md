# TinySwallow Feature Suggestions

## Goal

Use TinySwallow as an optional, fully offline study assistant that helps learners understand repeated mistakes. It should explain verified learning patterns, not act as a chatbot or decide whether an answer is correct.

## Implementation Status (2026-07-22)

The rollout described below is **implemented** in the current codebase:

- Migration v4 local learning-history tables (`review_attempts`, `learning_interventions`, `learning_history_meta`) plus v3 `coach_cache`.
- Attempt recording in review/lesson sessions (including Anki, override, synonym, ask-again-later).
- Deterministic Mistake Lens / Confusion Pair offers, pair practice by subject IDs, Helpful/Not helpful persistence.
- Validated structured coach actions (`mistake_lens`, `study_summary`) with validate-before-cache.
- On-demand AI Study Summary dashboard card and Weak-Spot Clinic screen.
- Settings clear-learning-history; logout clears history; full refresh preserves history and prunes orphans.
- Lifecycle prune on foreground; unload loaded model on background when not generating.

Still deferred by design: GGUF SHA-256 digest pinning (until a published digest is recorded), longer-window post-intervention analytics, chat UI, embeddings, and remote review-history APIs.

The sections below remain the product contract / rationale for those features.

## Feasibility Summary

**Conclusion: these features are buildable with Yomiji’s current WaniKani API coverage, and the history-aware path is now shipped via local attempt recording.** No new remote API is required. Older typed answers from before the feature shipped cannot be backfilled.

Current foundations already available:

- `subjects` contains accepted meanings, readings, reading types, components, official mnemonics, hints, context sentences, and parts of speech.
- `assignments` contains SRS state and links learned subjects to reviews.
- `study_materials` contains personal synonyms and meaning/reading notes.
- `review_stats` contains aggregate meaning/reading correct and incorrect totals.
- `subject_progress` contains only the latest mistake timestamp per subject.
- `ReviewSessionScreen` currently has the submitted answer, task type, answer-checker result, and per-session wrong counts while the review is active.
- Existing recent-mistake and leech queries already produce practice queues.
- TinySwallow Q5_K_M, `llama.rn`, download controls, lazy loading, streaming, cancellation, and text caching already exist.

Historical limitations that the local attempt history resolves:

- Individual attempts, task-specific miss windows, prior typed wrong answers, and confusion pairs are stored prospectively in `review_attempts` / `learning_interventions`.
- Completed reviews still only send aggregate wrong counts to WaniKani; typed answers remain local-only.
- Structured coach actions validate fact refs before cache; free-form `why_wrong` remains available for first-miss explain.
- Practice routes include fixed sources **and** an explicit subject-ID pair source.

### Buildability by Feature

| Feature | Feasibility | What works now | Required work | Recommendation |
|---|---|---|---|---|
| **Mistake Lens** | **Shipped** | Local attempt history, repeated-miss query, deterministic card, optional validated coach generation. | Optional longer-window improvement analytics. | Keep optional and never block Continue. |
| **Confusion Pair** | **Shipped** | Exact wrong-answer match against learned subjects; ambiguous multi-match cards; pair practice CTA. | Optional richer presentation for large match sets. | Keep deterministic detection authoritative. |
| **Pair Practice** | **Shipped** | `practiceSource: 'subjectIds'` queue; unscored practice session. | None for v1. | Never write WaniKani review results. |
| **Weak-Spot Clinic** | **Shipped** | Screen with recent mistakes, leeches, recurring misses, confusion pairs, practice deep links. | Optional per-row AI later. | Keep practice-first. |
| **Personal Memory Cue** | **Shipped as Mistake Lens field** | `memoryCue` in validated `mistake_lens` payload; free-form mnemonic still on subject detail. | Optional subject-detail structured mnemonic later. | Supporting text only. |
| **Helpful / Not Helpful Feedback** | **Shipped** | Local intervention rows with nullable helpfulness. | Longer-term usefulness reporting. | Skipping must not affect scores. |
| **AI Study Summary** | **Shipped** | Deterministic metrics + on-press structured summary; 7-day attempt window when present; no unprovable trends. | Optional prior-window comparison later. | Never auto-generate. |

### API Decision

The current WaniKani endpoints are sufficient for authoritative content, learned-item filtering, SRS state, user notes, and aggregate performance. Do **not** add a dependency on a remote review-history endpoint for these features. Capture attempts locally going forward because the needed typed-answer sequence is not present in Yomiji’s current sync data and old typed answers cannot be backfilled.

## Recommended Features

| Feature | Explanation | Example | Comments |
|---|---|---|---|
| **Mistake Lens** | After a learner repeatedly misses the same meaning or reading, show a short explanation based on saved attempts and verified WaniKani subject data. | “You entered **まつ** for 未. That is the reading for 末, which you have also reviewed. 未 is **み**.” | Best first feature after local attempt recording. Keep it optional and never block Continue. |
| **Confusion Pair** | Detect when a wrong answer exactly matches an accepted answer for another learned item. Show both items side by side and explain the verified difference. | The learner repeatedly swaps 未 and 末. The app shows both kanji, accepted readings/meanings, a short contrast, and a memory cue. | Fully local detection is possible. Multiple matches must be shown as ambiguous rather than choosing one. |
| **Pair Practice** | Offer a short, unscored drill for a verified Confusion Pair. Yomiji selects the subjects and grades with the existing answer checker. | After confusing 未 and 末, the learner receives a 2–4 question practice burst containing those items. | Reuse the practice session; add an explicit subject-ID queue. Never write WaniKani review results. |
| **Weak-Spot Clinic** | Add a dashboard area for recent mistakes, leeches, and—after attempt history exists—recurring task/pair patterns. | “Reading mix-ups: 未 and 末 — two verified matches recently.” | A basic clinic can use current queries. Personalized clustering requires the new attempt history. |
| **Personal Memory Cue** | Generate a short mnemonic using verified subject facts, official mnemonics, components, and optional user notes. | “末 has the longer top branch: imagine the tree’s **end** spreading outward.” | The current coach can prototype this. Production use requires validated structured output. |
| **Helpful / Not Helpful Feedback** | Let learners rate an intervention with one tap so usefulness and repeat-error outcomes can be measured. | After a Mistake Lens card: “Was this helpful?” | Local-only; requires a new intervention-outcome table. Skipping must not affect scores. |
| **AI Study Summary** | Generate a short overview of recent mistakes, current progress, workload, and a suggested next action from deterministic database facts. | “You have 42 reviews due. Reading errors are concentrated in three apprentice items. You passed 31 of 35 current-level kanji; practice the two repeated reading misses next.” | Generate only after the learner presses the sparkle icon. Show source metrics beside the prose and provide a deterministic fallback. |

## Suggested User Flow

1. The learner submits an answer.
2. Yomiji grades it with the existing deterministic answer checker.
3. A new local attempt recorder saves the final scored disposition.
4. On a first miss, Yomiji shows normal feedback.
5. On a repeated same-task miss or an unambiguous exact confusion match, Yomiji offers **Mistake Lens**.
6. If the learner taps it, TinySwallow generates a short, validated explanation and memory cue.
7. The learner may continue immediately or start an optional unscored practice burst.
8. Persistent issues appear later in **Weak-Spot Clinic** instead of interrupting every review.

## Example Card

**You may be mixing up 未 and 末**

- **未** — not yet
- **末** — end
- You entered the answer for 末 while reviewing 未 twice recently.
- Memory cue: 末 reaches farther at the top because it has reached the **end**.

Actions: **Practice Pair**, **Not now**, **Helpful / Not helpful**

The item names, accepted answers, and mistake count come from Yomiji’s local data. TinySwallow only writes the short explanation and memory cue.

This exact card is **not possible from the current schema** because Yomiji does not retain prior typed answers. It becomes possible after prospective attempt recording; it cannot be backfilled for old reviews.

## AI Study Summary

### Interaction

- Add an icon button to the Dashboard summary/header area.
- Use the Ionicons **`sparkles`** icon for every AI-generation action. The installed Ionicons set includes `sparkles` and `sparkles-outline`; it does not include a `wand` icon.
- Use filled `sparkles` for the action so it is clearly distinct from refresh, help, analytics, and settings.
- Accessibility label: **“Generate AI study summary.”**
- Generate only when the icon is pressed. Do not pre-generate on dashboard load, sync completion, app startup, or review start.
- While generating, keep the dashboard interactive and show progress inside the summary card. A second press cancels or regenerates according to the visible button state.
- Cache only a validated result keyed by the facts hash, model version, prompt version, and time window. A changed sync revision or attempt-history revision makes the prior summary visibly stale but does not automatically regenerate it.
- If the model is not installed, unavailable, or fails, show the same metrics as a deterministic summary card.

The review pill’s current AI explanation action must also use **`sparkles`**, replacing the generic help icon. Its accessibility label should identify the action as AI, for example **“AI: Explain this mistake.”** Any future icon-only AI action on subject details, Mistake Lens, or Weak-Spot Clinic must use the same sparkle icon convention.

### Database Data Available Now

| Source | Available facts | Safe summary use | Limitation |
|---|---|---|---|
| `user` | Username, current level, vacation start | Greeting, current level, vacation warning | No historical level snapshots |
| `assignments` | Subject, SRS stage, availability, unlock/start/pass/burn timestamps, hidden state | Reviews due, lessons available, SRS distribution, review forecast, recently started/passed/burned items | Current state does not prove an accuracy trend |
| `subjects` | Type, level, characters/images, meanings, readings/types, components, mnemonics, hints, context sentences, parts of speech | Name weak items, show authoritative answers, group by type/level, ground explanations | Subject facts are content, not learner performance |
| `study_materials` | Meaning/reading notes, personal synonyms, hidden state | Personal context for a selected weak item | Notes are private and should be included only when directly relevant |
| `review_stats` | Meaning/reading correct and incorrect totals, current/max streaks, percentage correct, creation time | Lifetime accuracy, meaning-versus-reading weakness, leech ranking, streak evidence | Aggregate totals cannot show when individual errors occurred |
| `subject_progress` | Current local SRS stage and latest mistake timestamp per subject | Items missed in the last 24 hours and most recent weak subjects | Only one timestamp; task and submitted answer are lost |
| `level_progressions` | Unlock, start, pass, complete, and abandon dates by level | Current/previous level timing and completed-level milestones | Not detailed daily study activity |
| `sync_cursors` | Last successful sync time by collection | Data-freshness warning | Never treat stale cache as current progress |
| `pending_progress` | Count and age of pending review/lesson writes | Warn that recent progress is still awaiting upload | Do not include queued payload contents in the model prompt |
| `audio_urls` / `voice_actors` | Audio availability and voice metadata | Generally unnecessary for a progress summary | Exclude from the prompt unless an audio-specific feature needs it |
| `error_log` | Sanitized operational failures | Do not use for learning summaries | Technical diagnostics are unrelated to learner progress |
| `coach_cache` | Prior generated text | Reuse only through a validated cache key | It is not evidence and must never be summarized as learner history |

Existing dashboard/repository queries already provide:

- lessons and reviews currently available;
- SRS counts for Apprentice, Guru, Master, Enlightened, and Burned;
- a 48-hour review forecast;
- passed versus total radicals, kanji, and vocabulary for the current level;
- recently started lessons;
- subjects with a mistake in the last 24 hours;
- leeches with meaning/reading correct and incorrect totals;
- burned and excluded-item counts;
- latest sync time.

### Additional Data After Attempt Recording

The bounded `review_attempts` history enables:

- scored attempts and accuracy over the last 7, 30, and 90 days;
- meaning-versus-reading accuracy by time window;
- correct/incorrect counts by review, lesson quiz, and practice source;
- repeated misses for the same subject/task;
- exact submitted-answer matches to other learned subjects;
- improvement after a Mistake Lens or Pair Practice intervention;
- whether a weak item stopped recurring;
- same-session versus cross-session recurrence;
- practice performance without changing WaniKani SRS.

The `learning_interventions` history adds:

- summaries offered, shown, skipped, dismissed, or failed;
- Helpful / Not Helpful responses;
- intervention cooldowns;
- post-intervention recurrence comparisons.

### Summary Contract

Build a deterministic `StudySummaryFacts` object before invoking TinySwallow. Do not pass arbitrary table rows or raw JSON payloads. Suggested bounded input:

```ts
interface StudySummaryFacts {
  generatedFromDataAt: string;
  level: number;
  availableLessons: number;
  availableReviews: number;
  reviewForecast24h: number;
  srs: {
    apprentice: number;
    guru: number;
    master: number;
    enlightened: number;
    burned: number;
  };
  currentLevelProgress: Array<{
    subjectType: string;
    passed: number;
    total: number;
  }>;
  recentMistakes: Array<{
    subjectId: number;
    taskType?: 'meaning' | 'reading';
    missCount?: number;
    lastMissAt: string;
  }>;
  topLeeches: Array<{
    subjectId: number;
    meaningIncorrect: number;
    meaningCorrect: number;
    readingIncorrect: number;
    readingCorrect: number;
  }>;
  recentWindow?: {
    days: 7 | 30 | 90;
    scoredAttempts: number;
    correctAttempts: number;
    meaningIncorrect: number;
    readingIncorrect: number;
  };
}
```

Limit recent mistakes and leeches to the top five each. Resolve subject labels and accepted answers in deterministic UI fields rather than asking the model to reproduce them.

Validated model output:

```ts
interface StudySummaryPayloadV1 {
  version: 1;
  overview: string;
  wins: string[];
  focus: string[];
  nextAction: string;
  factRefs: string[];
}
```

Render authoritative counts beside the generated prose. Every `factRef` must resolve to an input fact. Reject unsupported percentages, time comparisons, subject claims, or recommendations that name facts outside the allowlist.

### What the Summary May Say

With the current database:

- “You have 42 reviews available and 18 more expected in the next 24 hours.”
- “Three recently missed subjects are still in Apprentice.”
- “Your lifetime reading error rate is higher than your meaning error rate for these leeches.”
- “You have passed 31 of 35 current-level kanji.”

Only after attempt history exists:

- “Your seven-day reading accuracy improved from the previous seven-day window.”
- “You missed the same reading three times this month.”
- “This confusion has not recurred since Pair Practice.”

The summary must not claim motivation, effort, mastery, learning style, or causality. It must not say “improved,” “declined,” “this week,” or “recent accuracy” unless the input contains comparable timestamped windows.

## Product Rules

- Fully optional and local; no cloud fallback.
- Never use TinySwallow to grade answers, approve synonyms, change SRS stages, or order reviews.
- Never block grading, saving, Continue, or navigation while the model loads or generates.
- Do not load the model at app startup or merely because a review begins.
- Show help mainly for repeated mistakes or verified confusion—not every wrong answer.
- All generated content must be checked against authoritative local subject facts before display.
- If generation fails, show a deterministic card containing the entered answer, accepted answer, mistake count, official mnemonic, and available pair facts.
- Pair practice is always unscored and never writes WaniKani review results.
- Do not ship generated Japanese example sentences in the initial version.

## Model and Download Notes

- Reuse the existing TinySwallow 1.5B Q5_K_M model through `llama.rn`; the native integration already exists.
- The model download is approximately 1.1 GB and is already opt-in.
- Existing generation is lazy, single-flight, streamable, cancellable, and cached.
- Before production use, add strict structured-output/fact validation, artifact checksum verification, background cancellation, and a benchmarked unload policy.
- Current hard-coded GPU-layer settings still require physical-device benchmarks.
- Unsupported or slow devices must retain every deterministic feature without model-generated text.

## Required Database Changes

Add a migration with two local-only tables:

### `review_attempts`

- subject and assignment ID;
- session ID and review/lesson/practice source;
- meaning or reading task;
- normalized submitted answer;
- answer result and scored-correct flag;
- override flag;
- timestamp and previous SRS stage.

Record the final disposition after retry-only guidance, synonym, and override decisions. Retry-only guidance must not count as a scored miss. Practice attempts may be stored but must remain distinguishable from WaniKani-scored reviews.

### `learning_interventions`

- intervention kind and involved subject IDs;
- deterministic evidence hash;
- model and prompt version when used;
- offered, generating, shown, skipped, dismissed, or failed state;
- nullable helpful/not-helpful result and timestamps.

Use SQL/rules over `review_attempts`, `review_stats`, assignments, and subjects to calculate recurrence and confusion evidence. Do not store model-created learner diagnoses as facts. Preserve these local tables during full refresh, remove rows for deleted subjects, and apply the retention policy below.

## History Retention and Storage Policy

Use a bounded recent-attempt log, not permanent submission history. Mistake Lens and Confusion Pair need recent evidence; lifetime meaning/reading performance already exists in WaniKani `review_stats`.

### Retention Limits

- Keep detailed attempts for **90 days**.
- Apply a hard cap of **50,000 attempts**; age or cap, whichever is reached first.
- Keep intervention detail for **180 days**.
- Add a separate **Clear learning history** action in Settings.
- Do not add long-term rollup tables initially. Add compact monthly counts later only if a proven reporting feature needs them.

At an estimated 250–500 bytes per attempt including indexes, 90 days is approximately:

| Study volume | Rows | Estimated storage |
|---:|---:|---:|
| 100 attempts/day | 9,000 | 2–5 MB |
| 300 attempts/day | 27,000 | 7–14 MB |
| 1,000 attempts/day | 90,000 | 23–45 MB before the 50,000-row cap |

These are planning estimates and must be measured against the actual SQLite schema.

### What Counts as an Attempt

| Event | Persist? | Treatment |
|---|---:|---|
| Correct scored answer | Yes | Store outcome; `normalized_answer` may be `NULL`. |
| Incorrect scored answer | Yes | Store normalized answer for recurrence/confusion matching. |
| Retry-only guidance | No | Invalid characters, reading-type guidance, and similar retries are not scored mistakes. |
| Empty submission | No | Not a learning attempt. |
| Overridden answer | Yes | Update the attempt with `overridden = 1`; exclude it from scored-miss evidence. |
| Answer accepted after adding a synonym | Yes | Update the related attempt so it does not remain false mistake evidence. |
| Practice answer | Optional | Store with `source = 'practice'`; never mix it into WaniKani-scored recurrence. |
| Anki self-rating | Yes | Store the outcome without a typed answer. |

Insert a scored attempt immediately after deterministic grading. If the learner overrides it or adds a synonym, update that attempt before Continue. Do not wait for subject completion: an app interruption must not erase attempts already counted by the in-memory session.

### Compact Schema and Indexes

Use an integer primary key because attempts are local-only:

```sql
CREATE TABLE review_attempts (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL,
  subject_id INTEGER NOT NULL,
  assignment_id INTEGER,
  source TEXT NOT NULL,
  task_type TEXT NOT NULL,
  normalized_answer TEXT,
  result_kind TEXT NOT NULL,
  scored_correct INTEGER NOT NULL,
  overridden INTEGER NOT NULL DEFAULT 0,
  occurred_at TEXT NOT NULL,
  srs_stage_before INTEGER
);

CREATE INDEX review_attempts_subject_task_time_idx
ON review_attempts(subject_id, task_type, occurred_at DESC);

CREATE INDEX review_attempts_wrong_answer_time_idx
ON review_attempts(normalized_answer, task_type, occurred_at DESC)
WHERE scored_correct = 0 AND normalized_answer IS NOT NULL;
```

The partial wrong-answer index keeps Confusion Pair matching fast without indexing every correct answer.

### Cleanup

Run cleanup after a study session or at most once per day on foreground, never during active review input:

1. Delete attempts older than 90 days.
2. If more than 50,000 remain, delete the oldest excess rows.
3. Delete intervention detail older than 180 days.
4. Remove rows for subjects that no longer exist after a full refresh.
5. Record the last maintenance timestamp.

Delete in bounded batches, such as 2,000 rows per write transaction, so maintenance does not hold Yomiji’s database write lock for a long period. Do not run `VACUUM` after routine pruning; SQLite can reuse freed pages. Database compaction may be added later as an explicit idle maintenance action if measurements show a need.

### Full Refresh and Privacy

- Keep learning-history tables out of the remote-cache deletion list.
- Do not snapshot tens of thousands of attempts into JavaScript during full refresh.
- After remote subjects are downloaded again, prune attempts and pairs whose subject IDs no longer exist.
- Never upload attempts to WaniKani or include answers in routine logs/crash reports.
- Store normalized answers, not the original input.
- Exclude answers from diagnostic exports unless the learner explicitly opts in.
- Clearing learning history disables personalized recurrence/confusion until new evidence is collected.
- Deleting the model clears model caches, but learning history should be a separate user choice.
- Logout or a full local-data reset clears both attempt and intervention history.

## Not Recommended

- A general-purpose chat screen.
- AI answer checking or synonym approval.
- AI-generated scored questions or answer keys.
- AI-selected SRS changes or review ordering.
- Unverified readings, meanings, grammar advice, or Japanese examples.
- Learner personality/profile claims.
- Continuous background inference or automatic loading at launch.
- Embeddings or vector search for data already addressable through subject IDs and exact answers.

## Suggested Rollout

### 1. Add Local Attempt History

Persist prospective attempts at the current answer-finalization point. Add deterministic queries for repeated same-task misses and exact matches against accepted answers of other learned subjects. Preserve this data through full refresh.

### 2. Ship Deterministic Cards and Pair Practice

Show repeated-mistake/confusion evidence without a model, add explicit subject-ID practice queues, and verify that practice remains unscored. This proves the feature is useful even when TinySwallow is unavailable.

### 3. Add Validated TinySwallow Text and AI Study Summary

Refactor the current `why_wrong` action to accept bounded evidence and return typed, fact-referenced output. Add the on-press Dashboard summary using a deterministic `StudySummaryFacts` query and the shared validated generator. Add helpfulness outcomes and compare generated cards against deterministic fallbacks.

### 4. Add Weak-Spot Clinic

Start with current recent-mistake and leech data, then add task-specific recurrence, confusion pairs, cooldowns, and recurrence measurements from the new local tables.

## Success Measures

- Fewer repeat errors on subjects shown in Mistake Lens or Pair Practice.
- Learners rate explanations as helpful.
- Review continuation remains fast and interruption-free.
- No change to answer-checking or SRS correctness.
- No crashes or serious UI stalls on supported physical devices.
- Invalid or unsupported model output is never displayed as fact.

## Main Risks

| Risk | Response |
|---|---|
| Explanations are generic or misleading | Validate output against local facts and fall back to deterministic content. |
| The 1.1 GB download is not worth the value | Keep it opt-in and prove usefulness with the Mistake Lens prototype first. |
| Memory or performance problems | Benchmark physical devices, load lazily, serialize requests, and unload on background or memory pressure. |
| Too many review interruptions | Promote help only after repeated evidence, suppress repeated prompts within a session, and move persistent issues to the clinic. |

## Final Recommendation

The proposal is feasible without expanding the current WaniKani API client. The former blocking gap—individual attempt history—is now filled by local `review_attempts` recording going forward (not backfilled).

Shipped order matches the recommendation: **attempt recorder → deterministic Mistake Lens/Confusion Pair → explicit pair practice → validated TinySwallow wording and on-press AI Study Summary → Weak-Spot Clinic**. This preserves Yomiji’s existing answer checker and offline-first review writes while making every AI statement optional, non-blocking, and traceable to local evidence.
