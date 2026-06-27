import { createFileRoute } from '@tanstack/react-router';

type LiveEventRequest = {
  events?: Array<{
    marketId: string;
    matchup: string;
    kickoff: string;
    homeTeam: string;
    awayTeam: string;
  }>;
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

type LiveEventResponse = {
  statuses: Record<string, LiveStatusPayload>;
};

type ApiFootballFixture = {
  fixture?: {
    date?: string;
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
    home?: number | null;
    away?: number | null;
  };
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

const toStatusPayload = (fixture: ApiFootballFixture): LiveStatusPayload => {
  const short = fixture.fixture?.status?.short ?? '';
  const longStatus = fixture.fixture?.status?.long ?? '';
  const elapsed = fixture.fixture?.status?.elapsed;
  const homeScore =
    typeof fixture.goals?.home === 'number' ? fixture.goals.home : null;
  const awayScore =
    typeof fixture.goals?.away === 'number' ? fixture.goals.away : null;
  const scoreLabel =
    homeScore !== null && awayScore !== null
      ? `${homeScore}-${awayScore}`
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
    homeScore,
    awayScore,
    scoreLabel,
  };
};

export const Route = createFileRoute('/api/live-event-time')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request
          .json()
          .catch(() => ({}))) as LiveEventRequest;
        const events = body.events ?? [];

        const fallbackStatuses = events.reduce<
          Record<string, LiveStatusPayload>
        >((acc, event) => {
          acc[event.marketId] = getFallbackStatus(event.kickoff);
          return acc;
        }, {});

        const apiKey = process.env.API_FOOTBALL_API_KEY?.trim();
        if (!apiKey || events.length === 0) {
          return Response.json({
            statuses: fallbackStatuses,
          } satisfies LiveEventResponse);
        }

        const uniqueDates = Array.from(
          new Set(
            events
              .map((event) => {
                const kickoff = new Date(event.kickoff);
                if (Number.isNaN(kickoff.getTime())) {
                  return null;
                }
                return kickoff.toISOString().slice(0, 10);
              })
              .filter((value): value is string => Boolean(value))
          )
        );

        const fixtureResponses = await Promise.all(
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

        const fixtures = fixtureResponses.flat();

        const statuses = events.reduce<Record<string, LiveStatusPayload>>(
          (acc, event) => {
            const matchedFixture = fixtures.find((fixture) => {
              const home = fixture.teams?.home?.name ?? '';
              const away = fixture.teams?.away?.name ?? '';
              return (
                isSameTeam(home, event.homeTeam) &&
                isSameTeam(away, event.awayTeam)
              );
            });

            acc[event.marketId] = matchedFixture
              ? toStatusPayload(matchedFixture)
              : fallbackStatuses[event.marketId];

            return acc;
          },
          {}
        );

        return Response.json({ statuses } satisfies LiveEventResponse);
      },
    },
  },
});
