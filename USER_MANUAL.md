# 読路 (Yomiji) — User Manual

Welcome to **読路** (Yomiji), your offline-first WaniKani study companion. This guide covers everything the app can do.

> **読路** means "reading road" — a quieter path through your daily reviews.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Dashboard](#dashboard)
3. [Reviews](#reviews)
4. [Lessons](#lessons)
5. [Practice Modes](#practice-modes)
6. [Weak-Spot Clinic](#weak-spot-clinic)
7. [Subject Browsing & Search](#subject-browsing--search)
8. [Subject Details](#subject-details)
9. [Settings](#settings)
10. [Study Coach (TinySwallow)](#study-coach-tinyswallow)
11. [Notifications](#notifications)
12. [Sync & Offline Behavior](#sync--offline-behavior)
13. [Diagnostics](#diagnostics)

---

## Getting Started

### Logging In

1. Open 読路. You'll see the login screen with the app branding.
2. Enter your **WaniKani API token**. You can create one at [wanikani.com/settings/personal_access_tokens](https://www.wanikani.com/settings/personal_access_tokens) — tap "Create token" on the login screen to open that page directly.
3. The token needs **review** and **study-material** scopes.
4. Tap **Enter 読路**. The app validates and saves your token. After you enter the dashboard, 読路 starts the initial sync automatically; if your cache is still empty, use **Sync WaniKani data** or pull to refresh.

On first login, the app will request notification permissions. You can grant or deny these — notifications can be configured later in Settings.

---

## Dashboard

The dashboard is your home base. Pull down at any time to run an explicit incremental sync.

### Header

- **Username** — your WaniKani username (or "Local cache" if data hasn't synced yet).
- **Level pill** — tap it to browse subjects at your current level.
- **Cached subjects pill** — shows how many subjects are stored locally.

### Header Actions

| Button | Action |
|---|---|
| 🔍 Search | Opens subject search |
| ⚙️ Settings | Opens app settings |

### First Sync

If your local cache is empty, the dashboard shows a first-sync panel. Lessons, reviews, search, and subject details become available after WaniKani data is downloaded. Tap **Sync WaniKani data** or pull to refresh if the automatic initial sync has not finished.

### Study Action Cards

Two prominent cards show your available work:

- **Lessons** — shows the number of unlocked items ready to learn. Tap to start a lesson session. Disabled during vacation mode.
- **Reviews** — shows the number of reviews due right now. Tap to start reviewing. Disabled during vacation mode.

> If you have lessons available, a **Lesson Picker** button also appears beneath the cards, letting you choose specific items.

### Vacation Banner

When WaniKani vacation mode is active, a yellow banner appears. Lessons and reviews are disabled, but you can still browse subjects and access settings.

### Upcoming Reviews Chart

A bar chart showing the predicted review count for the next **24 hours**, grouped by hour. This helps you plan your study sessions.

### Current Level Progress

A progress chart showing how many radicals, kanji, and vocabulary you've completed at your current level. Displayed with colored progress bars for each subject type.

### SRS Distribution

A stacked bar showing how your items are distributed across WaniKani's SRS stages:

| Stage | Color |
|---|---|
| Apprentice (1–4) | Pink/purple |
| Guru (5–6) | Yellow/gold |
| Master (7) | Dark purple |
| Enlightened (8) | Purple |
| Burned (9) | Dark gray |

Tap any SRS stage to **browse all items** in that bucket.

### Recent Mistakes

Shows up to 5 items you got wrong in the last 24 hours. Each item displays the subject character and its primary meaning. Tap **Practice** to start a recent-mistakes practice session.

### Study Summary

An on-demand **Study summary** card shows deterministic metrics (reviews due, lessons available, next-24h forecast, SRS counts). Tap the **sparkles** icon to optionally generate an AI overview when Study Coach is installed and enabled. Metrics always work without the model.

### Weak-Spot Clinic Entry

A **Weak-Spot Clinic** button opens a focused practice hub for recent mistakes, leeches, recurring task misses, and confusion pairs.

### Leeches

Shows items with a high incorrect-to-correct ratio — items that keep tripping you up. The section displays:

- **Apprentice Leeches** — leeches currently in the Apprentice SRS stage (shown if there are no all-level leeches to display).
- **All Leeches** — leeches across all SRS stages.

Tap **Practice** to start a leech practice session.

### Shortcuts

- **Burned Item Practice** — review your burned items without affecting SRS. Shows the count of burned items.
- **Excluded Items** — browse vocabulary you've hidden from lessons and reviews.

### Sync Panel

Shows when data was last synced and the current sync status. Tap **Sync now** to run an explicit incremental sync. If there's an error, it will be displayed here.

---

## Reviews

### Starting a Review Session

From the dashboard, tap the **Reviews** card. Reviews come from items in your local cache that are currently due.

### Review Flow

Reviews use a **two-queue system**:

1. Items enter the **active queue** (up to your batch size).
2. You answer each item's meaning and/or reading.
3. Wrong answers are re-queued with a short delay.
4. An item is **finished** when all its tasks (meaning + reading) are answered correctly (or one side is unavailable).
5. When an item finishes, the next item from the review queue enters the active queue.

### Answer Input

- **Meaning questions** — type in English (or your synonyms). A standard text input is used.
- **Reading questions** — type in Japanese. On most keyboards, you can type in romaji and it will be **automatically converted to kana**. The placeholder text shows **答え** (which means "answer").

### Answer Feedback

After submitting an answer, you'll see one of these responses:

| Feedback | Meaning |
|---|---|
| **Correct** | Precise match |
| **Close enough** | Imprecise but acceptable match |
| **Incorrect** | Wrong answer — the correct answer is shown |
| **That is the reading** | You typed the reading, but the meaning was asked for |
| **That is another reading** | You typed a non-primary reading |
| **Check the okurigana** | The okurigana portion was wrong |
| **Invalid characters** | The answer contained disallowed characters |

When you answer incorrectly, the correct answer is displayed. After any vocabulary answer, a **Play Audio** button lets you hear the pronunciation; it is disabled while offline.

### Mistake Lens

After a scored miss, if local history shows a repeated same-task miss (within 14 days) or your wrong answer exactly matches another learned item, a **Mistake Lens** card may appear under the normal feedback. It is optional and never blocks **Continue**.

- Shows verified accepted answers, miss counts, and short contrast bullets from local data.
- Tap **sparkles** (when Study Coach is ready) for an optional AI explanation and memory cue.
- **Practice pair** starts an unscored practice session for an unambiguous confusion pair.
- **Helpful / Not helpful** stores local feedback only.
- **Not now** dismisses the card for this moment.

If cheats and Study Coach are enabled, the free-form **AI: Explain this mistake** action remains available for any wrong answer.

### Answer Checking Details

The answer checker is sophisticated:

- **Case-insensitive** matching for meanings.
- **Fuzzy matching** (can be disabled with Exact Match setting) allows close-but-not-exact answers.
- **Synonyms** you've added are accepted as correct answers.
- **Blacklisted meanings** (common wrong answers) are rejected with a specific message.
- **Kana normalization** — different kana representations of the same reading are treated as equivalent.
- **Romaji-to-kana conversion** happens live as you type reading answers.

### Cheats

When cheats are enabled and you answer incorrectly, three options appear:

| Cheat | Effect |
|---|---|
| **My answer was correct** | Overrides the answer as correct. The item progresses normally. |
| **Try again later** | Moves the item to the back of the queue. You'll see it again. |
| **Add as synonym** | (Meaning tasks only, when you've typed something) Adds your answer as a meaning synonym and marks it correct. The synonym is synced to WaniKani. |

### Wrap-Up Mode

Tap **Wrap Up** (available after the first answer) to enter wrap-up mode. No new items enter the active queue — you finish only the items currently in front of you. A message confirms wrap-up is active.

### Anki Mode

When Anki mode is enabled, the flow changes:

1. You see the subject character (no input field).
2. Tap **Show Answer** to reveal the meaning and reading.
3. Self-grade by tapping **Correct** (green) or **Incorrect** (red).
4. A single combined card covers both meaning and reading.

### Quick Settings

Tap the ⚙️ icon in the session header to open **Quick Settings** — a modal panel where you can toggle settings mid-session without leaving:

**Answers & Marking:**
- Exact match
- Allow cheats

**Display:**
- Show full answer

**Audio:**
- Autoplay audio
- Interrupt background audio

**Session:**
- Wrap Up (shows remaining count)
- End Session

### Subject Details After Answer

After answering, inline subject details appear below the feedback card. By default, only sections relevant to the task you answered are shown. Tap **Show all information** to expand everything (meaning, reading, components, mnemonics, hints, context sentences, used-in).

### Review Summary

When all reviews (or the wrap-up batch) are complete, you see a summary screen:

- **Success rate** as a percentage (large display)
- **Reviews completed** count
- **Correct** and **Needs Review** stat cards
- **Incorrect Items** grouped by level, showing wrong counts per item

---

## Lessons

### Starting a Lesson Session

From the dashboard, tap the **Lessons** card to start with the default lesson queue, or tap **Lesson Picker** to choose specific items.

### Lesson Picker

The lesson picker shows up to 100 available lesson items, grouped by:

1. **Level** — sorted from lowest to highest.
2. **Subject type** — within each level, items are grouped into Radicals, Kanji, and Vocabulary.

Tap items to select them (a colored dot indicates selection). The footer button shows how many items you've selected: **Begin (N)**. Tap it to start the lesson session with just those items.

### Lesson Session Flow

Lessons have two phases: **Introduction** and **Quiz**.

#### Introduction Phase

Items are presented in batches based on your **New Items Per Quiz** setting.

1. A **chip row** at the top shows all items in the current batch. Tap any chip to jump to that item.
2. The **subject hero card** shows the character, type, and level.
3. **Detail sections** show:
   - **Meaning** — primary and secondary meanings
   - **Reading** — primary and alternate readings (for kanji and vocabulary)
   - **Radical Combination / Components** — the parts that make up this item, shown as tappable chips with meanings
   - **Meaning Explanation / Mnemonic** — with highlighted radicals/kanji/meaning terms, plus optional hint
   - **Reading Explanation** — with highlighted terms, plus optional hint (kanji and vocabulary only)
   - **Context Sentences** — Japanese and English sentence pairs (vocabulary only)
   - **Part of Speech** — grammatical category (vocabulary only)
   - **Used In** — items that incorporate this subject (radicals and kanji only)

4. Navigate with **Back** / **Next** buttons. On the last item, the Next button becomes **Start Quiz**.

If there are multiple batches, the progress indicator shows "Batch X/Y · item/N".

#### Quiz Phase

The quiz uses the same answer checker as reviews, with lesson-specific limits:

- Type your answer and tap **Submit Answer**.
- Correct and incorrect feedback is shown.
- Cheats, Anki mode, and the Exact Match review setting are **not** applied during lesson quizzes.
- Lesson starts are queued after each item is completed correctly in the quiz.

#### Batch Completion

After finishing a batch quiz, a summary shows your accuracy. If there are more batches:

- Tap **Continue Lessons** to move to the next batch (introduction → quiz).
- Otherwise, tap **Back to Dashboard**.

---

## Practice Modes

Practice modes let you review items **without submitting SRS progress** to WaniKani. Your answers won't change item SRS stages. Practice sessions use the same review interface as normal reviews.

### Recent Mistakes Practice

- **Source:** Items you answered incorrectly in the last 24 hours.
- **Entry:** Dashboard → Recent Mistakes → **Practice** button.
- If no mistakes exist in the last 24 hours, the section is hidden.

### Apprentice Leech Practice

- **Source:** Items currently in the Apprentice SRS stage with a high incorrect/correct ratio (above your leech threshold).
- **Entry:** Dashboard → Apprentice Leeches → **Practice** button.

### All Leech Practice

- **Source:** Items at any SRS stage with a high incorrect/correct ratio.
- **Entry:** Dashboard → Leeches → **Practice** button.
- When this section is shown, the Apprentice-only section is hidden to avoid duplication.

### Burned Item Practice

- **Source:** Items that have reached the Burned SRS stage.
- **Entry:** Dashboard → Shortcuts → **Burned Item Practice**.
- Great for reviewing old material without un-burning items.

### Pair Practice

- **Source:** An explicit list of subject IDs from Mistake Lens or Weak-Spot Clinic.
- **Entry:** Mistake Lens **Practice pair**, or Weak-Spot Clinic row **Practice**.
- Uses the same review UI and never submits WaniKani SRS progress.

---

## Weak-Spot Clinic

Open **Weak-Spot Clinic** from the dashboard. Sections include:

1. **Recent mistakes** — last 24 hours, with practice deep link.
2. **Leeches** — high incorrect/correct ratio items.
3. **Recurring task misses** — subjects with ≥2 scored misses on the same meaning/reading task in the last 14 days (from local attempt history).
4. **Confusion pairs** — subjects that shared the same wrong answer recently; practice opens an unscored pair session.

All practice from this screen is unscored.

---

## Subject Browsing & Search

### Subject Catalog (by Level)

From the dashboard, tap your **Level pill** to see all subjects at that level. Subjects are grouped into three sections:

- **Radicals** — with pink/purple borders
- **Kanji** — with kanji-colored borders
- **Vocabulary** — with vocabulary-colored borders

Tap any item to open its detail screen.

### SRS Bucket Browsing

From the dashboard, tap any SRS stage in the SRS distribution bar to see all items in that bucket. For example, tap "Apprentice" to see all items at SRS stages 1–4.

### Excluded Items

From the dashboard shortcuts, tap **Excluded Items** to browse vocabulary you've hidden. These items won't appear in lessons or reviews.

### Search

Tap 🔍 on the dashboard to open the search screen.

- **Search by:** Japanese text, English meaning, or kana reading.
- **Real-time results** with a 250ms debounce.
- Results show the subject character, level, type, and accuracy percentage.
- **Ranking:** Exact matches first, then prefix and contains matches, with ties sorted by level, subject type, and ID.
- **Limit:** 50 results maximum.
- Tap any result to open its detail screen.

---

## Subject Details

The subject detail screen shows comprehensive information about any subject. It's accessible from:

- Search results
- Subject catalog
- SRS bucket browsing
- Component/amalgamation links within other detail screens

### Hero Card

Shows the subject character (or image for image-only radicals), subject type, and level.

### Stats Row

- **SRS Stage** — e.g., "Apprentice 2", "Guru 1", "Master", "Enlightened", "Burned", or "Unlocked"
- **Accuracy** — percentage correct (if available)

### Detail Sections

| Section | Radicals | Kanji | Vocabulary |
|---|---|---|---|
| Meaning | ✅ | ✅ | ✅ |
| Reading | — | ✅ | ✅ |
| Components / Radical Combination | — | ✅ (radicals) | ✅ (kanji) |
| Mnemonic / Meaning Explanation | ✅ | ✅ | ✅ |
| Reading Explanation | — | ✅ | ✅ |
| Context Sentences | — | — | ✅ |
| Part of Speech | — | — | ✅ |
| Used In | ✅ (kanji) | ✅ (vocabulary) | — |
| Meaning Note | ✅ | ✅ | ✅ |
| Reading Note | — | ✅ | ✅ |

- **Components** and **Used In** items are tappable — tap to navigate to that subject's detail screen.
- **Mnemonic text** highlights tagged terms (radical, kanji, meaning, reading) in color.
- **Hints** appear below mnemonics in italic when available.

### Editing Notes & Synonyms

- **Meaning Note** and **Reading Note** — tap "Add" or "Edit" to write personal notes. Notes are saved to your study materials and synced to WaniKani.
- **Synonyms** — existing meaning synonyms are shown and accepted during reviews. New synonyms can currently be added from the review cheat **Add as synonym** after an incorrect meaning answer.

---

## Settings

Access settings from the ⚙️ icon on the dashboard header.

### Appearance

| Option | Values | Default | Description |
|---|---|---|---|
| Theme | System, Light, Dark | System | Controls the app color scheme. Changes apply immediately. |

### Reviews

| Setting | Type | Default | Description |
|---|---|---|---|
| Review Order | Selection | Random | How review items are ordered. See below for all options. |
| Anki Mode | Toggle | Off | Reveal answers first, then self-grade. One combined card per item. |
| Exact Match | Toggle | Off | Disable fuzzy matching for meaning answers. Only exact answers accepted. |
| Group Meaning & Reading | Toggle | Off | Ask meaning and reading back-to-back for each item. |
| Meaning First | Toggle | On | When grouped, ask meaning before reading. Only visible when grouping is on. |
| Minimize Review Penalty | Toggle | On | Cap wrong counts to 1 per task type instead of incrementing. |
| Enable Cheats | Toggle | On | Allow override correct, try again later, and add synonym after wrong answers. |
| Batch Size | Stepper (1–15) | 5 | Number of items in the active review queue at once. |
| Limit Review Count | Toggle | Off | Enable a cap on how many reviews are loaded per session. |
| Review Limit | Stepper (5–500, step 5) | 15 | Maximum reviews per session when the limit is enabled. Current review sessions load up to 100 due reviews from the local queue, so values above 100 only take effect after the queue-loading cap is raised. |
| Leech Threshold | Stepper (1–10) | 1 | Incorrect/correct ratio for leech detection in practice modes. |

**Review Order Options:**

| Order | Description |
|---|---|
| Random | Shuffle all reviews randomly |
| Ascending SRS | Lowest SRS stage first |
| Descending SRS | Highest SRS stage first |
| Alternating SRS | Alternate between easy and hard items |
| Current Level First | Items at your current level first |
| Lowest Level First | Items from the lowest level first |
| Newest Available | Most recently unlocked reviews first |
| Oldest Available | Longest-waiting reviews first |
| Longest Wait | Items you haven't seen in the longest time |

### Audio

| Setting | Type | Default | Description |
|---|---|---|---|
| Voice Actor | Selection | Auto | Choose a specific voice actor for vocabulary audio, or Auto for automatic selection. Voice actors appear after sync. |
| Play Audio Automatically | Toggle | Off | Auto-play vocabulary audio after correct reading answers. |
| Interrupt Background Audio | Toggle | Off | Duck or pause other audio (music, podcasts) while pronunciation plays. |

> Audio is streamed from WaniKani servers and requires an internet connection. Offline audio download is not yet available.

### Notifications

| Setting | Type | Default | Description |
|---|---|---|---|
| Review Notifications | Toggle | On | Master toggle for review notifications. |
| Badge Icon | Toggle | On | Show the available review count on the app icon. |
| Notification Sound | Toggle | Off | Play a sound when a notification fires. |
| Review Threshold | Stepper (1–200) | 50 | Notify when this many reviews are pending. The notification is scheduled as a one-shot trigger at the exact time the Nth review becomes available. |
| Daily Reminder | Toggle | On (8 PM) | Get a daily reminder notification at a configured time. |
| Reminder Time | Stepper (0–23) | 20 (8 PM) | The hour for the daily reminder. Displayed in 12-hour format (e.g., "8 PM"). |

Notifications are automatically suppressed during **vacation mode** and when the OS permission is denied.

### Lessons

| Setting | Type | Default | Description |
|---|---|---|---|
| New Items Per Quiz | Stepper (1–10) | 5 | How many new items are introduced in each lesson batch before the quiz. |
| Max Lessons Per Session | Stepper (1–50) | 15 | Maximum lessons pulled from the dashboard Lessons card. |
| Prioritize Current Level | Toggle | Off | Show current-level items first in lessons (descending level). |
| Interleave Lessons | Toggle | Off | Shuffle items within level groups for a mixed subject-type experience. |
| Show Kana-Only Vocabulary | Toggle | On | Include kana-only vocabulary in lessons and the lesson picker. |
| Subject Type Order | Up/down controls | Radicals → Kanji → Vocabulary | Priority order for subject types during lessons. Use ↑/↓ buttons to reorder. |

### Subject Details

| Setting | Type | Default | Description |
|---|---|---|---|
| Katakana for Onyomi | Toggle | Off | Display onyomi (Chinese-origin) kanji readings in katakana instead of hiragana. |
| Show All Readings | Toggle | Off | Show all accepted alternate readings, not just primary readings. |

### Diagnostics

A button to open the [Diagnostics](#diagnostics) screen.

### Study Coach

Download, enable, or delete the optional offline TinySwallow model. Generation is always on-demand — the model does not load just because the app or a review starts.

### Learning History

**Clear learning history** removes the local 90-day attempt log and intervention outcomes. Personalized Mistake Lens / clinic recurrence resets until new evidence is collected. This does **not** delete the Study Coach model file.

### Log Out

Tap **Log Out and Clear Cache** to:
1. Delete your API token from secure storage.
2. Clear all local cached data (including learning history and coach cache).
3. Clear pending write queues.
4. Cancel all scheduled notifications.
5. Return to the login screen.

> This is a destructive action. All local progress not yet synced will be lost.

---

## Study Coach (TinySwallow)

Study Coach is an optional, fully offline assistant. It never grades answers, never changes SRS stages, and never blocks Continue or navigation.

### What it can do

- **Mistake Lens** wording after repeated misses or verified confusion pairs (on sparkles).
- **AI Study Summary** on the dashboard (on sparkles).
- Free-form subject helpers such as explain / mnemonic / examples from subject detail when enabled.

### What it will not do

- Grade or re-grade answers.
- Approve synonyms or reorder queues.
- Auto-generate on app start, dashboard focus, or review start.
- Invent accepted readings/meanings; structured cards are validated against local facts.

### Storage and privacy

- Attempt history and intervention ratings stay on-device.
- Full refresh keeps attempt history (orphans pruned if subjects disappear).
- Logout clears learning history and coach response cache.

---

## Notifications

読路 uses two notification types:

### Threshold Notification

A **one-shot** notification scheduled for the exact moment when the Nth review becomes available. For example, if your threshold is 50 and you currently have 30 reviews, the notification will fire when the 50th review's `available_at` time is reached.

- Re-scheduled every time the app foregrounds or syncs.
- Shows "Reviews Available" with the threshold count.

### Daily Reminder

A **recurring** daily notification at your configured hour.

- Uses native platform scheduling — works even if you haven't opened the app.
- Shows "Daily Reminder" with "Check your reviews".

### Badge Count

The app icon badge shows your current available review count. Updated every time the app foregrounds or syncs. If **Review Notifications** are off but **Badge Icon** is on, 読路 updates the badge without scheduling review notifications.

### Behavior

- **Vacation mode:** All notifications and badges are suppressed.
- **Permission denied:** Notifications are cleared and not re-scheduled.
- **Tapping notifications:** Opening a review notification starts the review session.
- **Platform differences:**
  - **iOS:** Notification sound setting controls whether a sound plays. Badge is set via the notification system.
  - **Android:** Sound is controlled by the notification channel. Badge behavior varies by launcher.

---

## Sync & Offline Behavior

読路 is designed to work offline after your initial sync.

### How Sync Works

1. **Initial sync** downloads all your WaniKani data (subjects, assignments, study materials, review stats, level progressions, voice actors) into a local SQLite database.
2. **Incremental sync** uses `updated_after` cursors to fetch only data that changed since the last sync.
3. **Pending writes** (review results, lesson starts, study material edits) are queued locally first, then flushed to the WaniKani API during the next sync.

### When Sync Happens

| Trigger | What Happens |
|---|---|
| **App opens / foregrounds** | If stale (>15 minutes) or has pending writes → incremental sync. Throttled to once per minute. |
| **App backgrounds** | If pending writes exist → flush pending writes only. Throttled to once per minute. |
| **Pull-to-refresh on dashboard** | Explicit incremental sync. |
| **After review/lesson actions** | Dashboard counts update immediately from local data. |

### Offline Capabilities

When offline, you can:

- ✅ Browse all cached subjects, search, view details
- ✅ Complete review sessions (results queued locally)
- ✅ Complete lesson sessions (starts queued locally)
- ✅ Edit notes and add synonyms from review cheats (queued locally)
- ✅ View dashboard data (from last sync)
- ✅ Use deterministic Mistake Lens / Weak-Spot Clinic / Study summary metrics from local history
- ✅ Use Study Coach generation if the TinySwallow model is already installed
- ❌ Stream vocabulary audio
- ❌ Download the Study Coach model (requires network)
- ❌ Sync new data from WaniKani

### Error Handling

Sync errors are classified and displayed clearly:

| Error Type | Behavior |
|---|---|
| **Offline** | Message shown. Local operations continue. |
| **Timeout** | Message shown. Retry on next sync trigger. |
| **Auth (401/403)** | Token deleted. You're logged out and returned to login. |
| **Rate limit (429)** | Message shown with retry guidance. |
| **Hibernating account** | Actionable error message displayed. |
| **Server error** | Generic error message. Logged for diagnostics. |

All errors are sanitized before display — API tokens and sensitive headers are never shown in error messages.

---

## Diagnostics

Access from Settings → Diagnostics. This screen is for troubleshooting.

### App Info

- **Version** — current app version.
- **Platform** — React Native (Expo).

### Cache

Row counts for each local table:

- Subjects
- Assignments
- Study Materials
- Review Statistics
- Level Progressions

### Sync

- **Last Sync** — timestamp of the most recent successful sync.
- **Sync Cursors** — the `updated_after` timestamp for each collection, showing how current each data type is.

### Pending Writes

- **Review/Lesson Progress** — count of queued review results and lesson starts not yet sent to WaniKani.
- **Study Material Edits** — count of queued note/synonym edits not yet sent.

> A hint appears: "Pending writes will flush on next background or manual sync."

### Error Log

Shows the most recent 25 error log entries with:

- Timestamp
- Severity level (warning, error)
- Message (sanitized)
- Context

Tap **Clear Error Log** to wipe it.

### Export Diagnostics

Tap **Export Diagnostics** to share a JSON file containing diagnostic data. This is useful for bug reports. The export includes app version, cache counts, pending write counts, sync cursors, and sanitized error context. **No API tokens are included**, but diagnostic state can still be account/app-state specific.

### Full Refresh

A destructive option at the bottom of diagnostics:

- **Clear Cache and Resync** — deletes all cached remote data and re-downloads everything from WaniKani. Your pending local writes (unsynced review results, lesson starts, study material edits) are **preserved** and will be flushed first.

---

## Quick Reference

### Color Coding

| Color | Subject Type |
|---|---|
| Pink/Purple | Radical |
| Blue/Teal | Kanji |
| Green/Violet | Vocabulary |
| Gold/Yellow | Lesson accent |

### Keyboard Shortcuts

- **Submit answer** — Press the keyboard's Done/Enter key.
- **Reading input** — Type in romaji; it converts to kana automatically.

### Gestures

| Gesture | Location | Action |
|---|---|---|
| Pull down | Dashboard | Run explicit incremental sync |
| Long-press | Various buttons | Show help tooltip |
| Tap | SRS bar segment | Browse items in that SRS bucket |
| Tap | Component chip | Navigate to that subject |

---

*読路 — A quieter path through reviews.* 🛤️
