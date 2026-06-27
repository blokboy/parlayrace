import { auth } from '@starter/backend/auth';
import { db } from '@starter/backend/db';
import {
  paperPortfolio,
  parlayTeam,
  parlayTeamMember,
  parlayTeamParlay,
  parlayTeamParlayClaim,
  parlayTeamParlayShare,
  userProfile,
} from '@starter/backend/schema';
import { createFileRoute } from '@tanstack/react-router';

type PositionSide = 'home' | 'draw' | 'away';
type BuySide = 'YES' | 'NO';
type ParlayStatus = 'ACTIVE' | 'LOST' | 'WON';
type LegResolution = 'PENDING' | 'WON' | 'LOST';

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
};

type PaperPortfolioState = {
  cash: number;
  positions: PaperPosition[];
};

type TeamMember = {
  id: string;
  username: string;
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
  positionSide: PositionSide;
  buySide: BuySide;
  placedAt: string;
  result: LegResolution;
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

  const apiKey = process.env.API_FOOTBALL_API_KEY?.trim();
  if (!apiKey || events.length === 0) {
    return fallbackStatuses;
  }

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
    const matched = findMatchingFixture(event, fixtures);
    acc[event.marketId] = matched
      ? toStatusPayload(matched.fixture, matched.swapped)
      : fallbackStatuses[event.marketId];
    return acc;
  }, {});
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

const computeClaimableAmount = (
  shares: Array<{ stake: number; entryPrice: number }>
): number => {
  if (shares.length === 0) {
    return 0;
  }

  let pool = roundToCents(shares[0]?.stake ?? 0);

  for (let index = 1; index < shares.length; index += 1) {
    pool = roundToCents(pool / Math.max(shares[index].entryPrice, 0.01));
  }

  return pool;
};

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

const syncParlayStates = async (teamIds: string[]) => {
  if (teamIds.length === 0) {
    return;
  }

  const [parlays, shares, memberships, blokboyProfile] = await Promise.all([
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
  ]);

  const activeParlays = parlays.filter((parlay) => parlay.status === 'ACTIVE');
  if (activeParlays.length === 0) {
    return;
  }

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

    const resolvedShares = parlayShares.map((share) => {
      const position = positionById.get(share.positionId) ?? null;
      return {
        share,
        result: resolveLegResult(position, statuses[share.id]),
      };
    });

    const firstLost = resolvedShares.find((entry) => entry.result === 'LOST');
    if (firstLost) {
      const settledAmount = roundToCents(
        parlayShares
          .filter((share) => share.sequence > firstLost.share.sequence)
          .reduce((sum, share) => sum + share.shares, 0)
      );

      if (settledAmount > 0 && blokboyProfile?.id) {
        await creditUserCash(blokboyProfile.id, settledAmount);
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
          lossSequence: firstLost.share.sequence,
        })
        .onConflictDoUpdate({
          target: parlayTeamParlay.id,
          set: {
            status: 'LOST',
            claimableAmount: 0,
            settledAmount,
            settledAt: new Date(),
            transferredToUserId: blokboyProfile?.id ?? null,
            lossSequence: firstLost.share.sequence,
            updatedAt: new Date(),
          },
        });

      continue;
    }

    const allWon = resolvedShares.every((entry) => entry.result === 'WON');
    if (allWon) {
      const claimableAmount = computeClaimableAmount(
        parlayShares.map((share) => ({
          stake: share.stake,
          entryPrice: share.entryPrice,
        }))
      );

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

  await syncParlayStates(teamIds);

  const [teams, members, parlays, shares, claims] = await Promise.all([
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
  ]);

  const userIds = Array.from(
    new Set([
      ...members.map((member) => member.userId),
      ...shares.map((share) => share.addedByUserId),
      ...teams.map((team) => team.createdByUserId),
      ...claims.map((claim) => claim.userId),
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
            placedAt: share.placedAt.toISOString(),
            result: resolveLegResult(position, statuses[share.id]),
          };
        });

      const currentClaim = claims.find(
        (claim) =>
          claim.parlayId === selectedParlayId && claim.userId === currentUserId
      );
      const totalStake = roundToCents(
        teamShares.reduce((sum, share) => sum + share.stake, 0)
      );
      const currentUserStake = roundToCents(
        teamShares
          .filter((share) => share.addedByUserId === currentUserId)
          .reduce((sum, share) => sum + share.stake, 0)
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

          const alreadyCommittedByUserForPosition = roundToCents(
            existingShares
              .filter(
                (share) =>
                  share.positionId === body.positionId &&
                  share.addedByUserId === user.id
              )
              .reduce((sum, share) => sum + share.shares, 0)
          );

          if (
            targetShares + alreadyCommittedByUserForPosition >
            targetPosition.quantity
          ) {
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

          await db.insert(parlayTeamParlayShare).values({
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
          });
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
          const totalStake = roundToCents(
            parlayShares.reduce((sum, share) => sum + share.stake, 0)
          );
          const userStake = roundToCents(
            parlayShares
              .filter((share) => share.addedByUserId === user.id)
              .reduce((sum, share) => sum + share.stake, 0)
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
