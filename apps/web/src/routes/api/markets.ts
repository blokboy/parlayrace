import { db } from '@starter/backend/db';
import { createFileRoute } from '@tanstack/react-router';

type MarketLeg = {
  id: string;
  side: 'home' | 'draw' | 'away';
  label: string;
  yesPrice: number;
  noPrice: number;
};

type TeamBranding = {
  logo: string;
  color: string | null;
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
  homeBranding: TeamBranding;
  awayBranding: TeamBranding;
};

// One persisted sub-market row joined to its latest Yes/No price.
type SubMarket = {
  sourceMarketId: string;
  title: string;
  yesPrice: number;
  noPrice: number;
};

// ─── price helpers ───────────────────────────────────────────────────────────

const roundToCents = (n: number) => Math.round(n * 100) / 100;

// ─── market classification ───────────────────────────────────────────────────
// Determines which side (home win / draw / away win) a Polymarket sub-market
// represents by inspecting its question text against the two team names.

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

const legPriceForSide = (
  subMarkets: SubMarket[],
  side: 'home' | 'draw' | 'away',
  homeTeam: string,
  awayTeam: string
): { yesPrice: number; noPrice: number } => {
  const match = subMarkets.find(
    (m) => classifyMarket(m.title, homeTeam, awayTeam) === side
  );
  return match
    ? { yesPrice: match.yesPrice, noPrice: match.noPrice }
    : { yesPrice: 0.5, noPrice: 0.5 };
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

        const defaultWindow = getWindow();
        const from = queryFrom ?? defaultWindow.from;
        const to = queryTo ?? defaultWindow.to;

        // 1. Persisted sub-markets in the requested close-time window.
        const marketRows = await db.query.externalMarket.findMany({
          where: (t, { and, eq, gte, lte }) =>
            and(
              eq(t.sourceProvider, 'POLYMARKET'),
              eq(t.category, 'fifa-games'),
              gte(t.closeTime, from),
              lte(t.closeTime, to)
            ),
          columns: {
            id: true,
            sourceMarketId: true,
            sourceEventId: true,
            eventSlug: true,
            title: true,
            homeTeam: true,
            awayTeam: true,
            homeLogo: true,
            homeColor: true,
            awayLogo: true,
            awayColor: true,
            closeTime: true,
          },
        });

        if (marketRows.length === 0) {
          return Response.json({ markets: [] as MarketItem[] });
        }

        const marketIds = marketRows.map((m) => m.id);

        // 2. Outcomes + 3. latest price snapshot per outcome, in parallel.
        const [outcomeRows, snapshotRows] = await Promise.all([
          db.query.externalOutcome.findMany({
            where: (t, { inArray }) => inArray(t.marketId, marketIds),
            columns: { id: true, marketId: true, label: true },
          }),
          db.query.externalPriceSnapshot.findMany({
            where: (t, { inArray }) => inArray(t.marketId, marketIds),
            orderBy: (t, { desc }) => desc(t.fetchedAt),
            columns: { outcomeId: true, price: true },
          }),
        ]);

        // Snapshots arrive newest-first; keep the first price seen per outcome.
        const latestPriceByOutcome = new Map<string, number>();
        for (const snap of snapshotRows) {
          if (!latestPriceByOutcome.has(snap.outcomeId)) {
            latestPriceByOutcome.set(snap.outcomeId, Number(snap.price));
          }
        }

        const outcomesByMarket = new Map<string, typeof outcomeRows>();
        for (const outcome of outcomeRows) {
          const list = outcomesByMarket.get(outcome.marketId) ?? [];
          list.push(outcome);
          outcomesByMarket.set(outcome.marketId, list);
        }

        // Resolve each sub-market's Yes price from its latest snapshot.
        const yesPriceForMarket = (marketDbId: string): number => {
          const outcomes = outcomesByMarket.get(marketDbId) ?? [];
          if (outcomes.length === 0) return 0.5;
          const yesOutcome =
            outcomes.find((o) => o.label.toLowerCase() === 'yes') ?? outcomes[0];
          const price = latestPriceByOutcome.get(yesOutcome.id);
          return Number.isFinite(price) ? (price as number) : 0.5;
        };

        // 4. Group sub-markets into match cards by event.
        const groups = new Map<
          string,
          {
            sourceEventId: string;
            eventSlug: string | null;
            homeTeam: string;
            awayTeam: string;
            homeBranding: TeamBranding;
            awayBranding: TeamBranding;
            kickoff: string;
            subMarkets: SubMarket[];
          }
        >();

        for (const row of marketRows) {
          const eventId = row.sourceEventId;
          // Without an event id we can't assemble a three-option card.
          if (!eventId || !row.homeTeam || !row.awayTeam) continue;

          const yesPrice = roundToCents(yesPriceForMarket(row.id));
          const noPrice = roundToCents(Math.max(0, Math.min(1, 1 - yesPrice)));

          const existing = groups.get(eventId);
          const subMarket: SubMarket = {
            sourceMarketId: row.sourceMarketId,
            title: row.title,
            yesPrice,
            noPrice,
          };

          if (existing) {
            existing.subMarkets.push(subMarket);
            continue;
          }

          groups.set(eventId, {
            sourceEventId: eventId,
            eventSlug: row.eventSlug,
            homeTeam: row.homeTeam,
            awayTeam: row.awayTeam,
            homeBranding: { logo: row.homeLogo ?? '', color: row.homeColor ?? null },
            awayBranding: { logo: row.awayLogo ?? '', color: row.awayColor ?? null },
            kickoff: row.closeTime ? row.closeTime.toISOString() : '',
            subMarkets: [subMarket],
          });
        }

        const markets: MarketItem[] = [...groups.values()]
          .map((group) => {
            const { homeTeam, awayTeam, subMarkets } = group;
            return {
              id: group.sourceEventId,
              sourceProvider: 'POLYMARKET' as const,
              category: 'fifa-games' as const,
              matchup: `${homeTeam} vs ${awayTeam}`,
              kickoff: group.kickoff,
              homeTeam,
              awayTeam,
              homeBranding: group.homeBranding,
              awayBranding: group.awayBranding,
              legs: [
                {
                  id: `${group.sourceEventId}:home`,
                  side: 'home' as const,
                  label: homeTeam,
                  ...legPriceForSide(subMarkets, 'home', homeTeam, awayTeam),
                },
                {
                  id: `${group.sourceEventId}:draw`,
                  side: 'draw' as const,
                  label: 'Draw',
                  ...legPriceForSide(subMarkets, 'draw', homeTeam, awayTeam),
                },
                {
                  id: `${group.sourceEventId}:away`,
                  side: 'away' as const,
                  label: awayTeam,
                  ...legPriceForSide(subMarkets, 'away', homeTeam, awayTeam),
                },
              ] as [MarketLeg, MarketLeg, MarketLeg],
            };
          })
          .sort((a, b) => a.kickoff.localeCompare(b.kickoff))
          .slice(0, 24);

        return Response.json({ markets });
      },
    },
  },
});
