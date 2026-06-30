import { db } from '@starter/backend/db';

// Spread/total-style "combo" add-on markets are NOT persisted by the sync (it
// keeps only the moneyline), so we fetch them live from Polymarket Gamma per
// game. Used by both the /combos route and the parlay settlement engine.
//
// Config-driven across leagues:
//   • mlb-games    → main event: spreads, totals
//   • fifa-games   → `<slug>-more-markets` companion event: spreads, totals
//   • tennis-games → main event: set handicap, total sets, total games, set winner
// Each option is tagged with its group (`marketType`, also stored as the bet's
// betType) + a display `groupLabel`; the UI groups by `marketType`.

export type ComboOption = {
  // Group key, also persisted as the placed bet's betType (e.g. 'spread',
  // 'total', 'set-handicap', 'total-sets', 'total-games', 'set-winner').
  marketType: string;
  // Badge / section label for the group (e.g. "Spreads", "Set Handicap").
  groupLabel: string;
  line: number;
  sourceMarketId: string;
  // Raw Polymarket outcome ("Milwaukee Brewers", "Over", "Tiafoe"). Used to
  // re-price a placed bet by matching sourceMarketId + outcomeLabel.
  outcomeLabel: string;
  // Display label, e.g. "Milwaukee Brewers -1.5", "Over 7.5", "Set 3: Tiafoe".
  label: string;
  price: number;
};

export type ComboOptionsPayload = {
  options: ComboOption[];
};

type GammaMarket = {
  id: string | number;
  sportsMarketType?: string;
  question?: string;
  line?: number | string | null;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
};

type GammaEvent = {
  markets?: GammaMarket[];
};

// How to turn one Polymarket sub-market into options.
//   spread     — outcomes are the two competitors; outcome[0] gets `line`, the
//                other gets `-line` (e.g. team/player ±N).
//   total      — Over/Under at `line`.
//   set-winner — pick a player; the set # comes from the question/line.
type ComboKind = 'spread' | 'total' | 'set-winner';

type ComboGroupDef = { group: string; groupLabel: string; kind: ComboKind };

type CategoryComboConfig = {
  // Appended to the persisted eventSlug before fetching (FIFA's add-ons live in
  // a separate `<slug>-more-markets` event).
  eventSlugSuffix?: string;
  byType: Record<string, ComboGroupDef>;
};

const CATEGORY_COMBO_CONFIG: Record<string, CategoryComboConfig> = {
  'mlb-games': {
    byType: {
      spreads: { group: 'spread', groupLabel: 'Spreads', kind: 'spread' },
      totals: { group: 'total', groupLabel: 'Totals', kind: 'total' },
    },
  },
  'fifa-games': {
    eventSlugSuffix: '-more-markets',
    byType: {
      spreads: { group: 'spread', groupLabel: 'Spreads', kind: 'spread' },
      totals: { group: 'total', groupLabel: 'Totals', kind: 'total' },
    },
  },
  'tennis-games': {
    byType: {
      tennis_set_handicap: {
        group: 'set-handicap',
        groupLabel: 'Set Handicap',
        kind: 'spread',
      },
      tennis_set_totals: {
        group: 'total-sets',
        groupLabel: 'Total Sets',
        kind: 'total',
      },
      tennis_match_totals: {
        group: 'total-games',
        groupLabel: 'Total Games',
        kind: 'total',
      },
      tennis_set_winner: {
        group: 'set-winner',
        groupLabel: 'Set Winner',
        kind: 'set-winner',
      },
      tennis_first_set_winner: {
        group: 'set-winner',
        groupLabel: 'Set Winner',
        kind: 'set-winner',
      },
    },
  },
};

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

// "Over 3.5" / "Over" → "Over"; strips any embedded number so we can re-append
// the line consistently across leagues.
const baseTotalWord = (outcome: string): string =>
  outcome.replace(/[\d.+-]/g, '').trim();

const parseSetNumber = (question: string | undefined): number | null => {
  const match = (question ?? '').match(/Set\s+(\d+)/i);
  return match ? Number(match[1]) : null;
};

const optionsForMarket = (
  market: GammaMarket,
  def: ComboGroupDef
): ComboOption[] => {
  const line = Number(market.line ?? 0);
  const outcomes = parseJsonArray(market.outcomes);
  const prices = parseJsonArray(market.outcomePrices).map(Number);
  const sourceMarketId = String(market.id);

  return outcomes.map((outcomeLabel, i) => {
    const price = roundToCents(clampPrice(prices[i]));
    let label: string;
    let optionLine = line;

    if (def.kind === 'spread') {
      optionLine = i === 0 ? line : -line;
      label = `${outcomeLabel} ${formatSignedLine(optionLine)}`;
    } else if (def.kind === 'total') {
      label = `${baseTotalWord(outcomeLabel)} ${line}`;
    } else {
      const setNo =
        parseSetNumber(market.question) ??
        (Number.isFinite(line) && line > 0 ? line : null);
      label = setNo ? `Set ${setNo}: ${outcomeLabel}` : outcomeLabel;
    }

    return {
      marketType: def.group,
      groupLabel: def.groupLabel,
      line: optionLine,
      sourceMarketId,
      outcomeLabel,
      label,
      price,
    } satisfies ComboOption;
  });
};

const empty = (): ComboOptionsPayload => ({ options: [] });

// Fetch a game's combo add-on options live from Gamma. Returns empties for
// categories without combos, missing slugs, or any network/parse failure.
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

  const config = row?.category
    ? CATEGORY_COMBO_CONFIG[row.category]
    : undefined;
  if (!row?.eventSlug || !config) {
    return empty();
  }

  const slug = `${row.eventSlug}${config.eventSlugSuffix ?? ''}`;

  let event: GammaEvent | undefined;
  try {
    const res = await fetch(
      `https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`
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

  const options: ComboOption[] = [];
  for (const market of event.markets) {
    const def = market.sportsMarketType
      ? config.byType[market.sportsMarketType]
      : undefined;
    if (def) {
      options.push(...optionsForMarket(market, def));
    }
  }

  return { options };
};

// Current price of a specific combo outcome (matched by sub-market + outcome).
// Returns null when the option is no longer offered or can't be priced.
export const getComboPrice = async (
  sourceEventId: string,
  comboMarketId: string,
  comboOutcomeLabel: string
): Promise<number | null> => {
  const data = await fetchEventCombos(sourceEventId);
  const match = data.options.find(
    (option) =>
      option.sourceMarketId === comboMarketId &&
      option.outcomeLabel === comboOutcomeLabel
  );
  return match ? match.price : null;
};
