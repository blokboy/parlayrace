import { db } from '@starter/backend/db';
import { createFileRoute } from '@tanstack/react-router';

type MarketDetailPayload = {
  marketId: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  updatedAt: string | null;
};

const roundToCents = (value: number) => Math.round(value * 100) / 100;

const priceUnavailable = (marketId: string): MarketDetailPayload => ({
  marketId,
  question: 'Price unavailable',
  yesPrice: 0.5,
  noPrice: 0.5,
  updatedAt: null,
});

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

export const Route = createFileRoute('/api/markets/$marketId')({
  server: {
    handlers: {
      // marketId is the persisted sourceEventId; the three sub-markets of the
      // fixture share it. We pick the sub-market for `side`, then read its
      // latest Yes-outcome snapshot from the DB.
      GET: async ({ request, params }) => {
        const marketId = params.marketId;
        const url = new URL(request.url);
        const side = (url.searchParams.get('side') ?? 'home') as
          | 'home'
          | 'away'
          | 'draw';

        const rows = await db.query.externalMarket.findMany({
          where: (t, { and, eq }) =>
            and(
              eq(t.sourceProvider, 'POLYMARKET'),
              eq(t.category, 'fifa-games'),
              eq(t.sourceEventId, marketId)
            ),
          columns: {
            id: true,
            sourceMarketId: true,
            title: true,
            homeTeam: true,
            awayTeam: true,
          },
        });

        if (rows.length === 0) {
          return Response.json(priceUnavailable(marketId), { status: 200 });
        }

        // Prefer the team names from the query string, falling back to stored.
        const homeTeam =
          url.searchParams.get('homeTeam') ?? rows[0].homeTeam ?? '';
        const awayTeam =
          url.searchParams.get('awayTeam') ?? rows[0].awayTeam ?? '';

        const selected =
          rows.find((r) => classifyMarket(r.title, homeTeam, awayTeam) === side) ??
          rows[0];

        // Resolve the latest Yes price for the selected sub-market.
        const outcomes = await db.query.externalOutcome.findMany({
          where: (t, { eq }) => eq(t.marketId, selected.id),
          columns: { id: true, label: true },
        });

        const yesOutcome =
          outcomes.find((o) => o.label.toLowerCase() === 'yes') ?? outcomes[0];

        if (!yesOutcome) {
          return Response.json(priceUnavailable(selected.sourceMarketId), {
            status: 200,
          });
        }

        const latest = await db.query.externalPriceSnapshot.findFirst({
          where: (t, { eq }) => eq(t.outcomeId, yesOutcome.id),
          orderBy: (t, { desc }) => desc(t.fetchedAt),
          columns: { price: true, fetchedAt: true },
        });

        const yesPriceRaw = latest ? Number(latest.price) : 0.5;
        const yesPrice = Number.isFinite(yesPriceRaw) ? yesPriceRaw : 0.5;
        const noPrice = Math.max(0, Math.min(1, 1 - yesPrice));

        return Response.json({
          marketId: selected.sourceMarketId,
          question: selected.title,
          yesPrice: roundToCents(yesPrice),
          noPrice: roundToCents(noPrice),
          updatedAt: latest ? latest.fetchedAt.toISOString() : null,
        } satisfies MarketDetailPayload);
      },
    },
  },
});
