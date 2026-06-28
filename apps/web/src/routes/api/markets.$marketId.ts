import { createFileRoute } from '@tanstack/react-router';

type PolymarketMarket = {
  id: string | number;
  question: string;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  updatedAt?: string;
};

type MarketDetailPayload = {
  marketId: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  updatedAt: string | null;
};

const parseJsonArray = (value: string | string[] | null | undefined): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as unknown[]).map(String) : [];
  } catch {
    return [];
  }
};

const roundToCents = (value: number) => Math.round(value * 100) / 100;

const toPricePair = (
  market: PolymarketMarket
): { yesPrice: number; noPrice: number } => {
  const outcomes = parseJsonArray(market.outcomes);
  const outcomePrices = parseJsonArray(market.outcomePrices).map((item) =>
    Number(item)
  );

  if (outcomes.length === 0 || outcomePrices.length === 0) {
    return { yesPrice: 0.5, noPrice: 0.5 };
  }

  const yesIndex = outcomes.findIndex(
    (outcome) => outcome.toLowerCase() === 'yes'
  );
  const yesPriceRaw =
    yesIndex >= 0 ? outcomePrices[yesIndex] : outcomePrices[0];
  const yesPrice = Number.isFinite(yesPriceRaw) ? yesPriceRaw : 0.5;
  const noPrice = Math.max(0, Math.min(1, 1 - yesPrice));

  return {
    yesPrice: roundToCents(yesPrice),
    noPrice: roundToCents(noPrice),
  };
};

// WIN_KEYWORDS are searched left-to-right; whichever team name appears
// last before the keyword is the predicted winner in that market.
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

  // Polymarket often labels markets with just the outcome ("Algeria", "Draw").
  // When only one team name is present the whole question IS that team's market.
  if (hasHome && !hasAway) return 'home';
  if (hasAway && !hasHome) return 'away';

  if (!hasHome && !hasAway) {
    return q.includes('draw') ? 'draw' : null;
  }

  // Both teams present → full-sentence question; keyword / position matching.
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

const pickMarketForSide = (
  markets: PolymarketMarket[],
  side: string,
  homeTeam: string,
  awayTeam: string
): PolymarketMarket | null => {
  if (markets.length === 0) {
    return null;
  }

  const target = side as 'home' | 'away' | 'draw';

  const match = markets.find(
    (market) =>
      classifyMarket(market.question, homeTeam, awayTeam) === target
  );

  return match ?? markets[0] ?? null;
};

const fetchMarketsForEvent = async (
  eventId: string
): Promise<PolymarketMarket[]> => {
  // Use the single-event endpoint — it is event-scoped and reliably returns
  // embedded markets with outcomePrices for that specific event.
  const eventRes = await fetch(
    `https://gamma-api.polymarket.com/events/${encodeURIComponent(eventId)}`
  );

  if (!eventRes.ok) return [];

  const event = (await eventRes.json()) as { markets?: PolymarketMarket[] };
  return event.markets ?? [];
};

export const Route = createFileRoute('/api/markets/$marketId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const marketId = params.marketId;
        const url = new URL(request.url);
        const side = url.searchParams.get('side') ?? 'home';
        const homeTeam = url.searchParams.get('homeTeam') ?? '';
        const awayTeam = url.searchParams.get('awayTeam') ?? '';

        const markets = await fetchMarketsForEvent(marketId);

        if (markets.length === 0) {
          return Response.json(
            {
              marketId,
              question: 'Price unavailable',
              yesPrice: 0.5,
              noPrice: 0.5,
              updatedAt: null,
            } satisfies MarketDetailPayload,
            { status: 200 }
          );
        }

        const selectedMarket = pickMarketForSide(
          markets,
          side,
          homeTeam,
          awayTeam
        );

        if (!selectedMarket) {
          return Response.json(
            {
              marketId,
              question: 'Price unavailable',
              yesPrice: 0.5,
              noPrice: 0.5,
              updatedAt: null,
            } satisfies MarketDetailPayload,
            { status: 200 }
          );
        }

        const prices = toPricePair(selectedMarket);

        return Response.json({
          marketId: String(selectedMarket.id),
          question: selectedMarket.question,
          yesPrice: prices.yesPrice,
          noPrice: prices.noPrice,
          updatedAt: selectedMarket.updatedAt ?? null,
        } satisfies MarketDetailPayload);
      },
    },
  },
});
