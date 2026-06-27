import { createFileRoute } from '@tanstack/react-router';

type PolymarketTeam = {
  name: string;
  logo: string;
  color: string | null;
  ordering: string | null;
};

type PolymarketEvent = {
  id: string | number;
  title: string;
  startDate: string;
  teams: PolymarketTeam[] | null;
  active?: boolean;
  closed?: boolean;
};

type MarketLeg = {
  id: string;
  side: 'home' | 'draw' | 'away';
  label: string;
};

type MarketItem = {
  id: string;
  sourceProvider: 'POLYMARKET';
  category: 'fifa-games';
  matchup: string;
  kickoff: string;
  homeTeam: string;
  awayTeam: string;
  legs: [MarketLeg, MarketLeg, MarketLeg];
};

const startOfDayUtc = (value: Date) =>
  new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
  );

const endOfDayUtc = (value: Date) =>
  new Date(
    Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate(),
      23,
      59,
      59,
      999
    )
  );

const getWindow = () => {
  const now = new Date();
  const from = startOfDayUtc(now);
  const tomorrow = new Date(from);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const to = endOfDayUtc(tomorrow);
  return { from, to };
};

const parseDateParam = (value: string | null): Date | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const inWindow = (isoDate: string, from: Date, to: Date) => {
  const value = new Date(isoDate);
  if (Number.isNaN(value.getTime())) {
    return false;
  }
  return value >= from && value <= to;
};

const toMarketItem = (event: PolymarketEvent): MarketItem | null => {
  if (!event.teams || event.teams.length < 2) {
    return null;
  }

  const home =
    event.teams.find((team) => team.ordering === 'home') ?? event.teams[0];
  const away =
    event.teams.find((team) => team.ordering === 'away') ??
    event.teams.find((team) => team.name !== home.name) ??
    event.teams[1];

  if (!home || !away) {
    return null;
  }

  const eventId = String(event.id);

  return {
    id: eventId,
    sourceProvider: 'POLYMARKET',
    category: 'fifa-games',
    matchup: `${home.name} vs ${away.name}`,
    kickoff: event.startDate,
    homeTeam: home.name,
    awayTeam: away.name,
    legs: [
      { id: `${eventId}:home`, side: 'home', label: home.name },
      { id: `${eventId}:draw`, side: 'draw', label: 'Draw' },
      { id: `${eventId}:away`, side: 'away', label: away.name },
    ],
  };
};

export const Route = createFileRoute('/api/markets')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const sourceProvider = url.searchParams.get('sourceProvider');
        const category = url.searchParams.get('category');
        const queryFrom = parseDateParam(url.searchParams.get('dateFrom'));
        const queryTo = parseDateParam(url.searchParams.get('dateTo'));

        if (sourceProvider !== 'POLYMARKET' || category !== 'fifa-games') {
          return Response.json({ markets: [] as MarketItem[] });
        }

        const response = await fetch(
          'https://gamma-api.polymarket.com/events?limit=200&active=true&closed=false&tag_slug=soccer'
        );

        if (!response.ok) {
          return Response.json(
            { markets: [] as MarketItem[] },
            { status: 200 }
          );
        }

        const events = (await response.json()) as PolymarketEvent[];
        const defaultWindow = getWindow();
        const from = queryFrom ?? defaultWindow.from;
        const to = queryTo ?? defaultWindow.to;

        const markets = events
          .filter((event) => inWindow(event.startDate, from, to))
          .map(toMarketItem)
          .filter((market): market is MarketItem => market !== null)
          .slice(0, 24);

        return Response.json({ markets });
      },
    },
  },
});
