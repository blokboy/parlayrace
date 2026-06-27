import { createFileRoute } from '@tanstack/react-router';

type PolymarketMarket = {
  id: string | number;
  question: string;
  outcomes?: string;
  outcomePrices?: string;
  updatedAt?: string;
};

type PolymarketEvent = {
  id: string | number;
  title: string;
  markets?: PolymarketMarket[];
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

const includesNormalized = (source: string, query: string) =>
  source.toLowerCase().includes(query.toLowerCase());

const pickMarketForSide = (
  markets: PolymarketMarket[],
  side: string,
  homeTeam: string,
  awayTeam: string
): PolymarketMarket | null => {
  if (markets.length === 0) {
    return null;
  }

  if (side === 'draw') {
    const drawMarket = markets.find((market) =>
      includesNormalized(market.question, 'draw')
    );
    if (drawMarket) {
      return drawMarket;
    }
  }

  if (side === 'home') {
    const homeWinMarket = markets.find((market) => {
      return (
        includesNormalized(market.question, homeTeam) &&
        includesNormalized(market.question, awayTeam) &&
        includesNormalized(market.question, 'beat')
      );
    });
    if (homeWinMarket) {
      return homeWinMarket;
    }
  }

  if (side === 'away') {
    const awayWinMarket = markets.find((market) => {
      return (
        includesNormalized(market.question, awayTeam) &&
        includesNormalized(market.question, homeTeam) &&
        includesNormalized(market.question, 'beat')
      );
    });
    if (awayWinMarket) {
      return awayWinMarket;
    }
  }

  return markets[0] ?? null;
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

        const eventResponse = await fetch(
          `https://gamma-api.polymarket.com/events/${encodeURIComponent(marketId)}`
        );

        if (!eventResponse.ok) {
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

        const event = (await eventResponse.json()) as PolymarketEvent;
        const selectedMarket = pickMarketForSide(
          event.markets ?? [],
          side,
          homeTeam,
          awayTeam
        );

        if (!selectedMarket) {
          return Response.json(
            {
              marketId,
              question: event.title,
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
