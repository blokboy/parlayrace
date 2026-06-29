import { createHash } from 'node:crypto';
import { db } from '@starter/backend/db';
import { and, eq, inArray, lt } from '@starter/backend/orm';
import {
  externalMarket,
  externalOutcome,
  externalPriceSnapshot,
  providerDeadLetter,
  providerSyncRun,
} from '@starter/backend/schema';

type PolymarketToken = { outcome: string; price: number };

type MarketCategory = 'fifa-games' | 'mlb-games';

type PolymarketMarket = {
  id: string | number;
  question: string;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  tokens?: PolymarketToken[];
  // Polymarket tags game sub-markets (e.g. "moneyline", "spreads", "totals").
  // For MLB we keep only the moneyline market.
  sportsMarketType?: string;
  updatedAt?: string;
  // The actual kickoff/first-pitch. For MLB, `endDate` is a resolution deadline
  // that's unrelated to the game time, so gameStartTime is the source of truth.
  gameStartTime?: string;
  endDate?: string;
  active?: boolean;
  closed?: boolean;
};

type PolymarketTeam = {
  name: string;
  logo?: string;
  color?: string | null;
  ordering?: string | null;
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

type EnrichedMarket = PolymarketMarket & {
  __category: MarketCategory;
  __eventId: string;
  __eventTitle: string;
  __eventSlug: string;
  __eventEndDate: string;
  // Resolved game time (gameStartTime → endDate → event endDate), ISO. Drives
  // both the date-window filter and the persisted closeTime/kickoff.
  __gameTimeIso: string;
  __homeTeam: string;
  __awayTeam: string;
  __homeLogo: string;
  __homeColor: string | null;
  __awayLogo: string;
  __awayColor: string | null;
};

// Resolve home/away (name + branding) from a Polymarket event's teams[] using
// the same ordering rules as the read path. Returns empty strings when teams
// are missing so sub-markets still sync (branding simply stays blank).
const resolveEventTeams = (
  event: PolymarketEvent
): {
  homeTeam: string;
  awayTeam: string;
  homeLogo: string;
  homeColor: string | null;
  awayLogo: string;
  awayColor: string | null;
} => {
  const teams = event.teams ?? [];
  const home = teams.find((t) => t.ordering === 'home') ?? teams[0];
  const away =
    teams.find((t) => t.ordering === 'away') ??
    teams.find((t) => t.name !== home?.name) ??
    teams[1];

  return {
    homeTeam: home?.name ?? '',
    awayTeam: away?.name ?? '',
    homeLogo: home?.logo ?? '',
    homeColor: home?.color ?? null,
    awayLogo: away?.logo ?? '',
    awayColor: away?.color ?? null,
  };
};

// Match moneyline questions like "Will Brazil win on 2026-06-29?", "Brazil to
// win", "Brazil beat Japan", etc. A bare "win" must be included — Polymarket's
// win markets read "Will <team> win ..." where "will" and "win" aren't adjacent.
const WIN_TITLE_REGEX = /\b(win|wins|won|beat|beats|defeat|defeats)\b/i;
const DRAW_TITLE_REGEX = /\bdraw\b/i;

const parseJsonArray = (
  value: string | string[] | null | undefined
): string[] => {
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
  WIN_TITLE_REGEX.test(market.question) ||
  DRAW_TITLE_REGEX.test(market.question);

// MLB game events bundle ~26 markets (spreads, totals, props). The head-to-head
// winner is the single "moneyline" market, whose two outcomes are the team
// names. That's the only one we persist for MLB cards.
const isMoneylineMarket = (market: PolymarketMarket): boolean =>
  market.sportsMarketType === 'moneyline';

// Per-category market filter: FIFA win/draw binaries vs MLB moneyline.
const passesCategoryFilter = (market: EnrichedMarket): boolean =>
  market.__category === 'mlb-games'
    ? isMoneylineMarket(market)
    : isMatchResultMarket(market);

// Polymarket's gameStartTime is "2026-07-07 18:15:00+00" (space, short offset),
// not strict ISO — normalize before Date parsing.
const parseGameStartTime = (value: string | undefined): Date | null => {
  if (!value) return null;
  const iso = value.replace(' ', 'T').replace(/\+00$/, 'Z');
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// The authoritative game time: gameStartTime when present, else the market's
// endDate, else the event endDate. For FIFA these coincide; for MLB only
// gameStartTime reflects the real game.
const resolveGameTime = (
  market: PolymarketMarket,
  eventEndDate: string
): Date => {
  const fromGameStart = parseGameStartTime(market.gameStartTime);
  if (fromGameStart) return fromGameStart;

  if (market.endDate) {
    const fromEnd = new Date(market.endDate);
    if (!Number.isNaN(fromEnd.getTime())) return fromEnd;
  }

  return new Date(eventEndDate);
};

const startOfDayUtc = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

// Window of upcoming days (UTC) the sync persists. Kept in sync with the read
// path's getWindow() in routes/api/markets.ts and routes/api/mlb-markets.ts so
// the dashboard never asks for days the sync didn't populate.
const SYNC_WINDOW_DAYS = 8;

const isCloseTimeWithinWindow = (isoDate: string | undefined): boolean => {
  if (!isoDate) return false;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  const today = startOfDayUtc(now);
  const windowEnd = new Date(today);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + SYNC_WINDOW_DAYS);
  return d >= today && d < windowEnd;
};

// Scrape polymarket.com/sports/world-cup/games for game slugs, then fetch
// each slug from the Gamma events API. Falls back to tag pagination.
export const fetchWorldCupGameEvents = async (
  limit = 1000
): Promise<PolymarketEvent[]> => {
  let slugs: string[] = [];

  try {
    const scrapeRes = await fetch(
      'https://polymarket.com/sports/world-cup/games',
      {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      }
    );
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
        (r): r is PromiseFulfilledResult<PolymarketEvent[]> =>
          r.status === 'fulfilled'
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

// Fetch MLB game events from the mlb + baseball tags, deduped. Only events with
// a two-team matchup are returned (excludes futures like "World Series winner").
export const fetchMlbGameEvents = async (
  limit = 1000
): Promise<PolymarketEvent[]> => {
  const pageLimit = Math.min(Math.max(limit, 1), 500);

  const fetchTag = async (tag: string): Promise<PolymarketEvent[]> => {
    try {
      const res = await fetch(
        `https://gamma-api.polymarket.com/events?limit=${pageLimit}&active=true&closed=false&tag_slug=${tag}`
      );
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? (data as PolymarketEvent[]) : [];
    } catch {
      return [];
    }
  };

  const [mlbEvents, baseballEvents] = await Promise.all([
    fetchTag('mlb'),
    fetchTag('baseball'),
  ]);

  const mlbIds = new Set(mlbEvents.map((e) => String(e.id)));
  const filteredBaseball = baseballEvents.filter(
    (e) => !mlbIds.has(String(e.id)) && isMlbEvent(e)
  );

  return [...mlbEvents, ...filteredBaseball]
    .filter((e) => (e.teams?.length ?? 0) >= 2)
    .slice(0, limit);
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

// Delete POLYMARKET game markets (FIFA + MLB) whose close time is before today
// (UTC). Outcomes and price snapshots cascade via FK constraints.
const pruneOldPolymarketMarkets = async (): Promise<number> => {
  const cutoff = startOfDayUtc(new Date());
  const deleted = await db
    .delete(externalMarket)
    .where(
      and(
        eq(externalMarket.sourceProvider, 'POLYMARKET'),
        inArray(externalMarket.category, ['fifa-games', 'mlb-games']),
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
}): Promise<{
  result: JobResult;
  catalogMap: Map<string, CatalogMapEntry>;
}> => {
  const { syncRunId, markets, batchSize, retryAttempts, payloadVersion } = args;
  const catalogMap = new Map<string, CatalogMapEntry>();
  const result: JobResult = {
    attempted: 0,
    success: 0,
    failed: 0,
    deadLetters: 0,
  };

  for (let i = 0; i < markets.length; i += batchSize) {
    const batch = markets.slice(i, i + batchSize);

    for (const market of batch) {
      result.attempted++;
      const sourceMarketId = String(market.id);

      try {
        const marketStatus: 'OPEN' | 'CLOSED' =
          market.closed === true || market.active === false ? 'CLOSED' : 'OPEN';
        // closeTime drives the read-path window + displayed kickoff, so use the
        // resolved game time rather than the (possibly bogus) market endDate.
        const closeTime = new Date(market.__gameTimeIso);

        const [upserted] = await withRetry(
          () =>
            db
              .insert(externalMarket)
              .values({
                sourceProvider: 'POLYMARKET',
                sourceMarketId,
                title: market.question,
                description: market.__eventTitle,
                category: market.__category,
                status: marketStatus,
                sourceEventId: market.__eventId,
                eventSlug: market.__eventSlug,
                homeTeam: market.__homeTeam,
                awayTeam: market.__awayTeam,
                homeLogo: market.__homeLogo,
                homeColor: market.__homeColor,
                awayLogo: market.__awayLogo,
                awayColor: market.__awayColor,
                closeTime,
              })
              .onConflictDoUpdate({
                target: [
                  externalMarket.sourceProvider,
                  externalMarket.sourceMarketId,
                ],
                set: {
                  title: market.question,
                  description: market.__eventTitle,
                  status: marketStatus,
                  sourceEventId: market.__eventId,
                  eventSlug: market.__eventSlug,
                  homeTeam: market.__homeTeam,
                  awayTeam: market.__awayTeam,
                  homeLogo: market.__homeLogo,
                  homeColor: market.__homeColor,
                  awayLogo: market.__awayLogo,
                  awayColor: market.__awayColor,
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
        const newOutcomes = tokens.filter(
          (t) => !existingLabels.has(t.outcome)
        );

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
            .returning({
              id: externalOutcome.id,
              label: externalOutcome.label,
            });
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
          reason:
            error instanceof Error ? error.message : 'catalog upsert failed',
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
  const {
    syncRunId,
    markets,
    catalogMap,
    batchSize,
    retryAttempts,
    payloadVersion,
  } = args;
  const result: JobResult = {
    attempted: 0,
    success: 0,
    failed: 0,
    deadLetters: 0,
  };
  const now = new Date();

  for (let i = 0; i < markets.length; i += batchSize) {
    const batch = markets.slice(i, i + batchSize);

    for (const market of batch) {
      const sourceMarketId = String(market.id);
      const entry = catalogMap.get(sourceMarketId);
      if (!entry) continue;

      const tokens = extractTokenPrices(market);
      for (const token of tokens) {
        const outcomeRow = entry.outcomes.find(
          (o) => o.label === token.outcome
        );
        if (!outcomeRow) continue;

        result.attempted++;
        try {
          const price = Math.max(0, Math.min(1, token.price));
          const hash = createHash('md5')
            .update(
              JSON.stringify({
                sourceMarketId,
                outcome: token.outcome,
                price,
                payloadVersion,
              })
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
            reason:
              error instanceof Error ? error.message : 'odds snapshot failed',
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
  const {
    syncRunId,
    markets,
    catalogMap,
    batchSize,
    retryAttempts,
    payloadVersion,
  } = args;
  const result: JobResult = {
    attempted: 0,
    success: 0,
    failed: 0,
    deadLetters: 0,
  };

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
                category: market.__category,
                status: marketStatus,
              })
              .onConflictDoUpdate({
                target: [
                  externalMarket.sourceProvider,
                  externalMarket.sourceMarketId,
                ],
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
          reason:
            error instanceof Error ? error.message : 'status transition failed',
          payload: {
            sourceMarketId,
            closed: market.closed,
            active: market.active,
          },
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
    const staleThresholdMinutes = clamp(
      options.staleThresholdMinutes ?? 30,
      1,
      180
    );
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

    const prunedMarkets = await pruneOldPolymarketMarkets();
    if (prunedMarkets > 0) {
      console.log(
        `Pruned ${prunedMarkets} old PolyMarket market records before sync.`
      );
    }

    // Fetch both sports in parallel and tag each event with its category.
    const [fifaEvents, mlbEvents] = await Promise.all([
      withRetry(() => fetchWorldCupGameEvents(limit), {
        attempts: retryAttempts,
      }),
      withRetry(() => fetchMlbGameEvents(limit), { attempts: retryAttempts }),
    ]);

    const taggedEvents: { event: PolymarketEvent; category: MarketCategory }[] =
      [
        ...fifaEvents.map((event) => ({
          event,
          category: 'fifa-games' as const,
        })),
        ...mlbEvents.map((event) => ({
          event,
          category: 'mlb-games' as const,
        })),
      ];

    // Flatten markets from every event, injecting event metadata + the resolved
    // game time so each sub-market carries everything the read path needs. The
    // date-window filter runs per-market on __gameTimeIso (not event.endDate),
    // since for MLB the event/market endDate is a resolution deadline that can
    // be weeks off from the actual game.
    const markets: EnrichedMarket[] = taggedEvents
      .flatMap(({ event, category }) => {
        const teams = resolveEventTeams(event);
        return (event.markets ?? []).map((market) => ({
          ...market,
          __category: category,
          __eventId: String(event.id),
          __eventTitle: event.title,
          __eventSlug: event.slug ?? '',
          __eventEndDate: event.endDate,
          __gameTimeIso: resolveGameTime(market, event.endDate).toISOString(),
          __homeTeam: teams.homeTeam,
          __awayTeam: teams.awayTeam,
          __homeLogo: teams.homeLogo,
          __homeColor: teams.homeColor,
          __awayLogo: teams.awayLogo,
          __awayColor: teams.awayColor,
        }));
      })
      .filter((market) => isCloseTimeWithinWindow(market.__gameTimeIso))
      .filter((market) => passesCategoryFilter(market))
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

    const observability = await computeObservabilityMetrics(
      staleThresholdMinutes
    );
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
      fetchedEvents: taggedEvents.length,
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
