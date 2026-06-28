import { db } from '@starter/backend/db';
import {
  externalMarket,
  externalOutcome,
  externalPriceSnapshot,
  providerDeadLetter,
  providerSyncRun,
} from '@starter/backend/schema';
import { and, eq, lt } from '@starter/backend/orm';
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

export type SyncPolyMarketOptions = {
  limit?: number;
  batchSize?: number;
  retryAttempts?: number;
  staleThresholdMinutes?: number;
  payloadVersion?: number;
};

type JobResult = {
  attempted: number;
  success: number;
  failed: number;
  deadLetters: number;
};

type CatalogMapEntry = {
  marketId: string;
  outcomes: { id: string; label: string }[];
};

export type SyncPolyMarketResult = {
  runId: string | null;
  sourceProvider: 'POLYMARKET';
  fetchedEvents: number;
  totalCandidates: number;
  jobs: {
    catalog: JobResult;
    odds: JobResult;
    status: JobResult;
  };
  observability: {
    lagSeconds: number;
    staleMarketCount: number;
    failureRate: number;
    providerHealthy: boolean;
  };
  durationMs: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

// Retry an async operation with linear backoff, re-throwing the last error.
const withRetry = async <T>(
  fn: () => Promise<T>,
  opts: { attempts: number }
): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < opts.attempts) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
  }
  throw lastError;
};

// Best-effort record of an item that could not be processed, for later replay.
const recordDeadLetter = async (args: {
  syncRunId: string;
  jobType: 'CATALOG' | 'ODDS' | 'STATUS';
  externalRef: string;
  reason: string;
  payload: unknown;
  payloadVersion: number;
}): Promise<void> => {
  try {
    const payloadHash = createHash('md5')
      .update(JSON.stringify(args.payload))
      .digest('hex');
    await db.insert(providerDeadLetter).values({
      sourceProvider: 'POLYMARKET',
      jobType: args.jobType,
      syncRunId: args.syncRunId,
      externalRef: args.externalRef,
      reason: args.reason,
      payload: args.payload as object,
      payloadHash,
      payloadVersion: args.payloadVersion,
    });
  } catch {
    // Dead-letter logging is best-effort; never let it break the sync.
  }
};

// Delete POLYMARKET FIFA markets whose close time is before today (UTC).
// Outcomes and price snapshots cascade via FK constraints.
const pruneOldPolymarketFifaMarkets = async (): Promise<number> => {
  const cutoff = startOfDayUtc(new Date());
  const deleted = await db
    .delete(externalMarket)
    .where(
      and(
        eq(externalMarket.sourceProvider, 'POLYMARKET'),
        eq(externalMarket.category, 'fifa-games'),
        lt(externalMarket.closeTime, cutoff)
      )
    )
    .returning({ id: externalMarket.id });
  return deleted.length;
};

// Upsert markets + their outcomes, returning a map keyed by sourceMarketId so
// downstream jobs can resolve DB ids without re-querying.
const runCatalogSync = async (args: {
  syncRunId: string;
  markets: EnrichedMarket[];
  batchSize: number;
  retryAttempts: number;
  payloadVersion: number;
}): Promise<{ result: JobResult; catalogMap: Map<string, CatalogMapEntry> }> => {
  const { syncRunId, markets, batchSize, retryAttempts, payloadVersion } = args;
  const catalogMap = new Map<string, CatalogMapEntry>();
  const result: JobResult = { attempted: 0, success: 0, failed: 0, deadLetters: 0 };

  for (let i = 0; i < markets.length; i += batchSize) {
    const batch = markets.slice(i, i + batchSize);

    for (const market of batch) {
      result.attempted++;
      const sourceMarketId = String(market.id);

      try {
        const marketStatus: 'OPEN' | 'CLOSED' =
          market.closed === true || market.active === false ? 'CLOSED' : 'OPEN';
        const closeTime = market.endDate
          ? new Date(market.endDate)
          : new Date(market.__eventEndDate);

        const [upserted] = await withRetry(
          () =>
            db
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
              .returning({ id: externalMarket.id }),
          { attempts: retryAttempts }
        );

        // Insert only outcome labels we haven't seen for this market yet.
        const tokens = extractTokenPrices(market);
        const outcomes = await db.query.externalOutcome.findMany({
          where: (t, { eq: equals }) => equals(t.marketId, upserted.id),
          columns: { id: true, label: true },
        });
        const existingLabels = new Set(outcomes.map((o) => o.label));
        const newOutcomes = tokens.filter((t) => !existingLabels.has(t.outcome));

        if (newOutcomes.length > 0) {
          const inserted = await db
            .insert(externalOutcome)
            .values(
              newOutcomes.map((t) => ({
                marketId: upserted.id,
                label: t.outcome,
                externalId: `${sourceMarketId}:${t.outcome}`,
              }))
            )
            .returning({ id: externalOutcome.id, label: externalOutcome.label });
          outcomes.push(...inserted);
        }

        catalogMap.set(sourceMarketId, { marketId: upserted.id, outcomes });
        result.success++;
      } catch (error) {
        result.failed++;
        result.deadLetters++;
        await recordDeadLetter({
          syncRunId,
          jobType: 'CATALOG',
          externalRef: sourceMarketId,
          reason: error instanceof Error ? error.message : 'catalog upsert failed',
          payload: market,
          payloadVersion,
        });
      }
    }
  }

  return { result, catalogMap };
};

