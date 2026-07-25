# WaniKani Recommended Lessons Algorithm

Research notes for matching WaniKani web "Today's Lessons" vs Advanced (Lesson Picker). Snapshots from May–July 2026 (Account F through Day 4, 2026-07-25).

## Working model (current best)

1. **Inputs**
   - Available lessons = assignments with `unlocked=true`, `started=false`, `srs_stages=0`.
   - Per-subject `lesson_position` from subject payload `data.lesson_position`.
   - User pref `lessons_batch_size` (API: `GET /user → data.preferences.lessons_batch_size`). Account F: **5**, confirmed in settings.
   - Recommended cap on observed accounts is repeatedly **`3 × lessons_batch_size`** (15 when batch size is 5). Whether this is hard-coded, `max_daily_lessons`, or `min` of both is still open.

2. **Build recommended list once per recommended window**
   - Split available lessons into type queues (radical / kanji / vocabulary).
   - Sort each queue by `lesson_position` ascending (matches Advanced picker order within type).
   - Take a proportional type quota for `cap = min(available, recommended_cap)`:
     - `ceil` on non-vocab types against the **full available pool**, remainder vocab.
     - Example (Account F Day 3, pre-session **3R+12K+48V = 63**, cap 15):
       - `ceil(15 × 3/63) = 1` R
       - `ceil(15 × 12/63) = 3` K
       - remainder **11** V → **1R+3K+11V**
     - Example (Account F Day 4, pre-session **2R+9K+39V = 50**, cap 15):
       - `ceil(15 × 2/50) = 1` R
       - `ceil(15 × 9/50) = 3` K
       - remainder **11** V → **1R+3K+11V** (observed exact; same non-vocab slots as Day 3)
   - Merge the selected heads by absolute `lesson_position` (cross-type interleave).
   - Chunk into batches of `lessons_batch_size`.

3. **Do not re-proportion after each batch of 5.** Later batches are leftovers of the same prebuilt list.

4. **Rebuild from the current available pool** when a new recommended window starts (evidence: daily / ~12AM rebuild). Advanced picker always shows the full remaining available pool.

5. **Anti-small-batch** (settings UI copy): preferred batch size may be raised so the last batch is not tiny. Account B (13 available, batch_size 5) → recommended **7** then 6 advanced-only, not `min(13, max_daily)`.

### Not yet proven

- Absolute `lesson_position` values as the merge key (strong inference; no API dump in these notes).
- Exact recommended cap when `lessons_batch_size ≠ max_daily_lessons / 3`.
- Exact anti-small-batch redistribution formula.
- Whether an unfinished recommended set survives past midnight.

---

## API verification commands

```bash
# User preferences
curl -sS "https://api.wanikani.com/v2/user" \
  -H "Authorization: Bearer ${WK_API_TOKEN}" \
  -H "Wanikani-Revision: 20170710" | \
  node -e 'let s=""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => {
    const j = JSON.parse(s);
    console.log(JSON.stringify({
      level: j.data.level,
      batch_size: j.data.preferences.lessons_batch_size,
      max_daily: j.data.preferences.lessons_autoexpand_lessons_in_progress ?? j.data.preferences.max_daily_lessons,
      prefs: j.data.preferences
    }, null, 2));
  })'

# Lesson-stage assignments
curl -sS "https://api.wanikani.com/v2/assignments?unlocked=true&started=false&srs_stages=0" \
  -H "Authorization: Bearer ${WK_API_TOKEN}" \
  -H "Wanikani-Revision: 20170710" | \
  node -e 'let s=""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => {
    const j = JSON.parse(s);
    const ids = j.data.map(a => a.data.subject_id);
    console.log("Subject IDs:", ids.join(","));
    console.log("Count:", ids.length);
  })'

# Subjects with lesson_position
curl -sS "https://api.wanikani.com/v2/subjects?ids=<IDS_FROM_STEP_2>" \
  -H "Authorization: Bearer ${WK_API_TOKEN}" \
  -H "Wanikani-Revision: 20170710" | \
  node -e 'let s=""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => {
    const j = JSON.parse(s);
    const sorted = j.data.map(s => ({
      id: s.id, chars: s.data.characters, type: s.object,
      level: s.data.level, pos: s.data.lesson_position
    })).sort((a,b) => a.pos - b.pos);
    console.log(JSON.stringify(sorted, null, 2));
  })'
```

---

## Historical snapshots (compact)

### Account A (level 10) — early verified proportional batches

