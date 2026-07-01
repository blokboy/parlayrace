import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@starter/ui/components/shadcn/responsive-dialog';
import { Skeleton } from '@starter/ui/components/shadcn/skeleton';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';

type MarketLeg = {
  id: string;
  side: 'home' | 'draw' | 'away';
  label: string;
  yesPrice: number;
  noPrice: number;
};

type MarketItem = {
  id: string;
  sourceProvider: 'POLYMARKET';
  category: 'fifa-games' | 'mlb-games' | 'tennis-games';
  matchup: string;
  kickoff: string;
  homeTeam: string;
  awayTeam: string;
  legs: MarketLeg[];
  homeBranding?: { logo: string; color: string | null };
  awayBranding?: { logo: string; color: string | null };
};

type TeamBranding = {
  name: string;
  logo: string;
  color: string | null;
};

type TeamButtonPalette = {
  background: string;
  color: string;
  border: string;
};

type MarketCard = {
  id: string;
  matchup: string;
  kickoffIso: string;
  kickoff: string;
  category: 'fifa-games' | 'mlb-games' | 'tennis-games';
  home: { name: string; logo: string; color: string | null };
  away: { name: string; logo: string; color: string | null };
  homeLeg: MarketLeg;
  drawLeg: MarketLeg | null;
  awayLeg: MarketLeg;
};

type SelectionSide = 'home' | 'draw' | 'away';

type SelectedTrade = {
  marketId: string;
  matchup: string;
  kickoff: string;
  homeTeam: string;
  awayTeam: string;
  category: 'fifa-games' | 'mlb-games' | 'tennis-games';
  side: SelectionSide;
  selectionLabel: string;
};

type LeagueCategory = 'fifa-games' | 'mlb-games' | 'tennis-games';

const LEAGUE_META: ReadonlyArray<{ category: LeagueCategory; label: string }> =
  [
    { category: 'fifa-games', label: 'FIFA' },
    { category: 'mlb-games', label: 'MLB' },
    { category: 'tennis-games', label: 'Tennis' },
  ];

type MarketDetail = {
  marketId: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  updatedAt: string | null;
};

type LiveStatus = {
  statusLabel: string;
  hasStarted: boolean;
  isFinal: boolean;
  eventTime: string | null;
  homeScore: number | null;
  awayScore: number | null;
  scoreLabel: string | null;
};

const formatLiveSummary = (
  status: LiveStatus | undefined,
  fallback: string
): string => {
  if (!status) {
    return fallback;
  }

  const scoreLabel =
    status.scoreLabel ??
    (status.homeScore !== null && status.awayScore !== null
      ? `${status.homeScore}-${status.awayScore}`
      : null);

  if (scoreLabel && (status.eventTime ?? status.statusLabel)) {
    return `${scoreLabel} • ${status.eventTime ?? status.statusLabel}`;
  }

  if (scoreLabel) {
    return scoreLabel;
  }

  if (status.eventTime ?? status.statusLabel) {
    return status.eventTime ?? status.statusLabel;
  }

  return fallback;
};

type PaperPosition = {
  id: string;
  marketId: string;
  matchup: string;
  homeTeam: string;
  awayTeam: string;
  side: SelectionSide;
  buySide: 'YES' | 'NO';
  stake: number;
  entryPrice: number;
  quantity: number;
  kickoff: string;
  status: 'OPEN' | 'CLOSED';
  createdAt: string;
  closedAt: string | null;
  closeValue: number | null;
  // Spreads/totals combo bets placed from the portfolio (absent ⇒ moneyline).
  betType?: string;
  optionLabel?: string;
  line?: number;
  comboMarketId?: string;
  comboOutcomeLabel?: string;
  parentPositionId?: string;
};

type PaperPortfolioState = {
  cash: number;
  positions: PaperPosition[];
};

const roundToCents = (value: number) => Math.round(value * 100) / 100;

const defaultPortfolioState = (): PaperPortfolioState => ({
  cash: 1000,
  positions: [],
});

const fetchPortfolioStateForUser =
  async (): Promise<PaperPortfolioState | null> => {
    const response = await fetch('/api/paper-portfolio', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (response.status === 401) {
      return null;
    }

    if (!response.ok) {
      return defaultPortfolioState();
    }

    const payload = (await response.json()) as { state?: PaperPortfolioState };
    return payload.state ?? defaultPortfolioState();
  };

const savePortfolioStateForUser = async (
  state: PaperPortfolioState
): Promise<boolean> => {
  const response = await fetch('/api/paper-portfolio', {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ state }),
  });

  return response.ok;
};

