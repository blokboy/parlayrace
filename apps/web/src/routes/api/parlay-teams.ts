import { auth } from '@starter/backend/auth';
import { db } from '@starter/backend/db';
import { eq } from '@starter/backend/orm';
import {
  paperPortfolio,
  parlayTeam,
  parlayTeamLegCombo,
  parlayTeamMember,
  parlayTeamParlay,
  parlayTeamParlayClaim,
  parlayTeamParlayRollover,
  parlayTeamParlayShare,
  userProfile,
} from '@starter/backend/schema';
import { createFileRoute } from '@tanstack/react-router';
import { fetchEventCombos, getComboPrice } from '@/server/polymarket/combos';
import { fetchPolymarketLiveStatus } from '@/server/polymarket/live';
import { getLegSidePrice } from '@/server/polymarket/prices';

type PositionSide = 'home' | 'draw' | 'away';
type BuySide = 'YES' | 'NO';
type ParlayStatus = 'ACTIVE' | 'LOST' | 'WON';
// ROLLED_OVER = the leg owner cashed the leg out early into the next leg; the
// underlying result is then ignored so the parlay stays alive.
type LegResolution = 'PENDING' | 'WON' | 'LOST' | 'ROLLED_OVER';

type PaperPosition = {
  id: string;
  marketId: string;
  matchup: string;
  homeTeam: string;
  awayTeam: string;
  side: PositionSide;
  buySide: BuySide;
  stake: number;
  entryPrice: number;
  quantity: number;
  kickoff: string;
  status: 'OPEN' | 'CLOSED';
  createdAt: string;
  closedAt?: string | null;
  closeValue?: number | null;
  // Spread/total combo bets attached to this position (see portfolio.tsx).
  betType?: 'moneyline' | 'spread' | 'total';
  optionLabel?: string;
  line?: number;
  comboMarketId?: string;
  comboOutcomeLabel?: string;
  parentPositionId?: string;
};

type PaperPortfolioState = {
  cash: number;
  positions: PaperPosition[];
};

type TeamMember = {
  id: string;
  username: string;
};

type LegCombo = {
  id: string;
  addedByUserId: string;
  addedByUsername: string;
  optionLabel: string;
  betType: string;
  line: number | null;
  sourceEventId: string;
  comboMarketId: string;
  comboOutcomeLabel: string;
  shares: number;
  stake: number;
  entryPrice: number;
  result: LegResolution;
};

type TeamCommittedLeg = {
  id: string;
  parlayId: string;
  positionId: string;
  sequence: number;
  addedByUserId: string;
  addedByUsername: string;
  shares: number;
  stake: number;
  entryPrice: number;
  marketId: string | null;
  cardTitle: string;
  optionLabel: string;
  side: string;
  kickoff: string;
  homeTeam: string;
  awayTeam: string;
  category: string | null;
  positionSide: PositionSide;
  buySide: BuySide;
  placedAt: string;
  result: LegResolution;
  combos: LegCombo[];
  // Compounding detail: principal vs winnings rolled in from earlier legs.
  principalShares: number;
  rolledInShares: number;
  effectiveShares: number;
  // True when this leg's value has rolled forward into a later leg (manual or
  // auto). Such legs are terminal=false for potential-payout purposes.
  rolledForward: boolean;
  resolvedAt: string | null;
};

type ParlayTeamResponse = {
  id: string;
  name: string;
  captainUserId: string;
  members: TeamMember[];
  committedLegs: TeamCommittedLeg[];
  claimedAt: string | null;
  createdAt: string;
  updatedAt: string;
  status: ParlayStatus;
  claimableAmount: number;
  settledAmount: number;
  canClaim: boolean;
  hasClaimed: boolean;
  claimAmount: number;
};

type LiveStatusPayload = {
  statusLabel: string;
  hasStarted: boolean;
  isFinal: boolean;
  eventTime: string | null;
  homeScore: number | null;
  awayScore: number | null;
  scoreLabel: string | null;
};

type ApiFootballFixture = {
  fixture?: {
    status?: {
      short?: string;
      long?: string;
      elapsed?: number | null;
    };
  };
  teams?: {
    home?: { name?: string };
    away?: { name?: string };
  };
  goals?: {
    home?: number | string | null;
    away?: number | string | null;
  };
  score?: {
    halftime?: {
      home?: number | string | null;
      away?: number | string | null;
    };
    fulltime?: {
      home?: number | string | null;
      away?: number | string | null;
    };
  };
};

type MatchedFixture = {
  fixture: ApiFootballFixture;
  swapped: boolean;
};

const MAX_ADDITIONAL_MEMBERS = 9;
const BLOKBOY_USERNAME = 'blokboy';

const roundToCents = (value: number) => Math.round(value * 100) / 100;

const kickoffKey = (value: string): string | null => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 16);
};

const optionLabelForPosition = (position: PaperPosition): string => {
  if (position.side === 'home') {
    return position.homeTeam;
  }

  if (position.side === 'away') {
    return position.awayTeam;
  }

  return 'Draw';
};

const initialPortfolioState = (): PaperPortfolioState => ({
  cash: 1000,
  positions: [],
});

const normalizePortfolioState = (
  value: Partial<PaperPortfolioState> | null | undefined
): PaperPortfolioState => {
  const fallback = initialPortfolioState();

  if (!value) {
    return fallback;
  }

  return {
    cash: Number.isFinite(value.cash) ? Number(value.cash) : fallback.cash,
    positions: Array.isArray(value.positions)
      ? (value.positions as PaperPosition[])
      : fallback.positions,
  };
};

const getSessionUser = async (request: Request) => {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ?? null;
};

