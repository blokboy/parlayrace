import { db } from '@starter/backend/db';

export type LegPrice = {
  yesPrice: number;
  noPrice: number;
};

const roundToCents = (value: number) => Math.round(value * 100) / 100;

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

  if (hasHome && !hasAway) return 'home';
  if (hasAway && !hasHome) return 'away';

  if (!hasHome && !hasAway) {
    return q.includes('draw') ? 'draw' : null;
  }

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

/**
 * Resolve the latest Polymarket Yes/No price for one side of an event.
 *
 * `marketId` is the persisted sourceEventId. Mirrors the logic behind
 * `/api/markets/$marketId` so it can be called directly server-side (e.g. by
 * parlay settlement) without an HTTP round-trip. Returns null when no price
 * snapshot exists for the event.
 */
export const getLegPrice = async (
  marketId: string,
  side: 'home' | 'away' | 'draw',
  homeTeam: string,
  awayTeam: string
): Promise<LegPrice | null> => {
  const rows = await db.query.externalMarket.findMany({
    where: (t, { and, eq }) =>
      and(eq(t.sourceProvider, 'POLYMARKET'), eq(t.sourceEventId, marketId)),
    columns: {
      id: true,
      sourceMarketId: true,
      title: true,
      homeTeam: true,
      awayTeam: true,
    },
  });

  if (rows.length === 0) {
    return null;
  }

  const resolvedHome = homeTeam || rows[0].homeTeam || '';
  const resolvedAway = awayTeam || rows[0].awayTeam || '';
  const targetTeam =
    side === 'home' ? resolvedHome : side === 'away' ? resolvedAway : '';

  const outcomes = await db.query.externalOutcome.findMany({
    where: (t, { inArray }) =>
      inArray(
        t.marketId,
        rows.map((r) => r.id)
      ),
    columns: { id: true, marketId: true, label: true },
  });

  const moneylineOutcome =
    targetTeam.length > 0
      ? outcomes.find((o) => o.label.toLowerCase() === targetTeam.toLowerCase())
      : undefined;

  let priceOutcomeId: string | undefined;

  if (moneylineOutcome) {
    priceOutcomeId = moneylineOutcome.id;
  } else {
    const selected =
      rows.find(
        (r) => classifyMarket(r.title, resolvedHome, resolvedAway) === side
      ) ?? rows[0];
    const marketOutcomes = outcomes.filter((o) => o.marketId === selected.id);
    priceOutcomeId = (
      marketOutcomes.find((o) => o.label.toLowerCase() === 'yes') ??
      marketOutcomes[0]
    )?.id;
  }

  if (!priceOutcomeId) {
    return null;
  }

  const latest = await db.query.externalPriceSnapshot.findFirst({
    where: (t, { eq }) => eq(t.outcomeId, priceOutcomeId as string),
    orderBy: (t, { desc }) => desc(t.fetchedAt),
    columns: { price: true },
  });

  const yesPriceRaw = latest ? Number(latest.price) : 0.5;
  const yesPrice = Number.isFinite(yesPriceRaw) ? yesPriceRaw : 0.5;
  const noPrice = Math.max(0, Math.min(1, 1 - yesPrice));

  return {
    yesPrice: roundToCents(yesPrice),
    noPrice: roundToCents(noPrice),
  };
};

/**
 * The cost-per-share of a leg's selected outcome — yesPrice when the position
 * was bought YES, noPrice when bought NO. Returns null when no price exists.
 */
export const getLegSidePrice = async (params: {
  marketId: string;
  side: 'home' | 'away' | 'draw';
  buySide: 'YES' | 'NO';
  homeTeam: string;
  awayTeam: string;
}): Promise<number | null> => {
  const price = await getLegPrice(
    params.marketId,
    params.side,
    params.homeTeam,
    params.awayTeam
  );

  if (!price) {
    return null;
  }

  return params.buySide === 'NO' ? price.noPrice : price.yesPrice;
};
