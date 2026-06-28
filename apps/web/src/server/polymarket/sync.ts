import { db } from '@starter/backend/db';
import {
  externalMarket,
  externalOutcome,
  externalPriceSnapshot,
  providerSyncRun,
} from '@starter/backend/schema';
import { createHash } from 'node:crypto';

type PolymarketToken = { outcome: string; price: number };

type PolymarketMarket = {
  id: string | number;
  question: string;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  tokens?: PolymarketToken[];
  updatedAt?: string;
  endDate?: string;
  active?: boolean;
  closed?: boolean;
};

type PolymarketEvent = {
  id: string | number;
  title: string;
  startDate: string;
  endDate: string;
  slug?: string;
  seriesSlug?: string;
  markets?: PolymarketMarket[];
  active?: boolean;
  closed?: boolean;
};

type EnrichedMarket = PolymarketMarket & {
  __eventTitle: string;
  __eventSlug: string;
  __eventEndDate: string;
};

const WIN_TITLE_REGEX = /\b(to win|beat|wins|will win|defeat)\b/i;
const DRAW_TITLE_REGEX = /\bdraw\b/i;

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

const extractTokenPrices = (market: PolymarketMarket): PolymarketToken[] => {
  if (market.tokens && market.tokens.length > 0) {
    return market.tokens;
  }

  const outcomes = parseJsonArray(market.outcomes);
  const prices = parseJsonArray(market.outcomePrices).map(Number);

  if (outcomes.length === 0) return [];

  return outcomes.map((outcome, i) => ({
    outcome,
    price: Number.isFinite(prices[i]) ? prices[i] : 0.5,
  }));
};

const isMatchResultMarket = (market: PolymarketMarket): boolean =>
  WIN_TITLE_REGEX.test(market.question) || DRAW_TITLE_REGEX.test(market.question);

const startOfDayUtc = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

const isCloseTimeTodayOrTomorrow = (isoDate: string | undefined): boolean => {
  if (!isoDate) return false;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  const today = startOfDayUtc(now);
  const dayAfterTomorrow = new Date(today);
  dayAfterTomorrow.setUTCDate(dayAfterTomorrow.getUTCDate() + 2);
  return d >= today && d < dayAfterTomorrow;
};

