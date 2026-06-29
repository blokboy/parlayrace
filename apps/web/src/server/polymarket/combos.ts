import { db } from '@starter/backend/db';

// Spreads/totals are NOT persisted by the sync (it keeps only moneyline), so we
// fetch them live from Polymarket Gamma for a single MLB game. sourceEventId is
// the persisted event id shared by all of a game's sub-markets. Used by both the
// /combos route and the parlay settlement engine.

export type ComboMarketType = 'spread' | 'total';

export type ComboOption = {
  marketType: ComboMarketType;
  line: number;
  sourceMarketId: string;
  // The raw Polymarket outcome ("Milwaukee Brewers", "Over"). Used to re-price a
  // placed bet by matching sourceMarketId + outcomeLabel.
  outcomeLabel: string;
  // Display label, e.g. "Milwaukee Brewers -1.5" or "Over 7.5".
  label: string;
  price: number;
};

export type ComboOptionsPayload = {
  spreads: ComboOption[];
  totals: ComboOption[];
};

type GammaMarket = {
  id: string | number;
  sportsMarketType?: string;
  line?: number | string | null;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
};

type GammaEvent = {
  markets?: GammaMarket[];
};

const empty = (): ComboOptionsPayload => ({ spreads: [], totals: [] });

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

const clampPrice = (value: number): number =>
  Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5));

const roundToCents = (value: number) => Math.round(value * 100) / 100;

const formatSignedLine = (line: number): string =>
  line > 0 ? `+${line}` : `${line}`;

// Build the per-outcome options for one spreads/totals sub-market.
//   spreads — the `line` (e.g. -1.5) applies to outcome[0] (the team named in
//             the question); the other team gets the opposite sign.
//   totals  — outcomes are Over/Under, both at `line`.
const optionsForMarket = (market: GammaMarket): ComboOption[] => {
  const marketType: ComboMarketType =
    market.sportsMarketType === 'spreads' ? 'spread' : 'total';
  const line = Number(market.line ?? 0);
  const outcomes = parseJsonArray(market.outcomes);
  const prices = parseJsonArray(market.outcomePrices).map(Number);
  const sourceMarketId = String(market.id);

  return outcomes.map((outcomeLabel, i) => {
    const price = clampPrice(prices[i]);
    let label: string;
    let optionLine = line;

    if (marketType === 'spread') {
      optionLine = i === 0 ? line : -line;
      label = `${outcomeLabel} ${formatSignedLine(optionLine)}`;
    } else {
      label = `${outcomeLabel} ${line}`;
    }

    return {
      marketType,
      line: optionLine,
      sourceMarketId,
      outcomeLabel,
      label,
      price: roundToCents(price),
    } satisfies ComboOption;
  });
};

// Fetch a game's spread/total options live from Gamma. Returns empties for
// non-MLB events, missing slugs, or any network/parse failure.
export const fetchEventCombos = async (
  sourceEventId: string
): Promise<ComboOptionsPayload> => {
  const row = await db.query.externalMarket.findFirst({
    where: (t, { and, eq }) =>
      and(
        eq(t.sourceProvider, 'POLYMARKET'),
        eq(t.sourceEventId, sourceEventId)
      ),
    columns: { eventSlug: true, category: true },
  });

  if (!row || row.category !== 'mlb-games' || !row.eventSlug) {
    return empty();
  }

  let event: GammaEvent | undefined;
  try {
    const res = await fetch(
      `https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(row.eventSlug)}`
    );
    if (res.ok) {
      const data = (await res.json()) as GammaEvent | GammaEvent[];
      event = Array.isArray(data) ? data[0] : data;
    }
  } catch {
    // Network/parse failure → treat as no combos available.
  }

  if (!event?.markets) {
    return empty();
  }

  const payload = empty();
  for (const market of event.markets) {
    if (market.sportsMarketType === 'spreads') {
      payload.spreads.push(...optionsForMarket(market));
    } else if (market.sportsMarketType === 'totals') {
      payload.totals.push(...optionsForMarket(market));
    }
  }

  return payload;
};

// Current price of a specific combo outcome (matched by sub-market + outcome).
// Returns null when the option is no longer offered or can't be priced.
export const getComboPrice = async (
  sourceEventId: string,
  comboMarketId: string,
  comboOutcomeLabel: string
): Promise<number | null> => {
  const data = await fetchEventCombos(sourceEventId);
  const match = [...data.spreads, ...data.totals].find(
    (option) =>
      option.sourceMarketId === comboMarketId &&
      option.outcomeLabel === comboOutcomeLabel
  );
  return match ? match.price : null;
};