const normalizeHexColor = (input: string | null | undefined): string | null => {
  if (!input) {
    return null;
  }

  const value = input.trim();
  return /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(value) ? value : null;
};

const getTextColorForBackground = (backgroundHex: string): string => {
  const hex = backgroundHex.replace('#', '');
  const isShort = hex.length === 3;
  const expanded = isShort
    ? `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
    : hex;

  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  return luminance > 0.65 ? '#111827' : '#ffffff';
};

const darkenHexColor = (hexColor: string, factor: number): string => {
  const hex = hexColor.replace('#', '');
  const isShort = hex.length === 3;
  const expanded = isShort
    ? `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
    : hex;

  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);

  const darkenedRed = Math.max(0, Math.floor(red * (1 - factor)));
  const darkenedGreen = Math.max(0, Math.floor(green * (1 - factor)));
  const darkenedBlue = Math.max(0, Math.floor(blue * (1 - factor)));

  const toHex = (value: number) => value.toString(16).padStart(2, '0');
  return `#${toHex(darkenedRed)}${toHex(darkenedGreen)}${toHex(darkenedBlue)}`;
};

const getTeamButtonPalette = (team: {
  color: string | null;
}): TeamButtonPalette => {
  const normalizedColor = normalizeHexColor(team.color);

  if (!normalizedColor) {
    return {
      background: '#ffffff',
      color: '#4c1d95',
      border: '#c4b5fd',
    };
  }

  return {
    background: normalizedColor,
    color: getTextColorForBackground(normalizedColor),
    border: darkenHexColor(normalizedColor, 0.18),
  };
};