batch_size=5, 4K+19V=23 available. Per-batch example with positions:

| Batch | Kanji (pos) | Vocab (pos) | Mix |
| ----- | ----------- | ----------- | --- |
| 1 | 農 (51) | 始める (84), 飲む (118), 投げ付ける (175), 化かす (176) | 1K+4V |
| 2 | 親 (62) | 話 (177), 出会う (178), 私大 (183), 千葉 (188) | 1K+4V |
| 3 | 最 (66) | 思わず (189), 立ち飲み (190), 部首 (193), 葉 (194) | 1K+4V |

Recommended **15**/23 in that era’s webapp observation.

### Account B (level ~5) — anti-small-batch + first-batch recommended

4K+9V=13 available, batch_size=5, max_daily=15. Recommended **7** (not 13, not 15). Remainder advanced-only. Daily cap does **not** inflate recommended count.

### Account C (level 10, 2026-05-15) — full-pool session order

~10K+30V; batch_size 5; recommended 15 then user continued Advanced. Within-batch interleave; kanji spread **2,1,1,1,1,1,1,2** across 8 batches of the full pool.

### Account D (level 10, 2026-05-18) — 15 recommended of 26

| Batch | Items | Mix |
| ----- | ----- | --- |
| 1 | 最終, 軽い, 漢, 道路, 線路 | 1K+4V |
| 2 | 路地, 算数, 病, フランス語, スペイン語 | 1K+4V |
| 3 | 主語, 鳴く, 線, 横, 最も | 0K+5V |

### Account E (level 11, 2026-05-25) — first 3-type residual

After an unrecorded Batch 1: Batch 2 `売り上げ, 低, 及, 別, 売り切れ` (1R+2K+2V); Batch 3 `売り手, 本物, 戈, 利, 乗り物` (1R+1K+3V). Per-type order stable; cross-type interleaved.

---

## Account F (level 14) — primary 3-type series

`lessons_batch_size = 5` confirmed in settings. Recommended stream repeatedly **15 = 3 × 5**.

### Day 1 — 2026-07-23

Mid-session: Batches 1–2 completed before Advanced picker screenshot; Batch 3 observed.

| Batch | Items (presented order) | Types | Mix |
| ----- | ----------------------- | ----- | --- |
| 1 | 市町村, 農村, 参, 感謝, **?** | V, V, K, V, **?** | 1K+4V if #5 is V |
| 2 | 謝る, 毛皮, 周, 公, 場合 | V, V, K, R, V | **1R+1K+3V** |
| 3 | 待たせる, 固, 着物, 下着, 季 | V, K, V, V, K | **0R+2K+3V** |

Assumed full mix with missing Batch-1 #5 as vocab: **1R+4K+10V**.

**Advanced residual after B1–2 (picker; V list incomplete OCR):**

| Type | Count | Heads / notes |
| ---- | ----- | ------------- |
| R | 4 | 井, 分, 才, 㦮 (4th confirmed later as 㦮; 公 already in B2) |
| K | 17 | 固, 季, 完, 希, 念, 折, 望, 束, … |
| V | 51+ | 待たせる, 着物, 下着, 水着, … (OCR missed several V later seen on Day 3) |

Batch 3 = leftover of the original 15, not a fresh proportion on the 72-item residual (that would have been ~1R+2K+2V).

### Day 2 — 2026-07-23 (same calendar day, after Day 1’s 15 completed)


| Batch | Items | Types | Mix |
| ----- | ----- | ----- | --- |
| 1 | 水着, 間に合う, 井, 完, 知り合い | V, V, R, K, V | **1R+1K+3V** |
| 2 | 待ちぼうけ, 希, 消しゴム, 悪気, 念 | V, K, V, V, K | **0R+2K+3V** |
| 3 | *(not recorded)* | — | **Inferred 0R+0K+5V** |

Running after 10 items: **1R+3K+6V**. Per-type continuity: R `井`; K `完→希→念`; V continues residual heads.

**Day 3 falsifies “Day 2 B3 takes one more kanji”:** Day 3 (2026-07-24) still starts kanji at **折** (next after 念). Day 2 full mix ≈ **1R+3K+11V**.


### Day 3 — 2026-07-24

Full 15-item recommended stream. Types from WK UI. Advanced screenshot after Batches 1–2.