// Append one price snapshot per outcome (snapshots are an append-only log).
const runOddsSnapshotSync = async (args: {
  syncRunId: string;
  markets: EnrichedMarket[];
  catalogMap: Map<string, CatalogMapEntry>;
  batchSize: number;
  retryAttempts: number;
  payloadVersion: number;
}): Promise<JobResult> => {
  const { syncRunId, markets, catalogMap, batchSize, retryAttempts, payloadVersion } =
    args;
  const result: JobResult = { attempted: 0, success: 0, failed: 0, deadLetters: 0 };
  const now = new Date();

  for (let i = 0; i < markets.length; i += batchSize) {
    const batch = markets.slice(i, i + batchSize);

    for (const market of batch) {
      const sourceMarketId = String(market.id);
      const entry = catalogMap.get(sourceMarketId);
      if (!entry) continue;

      const tokens = extractTokenPrices(market);
      for (const token of tokens) {
        const outcomeRow = entry.outcomes.find((o) => o.label === token.outcome);
        if (!outcomeRow) continue;

        result.attempted++;
        try {
          const price = Math.max(0, Math.min(1, token.price));
          const hash = createHash('md5')
            .update(
              JSON.stringify({ sourceMarketId, outcome: token.outcome, price, payloadVersion })
            )
            .digest('hex');

          await withRetry(
            () =>
              db.insert(externalPriceSnapshot).values({
                marketId: entry.marketId,
                outcomeId: outcomeRow.id,
                sourceProvider: 'POLYMARKET',
                probability: String(price),
                price: String(price),
                timestamp: now,
                fetchedAt: now,
                payloadHash: hash,
              }),
            { attempts: retryAttempts }
          );
          result.success++;
        } catch (error) {
          result.failed++;
          result.deadLetters++;
          await recordDeadLetter({
            syncRunId,
            jobType: 'ODDS',
            externalRef: `${sourceMarketId}:${token.outcome}`,
            reason: error instanceof Error ? error.message : 'odds snapshot failed',
            payload: { sourceMarketId, token },
            payloadVersion,
          });
        }
      }
    }
  }

  return result;
};