const formatKickoff = (isoDate: string, timeZone: string): string => {
  const value = new Date(isoDate);
  if (Number.isNaN(value.getTime())) {
    return 'TBD';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(value);
};

const toMarketCard = (
  market: MarketItem,
  teamBrands: Record<string, TeamBranding>,
  timeZone: string
): MarketCard | null => {
  const homeLeg = market.legs.find((leg) => leg.side === 'home');
  const awayLeg = market.legs.find((leg) => leg.side === 'away');

  if (!homeLeg || !awayLeg) {
    return null;
  }

  const drawLeg = market.legs.find((leg) => leg.side === 'draw') ?? null;
  const homeBrand = teamBrands[market.homeTeam];
  const awayBrand = teamBrands[market.awayTeam];

  return {
    id: market.id,
    matchup: market.matchup,
    kickoffIso: market.kickoff,
    kickoff: formatKickoff(market.kickoff, timeZone),
    category: market.category,
    home: {
      name: market.homeTeam,
      logo: homeBrand?.logo ?? '',
      color: homeBrand?.color ?? null,
    },
    away: {
      name: market.awayTeam,
      logo: awayBrand?.logo ?? '',
      color: awayBrand?.color ?? null,
    },
    homeLeg,
    drawLeg,
    awayLeg,
  };
};

const fetchMarkets = async (): Promise<MarketItem[]> => {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  // 8-day window (today + next 7) to match the sync's SYNC_WINDOW_DAYS.
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);

  const dateFrom = start.toISOString();
  const dateTo = new Date(
    Date.UTC(
      end.getUTCFullYear(),
      end.getUTCMonth(),
      end.getUTCDate(),
      23,
      59,
      59,
      999
    )
  ).toISOString();

  const qs = `dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`;

  const [fifaRes, mlbRes, tennisRes] = await Promise.all([
    fetch(`/api/markets?sourceProvider=POLYMARKET&category=fifa-games&${qs}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }),
    fetch(`/api/mlb-markets?${qs}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }),
    // Tennis reuses the two-outcome moneyline endpoint via ?category=.
    fetch(`/api/mlb-markets?category=tennis-games&${qs}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }),
  ]);

  const fifaMarkets = fifaRes.ok
    ? (((await fifaRes.json()) as { markets?: MarketItem[] }).markets ?? [])
    : [];

  const mlbMarkets = mlbRes.ok
    ? (((await mlbRes.json()) as { markets?: MarketItem[] }).markets ?? [])
    : [];

  const tennisMarkets = tennisRes.ok
    ? (((await tennisRes.json()) as { markets?: MarketItem[] }).markets ?? [])
    : [];

  return [...fifaMarkets, ...mlbMarkets, ...tennisMarkets];
};

const fetchTeamBranding = async (
  teamNames: string[]
): Promise<Record<string, TeamBranding>> => {
  if (teamNames.length === 0) {
    return {};
  }

  const encodedTeams = encodeURIComponent(teamNames.join(','));
  const response = await fetch(`/api/team-colors?teams=${encodedTeams}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    return {};
  }

  const payload = (await response.json()) as {
    teams?: Record<string, TeamBranding>;
  };

  return payload.teams ?? {};
};

const fetchMarketDetail = async (
  trade: SelectedTrade
): Promise<MarketDetail | null> => {
  const query = new URLSearchParams({
    side: trade.side,
    homeTeam: trade.homeTeam,
    awayTeam: trade.awayTeam,
  });

  const response = await fetch(
    `/api/markets/${trade.marketId}?${query.toString()}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }
  );

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as MarketDetail;
};

const FlagButton = ({
  team,
  draw = false,
  neutral = false,
  onClick,
  disabled = false,
}: {
  team: { name: string; logo: string; color: string | null };
  draw?: boolean;
  // Keep a white background (still shows the flag icon) — used for tennis so the
  // side selections stay visually consistent instead of team-colored.
  neutral?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) => {
  if (draw) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="!bg-white hover:!bg-white w-full rounded-lg border border-violet-200 px-3 py-2 font-semibold text-sm text-violet-900 transition hover:border-violet-400 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Draw
      </button>
    );
  }

  const palette = getTeamButtonPalette(team);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        neutral
          ? '!bg-white hover:!bg-white w-full rounded-lg border border-violet-200 px-3 py-2 font-semibold text-sm text-violet-900 transition hover:border-violet-400 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-50'
          : 'w-full rounded-lg border px-3 py-2 font-semibold text-sm transition disabled:cursor-not-allowed disabled:opacity-50'
      }
      style={
        neutral
          ? undefined
          : {
              backgroundColor: palette.background,
              color: palette.color,
              borderColor: palette.border,
            }
      }
    >
      <span className="inline-flex items-center justify-center gap-2">
        {team.logo ? (
          <img
            src={team.logo}
            alt={`${team.name} flag`}
            className="h-4 w-6 rounded-[2px] object-cover"
          />
        ) : null}
        <span>{team.name}</span>
      </span>
    </button>
  );
};

type ResolvedPrices = Record<
  string,
  { home: number; draw: number; away: number }
>;

// Renders a team's flag/logo next to a score. MLB logos are square (shown
// uncropped); FIFA flags are rectangular.
const TeamFlag = ({
  team,
  square = false,
}: {
  team: { name: string; logo: string };
  square?: boolean;
}) =>
  team.logo ? (
    <img
      src={team.logo}
      alt={`${team.name} logo`}
      className={
        square
          ? 'h-4 w-4 rounded-sm object-contain'
          : 'h-3 w-4 rounded-[2px] object-cover'
      }
    />
  ) : (
    <span className="font-semibold text-[10px] uppercase">
      {team.name.slice(0, 3)}
    </span>
  );

const StatusBadge = ({
  card,
  status,
  resolvedPrices,
}: {
  card: MarketCard;
  status: LiveStatus | undefined;
  resolvedPrices: ResolvedPrices;
}) => {
  if (!status?.isFinal) {
    // Active game with a score → show each team's flag next to its own score so
    // it's clear which team has which.
    if (
      status?.hasStarted &&
      status.homeScore !== null &&
      status.awayScore !== null
    ) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 font-medium text-green-800 text-xs">
          <TeamFlag
            team={card.home}
            square={card.category === 'mlb-games'}
          />
          <span className="font-semibold">{status.homeScore}</span>
          <span className="opacity-50">-</span>
          <span className="font-semibold">{status.awayScore}</span>
          <TeamFlag
            team={card.away}
            square={card.category === 'mlb-games'}
          />
          {status.eventTime ? (
            <span className="opacity-75">· {status.eventTime}</span>
          ) : null}
        </span>
      );
    }

    return (
      <span className="inline-block rounded-full bg-green-100 px-3 py-1 font-medium text-green-800 text-xs">
        {formatLiveSummary(status, status?.statusLabel ?? 'OPEN')}
      </span>
    );
  }

  // Use fresh Polymarket prices to determine the winner — the resolved
  // side will have yesPrice ≈ 1.0, losing sides ≈ 0.0.
  const prices = resolvedPrices[card.id];
  const homeP = prices?.home ?? card.homeLeg.yesPrice;
  const drawP = prices?.draw ?? card.drawLeg?.yesPrice ?? 0;
  const awayP = prices?.away ?? card.awayLeg.yesPrice;
  const maxP = Math.max(homeP, drawP, awayP);

  // Only claim a winner once Polymarket prices are clearly resolved.
  const winner =
    maxP >= 0.85
      ? homeP === maxP
        ? 'home'
        : awayP === maxP
          ? 'away'
          : 'draw'
      : null;

  const scoreLabel =
    status.scoreLabel ??
    (status.homeScore !== null && status.awayScore !== null
      ? `${status.homeScore}-${status.awayScore}`
      : null);

  if (winner === 'home' || winner === 'away') {
    const winnerTeam = winner === 'home' ? card.home : card.away;
    const palette = getTeamButtonPalette(winnerTeam);
    return (
      <span
        style={{
          backgroundColor: palette.background,
          color: palette.color,
          borderColor: palette.border,
        }}
        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium text-xs"
      >
        {winnerTeam.logo ? (
          <img
            src={winnerTeam.logo}
            alt=""
            className={
              card.category === 'mlb-games'
                ? 'h-4 w-4 rounded-sm object-contain'
                : 'h-3 w-4 rounded-sm object-cover'
            }
          />
        ) : null}
        <span>{winnerTeam.name}</span>
        {scoreLabel ? <span className="opacity-75">· {scoreLabel}</span> : null}
      </span>
    );
  }

  if (winner === 'draw') {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700 text-xs">
        Draw{scoreLabel ? ` · ${scoreLabel}` : ''}
      </span>
    );
  }

  // Final but Polymarket hasn't fully resolved yet — show score/status.
  return (
    <span className="inline-block rounded-full bg-green-100 px-3 py-1 font-medium text-green-800 text-xs">
      {formatLiveSummary(status, 'Final')}
    </span>
  );
};

const DashboardPage = () => {
  const [markets, setMarkets] = useState<MarketItem[]>([]);
  const [teamBrands, setTeamBrands] = useState<Record<string, TeamBranding>>(
    {}
  );
  const [liveStatuses, setLiveStatuses] = useState<Record<string, LiveStatus>>(
    {}
  );
  const liveStatusesRef = useRef<Record<string, LiveStatus>>({});
  const [selectedTrade, setSelectedTrade] = useState<SelectedTrade | null>(
    null
  );
  const [marketDetail, setMarketDetail] = useState<MarketDetail | null>(null);
  const [stake, setStake] = useState(25);
  const [pickSide, setPickSide] = useState<'YES' | 'NO'>('YES');
  const [availableBalance, setAvailableBalance] = useState(1000);

  const [resolvedPrices, setResolvedPrices] = useState<ResolvedPrices>({});
  const fetchedFinalIds = useRef(new Set<string>());
  const [buying, setBuying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userTimeZone, setUserTimeZone] = useState('UTC');
  const [activeLeagues, setActiveLeagues] = useState<Set<LeagueCategory>>(
    new Set()
  );

  // An empty set means "ALL" (no filter applied).
  const isLeagueActive = (category: LeagueCategory) =>
    activeLeagues.size === 0 || activeLeagues.has(category);

  const toggleLeague = (category: LeagueCategory) => {
    setActiveLeagues((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      // Selecting every league is equivalent to "ALL" — reset to empty.
      if (next.size === LEAGUE_META.length) {
        next.clear();
      }
      return next;
    });
  };

  useEffect(() => {
    const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detectedTimeZone) {
      setUserTimeZone(detectedTimeZone);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);

      let loadedMarkets = await fetchMarkets();

      if (loadedMarkets.length === 0) {
        await fetch('/api/sync/polymarket', {
          method: 'POST',
          headers: { Accept: 'application/json' },
        });
        loadedMarkets = await fetchMarkets();
      }

      if (cancelled) {
        return;
      }

      setMarkets(loadedMarkets);

      // Seed team branding from data embedded in the Polymarket response.
      // This covers MLB teams (and any FIFA teams whose colors Polymarket carries).
      const embeddedBranding: Record<string, TeamBranding> = {};
      for (const market of loadedMarkets) {
        if (market.homeBranding?.logo || market.homeBranding?.color) {
          embeddedBranding[market.homeTeam] = {
            name: market.homeTeam,
            logo: market.homeBranding.logo,
            color: market.homeBranding.color,
          };
        }
        if (market.awayBranding?.logo || market.awayBranding?.color) {
          embeddedBranding[market.awayTeam] = {
            name: market.awayTeam,
            logo: market.awayBranding.logo,
            color: market.awayBranding.color,
          };
        }
      }

      const uniqueTeams = Array.from(
        new Set(
          loadedMarkets.flatMap((market) => [market.homeTeam, market.awayTeam])
        )
      );

      // fetchTeamBranding covers FIFA national team colors/flags; merge over
      // embedded data so dedicated entries take precedence where both exist.
      const fetchedBranding = await fetchTeamBranding(uniqueTeams);

      if (!cancelled) {
        setTeamBrands({ ...embeddedBranding, ...fetchedBranding });
        setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const marketCards = useMemo(() => {
    return markets
      .map((market) => toMarketCard(market, teamBrands, userTimeZone))
      .filter((card): card is MarketCard => card !== null)
      .sort((a, b) => a.kickoffIso.localeCompare(b.kickoffIso));
  }, [markets, teamBrands, userTimeZone]);

  const leagueGroups = useMemo(
    () =>
      LEAGUE_META.filter(({ category }) => isLeagueActive(category))
        .map(({ category, label }) => ({
          category,
          label,
          cards: marketCards.filter((card) => card.category === category),
        }))
        .filter((group) => group.cards.length > 0),
    [marketCards, activeLeagues]
  );

  useEffect(() => {
    liveStatusesRef.current = liveStatuses;
  }, [liveStatuses]);

  // When a card becomes final, fetch fresh Polymarket prices for all three
  // sides so we can identify the resolved (winning) outcome accurately.
  useEffect(() => {
    const cardsToFetch = marketCards.filter(
      (card) =>
        liveStatuses[card.id]?.isFinal && !fetchedFinalIds.current.has(card.id)
    );

    if (cardsToFetch.length === 0) return;

    for (const card of cardsToFetch) {
      fetchedFinalIds.current.add(card.id);
    }

    let cancelled = false;

    Promise.all(
      cardsToFetch.map(async (card) => {
        const base = {
          marketId: card.id,
          matchup: card.matchup,
          kickoff: card.kickoffIso,
          homeTeam: card.home.name,
          awayTeam: card.away.name,
          category: card.category,
        };
        const [homeDetail, drawDetail, awayDetail] = await Promise.all([
          fetchMarketDetail({
            ...base,
            side: 'home',
            selectionLabel: card.home.name,
          }),
          fetchMarketDetail({ ...base, side: 'draw', selectionLabel: 'Draw' }),
          fetchMarketDetail({
            ...base,
            side: 'away',
            selectionLabel: card.away.name,
          }),
        ]);
        return [
          card.id,
          {
            home: homeDetail?.yesPrice ?? card.homeLeg.yesPrice,
            draw: drawDetail?.yesPrice ?? card.drawLeg?.yesPrice ?? 0,
            away: awayDetail?.yesPrice ?? card.awayLeg.yesPrice,
          },
        ] as const;
      })
    )
      .then((entries) => {
        if (!cancelled) {
          setResolvedPrices((prev) => ({
            ...prev,
            ...Object.fromEntries(entries),
          }));
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [liveStatuses, marketCards]);

  useEffect(() => {
    if (marketCards.length === 0) {
      return;
    }

    let cancelled = false;

    const pollLiveStatuses = async (cards: MarketCard[]) => {
      const response = await fetch('/api/live-event-time', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          events: cards.map((card) => ({
            marketId: card.id,
            matchup: card.matchup,
            kickoff: card.kickoffIso,
            homeTeam: card.home.name,
            awayTeam: card.away.name,
          })),
        }),
      });

      if (!response.ok || cancelled) {
        return;
      }

      const payload = (await response.json()) as {
        statuses?: Record<string, LiveStatus>;
      };

      if (!cancelled) {
        // Merge into the existing map rather than replacing it: we only poll
        // not-yet-final cards, so a full replace would drop concluded cards'
        // statuses and make them render as active/OPEN again. Also never let a
        // stale "live" response downgrade a card we already marked final — once
        // concluded, a card stays concluded.
        setLiveStatuses((prev) => {
          const next = { ...prev };
          for (const [id, status] of Object.entries(payload.statuses ?? {})) {
            if (prev[id]?.isFinal) {
              continue;
            }
            next[id] = status;
          }
          return next;
        });
      }
    };

    const pollIfNeeded = async () => {
      const now = Date.now();
      const FIVE_MIN_MS = 5 * 60 * 1000;
      const activeCards = marketCards.filter((card) => {
        const kickoffTime = new Date(card.kickoffIso).getTime();
        if (Number.isNaN(kickoffTime) || kickoffTime - FIVE_MIN_MS > now) {
          return false;
        }

        const status = liveStatusesRef.current[card.id];
        return !status?.isFinal;
      });

      if (activeCards.length === 0) {
        return;
      }

      await pollLiveStatuses(activeCards);
    };

    void pollIfNeeded();
    const interval = setInterval(() => {
      void pollIfNeeded();
    }, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [marketCards]);

  useEffect(() => {
    if (!selectedTrade) {
      setMarketDetail(null);
      return;
    }

    let cancelled = false;

    const loadDetail = async () => {
      const detail = await fetchMarketDetail(selectedTrade);
      if (!cancelled && detail) {
        setMarketDetail(detail);
      }
    };

    void loadDetail();

    return () => {
      cancelled = true;
    };
  }, [selectedTrade]);

  useEffect(() => {
    if (!selectedTrade) {
      return;
    }

    let cancelled = false;

    const loadBalance = async () => {
      const portfolio = await fetchPortfolioStateForUser();
      if (!cancelled && portfolio) {
        setAvailableBalance(portfolio.cash);
        setStake((currentStake) =>
          Math.min(currentStake, Math.floor(portfolio.cash))
        );
      }
    };

    void loadBalance();

    return () => {
      cancelled = true;
    };
  }, [selectedTrade]);

  // MLB and tennis markets are two-outcome (no draw), so picking a team/player
  // is an implicit "YES" on them — there's no YES/NO choice to surface.
  const isTwoWayTrade =
    selectedTrade?.category === 'mlb-games' ||
    selectedTrade?.category === 'tennis-games';
  const isDrawTrade = selectedTrade?.side === 'draw';

  // Color the modal's action buttons with the chosen team's palette.
  const selectedTeamName =
    selectedTrade?.side === 'home'
      ? selectedTrade.homeTeam
      : selectedTrade?.side === 'away'
        ? selectedTrade.awayTeam
        : null;
  const selectedPalette = getTeamButtonPalette({
    color: selectedTeamName
      ? (teamBrands[selectedTeamName]?.color ?? null)
      : null,
  });
  const selectedPrice =
    pickSide === 'YES'
      ? (marketDetail?.yesPrice ?? 0)
      : (marketDetail?.noPrice ?? 0);
  const expectedMaxPayout =
    selectedPrice > 0 ? Math.round((stake / selectedPrice) * 100) / 100 : 0;

  const openTradeModal = (card: MarketCard, side: SelectionSide) => {
    const selectionLabel =
      side === 'home'
        ? card.home.name
        : side === 'away'
          ? card.away.name
          : 'Draw';

    const leg =
      side === 'home'
        ? card.homeLeg
        : side === 'away'
          ? card.awayLeg
          : (card.drawLeg ?? card.homeLeg);

    // Pre-populate immediately from the embedded leg prices so the modal
    // opens with real prices instead of showing a loading skeleton.
    setMarketDetail({
      marketId: leg.id,
      question: selectionLabel,
      yesPrice: leg.yesPrice,
      noPrice: leg.noPrice,
      updatedAt: null,
    });

    setSelectedTrade({
      marketId: card.id,
      matchup: card.matchup,
      kickoff: card.kickoffIso,
      homeTeam: card.home.name,
      awayTeam: card.away.name,
      category: card.category,
      side,
      selectionLabel,
    });
    setPickSide('YES');
    setStake(25);
  };

  const handleConfirmBuy = async () => {
    if (!selectedTrade || !marketDetail || selectedPrice <= 0 || stake <= 0) {
      return;
    }

    setBuying(true);

    const portfolio = await fetchPortfolioStateForUser();

    if (!portfolio) {
      setBuying(false);
      window.location.assign('/auth/login?redirect=/dashboard');
      return;
    }

    const effectiveStake = roundToCents(Math.min(stake, portfolio.cash));
    if (effectiveStake <= 0) {
      setBuying(false);
      return;
    }

    const addedQuantity = roundToCents(effectiveStake / selectedPrice);

    // Buying more of a selection the user already holds merges into that
    // position's existing card (blended entry price) instead of adding a
    // duplicate card. Combos are excluded — they have their own identity.
    const existingPosition = portfolio.positions.find(
      (candidate) =>
        candidate.status === 'OPEN' &&
        !candidate.comboMarketId &&
        !candidate.parentPositionId &&
        candidate.marketId === selectedTrade.marketId &&
        candidate.side === selectedTrade.side &&
        candidate.buySide === pickSide
    );

    let nextPositions: PaperPosition[];
    if (existingPosition) {
      const mergedQuantity = roundToCents(
        existingPosition.quantity + addedQuantity
      );
      const mergedStake = roundToCents(existingPosition.stake + effectiveStake);
      const mergedEntryPrice =
        mergedQuantity > 0
          ? roundToCents(mergedStake / mergedQuantity)
          : existingPosition.entryPrice;

      nextPositions = portfolio.positions.map((candidate) =>
        candidate.id === existingPosition.id
          ? {
              ...candidate,
              quantity: mergedQuantity,
              stake: mergedStake,
              entryPrice: mergedEntryPrice,
            }
          : candidate
      );
    } else {
      const position: PaperPosition = {
        id: crypto.randomUUID(),
        marketId: selectedTrade.marketId,
        matchup: selectedTrade.matchup,
        homeTeam: selectedTrade.homeTeam,
        awayTeam: selectedTrade.awayTeam,
        side: selectedTrade.side,
        buySide: pickSide,
        stake: effectiveStake,
        entryPrice: selectedPrice,
        quantity: addedQuantity,
        kickoff: selectedTrade.kickoff,
        status: 'OPEN',
        createdAt: new Date().toISOString(),
        closedAt: null,
        closeValue: null,
      };
      nextPositions = [position, ...portfolio.positions];
    }

    const nextState: PaperPortfolioState = {
      cash: roundToCents(portfolio.cash - effectiveStake),
      positions: nextPositions,
    };

    const saved = await savePortfolioStateForUser(nextState);
    setBuying(false);

    if (!saved) {
      return;
    }

    setAvailableBalance(nextState.cash);
    setSelectedTrade(null);
  };

  return (
    <main className="dashboard-arcade landing-arcade relative min-h-screen overflow-hidden pt-16">
      <div className="landing-arcade__glow" />
      <div className="landing-arcade__scanlines" />
      <div className="dashboard-arcade__content relative z-10 mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="font-bold text-3xl text-gray-900">Markets</h1>
        </div>

        <div className="mb-8 flex flex-wrap items-center gap-2">
          {(
            [
              { key: 'all', label: 'ALL', active: activeLeagues.size === 0 },
              ...LEAGUE_META.map(({ category, label }) => ({
                key: category,
                label,
                active: activeLeagues.has(category),
              })),
            ] as const
          ).map((badge) => (
            <button
              key={badge.key}
              type="button"
              onClick={() =>
                badge.key === 'all'
                  ? setActiveLeagues(new Set())
                  : toggleLeague(badge.key as LeagueCategory)
              }
              className={`!bg-white rounded-full border px-3 py-1 font-semibold text-xs uppercase tracking-wide transition ${
                badge.active
                  ? 'border-violet-500 text-violet-900 ring-1 ring-violet-400'
                  : 'hover:!bg-violet-50 border-violet-200 text-violet-500 hover:border-violet-300'
              }`}
            >
              {badge.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="landing-panel p-6"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <Skeleton className="h-6 w-40 rounded-md bg-violet-100" />
                  <Skeleton className="h-5 w-16 rounded-full bg-violet-100" />
                </div>
                <Skeleton className="mb-4 h-4 w-28 rounded-md bg-violet-100" />
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-9 w-full rounded-lg bg-violet-100" />
                  <Skeleton className="h-9 w-full rounded-lg bg-violet-100" />
                  <Skeleton className="h-9 w-full rounded-lg bg-violet-100" />
                </div>
              </div>
            ))}
          </div>
        ) : leagueGroups.length > 0 ? (
          <div className="space-y-10">
            {leagueGroups.map((group) => (
              <section key={group.category}>
                <h2 className="mb-4 font-bold text-violet-900 text-xl tracking-tight">
                  {group.label}
                </h2>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {group.cards.map((card) => (
                    <div
                      key={card.id}
                      className="landing-panel p-6 transition-shadow hover:shadow-lg"
                    >
                      {/* Status / outcome badge sits above the title so a long
                          matchup + a team badge never have to share a row (and
                          wrap) on mobile. */}
                      <div className="mb-2 flex">
                        <StatusBadge
                          card={card}
                          status={liveStatuses[card.id]}
                          resolvedPrices={resolvedPrices}
                        />
                      </div>
                      <h3 className="mb-3 font-semibold text-lg text-violet-950">
                        {card.matchup}
                      </h3>

                      <div className="mb-4 flex items-center gap-2 text-violet-800/80 text-xs">
                        {card.kickoff}
                      </div>

                      <div className="flex flex-col gap-2">
                        <FlagButton
                          team={card.home}
                          neutral={card.category === 'tennis-games'}
                          disabled={Boolean(liveStatuses[card.id]?.isFinal)}
                          onClick={() => openTradeModal(card, 'home')}
                        />
                        {card.drawLeg ? (
                          <FlagButton
                            team={card.home}
                            draw={true}
                            disabled={Boolean(liveStatuses[card.id]?.isFinal)}
                            onClick={() => openTradeModal(card, 'draw')}
                          />
                        ) : null}
                        <FlagButton
                          team={card.away}
                          neutral={card.category === 'tennis-games'}
                          disabled={Boolean(liveStatuses[card.id]?.isFinal)}
                          onClick={() => openTradeModal(card, 'away')}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="landing-panel p-6 text-sm text-violet-900">
            No active soccer team markets are currently available from
            Polymarket.
          </div>
        )}
      </div>

      <ResponsiveDialog
        open={selectedTrade !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedTrade(null);
          }
        }}
      >
        <ResponsiveDialogContent
          showCloseButton={false}
          className="max-w-md border-violet-200 bg-white"
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-violet-950">
              {selectedTrade?.selectionLabel ?? 'Selection'}
            </ResponsiveDialogTitle>
            <p className="text-sm text-violet-800">
              {selectedTrade ? selectedTrade.matchup : 'Loading selection...'}
            </p>
            <ResponsiveDialogClose
              aria-label="Close trade modal"
              className="absolute top-4 right-4 rounded-full border border-violet-200 bg-white px-3 py-1 font-semibold text-violet-700 text-xs transition hover:border-violet-300 hover:bg-violet-50"
            >
              Close
            </ResponsiveDialogClose>
          </ResponsiveDialogHeader>

          <div className="space-y-4 max-md:space-y-3">
            <p className="text-sm text-violet-800 max-md:text-xs">
              Choose your side and paper stake for this selection.
            </p>

            <div className="grid grid-cols-4 gap-2">
              {[25, 50, 75, 100].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() =>
                    setStake(Math.round((availableBalance * value) / 100))
                  }
                  className="rounded-md border border-violet-200 bg-white px-3 py-1 font-semibold text-sm text-violet-900 transition hover:border-violet-300 hover:bg-violet-50"
                >
                  {value}%
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm text-violet-900">Stake (Paper)</p>
                <p className="text-sm text-violet-900">
                  ${stake} / ${availableBalance}
                </p>
              </div>
              <input
                type="range"
                min="0"
                max={Math.max(0, Math.floor(availableBalance))}
                step="1"
                value={stake}
                onChange={(event) => setStake(Number(event.target.value))}
                className="w-full"
              />
            </div>

            <p className="text-sm text-violet-700">
              Available balance: ${availableBalance.toFixed(2)}
            </p>

            {!marketDetail ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Skeleton className="h-10 w-full rounded-md bg-violet-100" />
                  <Skeleton className="h-10 w-full rounded-md bg-violet-100" />
                </div>
                <Skeleton className="h-4 w-48 rounded bg-violet-100" />
                <Skeleton className="h-10 w-full rounded-lg bg-violet-100" />
              </div>
            ) : (
              <div className="space-y-3">
                {isTwoWayTrade ? null : (
                  <>
                    <p className="text-sm text-violet-900">Pick Side</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setPickSide('YES')}
                        className={`rounded-full border px-3 py-2 font-semibold text-sm max-md:py-1.5 transition${pickSide === 'YES' ? 'border-emerald-400 bg-emerald-500 text-white' : '!bg-white hover:!bg-emerald-50 border-emerald-300 text-emerald-700'}`}
                      >
                        YES{' '}
                        {marketDetail
                          ? `$${marketDetail.yesPrice.toFixed(2)}`
                          : '--'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPickSide('NO')}
                        className={`rounded-full border px-3 py-2 font-semibold text-sm max-md:py-1.5 transition${pickSide === 'NO' ? 'border-rose-400 bg-rose-500 text-white' : '!bg-white hover:!bg-rose-50 border-rose-300 text-rose-700'}`}
                      >
                        NO{' '}
                        {marketDetail
                          ? `$${marketDetail.noPrice.toFixed(2)}`
                          : '--'}
                      </button>
                    </div>
                  </>
                )}

                <div className="flex items-center justify-between">
                  <p className="text-sm text-violet-900">
                    Expected Max Payout{isTwoWayTrade ? '' : ` (${pickSide})`}
                  </p>
                  <p className="font-semibold text-sm text-violet-950">
                    ${expectedMaxPayout.toFixed(2)}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={buying || selectedPrice <= 0 || stake <= 0}
                  onClick={() => void handleConfirmBuy()}
                  style={{
                    backgroundColor: selectedPalette.background,
                    color: selectedPalette.color,
                    borderColor: selectedPalette.border,
                  }}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border px-4 py-2 font-semibold text-sm transition disabled:cursor-not-allowed disabled:opacity-50 max-md:py-1.5"
                >
                  <span>
                    {isDrawTrade
                      ? `Confirm BUY ${pickSide}`
                      : `Confirm ${selectedTrade?.selectionLabel ?? ''}`}
                  </span>
                  <span>${selectedPrice.toFixed(2)}</span>
                </button>
              </div>
            )}
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </main>
  );
};

export const Route = createFileRoute('/_public/dashboard')({
  component: DashboardPage,
});
