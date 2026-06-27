import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@starter/ui/components/shadcn/dialog';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';

type MarketLeg = {
  id: string;
  side: 'home' | 'draw' | 'away';
  label: string;
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
  home: { name: string; logo: string; color: string | null };
  away: { name: string; logo: string; color: string | null };
  drawLeg: MarketLeg;
};

type SelectionSide = 'home' | 'draw' | 'away';

type SelectedTrade = {
  marketId: string;
  matchup: string;
  homeTeam: string;
  awayTeam: string;
  side: SelectionSide;
  selectionLabel: string;
};

type MarketDetail = {
  marketId: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  updatedAt: string | null;
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

const formatKickoff = (isoDate: string): string => {
  const value = new Date(isoDate);
  if (Number.isNaN(value.getTime())) {
    return 'TBD';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(value);
};

const toMarketCard = (
  market: MarketItem,
  teamBrands: Record<string, TeamBranding>
): MarketCard | null => {
  const homeLeg = market.legs.find((leg) => leg.side === 'home');
  const drawLeg = market.legs.find((leg) => leg.side === 'draw');
  const awayLeg = market.legs.find((leg) => leg.side === 'away');

  if (!homeLeg || !drawLeg || !awayLeg) {
    return null;
  }

  const homeBrand = teamBrands[market.homeTeam];
  const awayBrand = teamBrands[market.awayTeam];

  return {
    id: market.id,
    matchup: market.matchup,
    kickoffIso: market.kickoff,
    kickoff: formatKickoff(market.kickoff),
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
    drawLeg,
  };
};

const fetchMarkets = async (): Promise<MarketItem[]> => {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

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

  const response = await fetch(
    `/api/markets?sourceProvider=POLYMARKET&category=fifa-games&dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }
  );

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as { markets?: MarketItem[] };
  return payload.markets ?? [];
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
  onClick,
}: {
  team: { name: string; logo: string; color: string | null };
  draw?: boolean;
  onClick?: () => void;
}) => {
  if (draw) {
    return (
      <button
        type="button"
        onClick={onClick}
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
      className="w-full rounded-lg border px-3 py-2 font-semibold text-sm transition disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        backgroundColor: palette.background,
        color: palette.color,
        borderColor: palette.border,
      }}
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

const DashboardPage = () => {
  const [markets, setMarkets] = useState<MarketItem[]>([]);
  const [teamBrands, setTeamBrands] = useState<Record<string, TeamBranding>>(
    {}
  );
  const [liveStatuses, setLiveStatuses] = useState<Record<string, string>>({});
  const [selectedTrade, setSelectedTrade] = useState<SelectedTrade | null>(
    null
  );
  const [marketDetail, setMarketDetail] = useState<MarketDetail | null>(null);
  const [stake, setStake] = useState(25);
  const [pickSide, setPickSide] = useState<'YES' | 'NO'>('YES');
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loading, setLoading] = useState(true);

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

      const uniqueTeams = Array.from(
        new Set(
          loadedMarkets.flatMap((market) => [market.homeTeam, market.awayTeam])
        )
      );

      const branding = await fetchTeamBranding(uniqueTeams);

      if (!cancelled) {
        setTeamBrands(branding);
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
      .map((market) => toMarketCard(market, teamBrands))
      .filter((card): card is MarketCard => card !== null)
      .slice(0, 6);
  }, [markets, teamBrands]);

  useEffect(() => {
    if (marketCards.length === 0) {
      return;
    }

    let cancelled = false;

    const pollLiveStatuses = async () => {
      const response = await fetch('/api/live-event-time', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          events: marketCards.map((card) => ({
            matchup: card.matchup,
            kickoff: card.kickoffIso,
          })),
        }),
      });

      if (!response.ok || cancelled) {
        return;
      }

      const payload = (await response.json()) as {
        statuses?: Record<string, string>;
      };

      if (!cancelled) {
        setLiveStatuses(payload.statuses ?? {});
      }
    };

    void pollLiveStatuses();
    const interval = setInterval(() => {
      void pollLiveStatuses();
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
      setLoadingDetail(true);
      const detail = await fetchMarketDetail(selectedTrade);
      if (!cancelled) {
        setMarketDetail(detail);
        setLoadingDetail(false);
      }
    };

    void loadDetail();

    return () => {
      cancelled = true;
    };
  }, [selectedTrade]);

  const availableBalance = 1000;
  const openPositions = 0;
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

    setSelectedTrade({
      marketId: card.id,
      matchup: card.matchup,
      homeTeam: card.home.name,
      awayTeam: card.away.name,
      side,
      selectionLabel,
    });
    setPickSide('YES');
    setStake(25);
  };

  return (
    <main className="dashboard-arcade landing-arcade relative min-h-screen overflow-hidden pt-16">
      <div className="landing-arcade__glow" />
      <div className="landing-arcade__scanlines" />
      <div className="dashboard-arcade__content relative z-10 mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="font-bold text-3xl text-gray-900">Markets</h1>
        </div>

        {loading ? (
          <div className="landing-panel p-6 text-sm text-violet-900">
            Loading Polymarket FIFA markets...
          </div>
        ) : marketCards.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {marketCards.map((card) => (
              <div
                key={card.id}
                className="landing-panel p-6 transition-shadow hover:shadow-lg"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-lg text-violet-950">
                    {card.matchup}
                  </h3>
                  <span className="inline-block rounded-full bg-green-100 px-3 py-1 font-medium text-green-800 text-xs">
                    {liveStatuses[card.matchup] ?? 'OPEN'}
                  </span>
                </div>

                <div className="mb-4 flex items-center gap-2 text-violet-800/80 text-xs">
                  {card.kickoff}
                </div>

                <div className="flex flex-col gap-2">
                  <FlagButton
                    team={card.home}
                    onClick={() => openTradeModal(card, 'home')}
                  />
                  <FlagButton
                    team={card.home}
                    draw={true}
                    onClick={() => openTradeModal(card, 'draw')}
                  />
                  <FlagButton
                    team={card.away}
                    onClick={() => openTradeModal(card, 'away')}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="landing-panel p-6 text-sm text-violet-900">
            No active soccer team markets are currently available from
            Polymarket.
          </div>
        )}
      </div>

      <Dialog
        open={selectedTrade !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedTrade(null);
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="max-w-md border-violet-200 bg-white"
        >
          <DialogHeader>
            <DialogTitle className="text-violet-950">
              {selectedTrade?.selectionLabel ?? 'Selection'}
            </DialogTitle>
            <p className="text-sm text-violet-800">
              {selectedTrade ? selectedTrade.matchup : 'Loading selection...'}
            </p>
            <DialogClose
              aria-label="Close trade modal"
              className="absolute top-4 right-4 rounded-sm p-1 text-violet-700 transition hover:bg-violet-100"
            >
              x
            </DialogClose>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-violet-800">
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
                min="1"
                max={availableBalance}
                step="1"
                value={stake}
                onChange={(event) => setStake(Number(event.target.value))}
                className="w-full"
              />
            </div>

            <p className="text-sm text-violet-700">
              Available balance: ${availableBalance.toFixed(2)} · Open
              positions: {openPositions}
            </p>

            <div className="space-y-3">
              <p className="text-sm text-violet-900">Pick Side</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPickSide('YES')}
                  className={`rounded-md border px-3 py-2 font-semibold text-sm transition ${pickSide === 'YES' ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-violet-200 bg-white text-violet-900 hover:bg-violet-50'}`}
                >
                  YES{' '}
                  {marketDetail ? `$${marketDetail.yesPrice.toFixed(2)}` : '--'}
                </button>
                <button
                  type="button"
                  onClick={() => setPickSide('NO')}
                  className={`rounded-md border px-3 py-2 font-semibold text-sm transition ${pickSide === 'NO' ? 'border-rose-300 bg-rose-50 text-rose-900' : 'border-violet-200 bg-white text-violet-900 hover:bg-violet-50'}`}
                >
                  NO{' '}
                  {marketDetail ? `$${marketDetail.noPrice.toFixed(2)}` : '--'}
                </button>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm text-violet-900">
                  Expected Max Payout ({pickSide})
                </p>
                <p className="font-semibold text-sm text-violet-950">
                  ${expectedMaxPayout.toFixed(2)}
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={loadingDetail || !marketDetail || selectedPrice <= 0}
              className="w-full rounded-lg bg-violet-600 px-4 py-2 text-left font-semibold text-sm text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="block">Confirm BUY {pickSide}</span>
              <span className="block">
                {marketDetail ? `$${selectedPrice.toFixed(2)}` : '--'}
              </span>
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
};

export const Route = createFileRoute('/_public/dashboard')({
  component: DashboardPage,
});