const normalizeName = (value: string): string => {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(fc|cf|sc|afc|club|de|cd)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const isSameTeam = (left: string, right: string): boolean => {
  const a = normalizeName(left);
  const b = normalizeName(right);

  if (!a || !b) {
    return false;
  }

  return a === b || a.includes(b) || b.includes(a);
};

const toNullableScore = (value: number | string | null | undefined) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const getFallbackStatus = (kickoffIso: string): LiveStatusPayload => {
  const kickoff = new Date(kickoffIso);
  if (Number.isNaN(kickoff.getTime())) {
    return {
      statusLabel: 'OPEN',
      hasStarted: false,
      isFinal: false,
      eventTime: null,
      homeScore: null,
      awayScore: null,
      scoreLabel: null,
    };
  }

  const now = new Date();
  const diffMinutes = Math.floor((now.getTime() - kickoff.getTime()) / 60000);

  if (diffMinutes < -120) {
    return {
      statusLabel: 'OPEN',
      hasStarted: false,
      isFinal: false,
      eventTime: null,
      homeScore: null,
      awayScore: null,
      scoreLabel: null,
    };
  }

  if (diffMinutes < 0) {
    return {
      statusLabel: `Starts in ${Math.abs(diffMinutes)}m`,
      hasStarted: false,
      isFinal: false,
      eventTime: null,
      homeScore: null,
      awayScore: null,
      scoreLabel: null,
    };
  }

  if (diffMinutes <= 120) {
    return {
      statusLabel: `${diffMinutes}'`,
      hasStarted: true,
      isFinal: false,
      eventTime: `${diffMinutes}'`,
      homeScore: null,
      awayScore: null,
      scoreLabel: null,
    };
  }

  return {
    statusLabel: 'Final',
    hasStarted: true,
    isFinal: true,
    eventTime: 'Final',
    homeScore: null,
    awayScore: null,
    scoreLabel: null,
  };
};

// A match kicked off this long ago is over regardless of what the feed says —
// guards against api-football echoing a stale "live"/extra-time elapsed.
const DEFINITELY_FINAL_MINUTES = 210;

const coerceStaleLiveToFinal = (
  status: LiveStatusPayload,
  kickoffIso: string
): LiveStatusPayload => {
  if (status.isFinal) {
    return status;
  }
  const kickoff = new Date(kickoffIso);
  if (Number.isNaN(kickoff.getTime())) {
    return status;
  }
  if ((Date.now() - kickoff.getTime()) / 60000 <= DEFINITELY_FINAL_MINUTES) {
    return status;
  }
  return {
    ...status,
    statusLabel: 'Final',
    hasStarted: true,
    isFinal: true,
    eventTime: 'Final',
  };
};

const toStatusPayload = (
  fixture: ApiFootballFixture,
  swapped = false
): LiveStatusPayload => {
  const short = fixture.fixture?.status?.short ?? '';
  const longStatus = fixture.fixture?.status?.long ?? '';
  const elapsed = fixture.fixture?.status?.elapsed;
  const homeScore =
    toNullableScore(fixture.goals?.home) ??
    toNullableScore(fixture.score?.fulltime?.home) ??
    toNullableScore(fixture.score?.halftime?.home);
  const awayScore =
    toNullableScore(fixture.goals?.away) ??
    toNullableScore(fixture.score?.fulltime?.away) ??
    toNullableScore(fixture.score?.halftime?.away);
  const mappedHomeScore = swapped ? awayScore : homeScore;
  const mappedAwayScore = swapped ? homeScore : awayScore;
  const scoreLabel =
    mappedHomeScore !== null && mappedAwayScore !== null
      ? `${mappedHomeScore}-${mappedAwayScore}`
      : null;
  const isFinal = ['FT', 'AET', 'PEN'].includes(short);
  const isLive = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'].includes(short);
  const hasStarted = isLive || isFinal || ['INT', 'SUSP'].includes(short);
  const eventTime = isFinal
    ? 'Final'
    : typeof elapsed === 'number'
      ? `${elapsed}'`
      : longStatus || null;

  return {
    statusLabel: isFinal
      ? 'Final'
      : eventTime || (hasStarted ? 'Live' : 'OPEN'),
    hasStarted,
    isFinal,
    eventTime,
    homeScore: mappedHomeScore,
    awayScore: mappedAwayScore,
    scoreLabel,
  };
};

const findMatchingFixture = (
  event: { homeTeam: string; awayTeam: string },
  fixtures: ApiFootballFixture[]
): MatchedFixture | null => {
  const direct = fixtures.find((fixture) => {
    const home = fixture.teams?.home?.name ?? '';
    const away = fixture.teams?.away?.name ?? '';
    return isSameTeam(home, event.homeTeam) && isSameTeam(away, event.awayTeam);
  });

  if (direct) {
    return { fixture: direct, swapped: false };
  }

  const swapped = fixtures.find((fixture) => {
    const home = fixture.teams?.home?.name ?? '';
    const away = fixture.teams?.away?.name ?? '';
    return isSameTeam(home, event.awayTeam) && isSameTeam(away, event.homeTeam);
  });

  return swapped ? { fixture: swapped, swapped: true } : null;
};

const fetchLiveStatuses = async (
  events: Array<{
    marketId: string;
    // The persisted sourceEventId for Polymarket live lookups (the `marketId`
    // key above is the leg/share id used for keying the result).
    eventId?: string | null;
    kickoff: string;
    homeTeam: string;
    awayTeam: string;
  }>
): Promise<Record<string, LiveStatusPayload>> => {
  const fallbackStatuses = events.reduce<Record<string, LiveStatusPayload>>(
    (acc, event) => {
      acc[event.marketId] = getFallbackStatus(event.kickoff);
      return acc;
    },
    {}
  );

  // Polymarket is the source of truth for the clock + score; query it for
  // already-started events and prefer its result over api-football.
  const now = Date.now();
  const pmEntries = await Promise.all(
    events.map(async (event) => {
      const kickoffMs = new Date(event.kickoff).getTime();
      const started = Number.isFinite(kickoffMs) && kickoffMs <= now;
      const pm =
        started && event.eventId
          ? await fetchPolymarketLiveStatus(event.eventId)
          : null;
      return [event.marketId, pm] as const;
    })
  );
  const pmByMarket = new Map(pmEntries);

  const apiKey = process.env.API_FOOTBALL_API_KEY?.trim();
  if (!apiKey || events.length === 0) {
    return events.reduce<Record<string, LiveStatusPayload>>((acc, event) => {
      acc[event.marketId] =
        pmByMarket.get(event.marketId) ??
        coerceStaleLiveToFinal(fallbackStatuses[event.marketId], event.kickoff);
      return acc;
    }, {});
  }

  try {
    const uniqueDates = Array.from(
      new Set(
        events.flatMap((event) => {
          const kickoff = new Date(event.kickoff);
          if (Number.isNaN(kickoff.getTime())) {
            return [] as string[];
          }

          const base = new Date(
            Date.UTC(
              kickoff.getUTCFullYear(),
              kickoff.getUTCMonth(),
              kickoff.getUTCDate()
            )
          );
          const prev = new Date(base);
          prev.setUTCDate(prev.getUTCDate() - 1);
          const next = new Date(base);
          next.setUTCDate(next.getUTCDate() + 1);

          return [
            prev.toISOString().slice(0, 10),
            base.toISOString().slice(0, 10),
            next.toISOString().slice(0, 10),
          ];
        })
      )
    );

    const liveResponse = await fetch(
      'https://v3.football.api-sports.io/fixtures?live=all',
      {
        method: 'GET',
        headers: {
          'x-apisports-key': apiKey,
          Accept: 'application/json',
        },
      }
    );

    const liveFixtures = liveResponse.ok
      ? (((await liveResponse.json()) as { response?: ApiFootballFixture[] })
          .response ?? [])
      : [];

    const datedFixtures = await Promise.all(
      uniqueDates.map(async (date) => {
        const response = await fetch(
          `https://v3.football.api-sports.io/fixtures?date=${date}`,
          {
            method: 'GET',
            headers: {
              'x-apisports-key': apiKey,
              Accept: 'application/json',
            },
          }
        );

        if (!response.ok) {
          return [] as ApiFootballFixture[];
        }

        const payload = (await response.json()) as {
          response?: ApiFootballFixture[];
        };
        return payload.response ?? [];
      })
    );

    const fixtures = [...liveFixtures, ...datedFixtures.flat()];

    return events.reduce<Record<string, LiveStatusPayload>>((acc, event) => {
      const pm = pmByMarket.get(event.marketId);
      if (pm) {
        acc[event.marketId] = pm;
        return acc;
      }
      const matched = findMatchingFixture(event, fixtures);
      acc[event.marketId] = coerceStaleLiveToFinal(
        matched
          ? toStatusPayload(matched.fixture, matched.swapped)
          : fallbackStatuses[event.marketId],
        event.kickoff
      );
      return acc;
    }, {});
  } catch {
    return fallbackStatuses;
  }
};

const creditUserCash = async (userId: string, amount: number) => {
  const roundedAmount = roundToCents(amount);
  if (roundedAmount <= 0) {
    return;
  }

  const row = await db.query.paperPortfolio.findFirst({
    where: (table, { eq: equals }) => equals(table.userId, userId),
    columns: {
      cashBalance: true,
      positions: true,
    },
  });

  const current = normalizePortfolioState({
    cash: row?.cashBalance,
    positions: Array.isArray(row?.positions)
      ? (row.positions as PaperPosition[])
      : [],
  });
  const nextCash = roundToCents(current.cash + roundedAmount);

  await db
    .insert(paperPortfolio)
    .values({
      userId,
      cashBalance: nextCash,
      positions: current.positions,
    })
    .onConflictDoUpdate({
      target: paperPortfolio.userId,
      set: {
        cashBalance: nextCash,
        positions: current.positions,
        updatedAt: new Date(),
      },
    });
};

// Remove `amount` from a user's cash. Returns false (no change) when they can't
// cover it, so callers can reject the buy.
const debitUserCash = async (
  userId: string,
  amount: number
): Promise<boolean> => {
  const roundedAmount = roundToCents(amount);
  if (roundedAmount <= 0) {
    return false;
  }

  const row = await db.query.paperPortfolio.findFirst({
    where: (table, { eq: equals }) => equals(table.userId, userId),
    columns: { cashBalance: true, positions: true },
  });

  const current = normalizePortfolioState({
    cash: row?.cashBalance,
    positions: Array.isArray(row?.positions)
      ? (row.positions as PaperPosition[])
      : [],
  });

  if (current.cash < roundedAmount) {
    return false;
  }

  const nextCash = roundToCents(current.cash - roundedAmount);

  await db
    .insert(paperPortfolio)
    .values({
      userId,
      cashBalance: nextCash,
      positions: current.positions,
    })
    .onConflictDoUpdate({
      target: paperPortfolio.userId,
      set: {
        cashBalance: nextCash,
        positions: current.positions,
        updatedAt: new Date(),
      },
    });

  return true;
};

const getWinner = (status: LiveStatusPayload): PositionSide | null => {
  if (status.homeScore === null || status.awayScore === null) {
    return null;
  }

  if (status.homeScore > status.awayScore) {
    return 'home';
  }

  if (status.awayScore > status.homeScore) {
    return 'away';
  }

  return 'draw';
};

const resolveLegResult = (
  position: PaperPosition | null,
  status: LiveStatusPayload | undefined
): LegResolution => {
  if (!position || !status?.isFinal) {
    return 'PENDING';
  }

  const winner = getWinner(status);
  if (!winner) {
    return 'PENDING';
  }

  const pickedOutcomeWon = winner === position.side;
  const legWon =
    position.buySide === 'YES' ? pickedOutcomeWon : !pickedOutcomeWon;
  return legWon ? 'WON' : 'LOST';
};

type RolloverEntry = { targetShareId: string; sharesAdded: number };

// A leg's total shares = its members' principal + every rollover that has been
// purchased into it from earlier-resolved winning legs.
const effectiveShares = (
  shareId: string,
  principal: number,
  rollovers: RolloverEntry[]
): number =>
  roundToCents(
    principal +
      rollovers
        .filter((rollover) => rollover.targetShareId === shareId)
        .reduce((sum, rollover) => sum + rollover.sharesAdded, 0)
  );

const getSelectedParlay = <
  T extends { teamId: string; status: string; createdAt: Date; id: string },
>(
  teamId: string,
  parlays: T[]
) => {
  const teamParlays = parlays
    .filter((parlay) => parlay.teamId === teamId)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

  return (
    teamParlays.find((parlay) => parlay.status === 'ACTIVE') ??
    teamParlays[0] ??
    null
  );
};

const legPriceForPosition = async (
  marketId: string | null,
  position: PaperPosition | null
): Promise<number | null> => {
  if (!marketId || !position) {
    return null;
  }

  return getLegSidePrice({
    marketId,
    side: position.side,
    buySide: position.buySide,
    homeTeam: position.homeTeam,
    awayTeam: position.awayTeam,
  });
};

const syncParlayStates = async (teamIds: string[]) => {
  if (teamIds.length === 0) {
    return;
  }

  const [
    parlays,
    shares,
    memberships,
    blokboyProfile,
    rolloverRows,
    legCombos,
  ] = await Promise.all([
    db.query.parlayTeamParlay.findMany({
      where: (table, { inArray }) => inArray(table.teamId, teamIds),
    }),
    db.query.parlayTeamParlayShare.findMany({
      where: (table, { inArray }) => inArray(table.teamId, teamIds),
    }),
    db.query.parlayTeamMember.findMany({
      where: (table, { inArray }) => inArray(table.teamId, teamIds),
      columns: {
        userId: true,
      },
    }),
    db.query.userProfile.findFirst({
      where: (table, { eq: equals }) =>
        equals(table.username, BLOKBOY_USERNAME),
      columns: {
        id: true,
      },
    }),
    db.query.parlayTeamParlayRollover.findMany({
      where: (table, { inArray }) => inArray(table.teamId, teamIds),
    }),
    db.query.parlayTeamLegCombo.findMany({
      where: (table, { inArray }) => inArray(table.teamId, teamIds),
    }),
  ]);

  const activeParlays = parlays.filter((parlay) => parlay.status === 'ACTIVE');
  if (activeParlays.length === 0) {
    return;
  }

  // Price every still-pending combo once (one Gamma fetch per event) so leg
  // values below can fold in their combos cheaply. Post-game the price is the
  // settled ~1/0, so this doubles as combo settlement.
  const comboPriceById = new Map<string, number>();
  const pendingCombos = legCombos.filter(
    (combo) =>
      combo.result !== 'WON' &&
      combo.result !== 'LOST' &&
      combo.result !== 'ROLLED_OVER'
  );
  for (const eventId of new Set(pendingCombos.map((c) => c.sourceEventId))) {
    const options = await fetchEventCombos(eventId);
    const priceByKey = new Map(
      [...options.spreads, ...options.totals].map((option) => [
        `${option.sourceMarketId}:${option.outcomeLabel}`,
        option.price,
      ])
    );
    for (const combo of pendingCombos.filter(
      (c) => c.sourceEventId === eventId
    )) {
      const price = priceByKey.get(
        `${combo.comboMarketId}:${combo.comboOutcomeLabel}`
      );
      if (typeof price === 'number') {
        comboPriceById.set(combo.id, price);
      }
    }
  }

  // Dollar value of a leg's pending combos at current/settled prices.
  const legComboValue = (legShareId: string): number =>
    roundToCents(
      legCombos
        .filter(
          (combo) =>
            combo.legShareId === legShareId &&
            combo.result !== 'WON' &&
            combo.result !== 'LOST' &&
            combo.result !== 'ROLLED_OVER'
        )
        .reduce(
          (sum, combo) =>
            sum + combo.shares * (comboPriceById.get(combo.id) ?? 0),
          0
        )
    );

  // Stamp a leg's pending combos with a terminal result + settle price.
  const settleLegCombos = async (legShareId: string, result: LegResolution) => {
    const targets = legCombos.filter(
      (combo) =>
        combo.legShareId === legShareId &&
        combo.result !== 'WON' &&
        combo.result !== 'LOST' &&
        combo.result !== 'ROLLED_OVER'
    );
    for (const combo of targets) {
      combo.result = result;
      await db
        .update(parlayTeamLegCombo)
        .set({
          result,
          resolvedAt: new Date(),
          resolvedPrice: comboPriceById.get(combo.id) ?? null,
        })
        .where(eq(parlayTeamLegCombo.id, combo.id));
    }
  };

  const userIds = Array.from(
    new Set(memberships.map((membership) => membership.userId))
  );
  const portfolioRows =
    userIds.length > 0
      ? await db.query.paperPortfolio.findMany({
          where: (table, { inArray }) => inArray(table.userId, userIds),
          columns: {
            positions: true,
          },
        })
      : [];

  const positionById = new Map<string, PaperPosition>();
  for (const row of portfolioRows) {
    const positions = Array.isArray(row.positions)
      ? (row.positions as PaperPosition[])
      : [];

    for (const position of positions) {
      if (!positionById.has(position.id)) {
        positionById.set(position.id, position);
      }
    }
  }

  const statuses = await fetchLiveStatuses(
    shares
      .map((share) => {
        const position = positionById.get(share.positionId);
        if (!position) {
          return null;
        }

        return {
          marketId: share.id,
          eventId: share.marketId,
          kickoff: position.kickoff,
          homeTeam: position.homeTeam,
          awayTeam: position.awayTeam,
        };
      })
      .filter(
        (
          entry
        ): entry is {
          marketId: string;
          eventId: string | null;
          kickoff: string;
          homeTeam: string;
          awayTeam: string;
        } => Boolean(entry)
      )
  );

  for (const parlay of activeParlays) {
    const parlayShares = shares
      .filter((share) => share.parlayId === parlay.id)
      .sort((a, b) => a.sequence - b.sequence);

    if (parlayShares.length === 0) {
      continue;
    }

    // Per-leg working state. Prefer a persisted result; otherwise resolve from
    // the live status. resolvedAt drives the rollover chronology.
    const legState = await Promise.all(
      parlayShares.map(async (share) => {
        const position = positionById.get(share.positionId) ?? null;
        const persisted =
          share.result === 'WON' ||
          share.result === 'LOST' ||
          share.result === 'ROLLED_OVER'
            ? (share.result as LegResolution)
            : null;

        let result =
          persisted ?? resolveLegResult(position, statuses[share.id]);

        // When the game is final but live scores can't name a winner (e.g.
        // api-football couldn't match the fixture), fall back to Polymarket's
        // resolved price: a settled market pays the bought side ~1.0 (won) or
        // ~0.0 (lost). Gated on isFinal so a transient mid-match price can't
        // settle a leg early.
        let sidePrice: number | null = null;
        if (
          !persisted &&
          result === 'PENDING' &&
          position &&
          statuses[share.id]?.isFinal
        ) {
          sidePrice = await legPriceForPosition(share.marketId, position);
          if (sidePrice !== null) {
            if (sidePrice >= 0.99) {
              result = 'WON';
            } else if (sidePrice <= 0.01) {
              result = 'LOST';
            }
          }
        }

        return {
          share,
          position,
          result,
          persisted: persisted !== null,
          resolvedAt: share.resolvedAt ? new Date(share.resolvedAt) : null,
          sidePrice,
        };
      })
    );

    const now = new Date();

    // 1) Stamp newly-resolved legs with result + resolvedAt + a settle-price
    // snapshot, so the chronology is fixed and we don't re-resolve later.
    for (const leg of legState) {
      if (leg.persisted || leg.result === 'PENDING') {
        continue;
      }

      const settlePrice =
        leg.sidePrice ??
        (await legPriceForPosition(leg.share.marketId, leg.position));

      leg.resolvedAt = now;
      await db
        .update(parlayTeamParlayShare)
        .set({
          result: leg.result,
          resolvedAt: now,
          resolvedPrice: settlePrice,
        })
        .where(eq(parlayTeamParlayShare.id, leg.share.id));
    }

    // Working copy of this parlay's rollovers; appended to as we create more.
    const parlayRollovers: Array<{
      sourceShareId: string;
      targetShareId: string;
      sharesAdded: number;
    }> = rolloverRows
      .filter((rollover) => rollover.parlayId === parlay.id)
      .map((rollover) => ({
        sourceShareId: rollover.sourceShareId,
        targetShareId: rollover.targetShareId,
        sharesAdded: rollover.sharesAdded,
      }));

    // 2) Roll each winning leg's full value into the earliest leg that hadn't
    // started yet at its resolution moment, buying at that leg's live price.
    // Processed in resolution order so a leg's incoming rollovers exist first.
    const wonLegs = legState
      .filter((leg) => leg.result === 'WON')
      .sort(
        (a, b) =>
          (a.resolvedAt?.getTime() ?? 0) - (b.resolvedAt?.getTime() ?? 0)
      );

    for (const leg of wonLegs) {
      const alreadyRolled = parlayRollovers.some(
        (rollover) => rollover.sourceShareId === leg.share.id
      );
      if (alreadyRolled) {
        continue;
      }

      // The leg's full value = its ML effective shares (won → $1/share) plus the
      // current value of any combos bought on it; both roll into the next leg.
      const value = roundToCents(
        effectiveShares(leg.share.id, leg.share.shares, parlayRollovers) +
          legComboValue(leg.share.id)
      );
      if (value <= 0) {
        continue;
      }

      const resolvedAtMs = (leg.resolvedAt ?? now).getTime();
      const target = legState
        .filter((candidate) => {
          if (candidate.share.id === leg.share.id) return false;
          if (candidate.result === 'LOST') return false;
          const kickoffMs = candidate.position
            ? new Date(candidate.position.kickoff).getTime()
            : Number.NaN;
          return Number.isFinite(kickoffMs) && kickoffMs > resolvedAtMs;
        })
        .sort((a, b) => a.share.sequence - b.share.sequence)[0];

      // No un-started successor → this leg's value is terminal (final claimable).
      if (!target) {
        continue;
      }

      const targetPrice = await legPriceForPosition(
        target.share.marketId,
        target.position
      );
      if (!targetPrice || targetPrice <= 0) {
        // Can't price the target yet; retry on the next sync.
        continue;
      }

      const sharesAdded = roundToCents(value / targetPrice);
      await db.insert(parlayTeamParlayRollover).values({
        parlayId: parlay.id,
        teamId: parlay.teamId,
        sourceShareId: leg.share.id,
        targetShareId: target.share.id,
        amount: roundToCents(value),
        targetPrice,
        sharesAdded,
      });
      parlayRollovers.push({
        sourceShareId: leg.share.id,
        targetShareId: target.share.id,
        sharesAdded,
      });
      // The leg's combos rolled forward with it; mark them so they aren't
      // double-counted in claimable/settlement.
      await settleLegCombos(leg.share.id, 'ROLLED_OVER');
    }

    // 3) Any loss busts the parlay. Everything downstream of the earliest-start
    // loser (by start order) is sold at current value and sent to blokboy.
    const lostLegs = legState
      .filter((leg) => leg.result === 'LOST')
      .sort((a, b) => a.share.sequence - b.share.sequence);

    if (lostLegs.length > 0) {
      const lossSequence = lostLegs[0].share.sequence;

      let settledAmount = 0;
      for (const leg of legState) {
        if (leg.share.sequence <= lossSequence) {
          continue;
        }

        // Skip legs whose value already rolled forward into a later leg — it is
        // captured in that target's effective shares (avoids double counting).
        const rolledForward = parlayRollovers.some(
          (rollover) => rollover.sourceShareId === leg.share.id
        );
        if (rolledForward) {
          continue;
        }

        const legShares = effectiveShares(
          leg.share.id,
          leg.share.shares,
          parlayRollovers
        );
        if (legShares <= 0) {
          continue;
        }

        // Won downstream legs are worth their full $1/share; otherwise sell at
        // the current market price. Downstream combos are sold at their value too.
        const sellPrice =
          leg.result === 'WON'
            ? 1
            : ((await legPriceForPosition(leg.share.marketId, leg.position)) ??
              0);
        settledAmount += legShares * sellPrice + legComboValue(leg.share.id);
      }

      settledAmount = roundToCents(settledAmount);
      if (settledAmount > 0 && blokboyProfile?.id) {
        await creditUserCash(blokboyProfile.id, settledAmount);
      }

      // Combos are lost with the busted parlay: downstream value went to blokboy
      // above; everything else is forfeit. Mark them all resolved.
      for (const leg of legState) {
        await settleLegCombos(leg.share.id, 'LOST');
      }

      await db
        .insert(parlayTeamParlay)
        .values({
          id: parlay.id,
          teamId: parlay.teamId,
          startedByUserId: parlay.startedByUserId,
          status: 'LOST',
          claimableAmount: 0,
          settledAmount,
          settledAt: new Date(),
          transferredToUserId: blokboyProfile?.id ?? null,
          lossSequence,
        })
        .onConflictDoUpdate({
          target: parlayTeamParlay.id,
          set: {
            status: 'LOST',
            claimableAmount: 0,
            settledAmount,
            settledAt: new Date(),
            transferredToUserId: blokboyProfile?.id ?? null,
            lossSequence,
            updatedAt: new Date(),
          },
        });

      continue;
    }

    // 4) Every leg settled without a loss (won or manually rolled over) →
    // claimable is the sum of every terminal leg's value (legs whose value
    // didn't roll forward into another leg).
    const allSettled = legState.every(
      (leg) => leg.result === 'WON' || leg.result === 'ROLLED_OVER'
    );
    if (allSettled) {
      let claimableAmount = 0;
      for (const leg of legState) {
        const rolledForward = parlayRollovers.some(
          (rollover) => rollover.sourceShareId === leg.share.id
        );
        if (rolledForward) {
          continue;
        }
        // Terminal leg → its ML value plus its combos' settled value is
        // claimable; mark those combos WON so they settle with the leg.
        claimableAmount +=
          effectiveShares(leg.share.id, leg.share.shares, parlayRollovers) +
          legComboValue(leg.share.id);
        await settleLegCombos(leg.share.id, 'WON');
      }
      claimableAmount = roundToCents(claimableAmount);

      await db
        .insert(parlayTeamParlay)
        .values({
          id: parlay.id,
          teamId: parlay.teamId,
          startedByUserId: parlay.startedByUserId,
          status: 'WON',
          claimableAmount,
          settledAmount: claimableAmount,
          settledAt: new Date(),
        })
        .onConflictDoUpdate({
          target: parlayTeamParlay.id,
          set: {
            status: 'WON',
            claimableAmount,
            settledAmount: claimableAmount,
            settledAt: new Date(),
            updatedAt: new Date(),
          },
        });
    }
  }
};

const buildTeamResponses = async (
  teamIds: string[],
  currentUserId: string
): Promise<ParlayTeamResponse[]> => {
  if (teamIds.length === 0) {
    return [];
  }

  try {
    await syncParlayStates(teamIds);
  } catch {
    // ignore live sync failures and still return team payloads
  }

  const [teams, members, parlays, shares, claims, rollovers, legCombos] =
    await Promise.all([
      db.query.parlayTeam.findMany({
        where: (table, { inArray }) => inArray(table.id, teamIds),
      }),
      db.query.parlayTeamMember.findMany({
        where: (table, { inArray }) => inArray(table.teamId, teamIds),
      }),
      db.query.parlayTeamParlay.findMany({
        where: (table, { inArray }) => inArray(table.teamId, teamIds),
      }),
      db.query.parlayTeamParlayShare.findMany({
        where: (table, { inArray }) => inArray(table.teamId, teamIds),
      }),
      db.query.parlayTeamParlayClaim.findMany({
        where: (table, { inArray }) => inArray(table.teamId, teamIds),
      }),
      db.query.parlayTeamParlayRollover.findMany({
        where: (table, { inArray }) => inArray(table.teamId, teamIds),
      }),
      db.query.parlayTeamLegCombo.findMany({
        where: (table, { inArray }) => inArray(table.teamId, teamIds),
      }),
    ]);

  // Category per leg's game (to gate the Spreads/Totals badges to MLB legs).
  const legEventIds = Array.from(
    new Set(
      shares
        .map((share) => share.marketId)
        .filter((id): id is string => Boolean(id))
    )
  );
  const eventCategoryRows =
    legEventIds.length > 0
      ? await db.query.externalMarket.findMany({
          where: (table, { and, eq: equals, inArray }) =>
            and(
              equals(table.sourceProvider, 'POLYMARKET'),
              inArray(table.sourceEventId, legEventIds)
            ),
          columns: { sourceEventId: true, category: true },
        })
      : [];
  const categoryByEventId = new Map(
    eventCategoryRows.map((row) => [row.sourceEventId, row.category ?? null])
  );

  const userIds = Array.from(
    new Set([
      ...members.map((member) => member.userId),
      ...shares.map((share) => share.addedByUserId),
      ...teams.map((team) => team.createdByUserId),
      ...claims.map((claim) => claim.userId),
      ...legCombos.map((combo) => combo.addedByUserId),
    ])
  );

  const profiles =
    userIds.length > 0
      ? await db.query.userProfile.findMany({
          where: (table, { inArray }) => inArray(table.id, userIds),
          columns: {
            id: true,
            username: true,
          },
        })
      : [];

  const usernameById = new Map(
    profiles.map((profile) => [profile.id, profile.username ?? profile.id])
  );

  const portfolioRows =
    userIds.length > 0
      ? await db.query.paperPortfolio.findMany({
          where: (table, { inArray }) => inArray(table.userId, userIds),
          columns: {
            positions: true,
          },
        })
      : [];

  const positionById = new Map<string, PaperPosition>();
  for (const row of portfolioRows) {
    const positions = Array.isArray(row.positions)
      ? (row.positions as PaperPosition[])
      : [];

    for (const position of positions) {
      if (!positionById.has(position.id)) {
        positionById.set(position.id, position);
      }
    }
  }

  const statuses = await fetchLiveStatuses(
    shares
      .map((share) => {
        const position = positionById.get(share.positionId);
        if (!position) {
          return null;
        }

        return {
          marketId: share.id,
          eventId: share.marketId,
          kickoff: position.kickoff,
          homeTeam: position.homeTeam,
          awayTeam: position.awayTeam,
        };
      })
      .filter(
        (
          entry
        ): entry is {
          marketId: string;
          eventId: string | null;
          kickoff: string;
          homeTeam: string;
          awayTeam: string;
        } => Boolean(entry)
      )
  );

  return teams
    .map<ParlayTeamResponse>((team) => {
      const selectedParlay = getSelectedParlay(team.id, parlays);
      const selectedParlayId = selectedParlay?.id ?? null;

      const teamMembers = members
        .filter((member) => member.teamId === team.id)
        .map<TeamMember>((member) => ({
          id: member.userId,
          username:
            usernameById.get(member.userId) ??
            usernameById.get(team.createdByUserId) ??
            member.userId,
        }));

      const dedupedMembers = Array.from(
        new Map(teamMembers.map((member) => [member.id, member])).values()
      );

      const teamShares = shares
        .filter((share) => share.parlayId === selectedParlayId)
        .sort((a, b) => a.sequence - b.sequence)
        .map<TeamCommittedLeg>((share) => {
          const position = positionById.get(share.positionId) ?? null;
          const rolledInShares = roundToCents(
            rollovers
              .filter((rollover) => rollover.targetShareId === share.id)
              .reduce((sum, rollover) => sum + rollover.sharesAdded, 0)
          );
          const rolledForward = rollovers.some(
            (rollover) => rollover.sourceShareId === share.id
          );

          return {
            id: share.id,
            parlayId: share.parlayId,
            positionId: share.positionId,
            sequence: share.sequence,
            addedByUserId: share.addedByUserId,
            addedByUsername:
              usernameById.get(share.addedByUserId) ?? share.addedByUserId,
            shares: share.shares,
            stake: share.stake,
            entryPrice: share.entryPrice,
            marketId: share.marketId ?? null,
            cardTitle: share.cardTitle,
            optionLabel: share.optionLabel,
            side: share.side,
            kickoff: position?.kickoff ?? share.placedAt.toISOString(),
            homeTeam: position?.homeTeam ?? '',
            awayTeam: position?.awayTeam ?? '',
            positionSide: position?.side ?? 'draw',
            buySide: position?.buySide ?? (share.side === 'NO' ? 'NO' : 'YES'),
            category: share.marketId
              ? (categoryByEventId.get(share.marketId) ?? null)
              : null,
            placedAt: share.placedAt.toISOString(),
            result:
              share.result === 'WON' ||
              share.result === 'LOST' ||
              share.result === 'ROLLED_OVER'
                ? (share.result as LegResolution)
                : resolveLegResult(position, statuses[share.id]),
            combos: legCombos
              .filter((combo) => combo.legShareId === share.id)
              .map<LegCombo>((combo) => ({
                id: combo.id,
                addedByUserId: combo.addedByUserId,
                addedByUsername:
                  usernameById.get(combo.addedByUserId) ?? combo.addedByUserId,
                optionLabel: combo.optionLabel,
                betType: combo.betType,
                line: combo.line ?? null,
                sourceEventId: combo.sourceEventId,
                comboMarketId: combo.comboMarketId,
                comboOutcomeLabel: combo.comboOutcomeLabel,
                shares: combo.shares,
                stake: combo.stake,
                entryPrice: combo.entryPrice,
                result:
                  combo.result === 'WON' ||
                  combo.result === 'LOST' ||
                  combo.result === 'ROLLED_OVER'
                    ? (combo.result as LegResolution)
                    : 'PENDING',
              })),
            principalShares: roundToCents(share.shares),
            rolledInShares,
            effectiveShares: roundToCents(share.shares + rolledInShares),
            rolledForward,
            resolvedAt: share.resolvedAt
              ? new Date(share.resolvedAt).toISOString()
              : null,
          };
        });

      const currentClaim = claims.find(
        (claim) =>
          claim.parlayId === selectedParlayId && claim.userId === currentUserId
      );
      // Claim proportion is by stake, including combo stake so a member who only
      // bought combos still shares the payout.
      const selectedLegCombos = legCombos.filter(
        (combo) => combo.parlayId === selectedParlayId
      );
      const totalStake = roundToCents(
        teamShares.reduce((sum, share) => sum + share.stake, 0) +
          selectedLegCombos.reduce((sum, combo) => sum + combo.stake, 0)
      );
      const currentUserStake = roundToCents(
        teamShares
          .filter((share) => share.addedByUserId === currentUserId)
          .reduce((sum, share) => sum + share.stake, 0) +
          selectedLegCombos
            .filter((combo) => combo.addedByUserId === currentUserId)
            .reduce((sum, combo) => sum + combo.stake, 0)
      );
      const claimableAmount = roundToCents(
        selectedParlay?.claimableAmount ?? 0
      );
      const proportionalClaim =
        selectedParlay?.status === 'WON' &&
        totalStake > 0 &&
        currentUserStake > 0
          ? roundToCents((claimableAmount * currentUserStake) / totalStake)
          : 0;

      return {
        id: team.id,
        name: team.name,
        captainUserId: team.createdByUserId,
        members: dedupedMembers,
        committedLegs: teamShares,
        claimedAt: currentClaim?.claimedAt.toISOString() ?? null,
        createdAt: team.createdAt.toISOString(),
        updatedAt: team.updatedAt.toISOString(),
        status: (selectedParlay?.status ?? 'ACTIVE') as ParlayStatus,
        claimableAmount,
        settledAmount: roundToCents(selectedParlay?.settledAmount ?? 0),
        canClaim:
          selectedParlay?.status === 'WON' &&
          !currentClaim &&
          proportionalClaim > 0,
        hasClaimed: Boolean(currentClaim),
        claimAmount: roundToCents(currentClaim?.amount ?? proportionalClaim),
      };
    })
    .sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
};

export const Route = createFileRoute('/api/parlay-teams')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await getSessionUser(request);

        if (!user) {
          return Response.json(
            { ok: false, error: 'UNAUTHORIZED' },
            { status: 401 }
          );
        }

        const memberships = await db.query.parlayTeamMember.findMany({
          where: (table, { eq: equals }) => equals(table.userId, user.id),
          columns: {
            teamId: true,
          },
        });

        const teamIds = Array.from(
          new Set(memberships.map((membership) => membership.teamId))
        );

        const teams = await buildTeamResponses(teamIds, user.id);

        return Response.json({ ok: true, teams });
      },
      POST: async ({ request }) => {
        const user = await getSessionUser(request);

        if (!user) {
          return Response.json(
            { ok: false, error: 'UNAUTHORIZED' },
            { status: 401 }
          );
        }

        const body = (await request.json().catch(() => ({}))) as {
          action?: string;
          name?: string;
          memberUsernames?: string[];
          captainUsername?: string;
        };

        if (body.action !== 'create' || !body.name?.trim()) {
          return Response.json(
            { ok: false, error: 'INVALID_CREATE' },
            { status: 400 }
          );
        }

        const uniqueMemberUsernames = Array.from(
          new Set(
            (body.memberUsernames ?? [])
              .map((entry) => entry.trim())
              .filter(Boolean)
          )
        );

        if (uniqueMemberUsernames.length > MAX_ADDITIONAL_MEMBERS) {
          return Response.json(
            {
              ok: false,
              error: 'MAX_MEMBERS_EXCEEDED',
              message: 'A team can include up to 10 members total.',
            },
            { status: 400 }
          );
        }

        const captainUsername = body.captainUsername?.trim() || null;

        const existingCaptainProfile = await db.query.userProfile.findFirst({
          where: (table, { eq: equals }) => equals(table.id, user.id),
          columns: {
            id: true,
            username: true,
          },
        });

        if (existingCaptainProfile) {
          if (!existingCaptainProfile.username && captainUsername) {
            try {
              await db
                .insert(userProfile)
                .values({
                  id: user.id,
                  username: captainUsername,
                })
                .onConflictDoUpdate({
                  target: userProfile.id,
                  set: {
                    username: captainUsername,
                    updatedAt: new Date(),
                  },
                });
            } catch {
              await db
                .insert(userProfile)
                .values({
                  id: user.id,
                })
                .onConflictDoUpdate({
                  target: userProfile.id,
                  set: {
                    updatedAt: new Date(),
                  },
                });
            }
          } else {
            await db
              .insert(userProfile)
              .values({
                id: user.id,
              })
              .onConflictDoUpdate({
                target: userProfile.id,
                set: {
                  updatedAt: new Date(),
                },
              });
          }
        } else {
          try {
            await db.insert(userProfile).values({
              id: user.id,
              username: captainUsername,
            });
          } catch {
            await db.insert(userProfile).values({
              id: user.id,
            });
          }
        }

        const matchedProfiles = uniqueMemberUsernames.length
          ? await db.query.userProfile.findMany({
              where: (table, { inArray }) =>
                inArray(table.username, uniqueMemberUsernames),
              columns: {
                id: true,
                username: true,
              },
            })
          : [];

        const matchedByUsername = new Map(
          matchedProfiles
            .filter((profile): profile is { id: string; username: string } =>
              Boolean(profile.username)
            )
            .map((profile) => [profile.username, profile.id])
        );

        const memberIds = [
          user.id,
          ...uniqueMemberUsernames
            .map((username) => matchedByUsername.get(username) ?? null)
            .filter((id): id is string => Boolean(id)),
        ];

        const uniqueMemberIds = Array.from(new Set(memberIds));

        const [createdTeam] = await db
          .insert(parlayTeam)
          .values({
            name: body.name.trim(),
            createdByUserId: user.id,
          })
          .returning({
            id: parlayTeam.id,
          });

        await db.insert(parlayTeamMember).values(
          uniqueMemberIds.map((memberId) => ({
            teamId: createdTeam.id,
            userId: memberId,
          }))
        );

        await db.insert(parlayTeamParlay).values({
          teamId: createdTeam.id,
          startedByUserId: user.id,
          status: 'ACTIVE',
        });

        const teams = await buildTeamResponses([createdTeam.id], user.id);
        const team = teams[0] ?? null;

        return Response.json({ ok: true, team, teams });
      },
      PATCH: async ({ request }) => {
        const user = await getSessionUser(request);

        if (!user) {
          return Response.json(
            { ok: false, error: 'UNAUTHORIZED' },
            { status: 401 }
          );
        }

        const body = (await request.json().catch(() => ({}))) as {
          action?: string;
          teamId?: string;
          positionId?: string;
          shares?: number;
          // commit-share: which of the position's combos to send with the leg.
          comboPositionIds?: string[];
          legId?: string;
          // buy-leg-combo
          comboMarketId?: string;
          comboOutcomeLabel?: string;
          optionLabel?: string;
          betType?: string;
          line?: number;
          stake?: number;
        };

        if (!body.teamId) {
          return Response.json(
            { ok: false, error: 'TEAM_NOT_FOUND' },
            { status: 404 }
          );
        }

        const teamId = body.teamId;

        const memberRow = await db.query.parlayTeamMember.findFirst({
          where: (table, { and, eq: equals }) =>
            and(equals(table.teamId, teamId), equals(table.userId, user.id)),
        });

        if (!memberRow) {
          return Response.json(
            { ok: false, error: 'TEAM_NOT_FOUND' },
            { status: 404 }
          );
        }

        if (body.action === 'commit-share') {
          if (
            !body.positionId ||
            !Number.isFinite(body.shares) ||
            Number(body.shares) <= 0
          ) {
            return Response.json(
              { ok: false, error: 'INVALID_COMMIT' },
              { status: 400 }
            );
          }

          const targetShares = roundToCents(Number(body.shares));
          const teamMembers = await db.query.parlayTeamMember.findMany({
            where: (table, { eq: equals }) => equals(table.teamId, teamId),
            columns: {
              userId: true,
            },
          });
          const teamMemberIds = teamMembers.map((member) => member.userId);

          const memberPortfolios = await db.query.paperPortfolio.findMany({
            where: (table, { inArray }) => inArray(table.userId, teamMemberIds),
            columns: {
              userId: true,
              positions: true,
            },
          });

          const positionById = new Map<string, PaperPosition>();
          for (const portfolio of memberPortfolios) {
            const positions = Array.isArray(portfolio.positions)
              ? (portfolio.positions as PaperPosition[])
              : [];

            for (const position of positions) {
              if (!positionById.has(position.id)) {
                positionById.set(position.id, position);
              }
            }
          }

          const currentUserPortfolio = memberPortfolios.find(
            (portfolio) => portfolio.userId === user.id
          );
          const currentUserPositions = Array.isArray(
            currentUserPortfolio?.positions
          )
            ? (currentUserPortfolio.positions as PaperPosition[])
            : [];
          const targetPosition = currentUserPositions.find(
            (position) => position.id === body.positionId
          );

          if (!targetPosition || targetPosition.status !== 'OPEN') {
            return Response.json(
              { ok: false, error: 'POSITION_NOT_FOUND' },
              { status: 400 }
            );
          }

          const teamParlays = await db.query.parlayTeamParlay.findMany({
            where: (table, { eq: equals }) => equals(table.teamId, teamId),
          });
          const activeParlay = teamParlays.find(
            (parlay) => parlay.status === 'ACTIVE'
          );
          const ensuredParlay =
            activeParlay ??
            (
              await db
                .insert(parlayTeamParlay)
                .values({
                  teamId,
                  startedByUserId: user.id,
                  status: 'ACTIVE',
                })
                .returning({
                  id: parlayTeamParlay.id,
                })
            )[0];

          const existingShares = await db.query.parlayTeamParlayShare.findMany({
            where: (table, { and, eq: equals }) =>
              and(
                equals(table.teamId, teamId),
                equals(table.parlayId, ensuredParlay.id)
              ),
          });

          // Legs are ordered by kickoff, so the parlay locks once the
          // earliest-starting leg has kicked off — not the first one added.
          if (existingShares.length > 0) {
            const earliestKickoffMs = existingShares.reduce((min, share) => {
              const sharePosition = positionById.get(share.positionId);
              const ms = sharePosition
                ? new Date(sharePosition.kickoff).getTime()
                : Number.NaN;
              return Number.isFinite(ms) ? Math.min(min, ms) : min;
            }, Number.POSITIVE_INFINITY);

            if (
              Number.isFinite(earliestKickoffMs) &&
              earliestKickoffMs <= Date.now()
            ) {
              return Response.json(
                {
                  ok: false,
                  error: 'PARLAY_LOCKED_STARTED',
                  message:
                    'Cannot add legs once the first parlay leg has started.',
                },
                { status: 400 }
              );
            }
          }

          // One time, one direction: a position can be committed to a parlay
          // exactly once and the shares can't be withdrawn afterward.
          const positionAlreadyCommitted = existingShares.some(
            (share) => share.positionId === body.positionId
          );

          if (positionAlreadyCommitted) {
            return Response.json(
              {
                ok: false,
                error: 'POSITION_ALREADY_COMMITTED',
                message:
                  'Shares from this position are already committed to the Parlay Team and cannot be withdrawn or re-committed.',
              },
              { status: 400 }
            );
          }

          if (targetShares > targetPosition.quantity) {
            return Response.json(
              {
                ok: false,
                error: 'INSUFFICIENT_SHARES',
                message:
                  'Cannot commit more shares than this position contains.',
              },
              { status: 400 }
            );
          }

          const targetKickoff = kickoffKey(targetPosition.kickoff);
          const hasKickoffConflict = existingShares.some((share) => {
            if (share.positionId === body.positionId) {
              return false;
            }

            const existingPosition = positionById.get(share.positionId);
            if (!existingPosition) {
              return false;
            }

            const existingKickoff = kickoffKey(existingPosition.kickoff);
            return targetKickoff !== null && existingKickoff === targetKickoff;
          });

          if (hasKickoffConflict) {
            return Response.json(
              {
                ok: false,
                error: 'CONFLICTING_START_TIME',
                message:
                  'Cannot add a leg with a conflicting start time to this Parlay Team.',
              },
              { status: 400 }
            );
          }

          const highestSequence = existingShares.reduce(
            (max, share) => Math.max(max, share.sequence),
            0
          );

          const [insertedShare] = await db
            .insert(parlayTeamParlayShare)
            .values({
              parlayId: ensuredParlay.id,
              teamId,
              addedByUserId: user.id,
              positionId: body.positionId,
              sequence: highestSequence + 1,
              placedAt: new Date(targetPosition.createdAt),
              cardTitle: targetPosition.matchup,
              marketId: targetPosition.marketId,
              optionLabel: optionLabelForPosition(targetPosition),
              side: targetPosition.buySide,
              shares: targetShares,
              stake: roundToCents(targetShares * targetPosition.entryPrice),
              entryPrice: roundToCents(targetPosition.entryPrice),
            })
            .returning({ id: parlayTeamParlayShare.id });

          // Open spread/total combos attached to this ML position go with it:
          // transfer them onto the new leg and strip them from the portfolio.
          const childCombos = currentUserPositions.filter(
            (position) =>
              position.parentPositionId === targetPosition.id &&
              position.comboMarketId &&
              position.status === 'OPEN'
          );

          // Deduct the committed shares from the user's position — the shares
          // leave the portfolio and can't be sold or withdrawn until the parlay
          // concludes with a victory.
          const remainingQuantity = roundToCents(
            targetPosition.quantity - targetShares
          );

          // Only the user-selected combos ride along — except a full-position
          // commit (position closes) must take them all, or they'd orphan.
          const requestedComboIds = new Set(
            Array.isArray(body.comboPositionIds) ? body.comboPositionIds : []
          );
          const combosToTransfer =
            remainingQuantity <= 0
              ? childCombos
              : childCombos.filter((combo) => requestedComboIds.has(combo.id));

          if (combosToTransfer.length > 0) {
            await db.insert(parlayTeamLegCombo).values(
              combosToTransfer.map((combo) => ({
                parlayId: ensuredParlay.id,
                teamId,
                legShareId: insertedShare.id,
                addedByUserId: user.id,
                sourceEventId: combo.marketId,
                comboMarketId: combo.comboMarketId as string,
                comboOutcomeLabel: combo.comboOutcomeLabel as string,
                optionLabel: combo.optionLabel as string,
                betType: combo.betType as string,
                line: Number.isFinite(combo.line) ? Number(combo.line) : null,
                shares: combo.quantity,
                stake: combo.stake,
                entryPrice: combo.entryPrice,
              }))
            );
          }

          const childComboIds = new Set(
            combosToTransfer.map((combo) => combo.id)
          );
          const remainingStake = roundToCents(
            Math.max(
              0,
              targetPosition.stake - targetShares * targetPosition.entryPrice
            )
          );
          const nextPositions = currentUserPositions
            .filter((position) => !childComboIds.has(position.id))
            .map((position) =>
              position.id === targetPosition.id
                ? {
                    ...position,
                    quantity: Math.max(0, remainingQuantity),
                    stake: remainingStake,
                    status:
                      remainingQuantity <= 0
                        ? ('CLOSED' as const)
                        : position.status,
                  }
                : position
            );

          await db
            .update(paperPortfolio)
            .set({ positions: nextPositions, updatedAt: new Date() })
            .where(eq(paperPortfolio.userId, user.id));

          // Legs are always ordered by kickoff; renumber the whole parlay so
          // "Leg N" reflects chronological start order after this insert.
          const parlaySharesForOrdering =
            await db.query.parlayTeamParlayShare.findMany({
              where: (table, { eq: equals }) =>
                equals(table.parlayId, ensuredParlay.id),
              columns: { id: true, positionId: true, placedAt: true },
            });

          const orderedShares = parlaySharesForOrdering
            .map((share) => {
              const sharePosition =
                positionById.get(share.positionId) ??
                (share.positionId === targetPosition.id
                  ? targetPosition
                  : undefined);
              const ms = sharePosition
                ? new Date(sharePosition.kickoff).getTime()
                : new Date(share.placedAt).getTime();
              return {
                id: share.id,
                ms: Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER,
              };
            })
            .sort((a, b) => a.ms - b.ms);

          await Promise.all(
            orderedShares.map((entry, index) =>
              db
                .update(parlayTeamParlayShare)
                .set({ sequence: index + 1 })
                .where(eq(parlayTeamParlayShare.id, entry.id))
            )
          );
        } else if (body.action === 'claim') {
          const winningParlay = getSelectedParlay(
            teamId,
            await db.query.parlayTeamParlay.findMany({
              where: (table, { eq: equals }) => equals(table.teamId, teamId),
            })
          );

          if (
            !winningParlay ||
            winningParlay.status !== 'WON' ||
            winningParlay.claimableAmount <= 0
          ) {
            return Response.json(
              { ok: false, error: 'PARLAY_NOT_CLAIMABLE' },
              { status: 400 }
            );
          }

          const existingClaim = await db.query.parlayTeamParlayClaim.findFirst({
            where: (table, { and, eq: equals }) =>
              and(
                equals(table.parlayId, winningParlay.id),
                equals(table.userId, user.id)
              ),
          });

          if (existingClaim) {
            return Response.json(
              { ok: false, error: 'ALREADY_CLAIMED' },
              { status: 400 }
            );
          }

          const parlayShares = await db.query.parlayTeamParlayShare.findMany({
            where: (table, { eq: equals }) =>
              equals(table.parlayId, winningParlay.id),
          });
          const parlayCombos = await db.query.parlayTeamLegCombo.findMany({
            where: (table, { eq: equals }) =>
              equals(table.parlayId, winningParlay.id),
          });
          // Stake (ML + combos) drives the proportional split, so combo buyers
          // share the winnings.
          const totalStake = roundToCents(
            parlayShares.reduce((sum, share) => sum + share.stake, 0) +
              parlayCombos.reduce((sum, combo) => sum + combo.stake, 0)
          );
          const userStake = roundToCents(
            parlayShares
              .filter((share) => share.addedByUserId === user.id)
              .reduce((sum, share) => sum + share.stake, 0) +
              parlayCombos
                .filter((combo) => combo.addedByUserId === user.id)
                .reduce((sum, combo) => sum + combo.stake, 0)
          );

          if (totalStake <= 0 || userStake <= 0) {
            return Response.json(
              { ok: false, error: 'NOTHING_TO_CLAIM' },
              { status: 400 }
            );
          }

          const claimAmount = roundToCents(
            (winningParlay.claimableAmount * userStake) / totalStake
          );
          if (claimAmount <= 0) {
            return Response.json(
              { ok: false, error: 'NOTHING_TO_CLAIM' },
              { status: 400 }
            );
          }

          await creditUserCash(user.id, claimAmount);

          await db.insert(parlayTeamParlayClaim).values({
            parlayId: winningParlay.id,
            teamId,
            userId: user.id,
            amount: claimAmount,
            claimedAt: new Date(),
          });
        } else if (body.action === 'manual-rollover') {
          if (!body.legId) {
            return Response.json(
              { ok: false, error: 'INVALID_ROLLOVER' },
              { status: 400 }
            );
          }

          const teamParlays = await db.query.parlayTeamParlay.findMany({
            where: (table, { eq: equals }) => equals(table.teamId, teamId),
          });
          const activeParlay = teamParlays.find(
            (parlay) => parlay.status === 'ACTIVE'
          );

          if (!activeParlay) {
            return Response.json(
              { ok: false, error: 'PARLAY_NOT_ACTIVE' },
              { status: 400 }
            );
          }

          const parlayShares = await db.query.parlayTeamParlayShare.findMany({
            where: (table, { eq: equals }) =>
              equals(table.parlayId, activeParlay.id),
          });

          const leg = parlayShares.find((share) => share.id === body.legId);
          if (!leg) {
            return Response.json(
              { ok: false, error: 'LEG_NOT_FOUND' },
              { status: 404 }
            );
          }

          // Only the leg's owner can roll it over.
          if (leg.addedByUserId !== user.id) {
            return Response.json(
              { ok: false, error: 'NOT_LEG_OWNER' },
              { status: 403 }
            );
          }

          if (
            leg.result === 'WON' ||
            leg.result === 'LOST' ||
            leg.result === 'ROLLED_OVER'
          ) {
            return Response.json(
              { ok: false, error: 'LEG_ALREADY_RESOLVED' },
              { status: 400 }
            );
          }

          // Build positions for every team member so legs can be priced.
          const teamMembers = await db.query.parlayTeamMember.findMany({
            where: (table, { eq: equals }) => equals(table.teamId, teamId),
            columns: { userId: true },
          });
          const memberPortfolios = await db.query.paperPortfolio.findMany({
            where: (table, { inArray }) =>
              inArray(
                table.userId,
                teamMembers.map((member) => member.userId)
              ),
            columns: { positions: true },
          });
          const positionById = new Map<string, PaperPosition>();
          for (const portfolio of memberPortfolios) {
            const positions = Array.isArray(portfolio.positions)
              ? (portfolio.positions as PaperPosition[])
              : [];
            for (const position of positions) {
              if (!positionById.has(position.id)) {
                positionById.set(position.id, position);
              }
            }
          }

          const existingRollovers =
            await db.query.parlayTeamParlayRollover.findMany({
              where: (table, { eq: equals }) =>
                equals(table.parlayId, activeParlay.id),
            });

          // The whole leg — principal plus anything already rolled in — is
          // cashed out at the current market price.
          const rolledIn = existingRollovers
            .filter((rollover) => rollover.targetShareId === leg.id)
            .reduce((sum, rollover) => sum + rollover.sharesAdded, 0);
          const legEffectiveShares = roundToCents(leg.shares + rolledIn);
          const currentPrice = await legPriceForPosition(
            leg.marketId,
            positionById.get(leg.positionId) ?? null
          );

          if (!currentPrice || currentPrice <= 0) {
            return Response.json(
              { ok: false, error: 'PRICE_UNAVAILABLE' },
              { status: 400 }
            );
          }

          // Combos on this leg roll with it: cash them out at current value and
          // add it to the rolled amount.
          const legCombosForLeg = await db.query.parlayTeamLegCombo.findMany({
            where: (table, { eq: equals }) => equals(table.legShareId, leg.id),
          });
          const pendingLegCombos = legCombosForLeg.filter(
            (combo) =>
              combo.result !== 'WON' &&
              combo.result !== 'LOST' &&
              combo.result !== 'ROLLED_OVER'
          );
          const comboPriceById = new Map<string, number>();
          let comboValue = 0;
          for (const combo of pendingLegCombos) {
            const comboPrice = await getComboPrice(
              combo.sourceEventId,
              combo.comboMarketId,
              combo.comboOutcomeLabel
            );
            if (comboPrice && comboPrice > 0) {
              comboPriceById.set(combo.id, comboPrice);
              comboValue += combo.shares * comboPrice;
            }
          }
          comboValue = roundToCents(comboValue);

          const value = roundToCents(
            legEffectiveShares * currentPrice + comboValue
          );
          if (value <= 0) {
            return Response.json(
              { ok: false, error: 'NOTHING_TO_ROLL' },
              { status: 400 }
            );
          }

          // Target = the next leg that hasn't started yet (same rule as the
          // automatic rollover), excluding lost/already-rolled legs.
          const nowMs = Date.now();
          const target = parlayShares
            .filter((candidate) => {
              if (candidate.id === leg.id) return false;
              if (candidate.sequence <= leg.sequence) return false;
              if (
                candidate.result === 'LOST' ||
                candidate.result === 'ROLLED_OVER'
              ) {
                return false;
              }
              const candidatePosition = positionById.get(candidate.positionId);
              const kickoffMs = candidatePosition
                ? new Date(candidatePosition.kickoff).getTime()
                : Number.NaN;
              return Number.isFinite(kickoffMs) && kickoffMs > nowMs;
            })
            .sort((a, b) => a.sequence - b.sequence)[0];

          if (!target) {
            return Response.json(
              {
                ok: false,
                error: 'NO_TARGET_LEG',
                message: 'No upcoming leg is available to roll this leg into.',
              },
              { status: 400 }
            );
          }

          const targetPrice = await legPriceForPosition(
            target.marketId,
            positionById.get(target.positionId) ?? null
          );
          if (!targetPrice || targetPrice <= 0) {
            return Response.json(
              { ok: false, error: 'PRICE_UNAVAILABLE' },
              { status: 400 }
            );
          }

          await db.insert(parlayTeamParlayRollover).values({
            parlayId: activeParlay.id,
            teamId,
            sourceShareId: leg.id,
            targetShareId: target.id,
            amount: value,
            targetPrice,
            sharesAdded: roundToCents(value / targetPrice),
          });

          // Logged as ROLLED_OVER (not LOST) so the parlay stays alive even if
          // the underlying bet would have lost.
          await db
            .update(parlayTeamParlayShare)
            .set({
              result: 'ROLLED_OVER',
              resolvedAt: new Date(),
              resolvedPrice: currentPrice,
            })
            .where(eq(parlayTeamParlayShare.id, leg.id));

          // The leg's combos rolled with it — mark them ROLLED_OVER too.
          for (const combo of pendingLegCombos) {
            await db
              .update(parlayTeamLegCombo)
              .set({
                result: 'ROLLED_OVER',
                resolvedAt: new Date(),
                resolvedPrice: comboPriceById.get(combo.id) ?? null,
              })
              .where(eq(parlayTeamLegCombo.id, combo.id));
          }
        } else if (body.action === 'buy-leg-combo') {
          // Any team member can buy a spread/total combo on an MLB leg whose
          // game hasn't started. Funds are locked into the parlay (the buyer's
          // cash is debited and the combo rolls/settles with the leg).
          const stake = roundToCents(Number(body.stake));
          if (
            !body.legId ||
            !body.comboMarketId ||
            !body.comboOutcomeLabel ||
            !body.optionLabel ||
            !(body.betType === 'spread' || body.betType === 'total') ||
            !Number.isFinite(stake) ||
            stake <= 0
          ) {
            return Response.json(
              { ok: false, error: 'INVALID_COMBO' },
              { status: 400 }
            );
          }

          const teamParlays = await db.query.parlayTeamParlay.findMany({
            where: (table, { eq: equals }) => equals(table.teamId, teamId),
          });
          const activeParlay = teamParlays.find(
            (parlay) => parlay.status === 'ACTIVE'
          );
          if (!activeParlay) {
            return Response.json(
              { ok: false, error: 'PARLAY_NOT_ACTIVE' },
              { status: 400 }
            );
          }

          const leg = await db.query.parlayTeamParlayShare.findFirst({
            where: (table, { and, eq: equals }) =>
              and(
                equals(table.id, body.legId as string),
                equals(table.parlayId, activeParlay.id)
              ),
          });
          if (!leg || !leg.marketId) {
            return Response.json(
              { ok: false, error: 'LEG_NOT_FOUND' },
              { status: 404 }
            );
          }

          // The leg's game must be MLB and not yet started.
          const eventRow = await db.query.externalMarket.findFirst({
            where: (table, { and, eq: equals }) =>
              and(
                equals(table.sourceProvider, 'POLYMARKET'),
                equals(table.sourceEventId, leg.marketId as string)
              ),
            columns: { category: true, closeTime: true },
          });
          if (!eventRow || eventRow.category !== 'mlb-games') {
            return Response.json(
              { ok: false, error: 'NOT_MLB_LEG' },
              { status: 400 }
            );
          }
          if (
            eventRow.closeTime &&
            eventRow.closeTime.getTime() <= Date.now()
          ) {
            return Response.json(
              {
                ok: false,
                error: 'LEG_STARTED',
                message: 'Cannot add combos once the leg game has started.',
              },
              { status: 400 }
            );
          }

          const price = await getComboPrice(
            leg.marketId,
            body.comboMarketId,
            body.comboOutcomeLabel
          );
          if (!price || price <= 0) {
            return Response.json(
              { ok: false, error: 'PRICE_UNAVAILABLE' },
              { status: 400 }
            );
          }

          // Lock the buyer's cash. Reject when they can't cover the stake.
          const debited = await debitUserCash(user.id, stake);
          if (!debited) {
            return Response.json(
              { ok: false, error: 'INSUFFICIENT_FUNDS' },
              { status: 400 }
            );
          }

          await db.insert(parlayTeamLegCombo).values({
            parlayId: activeParlay.id,
            teamId,
            legShareId: leg.id,
            addedByUserId: user.id,
            sourceEventId: leg.marketId,
            comboMarketId: body.comboMarketId,
            comboOutcomeLabel: body.comboOutcomeLabel,
            optionLabel: body.optionLabel,
            betType: body.betType,
            line: Number.isFinite(body.line) ? Number(body.line) : null,
            shares: roundToCents(stake / price),
            stake,
            entryPrice: price,
          });
        } else {
          return Response.json(
            { ok: false, error: 'INVALID_ACTION' },
            { status: 400 }
          );
        }

        const teams = await buildTeamResponses([teamId], user.id);
        const team = teams[0] ?? null;

        return Response.json({ ok: true, team, teams });
      },
    },
  },
});
