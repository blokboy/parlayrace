import { db } from '@starter/backend/db';
import { createFileRoute } from '@tanstack/react-router';

type MarketLeg = {
  id: string;
  side: 'home' | 'away';
  label: string;
  yesPrice: number;
  noPrice: number;
};

type TeamBranding = {
  logo: string;
  color: string | null;
};

type MlbMarketItem = {
  id: string;
  sourceProvider: 'POLYMARKET';
  category: 'mlb-games';
  matchup: string;
  kickoff: string;
  homeTeam: string;
  awayTeam: string;
  homeBranding: TeamBranding;
  awayBranding: TeamBranding;
  legs: MarketLeg[];
};

const roundToCents = (n: number) => Math.round(n * 100) / 100;

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

// 8-day window (today + next 7). Kept in sync with SYNC_WINDOW_DAYS in
// server/polymarket/sync.ts so the dashboard never asks for unsynced days.
const getWindow = () => {
  const now = new Date();
  const from = startOfDayUtc(now);
  const last = new Date(from);
  last.setUTCDate(last.getUTCDate() + 7);
  return { from, to: endOfDayUtc(last) };
};

const parseDateParam = (value: string | null): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// ─── route ───────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/api/mlb-markets')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const queryFrom = parseDateParam(url.searchParams.get('dateFrom'));
        const queryTo = parseDateParam(url.searchParams.get('dateTo'));

        const defaultWindow = getWindow();
        const from = queryFrom ?? defaultWindow.from;
        const to = queryTo ?? defaultWindow.to;

        // Each MLB event persists a single moneyline sub-market whose two
        // outcomes are the team names (home/away win probabilities).
        const marketRows = await db.query.externalMarket.findMany({
          where: (t, { and, eq, gte, lte }) =>
            and(
              eq(t.sourceProvider, 'POLYMARKET'),
              eq(t.category, 'mlb-games'),
              gte(t.closeTime, from),
              lte(t.closeTime, to)
            ),
          columns: {
            id: true,
            sourceEventId: true,
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
          return Response.json({ markets: [] as MlbMarketItem[] });
        }

        const marketIds = marketRows.map((m) => m.id);

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

        // Newest-first; keep the first (latest) price seen per outcome.
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

        // For a moneyline market the outcome labels are the team names, so a
        // team's price is its own outcome's latest snapshot.
        const teamPrice = (marketDbId: string, team: string): number => {
          const outcomes = outcomesByMarket.get(marketDbId) ?? [];
          const match = outcomes.find(
            (o) => o.label.toLowerCase() === team.toLowerCase()
          );
          const price = match ? latestPriceByOutcome.get(match.id) : undefined;
          return Number.isFinite(price) ? (price as number) : 0.5;
        };

        const markets: MlbMarketItem[] = marketRows
          .filter((row) => row.sourceEventId && row.homeTeam && row.awayTeam)
          .map((row) => {
            const eventId = row.sourceEventId as string;
            const homeTeam = row.homeTeam as string;
            const awayTeam = row.awayTeam as string;

            const homeYes = roundToCents(teamPrice(row.id, homeTeam));
            const awayYes = roundToCents(teamPrice(row.id, awayTeam));

            return {
              id: eventId,
              sourceProvider: 'POLYMARKET' as const,
              category: 'mlb-games' as const,
              matchup: `${homeTeam} vs ${awayTeam}`,
              kickoff: row.closeTime ? row.closeTime.toISOString() : '',
              homeTeam,
              awayTeam,
              homeBranding: { logo: row.homeLogo ?? '', color: row.homeColor ?? null },
              awayBranding: { logo: row.awayLogo ?? '', color: row.awayColor ?? null },
              legs: [
                {
                  id: `${eventId}:home`,
                  side: 'home' as const,
                  label: homeTeam,
                  yesPrice: homeYes,
                  noPrice: roundToCents(Math.max(0, Math.min(1, 1 - homeYes))),
                },
                {
                  id: `${eventId}:away`,
                  side: 'away' as const,
                  label: awayTeam,
                  yesPrice: awayYes,
                  noPrice: roundToCents(Math.max(0, Math.min(1, 1 - awayYes))),
                },
              ],
            };
          })
          .sort((a, b) => a.kickoff.localeCompare(b.kickoff))
          .slice(0, 100);

        return Response.json({ markets });
      },
    },
  },
});
