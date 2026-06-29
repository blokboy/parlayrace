import { db } from '@starter/backend/db';
import { createFileRoute } from '@tanstack/react-router';

type MarketDetailPayload = {
  marketId: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  updatedAt: string | null;
  category: string | null;
};

const roundToCents = (value: number) => Math.round(value * 100) / 100;

const priceUnavailable = (
  marketId: string,
  category: string | null = null
): MarketDetailPayload => ({
  marketId,
  question: 'Price unavailable',
  yesPrice: 0.5,
  noPrice: 0.5,
  updatedAt: null,
  category,
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
      // marketId is the persisted sourceEventId. Two shapes share this route:
      //   FIFA  — three binary sub-markets (Yes/No); price = the side's Yes.
      //   MLB   — one moneyline sub-market whose outcomes are the team names;
      //           price = the side's team outcome.
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
              eq(t.sourceEventId, marketId)
            ),
          columns: {
            id: true,
            sourceMarketId: true,
            title: true,
            homeTeam: true,
            awayTeam: true,
            category: true,
          },
        });

        if (rows.length === 0) {
          return Response.json(priceUnavailable(marketId), { status: 200 });
        }

        const category = rows[0].category ?? null;

        // Prefer the team names from the query string, falling back to stored.
        const homeTeam =
          url.searchParams.get('homeTeam') ?? rows[0].homeTeam ?? '';
        const awayTeam =
          url.searchParams.get('awayTeam') ?? rows[0].awayTeam ?? '';
        const targetTeam =
          side === 'home' ? homeTeam : side === 'away' ? awayTeam : '';

        // All outcomes for the event's sub-market(s), with latest prices.
        const outcomes = await db.query.externalOutcome.findMany({
          where: (t, { inArray }) =>
            inArray(
              t.marketId,
              rows.map((r) => r.id)
            ),
          columns: { id: true, marketId: true, label: true },
        });

        const latestForOutcome = async (outcomeId: string) =>
          db.query.externalPriceSnapshot.findFirst({
            where: (t, { eq }) => eq(t.outcomeId, outcomeId),
            orderBy: (t, { desc }) => desc(t.fetchedAt),
            columns: { price: true, fetchedAt: true },
          });

        // MLB moneyline: an outcome labeled with the side's team name.
        const moneylineOutcome =
          targetTeam.length > 0
            ? outcomes.find(
                (o) => o.label.toLowerCase() === targetTeam.toLowerCase()
              )
            : undefined;

        let priceOutcomeId: string | undefined;
        let selected = rows[0];

        if (moneylineOutcome) {
          priceOutcomeId = moneylineOutcome.id;
          selected =
            rows.find((r) => r.id === moneylineOutcome.marketId) ?? rows[0];
        } else {
          // FIFA: pick the sub-market for this side, then its Yes outcome.
          selected =
            rows.find(
              (r) => classifyMarket(r.title, homeTeam, awayTeam) === side
            ) ?? rows[0];
          const marketOutcomes = outcomes.filter(
            (o) => o.marketId === selected.id
          );
          priceOutcomeId = (
            marketOutcomes.find((o) => o.label.toLowerCase() === 'yes') ??
            marketOutcomes[0]
          )?.id;
        }

        if (!priceOutcomeId) {
          return Response.json(
            priceUnavailable(selected.sourceMarketId, category),
            { status: 200 }
          );
        }

        const latest = await latestForOutcome(priceOutcomeId);
        const yesPriceRaw = latest ? Number(latest.price) : 0.5;
        const yesPrice = Number.isFinite(yesPriceRaw) ? yesPriceRaw : 0.5;
        const noPrice = Math.max(0, Math.min(1, 1 - yesPrice));

        return Response.json({
          marketId: selected.sourceMarketId,
          question: selected.title,
          yesPrice: roundToCents(yesPrice),
          noPrice: roundToCents(noPrice),
          updatedAt: latest ? latest.fetchedAt.toISOString() : null,
          category,
        } satisfies MarketDetailPayload);
      },
    },
  },
});
