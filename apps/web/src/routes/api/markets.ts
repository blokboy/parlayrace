import { createFileRoute } from '@tanstack/react-router';

type PolymarketMarket = {
  id: string | number;
  question: string;
  outcomes?: string;
  outcomePrices?: string;
  updatedAt?: string;
};

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
  endDate: string;
  slug?: string;
  seriesSlug?: string;
  teams: PolymarketTeam[] | null;
  markets?: PolymarketMarket[];
  active?: boolean;
  closed?: boolean;
};

type MarketLeg = {
  id: string;
  side: 'home' | 'draw' | 'away';
  label: string;
  yesPrice: number;
  noPrice: number;
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

// ─── price extraction ───────────────────────────────────────────────────────

const parseJsonArray = (value: string | undefined): string[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const roundToCents = (n: number) => Math.round(n * 100) / 100;

const extractPrices = (
  market: PolymarketMarket
): { yesPrice: number; noPrice: number } => {
  const outcomes = parseJsonArray(market.outcomes);
  const prices = parseJsonArray(market.outcomePrices).map(Number);

  if (outcomes.length === 0 || prices.length === 0) {
    return { yesPrice: 0.5, noPrice: 0.5 };
  }

  const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === 'yes');
  const yesPriceRaw = yesIdx >= 0 ? prices[yesIdx] : prices[0];
  const yesPrice = Number.isFinite(yesPriceRaw) ? yesPriceRaw : 0.5;

  return {
    yesPrice: roundToCents(yesPrice),
    noPrice: roundToCents(Math.max(0, Math.min(1, 1 - yesPrice))),
  };
};

// ─── market classification ───────────────────────────────────────────────────
// Determines which side (home win / draw / away win) a Polymarket market
// represents by inspecting its question text.

const WIN_KEYWORDS = ['to win', 'beat', 'wins', 'will win', 'defeat'];

const classifyMarket = (
  question: string,
  homeTeam: string,
  awayTeam: string
): 'home' | 'away' | 'draw' | null => {
  const q = question.toLowerCase().trim();
  const home = homeTeam.toLowerCase();
  const away = awayTeam.toLowerCase();

  if (!home || !away) return null;

  const hasHome = q.includes(home);
  const hasAway = q.includes(away);

  // Polymarket often uses bare outcome labels ("Algeria", "Draw", "Austria").
  // When only one team is present the whole question IS that team's market.
  if (hasHome && !hasAway) return 'home';
  if (hasAway && !hasHome) return 'away';

  // Neither team mentioned — only remaining possibility is a draw label.
  if (!hasHome && !hasAway) {
    return q.includes('draw') ? 'draw' : null;
  }

  // Both teams present → full-sentence question; use keyword / position matching.
  if (q.includes('draw')) return 'draw';

  for (const kw of WIN_KEYWORDS) {
    const kwIdx = q.indexOf(kw);
    if (kwIdx < 0) continue;

    const homeIdx = q.lastIndexOf(home, kwIdx - 1);
    const awayIdx = q.lastIndexOf(away, kwIdx - 1);

    if (homeIdx >= 0 && (awayIdx < 0 || homeIdx > awayIdx)) return 'home';
    if (awayIdx >= 0 && (homeIdx < 0 || awayIdx > homeIdx)) return 'away';
  }

  return q.indexOf(home) < q.indexOf(away) ? 'home' : 'away';
};

const findLegPrices = (
  markets: PolymarketMarket[],
  side: 'home' | 'draw' | 'away',
  homeTeam: string,
  awayTeam: string
): { yesPrice: number; noPrice: number } => {
  const match = markets.find(
    (m) => classifyMarket(m.question, homeTeam, awayTeam) === side
  );
  return match ? extractPrices(match) : { yesPrice: 0.5, noPrice: 0.5 };
};

// ─── date utilities ──────────────────────────────────────────────────────────

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
  const fourthDay = new Date(from);
  fourthDay.setUTCDate(fourthDay.getUTCDate() + 3);
  const to = endOfDayUtc(fourthDay);
  return { from, to };
};

const parseDateParam = (value: string | null): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const inWindow = (isoDate: string, from: Date, to: Date) => {
  const value = new Date(isoDate);
  if (Number.isNaN(value.getTime())) return false;
  return value >= from && value <= to;
};

const isWorldCupEvent = (event: PolymarketEvent) => {
  const series = (event.seriesSlug ?? '').toLowerCase();
  const slug = (event.slug ?? '').toLowerCase();
  return (
    series.includes('fifwc') ||
    series.includes('world-cup') ||
    slug.startsWith('fifwc-') ||
    slug.includes('world-cup')
  );
};

// ─── market item builder ─────────────────────────────────────────────────────

const toMarketItem = (event: PolymarketEvent): MarketItem | null => {
  if (!event.teams || event.teams.length < 2) return null;

  const home =
    event.teams.find((team) => team.ordering === 'home') ?? event.teams[0];
  const away =
    event.teams.find((team) => team.ordering === 'away') ??
    event.teams.find((team) => team.name !== home.name) ??
    event.teams[1];

  if (!home || !away) return null;

  const eventId = String(event.id);
  const markets = event.markets ?? [];

  return {
    id: eventId,
    sourceProvider: 'POLYMARKET',
    category: 'fifa-games',
    matchup: `${home.name} vs ${away.name}`,
    kickoff: event.endDate,
    homeTeam: home.name,
    awayTeam: away.name,
    legs: [
      {
        id: `${eventId}:home`,
        side: 'home',
        label: home.name,
        ...findLegPrices(markets, 'home', home.name, away.name),
      },
      {
        id: `${eventId}:draw`,
        side: 'draw',
        label: 'Draw',
        ...findLegPrices(markets, 'draw', home.name, away.name),
      },
      {
        id: `${eventId}:away`,
        side: 'away',
        label: away.name,
        ...findLegPrices(markets, 'away', home.name, away.name),
      },
    ],
  };
};

// ─── route ───────────────────────────────────────────────────────────────────

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

        // Fetch both tags in parallel — World Cup fixtures live under
        // "world-cup" on Polymarket, but some may also appear under "soccer".
        const [wcRes, soccerRes] = await Promise.all([
          fetch(
            'https://gamma-api.polymarket.com/events?limit=200&active=true&closed=false&tag_slug=world-cup'
          ),
          fetch(
            'https://gamma-api.polymarket.com/events?limit=200&active=true&closed=false&tag_slug=soccer'
          ),
        ]);

        const wcEvents: PolymarketEvent[] = wcRes.ok
          ? ((await wcRes.json()) as PolymarketEvent[])
          : [];

        const soccerEvents: PolymarketEvent[] = soccerRes.ok
          ? ((await soccerRes.json()) as PolymarketEvent[])
          : [];

        // Events from the world-cup tag are all WC fixtures; events from the
        // soccer tag need the slug/series check to exclude unrelated markets.
        const wcIds = new Set(wcEvents.map((e) => String(e.id)));
        const filteredSoccer = soccerEvents.filter(
          (e) => !wcIds.has(String(e.id)) && isWorldCupEvent(e)
        );

        const allEvents = [...wcEvents, ...filteredSoccer];

        const defaultWindow = getWindow();
        const from = queryFrom ?? defaultWindow.from;
        const to = queryTo ?? defaultWindow.to;

        const markets = allEvents
          .filter((event) => inWindow(event.endDate, from, to))
          .map(toMarketItem)
          .filter((market): market is MarketItem => market !== null)
          .slice(0, 24);

        return Response.json({ markets });
      },
    },
  },
});