// Re-apply OPEN/CLOSED status (and resolveTime on close) as a discrete pass.
const runStatusTransitionSync = async (args: {
  syncRunId: string;
  markets: EnrichedMarket[];
  catalogMap: Map<string, CatalogMapEntry>;
  batchSize: number;
  retryAttempts: number;
  payloadVersion: number;
}): Promise<JobResult> => {
  const { syncRunId, markets, catalogMap, batchSize, retryAttempts, payloadVersion } =
    args;
  const result: JobResult = { attempted: 0, success: 0, failed: 0, deadLetters: 0 };

  for (let i = 0; i < markets.length; i += batchSize) {
    const batch = markets.slice(i, i + batchSize);

    for (const market of batch) {
      const sourceMarketId = String(market.id);
      const entry = catalogMap.get(sourceMarketId);
      if (!entry) continue;

      result.attempted++;
      try {
        const marketStatus: 'OPEN' | 'CLOSED' =
          market.closed === true || market.active === false ? 'CLOSED' : 'OPEN';
        const set: Record<string, unknown> = {
          status: marketStatus,
          updatedAt: new Date(),
        };
        if (marketStatus === 'CLOSED') {
          set.resolveTime = new Date();
        }

        await withRetry(
          () =>
            db
              .insert(externalMarket)
              .values({
                sourceProvider: 'POLYMARKET',
                sourceMarketId,
                title: market.question,
                category: 'fifa-games',
                status: marketStatus,
              })
              .onConflictDoUpdate({
                target: [externalMarket.sourceProvider, externalMarket.sourceMarketId],
                set,
              }),
          { attempts: retryAttempts }
        );
        result.success++;
      } catch (error) {
        result.failed++;
        result.deadLetters++;
        await recordDeadLetter({
          syncRunId,
          jobType: 'STATUS',
          externalRef: sourceMarketId,
          reason: error instanceof Error ? error.message : 'status transition failed',
          payload: { sourceMarketId, closed: market.closed, active: market.active },
          payloadVersion,
        });
      }
    }
  }

  return result;
};

// Lag = age of the freshest snapshot; stale = open markets whose latest snapshot
// is older than the threshold (or missing entirely).
const computeObservabilityMetrics = async (
  staleThresholdMinutes: number
): Promise<{ lagSeconds: number; staleMarketCount: number }> => {
  const now = Date.now();
  const staleBefore = new Date(now - staleThresholdMinutes * 60 * 1000);

  const openMarkets = await db.query.externalMarket.findMany({
    where: (t, { and: a, eq: e }) =>
      a(e(t.sourceProvider, 'POLYMARKET'), e(t.status, 'OPEN')),
    columns: { id: true },
  });

  if (openMarkets.length === 0) {
    return { lagSeconds: 0, staleMarketCount: 0 };
  }

  let latestFetchedAt: Date | null = null;
  let staleMarketCount = 0;

  for (const market of openMarkets) {
    const latest = await db.query.externalPriceSnapshot.findFirst({
      where: (t, { eq: e }) => e(t.marketId, market.id),
      orderBy: (t, { desc: d }) => d(t.fetchedAt),
      columns: { fetchedAt: true },
    });

    if (!latest) {
      staleMarketCount++;
      continue;
    }
    if (!latestFetchedAt || latest.fetchedAt > latestFetchedAt) {
      latestFetchedAt = latest.fetchedAt;
    }
    if (latest.fetchedAt < staleBefore) {
      staleMarketCount++;
    }
  }

  const lagSeconds = latestFetchedAt
    ? Math.max(0, Math.round((now - latestFetchedAt.getTime()) / 1000))
    : 0;

  return { lagSeconds, staleMarketCount };
};

// Healthy when data is fresh (< 15 min lag) and the run isn't error-heavy.
const computeProviderHealthIndicator = (
  lagSeconds: number,
  failureRate: number
): boolean => lagSeconds < 15 * 60 && failureRate < 0.25;