| Batch | Items (presented order) | Types | Mix |
| ----- | ----------------------- | ----- | --- |
| 1 | 情熱, 事情, 折, 人情, 情け | V, V, K, V, V | **0R+1K+4V** |
| 2 | 感情, 表情, 望, 山登り, 流行語 | V, V, K, V, V | **0R+1K+4V** |
| 3 | 流行歌, 仲間, 束, 分, 祭り | V, V, K, R, V | **1R+1K+3V** |

**Full mix: 1R + 3K + 11V.**  
Non-vocab positions (0-based): 折@2, 望@7, 束@12, 分@13.

**Advanced residual after B1–2 (screenshot):**

| Type | Count | Items (picker order) |
| ---- | ----- | -------------------- |
| R | 3 | 分, 才, 㦮 |
| K | 10 | 束, 芸, 基, 性, 格, 能, 骨, 妥, 頑, 願 |
| V | 40 | 流行歌, 仲間, 祭り, 俺ら, 感じ, 料理, 空き缶, 落ち着く, 消化する, 消える, 気持ち悪い, 皆様, 流れる, 動かす, 着ける, 勉強する, 整理する, 旅行する, 起こす, 旅行者, 悪口, 理解する, 良好, 自動, 消化不良, 期待する, 回転ずし, 回転する, 試合, 合わせる, 動き, お疲れ様, 深さ, 待合, 言葉つき, 具合, 意地悪, 合図, 運動会, 本館 |
| **Total** | **53** | |

Batch 3 heads = residual heads: V `流行歌→仲間→祭り`, K `束`, R `分`.

**Pre–Day-3 pool** (residual after B1–2 + B1–2 consumed): **3R+12K+48V = 63**  
→ `ceil(15×3/63)=1` R, `ceil(15×12/63)=3` K, remainder 11 V — exact.

**Day-1 V OCR gap:** 情熱, 事情, 人情, 情け, 感情, 表情 were missing from the Day-1 residual transcription but appear in Day 3 B1–2 before 山登り/流行語. Do not treat that V list as complete.

### Day 4 — 2026-07-25 (today’s recommended set)

Full 15-item recommended stream. Types from WK UI labels in the user dump.

| Batch | Items (presented order) | Types | Mix |
| ----- | ----------------------- | ----- | --- |
| 1 | 養う, 養子, 芸, 俺ら, 感じ | V, V, K, V, V | **0R+1K+4V** |
| 2 | 料理, 空き缶, 基, 落ち着く, 消化する | V, V, K, V, V | **0R+1K+4V** |
| 3 | 消える, 気持ち悪い, 性, 才, 皆様 | V, V, K, R, V | **1R+1K+3V** |

**Full mix: 1R + 3K + 11V.**  
Non-vocab positions (0-based): 芸@2, 基@7, 性@12, 才@13 — **identical slot pattern to Day 3** (折@2, 望@7, 束@12, 分@13).

**Per-type continuity from Day 3 residual (after B3 consumed 分/束/流行歌/仲間/祭り):**

| Type | Day 3 residual heads after full Day-3 recommended | Day 4 recommended takes |
| ---- | ------------------------------------------------ | ----------------------- |
| R | 才, 㦮 | **才** (1) |
| K | 芸, 基, 性, 格, 能, 骨, 妥, 頑, 願 | **芸 → 基 → 性** (3) |
| V | 俺ら, 感じ, 料理, 空き缶, 落ち着く, 消化する, 消える, 気持ち悪い, 皆様, … | **養う, 養子**, then residual chain 俺ら→…→皆様 (11) |

**養う / 養子** sit ahead of residual V head 俺ら. They were **not** in the Day-3 Advanced residual V list (40 items, ordered, 俺ら fourth after B3 heads). Confirmed as **new overnight unlocks** with lower `lesson_position` than 俺ら — not a reorder of the old V queue.

**Advanced residual after full Day-4 recommended (picker screenshot):**

| Type | Count | Items (picker order) |
| ---- | ----- | -------------------- |
| R | 1 | 㦮 |
| K | 6 | 格, 能, 骨, 妥, 頑, 願 |
| V | 28 | 流れる, 動かす, 着ける, 勉強する, 整理する, 旅行する, 起こす, 旅行者, 悪口, 理解する, 良好, 自動, 消化不良, 期待する, 回転ずし, 回転する, 試合, 合わせる, 動き, お疲れ様, 深さ, 待合, 言葉つき, 具合, 意地悪, 合図, 運動会, 本館 |
| **Total** | **35** | |

**Pre–Day-4 pool (now exact):** residual 35 + recommended 15 = **2R+9K+39V = 50**.

