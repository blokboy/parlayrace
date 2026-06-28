import { createFileRoute } from '@tanstack/react-router';

type PolymarketMarket = {
  id: string | number;
  question: string;
  outcomes?: string;
  outcomePrices?: string;
  updatedAt?: string;
};

type MarketDetailPayload = {
  marketId: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  updatedAt: string | null;
};

const parseJsonArray = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as string[];
    return Array.isArray(parsed) ? parsed : [];
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
  const q = question.toLowerCase();
  const home = homeTeam.toLowerCase();
  const away = awayTeam.toLowerCase();

  if (q.includes('draw')) {
    return 'draw';
  }

  for (const keyword of WIN_KEYWORDS) {
    const keywordIdx = q.indexOf(keyword);
    if (keywordIdx < 0) {
      continue;
    }

    // Find the rightmost occurrence of each team name BEFORE the keyword —
    // that team is the subject of the win clause.
    const homeIdx = q.lastIndexOf(home, keywordIdx - 1);
    const awayIdx = q.lastIndexOf(away, keywordIdx - 1);

    if (homeIdx >= 0 && (awayIdx < 0 || homeIdx > awayIdx)) {
      return 'home';
    }
    if (awayIdx >= 0 && (homeIdx < 0 || awayIdx > homeIdx)) {
      return 'away';
    }
  }

  // Fallback: whichever team appears first in the question is the winner
  // (handles formats like "[Team A] vs [Team B]" where Team A is the subject).
  const firstHome = q.indexOf(home);
  const firstAway = q.indexOf(away);
  if (firstHome >= 0 && firstAway >= 0) {
    return firstHome < firstAway ? 'home' : 'away';
  }

  return null;
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
  // Prefer the /markets endpoint — it reliably includes outcomePrices.
  const marketsRes = await fetch(
    `https://gamma-api.polymarket.com/markets?event_id=${encodeURIComponent(eventId)}&limit=20`
  );

  if (marketsRes.ok) {
    const data = (await marketsRes.json()) as PolymarketMarket[];
    if (Array.isArray(data) && data.length > 0) {
      return data;
    }
  }

  // Fallback: fetch the event and extract embedded markets.
  const eventRes = await fetch(
    `https://gamma-api.polymarket.com/events/${encodeURIComponent(eventId)}`
  );

  if (!eventRes.ok) {
    return [];
  }

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