export const syncPolyMarketMarkets = async (
  options: SyncPolyMarketOptions = {}
): Promise<SyncPolyMarketResult> => {
  let syncRunId: string | null = null;
  const startedAt = new Date();

  try {
    const limit = clamp(options.limit ?? 50, 1, 500);
    const batchSize = clamp(options.batchSize ?? 25, 1, 250);
    const retryAttempts = clamp(options.retryAttempts ?? 3, 1, 6);
    const staleThresholdMinutes = clamp(options.staleThresholdMinutes ?? 30, 1, 180);
    const payloadVersion = options.payloadVersion ?? 1;

    const [run] = await db
      .insert(providerSyncRun)
      .values({
        sourceProvider: 'POLYMARKET',
        jobType: 'FULL',
        status: 'RUNNING',
        startedAt,
      })
      .returning({ id: providerSyncRun.id });
    syncRunId = run.id;

    console.log(
      `Syncing PolyMarket jobs (runId: ${syncRunId}, limit: ${limit}, batchSize: ${batchSize})...`
    );

    const prunedMarkets = await pruneOldPolymarketFifaMarkets();
    if (prunedMarkets > 0) {
      console.log(`Pruned ${prunedMarkets} old PolyMarket FIFA market records before sync.`);
    }

    const events = await withRetry(() => fetchWorldCupGameEvents(limit), {
      attempts: retryAttempts,
    });

    // Flatten markets from qualifying events, injecting event metadata.
    const markets: EnrichedMarket[] = events
      .filter((event) => isCloseTimeTodayOrTomorrow(event.endDate))
      .flatMap((event) =>
        (event.markets ?? []).map((market) => ({
          ...market,
          __eventTitle: event.title,
          __eventSlug: event.slug ?? '',
          __eventEndDate: event.endDate,
        }))
      )
      .filter((market) => isMatchResultMarket(market))
      .slice(0, limit);

    const catalog = await runCatalogSync({
      syncRunId,
      markets,
      batchSize,
      retryAttempts,
      payloadVersion,
    });
    const odds = await runOddsSnapshotSync({
      syncRunId,
      markets,
      catalogMap: catalog.catalogMap,
      batchSize,
      retryAttempts,
      payloadVersion,
    });
    const status = await runStatusTransitionSync({
      syncRunId,
      markets,
      catalogMap: catalog.catalogMap,
      batchSize,
      retryAttempts,
      payloadVersion,
    });

    const attemptedCount =
      catalog.result.attempted + odds.attempted + status.attempted;
    const successCount = catalog.result.success + odds.success + status.success;
    const failureCount = catalog.result.failed + odds.failed + status.failed;
    const failureRate = attemptedCount > 0 ? failureCount / attemptedCount : 0;
    const deadLetters =
      catalog.result.deadLetters + odds.deadLetters + status.deadLetters;

    const observability = await computeObservabilityMetrics(staleThresholdMinutes);
    const providerHealthy = computeProviderHealthIndicator(
      observability.lagSeconds,
      failureRate
    );

    const statusForRun =
      attemptedCount === 0
        ? 'FAILURE'
        : failureCount === 0
          ? 'SUCCESS'
          : successCount === 0
            ? 'FAILURE'
            : 'PARTIAL_FAILURE';

    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const metadata = {
      limit,
      batchSize,
      retryAttempts,
      staleThresholdMinutes,
      payloadVersion,
      deadLetters,
    };

    await db
      .insert(providerSyncRun)
      .values({
        id: syncRunId,
        sourceProvider: 'POLYMARKET',
        jobType: 'FULL',
        status: statusForRun,
        startedAt,
        finishedAt,
        durationMs,
        attemptedCount,
        successCount,
        failureCount,
        lagSeconds: observability.lagSeconds,
        staleMarketCount: observability.staleMarketCount,
        errorRate: String(failureRate),
        metadata,
      })
      .onConflictDoUpdate({
        target: providerSyncRun.id,
        set: {
          status: statusForRun,
          finishedAt,
          durationMs,
          attemptedCount,
          successCount,
          failureCount,
          lagSeconds: observability.lagSeconds,
          staleMarketCount: observability.staleMarketCount,
          errorRate: String(failureRate),
          metadata,
        },
      });

    return {
      runId: syncRunId,
      sourceProvider: 'POLYMARKET',
      fetchedEvents: events.length,
      totalCandidates: markets.length,
      jobs: { catalog: catalog.result, odds, status },
      observability: {
        lagSeconds: observability.lagSeconds,
        staleMarketCount: observability.staleMarketCount,
        failureRate,
        providerHealthy,
      },
      durationMs,
    };
  } catch (error) {
    if (syncRunId) {
      const finishedAt = new Date();
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown sync failure';
      await db
        .insert(providerSyncRun)
        .values({
          id: syncRunId,
          sourceProvider: 'POLYMARKET',
          jobType: 'FULL',
          status: 'FAILURE',
          startedAt,
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          errorMessage,
        })
        .onConflictDoUpdate({
          target: providerSyncRun.id,
          set: {
            status: 'FAILURE',
            finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            errorMessage,
          },
        });
    }

    console.error('Failed to sync PolyMarket markets:', error);
    throw error;
  }
};