- From Day-3 post-recommended base **2R+9K+37V = 48**, plus **+2 V** (養う, 養子) → 50. No other unlocks.
- Cap 15 proportional:
  - `ceil(15 × 2/50) = 1` R
  - `ceil(15 × 9/50) = 3` K
  - remainder **11** V → **1R+3K+11V** exact.
- Per-type continuity after Day 4: R only 㦮 left; K heads now 格…; V head 流れる (immediate successor of 皆様 in Day-3 residual order).

**Batch structure:** B1/B2 are pure leftover chunks of one prebuilt 15 (same as Days 1–3). B3 heads = remaining recommended, not a re-proportion on the residual after B1–2.

**Rebuild:** New recommended window on **2026-07-25** after Day 3’s completed 15 on **2026-07-24**. Still consistent with daily/~12AM rebuild and/or rebuild-on-finish; Days 1–2 same-calendar-day double window remains the only same-day rebuild evidence.

### Account F deductions

1. Recommended list rebuilds after a completed 15-set **and/or** on a new calendar day — Days 1 and 2 were both **2026-07-23** (two consecutive recommended windows), Day 3 **2026-07-24**, Day 4 **2026-07-25**. Not one immortal level queue. Exact trigger (finish recommended vs ~12AM) still open; Day 4 only adds another next-day rebuild after a completed 15.

2. Type mix is proportional to the **current** available pool — Day 1 **1R+4K+10V**, Days 2–4 **1R+3K+11V** as R/K thinned and V share grew (Day 4 exact on **2R+9K+39V=50**).
3. Batches are chunks of a prebuilt 15; identity of B3 items proves leftovers, not re-pick (even when fresh 5-item proportions coincidentally match counts). Day 4 B1–3 again one prebuilt list.
4. Radical slot moves by merge order (公 mid Day-1 B2; 井 early Day-2 B1; 分 late Day-3 B3; 才 late Day-4 B3) — not radicals-first.
5. Per-type order is stable across days (K: …念→折→望→束→**芸→基→性**; R: …公→井→分→**才**; V residual heads continue unless **new unlocks** insert by lower `lesson_position` — Day 4 **養う, 養子** ahead of 俺ら).
6. **Cross-type interleave slots can repeat** when pool proportions are similar: Days 3 and 4 both place non-vocab at 0-based **@2, @7, @12, @13** (K, K, K, R). Strong support for absolute `lesson_position` merge of fixed per-type heads (not random within-batch fill).

---

## Open questions

1. **Cap rule** — Always `3 × lessons_batch_size`? Or `max_daily_lessons`? Need prefs where they diverge. Account F Days 1–4 all 15.
2. **Merge key** — Need API `lesson_position` dump to prove absolute merge. Day 3↔4 identical non-vocab slots make this nearly certain without the dump.
3. **Anti-small-batch formula** — Account B → [7,6]; threshold unknown.
4. **Rebuild trigger** — Days 1–2 same calendar day (2026-07-23) then Days 3–4 next days after completed 15s. Unclear whether finishing the 15 is enough without midnight, or both occurred on the 23rd for another reason.
5. **Account F loose ends** — Day-1 Batch 1 item #5; Day-2 Batch 3 characters; `max_daily_lessons`.

**Resolved this session:** Day 4 **養う / 養子** are new unlocks (not OCR omission). Residual after Day 4 is exact **1R+6K+28V=35**; pre-pool **2R+9K+39V=50**.

---

## Implementation plan

### Data layer

1. Read `lessons_batch_size` from user preferences during sync (blob already stored).
2. Sort lesson queues by `json_extract(subjects.payload, '$.data.lesson_position')` (no migration required).
3. Batching in `src/domain/study/studyRepository.ts`: type queues → proportional quota for recommended cap → merge by `lesson_position` → chunk by batch size; anti-small-batch when total &lt; cap.

### Dashboard UI

4. Lessons card: recommended count + start first batch in canonical order.
5. Lesson Picker stays full available pool (already implemented).

### Files

| File | Change |
| ---- | ------ |
| `src/domain/api/types.ts` | Type `lessons_batch_size` on preferences |
| `src/domain/db/database.ts` | Surface batch size from user sync if stored |
| `src/domain/study/studyRepository.ts` | Proportional recommended list + batching |
| `src/domain/dashboard/dashboardRepository.ts` | Recommended lesson count |
| `src/screens/DashboardScreen.tsx` | Wire Lessons card |
| `src/domain/db/schema.ts` | Optional indexed `lesson_position` column |
