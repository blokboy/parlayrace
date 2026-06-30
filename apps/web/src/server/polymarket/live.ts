import { db } from '@starter/backend/db';

// Polymarket Gamma exposes live game state at the event level (live/ended/score/
// elapsed/period). For the markets we track this is the authoritative source of
// truth for the clock + score, so we prefer it over api-football and only fall
// back when Polymarket has nothing live/final to report.

export type PmLiveStatus = {
  statusLabel: string;
  hasStarted: boolean;
  isFinal: boolean;
  eventTime: string | null;
  homeScore: number | null;
  awayScore: number | null;
  scoreLabel: string | null;
};

type GammaSportsEvent = {
  live?: boolean | null;
  ended?: boolean | null;
  closed?: boolean | null;
  // "1-1" — home-away in the event's teams[] order.
  score?: string | null;
  elapsed?: string | null;
  period?: string | null;
};

const parseScore = (
  score: string | null | undefined
): { home: number | null; away: number | null; label: string | null } => {
  if (!score || !score.includes('-')) {
    return { home: null, away: null, label: null };
  }
  const [rawHome, rawAway] = score.split('-');
  const home = Number(rawHome?.trim());
  const away = Number(rawAway?.trim());
  const homeScore = Number.isFinite(home) ? home : null;
  const awayScore = Number.isFinite(away) ? away : null;
  return {
    home: homeScore,
    away: awayScore,
    label:
      homeScore !== null && awayScore !== null
        ? `${homeScore}-${awayScore}`
        : score,
  };
};

// "67" → "67'"; a period label ("1H", "HT") is used verbatim; else "Live".
const formatElapsed = (
  elapsed: string | null | undefined,
  period: string | null | undefined
): string => {
  const trimmedElapsed = (elapsed ?? '').trim();
  if (trimmedElapsed) {
    return /^\d+$/.test(trimmedElapsed) ? `${trimmedElapsed}'` : trimmedElapsed;
  }
  const trimmedPeriod = (period ?? '').trim();
  return trimmedPeriod || 'Live';
};

// Live status from Polymarket for one event (marketId = persisted sourceEventId).
// Returns null when Polymarket has no started/finished state to report (so the
// caller can fall back to api-football / the time-based heuristic).
export const fetchPolymarketLiveStatus = async (
  sourceEventId: string
): Promise<PmLiveStatus | null> => {
  const row = await db.query.externalMarket.findFirst({
    where: (t, { and, eq }) =>
      and(
        eq(t.sourceProvider, 'POLYMARKET'),
        eq(t.sourceEventId, sourceEventId)
      ),
    columns: { eventSlug: true },
  });
  if (!row?.eventSlug) {
    return null;
  }

  let event: GammaSportsEvent | undefined;
  try {
    const res = await fetch(
      `https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(row.eventSlug)}`
    );
    if (res.ok) {
      const data = (await res.json()) as GammaSportsEvent | GammaSportsEvent[];
      event = Array.isArray(data) ? data[0] : data;
    }
  } catch {
    return null;
  }
  if (!event) {
    return null;
  }

  const score = parseScore(event.score);

  if (event.ended || event.closed) {
    return {
      statusLabel: 'Final',
      hasStarted: true,
      isFinal: true,
      eventTime: 'Final',
      homeScore: score.home,
      awayScore: score.away,
      scoreLabel: score.label,
    };
  }

  if (event.live) {
    const label = formatElapsed(event.elapsed, event.period);
    return {
      statusLabel: label,
      hasStarted: true,
      isFinal: false,
      eventTime: label,
      homeScore: score.home,
      awayScore: score.away,
      scoreLabel: score.label,
    };
  }

  return null;
};
