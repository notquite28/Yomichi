import type { AppDatabase } from '../db/database';
import { getAttemptRevision } from '../study/reviewAttempts';
import {
  getCurrentLevelProgress,
  getDashboardSummary,
  getLeechedItems,
  getRecentMistakes,
  getReviewForecast,
} from './dashboardRepository';
import type { StudySummaryFacts } from '../ai/types';
import { hashPromptPayload } from '../ai/prompts';

export type { StudySummaryFacts };

export async function buildStudySummaryFacts(
  db: AppDatabase,
  options?: { syncRevision?: number },
): Promise<StudySummaryFacts> {
  const [summary, forecast, levelProgressRows, recentMistakes, topLeeches, attemptRevision] =
    await Promise.all([
      getDashboardSummary(db),
      getReviewForecast(db, 24),
      getCurrentLevelProgress(db),
      getRecentMistakes(db, 5),
      getLeechedItems(db, { limit: 5 }),
      getAttemptRevision(db),
    ]);

  const reviewForecast24h = forecast.reduce((sum, hour) => sum + hour.count, 0);

  let levelProgress: StudySummaryFacts['levelProgress'] = null;
  if (levelProgressRows.length > 0) {
    const radicals = levelProgressRows.find((row) => row.subjectType === 'radical');
    const kanji = levelProgressRows.find((row) => row.subjectType === 'kanji');
    levelProgress = {
      radicalsPassed: radicals?.passed ?? 0,
      radicalsTotal: radicals?.total ?? 0,
      kanjiPassed: kanji?.passed ?? 0,
      kanjiTotal: kanji?.total ?? 0,
    };
  }

  const windowStart = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const attemptAgg = await db.getFirstAsync<{
    scored: number;
    correct: number;
    incorrect: number;
  }>(
    `SELECT
       COUNT(*) AS scored,
       SUM(CASE WHEN scored_correct = 1 THEN 1 ELSE 0 END) AS correct,
       SUM(CASE WHEN scored_correct = 0 AND overridden = 0 THEN 1 ELSE 0 END) AS incorrect
     FROM review_attempts
     WHERE source IN ('review', 'lesson')
       AND occurred_at >= ?`,
    windowStart,
  );

  const recentWindow =
    (attemptAgg?.scored ?? 0) > 0
      ? {
          days: 7,
          scoredAttempts: attemptAgg?.scored ?? 0,
          correct: attemptAgg?.correct ?? 0,
          incorrect: attemptAgg?.incorrect ?? 0,
        }
      : null;

  return {
    level: summary.level ?? null,
    username: summary.username ?? null,
    availableLessons: summary.availableLessons,
    availableReviews: summary.availableReviews,
    reviewForecast24h,
    srs: {
      apprentice: summary.apprentice,
      guru: summary.guru,
      master: summary.master,
      enlightened: summary.enlightened,
      burned: summary.burned,
    },
    levelProgress,
    recentMistakes: recentMistakes.map((item) => ({
      subjectId: item.subjectId,
      japanese: item.japanese,
      primaryMeaning: item.japanese || `Subject ${item.subjectId}`,
    })),
    topLeeches: topLeeches.map((item) => ({
      subjectId: item.subjectId,
      japanese: item.japanese,
      primaryMeaning: item.japanese || `Subject ${item.subjectId}`,
      score: item.score,
    })),
    recentWindow,
    lastSyncedAt: summary.lastSyncedAt ?? null,
    attemptRevision,
    syncRevision: options?.syncRevision ?? 0,
  };
}

export function renderDeterministicSummary(facts: StudySummaryFacts): {
  overview: string;
  wins: string[];
  focus: string[];
  nextAction: string;
  metrics: Array<{ label: string; value: string }>;
} {
  const metrics = [
    { label: 'Reviews due', value: String(facts.availableReviews) },
    { label: 'Lessons available', value: String(facts.availableLessons) },
    { label: 'Next 24h reviews', value: String(facts.reviewForecast24h) },
    { label: 'Apprentice', value: String(facts.srs.apprentice) },
    { label: 'Guru', value: String(facts.srs.guru) },
  ];

  const wins: string[] = [];
  if (facts.srs.burned > 0) {
    wins.push(`${facts.srs.burned} burned items retained`);
  }
  if (facts.srs.enlightened > 0) {
    wins.push(`${facts.srs.enlightened} enlightened items`);
  }
  if (facts.recentWindow && facts.recentWindow.correct > 0) {
    wins.push(
      `${facts.recentWindow.correct} correct of ${facts.recentWindow.scoredAttempts} scored attempts in 7 days`,
    );
  }

  const focus: string[] = [];
  if (facts.availableReviews > 0) {
    focus.push(`${facts.availableReviews} reviews are available now`);
  }
  if (facts.topLeeches.length > 0) {
    focus.push(
      `Top leech: ${facts.topLeeches[0]!.japanese || facts.topLeeches[0]!.primaryMeaning}`,
    );
  }
  if (facts.recentMistakes.length > 0) {
    focus.push(
      `Recent mistake: ${facts.recentMistakes[0]!.japanese || facts.recentMistakes[0]!.primaryMeaning}`,
    );
  }

  let nextAction = 'Open reviews when ready — Study Coach stays optional.';
  if (facts.availableReviews > 0) {
    nextAction = `Start your ${facts.availableReviews} available review${facts.availableReviews === 1 ? '' : 's'}.`;
  } else if (facts.availableLessons > 0) {
    nextAction = `You have ${facts.availableLessons} lesson${facts.availableLessons === 1 ? '' : 's'} ready.`;
  } else if (facts.topLeeches.length > 0) {
    nextAction = 'Practice leeches from the Weak-Spot Clinic when you want a focused session.';
  }

  const overviewParts = [
    facts.level != null ? `You are on level ${facts.level}.` : 'Level data is not cached yet.',
    `${facts.availableReviews} review${facts.availableReviews === 1 ? '' : 's'} due and ${facts.availableLessons} lesson${facts.availableLessons === 1 ? '' : 's'} available.`,
    `${facts.reviewForecast24h} review${facts.reviewForecast24h === 1 ? '' : 's'} forecast in the next 24 hours.`,
  ];

  return {
    overview: overviewParts.join(' '),
    wins: wins.slice(0, 5),
    focus: focus.slice(0, 5),
    nextAction,
    metrics,
  };
}

export function studySummaryFactRefAllowlist(facts: StudySummaryFacts): Set<string> {
  const refs = new Set<string>([
    'facts.level',
    'facts.available_lessons',
    'facts.available_reviews',
    'facts.review_forecast_24h',
    'facts.srs.apprentice',
    'facts.srs.guru',
    'facts.srs.master',
    'facts.srs.enlightened',
    'facts.srs.burned',
    'facts.recent_mistakes_count',
    'facts.top_leeches_count',
  ]);
  if (facts.levelProgress) {
    refs.add('facts.level_progress.radicals');
    refs.add('facts.level_progress.kanji');
  }
  if (facts.recentWindow) {
    refs.add('facts.recent_window.days');
    refs.add('facts.recent_window.scored_attempts');
    refs.add('facts.recent_window.correct');
    refs.add('facts.recent_window.incorrect');
  }
  return refs;
}

export function hashStudySummaryFacts(facts: StudySummaryFacts): string {
  return hashPromptPayload(JSON.stringify(facts));
}
