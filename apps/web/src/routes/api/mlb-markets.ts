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
  teams?: PolymarketTeam[] | null;
  markets?: PolymarketMarket[];
  active?: boolean;
  closed?: boolean;
};

type MarketLeg = {
  id: string;
  side: 'home' | 'away';
  label: string;
  yesPrice: number;
  noPrice: number;
};

type MlbMarketItem = {
  id: string;
  sourceProvider: 'POLYMARKET';
  category: 'mlb-games';
  matchup: string;
  kickoff: string;
  homeTeam: string;
  awayTeam: string;
  legs: MarketLeg[];
};

// ─── price extraction ────────────────────────────────────────────────────────

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

// ─── market classification (home/away only — no draw in baseball) ────────────

const classifyMarket = (
  question: string,
  homeTeam: string,
  awayTeam: string
): 'home' | 'away' | null => {
  const q = question.toLowerCase().trim();
  const home = homeTeam.toLowerCase();
  const away = awayTeam.toLowerCase();

  if (!home || !away) return null;

  const hasHome = q.includes(home);
  const hasAway = q.includes(away);

  // Bare outcome label ("Yankees", "Red Sox")
  if (hasHome && !hasAway) return 'home';
  if (hasAway && !hasHome) return 'away';

  if (!hasHome && !hasAway) return null;

  // Full sentence — look for the team that precedes a win keyword.
  const WIN_KEYWORDS = ['to win', 'beat', 'wins', 'will win', 'defeat'];
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
  side: 'home' | 'away',
  homeTeam: string,
  awayTeam: string
): { yesPrice: number; noPrice: number } => {
  const match = markets.find(
    (m) => classifyMarket(m.question, homeTeam, awayTeam) === side
  );
  return match ? extractPrices(match) : { yesPrice: 0.5, noPrice: 0.5 };
};

// ─── event filtering ─────────────────────────────────────────────────────────

const isMlbEvent = (event: PolymarketEvent): boolean => {
  const series = (event.seriesSlug ?? '').toLowerCase();
  const slug = (event.slug ?? '').toLowerCase();
  return (
    series.includes('mlb') ||
    series.includes('baseball') ||
    slug.includes('mlb') ||
    slug.startsWith('mlb-')
  );
};

// ─── date utilities ──────────────────────────────────────────────────────────

const parseDateParam = (value: string | null): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const startOfDayUtc = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

const endOfDayUtc = (d: Date) =>
  new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999)
  );

const getWindow = () => {
  const now = new Date();
  const from = startOfDayUtc(now);
  const last = new Date(from);
  last.setUTCDate(last.getUTCDate() + 3);
  return { from, to: endOfDayUtc(last) };
};

const inWindow = (isoDate: string, from: Date, to: Date): boolean => {
  const v = new Date(isoDate);
  return !Number.isNaN(v.getTime()) && v >= from && v <= to;
};

// ─── market builder ───────────────────────────────────────────────────────────

const toMlbMarketItem = (event: PolymarketEvent): MlbMarketItem | null => {
  const teams = event.teams ?? [];
  if (teams.length < 2) return null;

  const home =
    teams.find((t) => t.ordering === 'home') ?? teams[0];
  const away =
    teams.find((t) => t.ordering === 'away') ??
    teams.find((t) => t.name !== home.name) ??
    teams[1];

  if (!home || !away) return null;

  const eventId = String(event.id);
  const markets = event.markets ?? [];

  return {
    id: eventId,
    sourceProvider: 'POLYMARKET',
    category: 'mlb-games',
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
        id: `${eventId}:away`,
        side: 'away',
        label: away.name,
        ...findLegPrices(markets, 'away', home.name, away.name),
      },
    ],
  };
};

// ─── route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/api/mlb-markets')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const queryFrom = parseDateParam(url.searchParams.get('dateFrom'));
        const queryTo = parseDateParam(url.searchParams.get('dateTo'));

        // Fetch from both MLB-specific and baseball tags in parallel.
        const [mlbRes, baseballRes] = await Promise.all([
          fetch(
            'https://gamma-api.polymarket.com/events?limit=200&active=true&closed=false&tag_slug=mlb'
          ),
          fetch(
            'https://gamma-api.polymarket.com/events?limit=200&active=true&closed=false&tag_slug=baseball'
          ),
        ]);

        const mlbEvents: PolymarketEvent[] = mlbRes.ok
          ? ((await mlbRes.json()) as PolymarketEvent[])
          : [];

        const baseballEvents: PolymarketEvent[] = baseballRes.ok
          ? ((await baseballRes.json()) as PolymarketEvent[])
          : [];

        // Merge, deduplicating by event ID.
        const mlbIds = new Set(mlbEvents.map((e) => String(e.id)));
        const filteredBaseball = baseballEvents.filter(
          (e) => !mlbIds.has(String(e.id)) && isMlbEvent(e)
        );

        const allEvents = [...mlbEvents, ...filteredBaseball];

        const defaultWindow = getWindow();
        const from = queryFrom ?? defaultWindow.from;
        const to = queryTo ?? defaultWindow.to;

        const markets = allEvents
          .filter((e) => inWindow(e.endDate, from, to))
          .map(toMlbMarketItem)
          .filter((m): m is MlbMarketItem => m !== null)
          .slice(0, 24);

        return Response.json({ markets });
      },
    },
  },
});
