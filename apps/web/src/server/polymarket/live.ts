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

type GammaTeam = {
  name?: string | null;
  logo?: string | null;
  ordering?: string | null;
};

type GammaSportsEvent = {
  live?: boolean | null;
  ended?: boolean | null;
  closed?: boolean | null;
  // "1-1" — the two numbers are in teams[] array order, which is NOT always
  // home-then-away (MLB events list [away, home]). Map via teams[].ordering.
  score?: string | null;
  elapsed?: string | null;
  period?: string | null;
  teams?: GammaTeam[] | null;
};

// Split "1-1" into the two raw numbers in teams[] array order (first, second).
const parseScorePair = (
  score: string | null | undefined
): { first: number | null; second: number | null } => {
  if (!score || !score.includes('-')) {
    return { first: null, second: null };
  }
  const [rawFirst, rawSecond] = score.split('-');
  const first = Number(rawFirst?.trim());
  const second = Number(rawSecond?.trim());
  return {
    first: Number.isFinite(first) ? first : null,
    second: Number.isFinite(second) ? second : null,
  };
};

// The score's first number belongs to teams[0]. Home/away is decided by the
// per-team `ordering` field (mirrors resolveEventTeams in sync.ts, which
// defaults home to teams[0] when no ordering match is present).
const mapScoreToHomeAway = (
  event: GammaSportsEvent
): { home: number | null; away: number | null; label: string | null } => {
  const { first, second } = parseScorePair(event.score);
  if (first === null && second === null) {
    return { home: null, away: null, label: null };
  }
  const teams = event.teams ?? [];
  const homeIdx = teams.findIndex((t) => t.ordering === 'home');
  const homeIsFirst = homeIdx <= 0; // -1 (unknown → default teams[0]) or 0
  const home = homeIsFirst ? first : second;
  const away = homeIsFirst ? second : first;
  return {
    home,
    away,
    label:
      home !== null && away !== null
        ? `${home}-${away}`
        : (event.score ?? null),
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

// Tennis period is a set code like "S4" → "Set 4".
const formatTennisPeriod = (period: string | null | undefined): string => {
  const value = (period ?? '').trim();
  const match = value.match(/^S(\d+)$/i);
  return match ? `Set ${match[1]}` : value || 'Live';
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
    columns: { eventSlug: true, category: true },
  });
  if (!row?.eventSlug) {
    return null;
  }

  // Tennis scores are set-by-set ("7-6(8-6), 6-1, …"), not "home-away", so we
  // display the raw string + the set as the clock and skip numeric scores.
  const isTennis = row.category === 'tennis-games';

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

  const score = mapScoreToHomeAway(event);
  const rawScoreLabel = (event.score ?? '').trim() || null;
  // For tennis, expose the raw set score only (no numeric home/away).
  const homeScore = isTennis ? null : score.home;
  const awayScore = isTennis ? null : score.away;
  const scoreLabel = isTennis ? rawScoreLabel : score.label;

  if (event.ended || event.closed) {
    return {
      statusLabel: 'Final',
      hasStarted: true,
      isFinal: true,
      eventTime: 'Final',
      homeScore,
      awayScore,
      scoreLabel,
    };
  }

  if (event.live) {
    const label = isTennis
      ? formatTennisPeriod(event.period)
      : formatElapsed(event.elapsed, event.period);
    return {
      statusLabel: label,
      hasStarted: true,
      isFinal: false,
      eventTime: label,
      homeScore,
      awayScore,
      scoreLabel,
    };
  }

  return null;
};