// Scrape polymarket.com/sports/world-cup/games for game slugs, then fetch
// each slug from the Gamma events API. Falls back to tag pagination.
export const fetchWorldCupGameEvents = async (limit = 1000): Promise<PolymarketEvent[]> => {
  let slugs: string[] = [];

  try {
    const scrapeRes = await fetch('https://polymarket.com/sports/world-cup/games', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (scrapeRes.ok) {
      const html = await scrapeRes.text();
      const matches = html.matchAll(/\/sports\/world-cup\/([a-z0-9-]+)/gi);
      slugs = Array.from(new Set([...matches].map((m) => m[1])));
    }
  } catch {
    // ignore scrape errors — fall through to pagination
  }

  if (slugs.length > 0) {
    const settled = await Promise.allSettled(
      slugs.map(async (slug) => {
        const res = await fetch(
          `https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`
        );
        if (!res.ok) return [] as PolymarketEvent[];
        const data = (await res.json()) as PolymarketEvent | PolymarketEvent[];
        return Array.isArray(data) ? data : [data];
      })
    );

    const events = settled
      .filter(
        (r): r is PromiseFulfilledResult<PolymarketEvent[]> => r.status === 'fulfilled'
      )
      .flatMap((r) => r.value);

    if (events.length > 0) {
      return events.slice(0, limit);
    }
  }

  // Fallback: paginate the world-cup tag with offset.
  const pageSize = 100;
  const pages = Math.max(1, Math.ceil(limit / pageSize));
  const allEvents: PolymarketEvent[] = [];

  for (let page = 0; page < pages; page++) {
    const offset = page * pageSize;
    const res = await fetch(
      `https://gamma-api.polymarket.com/events?limit=${pageSize}&offset=${offset}&tag_slug=world-cup`,
      { headers: { 'Content-Type': 'application/json' } }
    );
    if (!res.ok) break;

    const data = (await res.json()) as PolymarketEvent[];
    const events = Array.isArray(data) ? data : [];
    if (events.length === 0) break;

    allEvents.push(...events);
    if (events.length < pageSize) break;
  }

  return allEvents;
};

export const syncPolyMarketMarkets = async (
  opts: { limit?: number; batchSize?: number } = {}
): Promise<{ synced: boolean; count: number; attempted: number }> => {
  const { limit = 50, batchSize = 25 } = opts;
  const startedAt = new Date();
  let runId = '';
  let attemptedCount = 0;
  let successCount = 0;
  let failureCount = 0;

  try {
    const [run] = await db
      .insert(providerSyncRun)
      .values({
        sourceProvider: 'POLYMARKET',
        jobType: 'FULL',
        status: 'RUNNING',
        startedAt,
      })
      .returning({ id: providerSyncRun.id });

    runId = run.id;
  } catch {
    // If we can't write the sync run, proceed anyway without tracking
  }

  try {
    const rawEvents = await fetchWorldCupGameEvents(limit);

    // Flatten markets from qualifying events, injecting event metadata
    const enrichedMarkets: EnrichedMarket[] = rawEvents.flatMap((event) => {
      if (!isCloseTimeTodayOrTomorrow(event.endDate)) return [];
      return (event.markets ?? [])
        .filter(isMatchResultMarket)
        .map((market) => ({
          ...market,
          __eventTitle: event.title,
          __eventSlug: event.slug ?? '',
          __eventEndDate: event.endDate,
        }));
    });

    attemptedCount = enrichedMarkets.length;

    // ── Catalog + Status job ────────────────────────────────────────────────
    for (let i = 0; i < enrichedMarkets.length; i += batchSize) {
      const batch = enrichedMarkets.slice(i, i + batchSize);

      for (const market of batch) {
        try {
          const sourceMarketId = String(market.id);
          const marketStatus: 'OPEN' | 'CLOSED' =
            market.closed === true || market.active === false ? 'CLOSED' : 'OPEN';
          const closeTime = market.endDate
            ? new Date(market.endDate)
            : new Date(market.__eventEndDate);

          const [upserted] = await db
            .insert(externalMarket)
            .values({
              sourceProvider: 'POLYMARKET',
              sourceMarketId,
              title: market.question,
              description: market.__eventTitle,
              category: 'fifa-games',
              status: marketStatus,
              closeTime,
            })
            .onConflictDoUpdate({
              target: [externalMarket.sourceProvider, externalMarket.sourceMarketId],
              set: {
                title: market.question,
                description: market.__eventTitle,
                status: marketStatus,
                closeTime,
                updatedAt: new Date(),
              },
            })
            .returning({ id: externalMarket.id });

          // Upsert outcomes — no unique constraint so query first
          const tokens = extractTokenPrices(market);
          if (tokens.length > 0) {
            const existingOutcomes = await db.query.externalOutcome.findMany({
              where: (t, { eq: equals }) => equals(t.marketId, upserted.id),
              columns: { id: true, label: true },
            });
            const existingLabels = new Set(existingOutcomes.map((o) => o.label));
            const newOutcomes = tokens.filter((t) => !existingLabels.has(t.outcome));

            if (newOutcomes.length > 0) {
              await db.insert(externalOutcome).values(
                newOutcomes.map((t) => ({
                  marketId: upserted.id,
                  label: t.outcome,
                  externalId: `${sourceMarketId}:${t.outcome}`,
                }))
              );
            }
          }

          successCount++;
        } catch {
          failureCount++;
        }
      }
    }

    // ── Odds Snapshot job ───────────────────────────────────────────────────
    const now = new Date();

    for (let i = 0; i < enrichedMarkets.length; i += batchSize) {
      const batch = enrichedMarkets.slice(i, i + batchSize);

      for (const market of batch) {
        try {
          const sourceMarketId = String(market.id);

          const marketRow = await db.query.externalMarket.findFirst({
            where: (t, { and, eq: equals }) =>
              and(
                equals(t.sourceProvider, 'POLYMARKET'),
                equals(t.sourceMarketId, sourceMarketId)
              ),
            columns: { id: true },
          });

          if (!marketRow) continue;

          const outcomeRows = await db.query.externalOutcome.findMany({
            where: (t, { eq: equals }) => equals(t.marketId, marketRow.id),
            columns: { id: true, label: true },
          });

          const tokens = extractTokenPrices(market);

          for (const token of tokens) {
            const outcomeRow = outcomeRows.find((o) => o.label === token.outcome);
            if (!outcomeRow) continue;

            const price = Math.max(0, Math.min(1, token.price));
            const hash = createHash('md5')
              .update(JSON.stringify({ sourceMarketId, outcome: token.outcome, price }))
              .digest('hex');

            await db.insert(externalPriceSnapshot).values({
              marketId: marketRow.id,
              outcomeId: outcomeRow.id,
              sourceProvider: 'POLYMARKET',
              probability: String(price),
              price: String(price),
              timestamp: now,
              fetchedAt: now,
              payloadHash: hash,
            });
          }
        } catch {
          // ignore per-market snapshot errors
        }
      }
    }

    // Update sync run to final status
    if (runId) {
      const finishedAt = new Date();
      const finalStatus =
        attemptedCount === 0
          ? 'FAILURE'
          : failureCount === 0
            ? 'SUCCESS'
            : 'PARTIAL_FAILURE';

      await db
        .insert(providerSyncRun)
        .values({
          id: runId,
          sourceProvider: 'POLYMARKET',
          jobType: 'FULL',
          status: finalStatus,
          startedAt,
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          attemptedCount,
          successCount,
          failureCount,
        })
        .onConflictDoUpdate({
          target: providerSyncRun.id,
          set: {
            status: finalStatus,
            finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            attemptedCount,
            successCount,
            failureCount,
          },
        });
    }

    return { synced: true, count: successCount, attempted: attemptedCount };
  } catch (error) {
    if (runId) {
      const finishedAt = new Date();
      await db
        .insert(providerSyncRun)
        .values({
          id: runId,
          sourceProvider: 'POLYMARKET',
          jobType: 'FULL',
          status: 'FAILURE',
          startedAt,
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          attemptedCount,
          successCount,
          failureCount,
          errorMessage: error instanceof Error ? error.message : String(error),
        })
        .onConflictDoUpdate({
          target: providerSyncRun.id,
          set: {
            status: 'FAILURE',
            finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        });
    }

    return { synced: false, count: 0, attempted: 0 };
  }
};
