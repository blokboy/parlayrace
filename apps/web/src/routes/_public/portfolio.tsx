import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@starter/ui/components/shadcn/dialog';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';

type PositionSide = 'home' | 'draw' | 'away';
type BuySide = 'YES' | 'NO';

type PaperPosition = {
  id: string;
  marketId: string;
  matchup: string;
  homeTeam: string;
  awayTeam: string;
  side: PositionSide;
  buySide: BuySide;
  stake: number;
  entryPrice: number;
  quantity: number;
  kickoff: string;
  status: 'OPEN' | 'CLOSED';
  createdAt: string;
  closedAt: string | null;
  closeValue: number | null;
};

type PaperPortfolioState = {
  cash: number;
  positions: PaperPosition[];
};

type MarketLeg = {
  id: string;
  side: PositionSide;
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

type MarketDetail = {
  marketId: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  updatedAt: string | null;
};

type PositionValuation = {
  currentPrice: number;
  currentValue: number;
  question: string;
  updatedAt: string | null;
};

type TeamBranding = {
  name: string;
  logo: string;
  color: string | null;
};

type TeamMember = {
  id: string;
  name: string;
  email: string;
};

type TeamCommittedLeg = {
  positionId: string;
  shares: number;
};

type ParlayTeam = {
  id: string;
  name: string;
  captainUserId: string;
  members: TeamMember[];
  committedLegs: TeamCommittedLeg[];
  claimedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type SearchUser = {
  id: string;
  name: string;
  email: string;
};

const defaultPortfolio = (): PaperPortfolioState => ({
  cash: 1000,
  positions: [],
});

const roundToCents = (value: number) => Math.round(value * 100) / 100;

const fetchPortfolioStateForUser = async (): Promise<PaperPortfolioState> => {
  const response = await fetch('/api/paper-portfolio', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    return defaultPortfolio();
  }

  const payload = (await response.json()) as {
    state?: PaperPortfolioState;
  };

  return payload.state ?? defaultPortfolio();
};

const savePortfolioStateForUser = async (state: PaperPortfolioState) => {
  await fetch('/api/paper-portfolio', {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ state }),
  });
};

const fetchFifaMarkets = async (): Promise<MarketItem[]> => {
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
    { method: 'GET', headers: { Accept: 'application/json' } }
  );

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as { markets?: MarketItem[] };
  return payload.markets ?? [];
};

const fetchMarketDetail = async (
  marketId: string,
  side: PositionSide,
  homeTeam: string,
  awayTeam: string
): Promise<MarketDetail | null> => {
  const query = new URLSearchParams({ side, homeTeam, awayTeam });
  const response = await fetch(`/api/markets/${marketId}?${query.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as MarketDetail;
};

const fetchParlayTeams = async (): Promise<ParlayTeam[]> => {
  const response = await fetch('/api/parlay-teams', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as { teams?: ParlayTeam[] };
  return payload.teams ?? [];
};

const fetchTeamBranding = async (
  teamNames: string[]
): Promise<Record<string, TeamBranding>> => {
  if (teamNames.length === 0) {
    return {};
  }

  const response = await fetch(
    `/api/team-colors?teams=${encodeURIComponent(teamNames.join(','))}`,
    { method: 'GET', headers: { Accept: 'application/json' } }
  );

  if (!response.ok) {
    return {};
  }

  const payload = (await response.json()) as {
    teams?: Record<string, TeamBranding>;
  };

  return payload.teams ?? {};
};

const fetchLiveLabels = async (positions: PaperPosition[]) => {
  const events = positions
    .filter((position) => position.status === 'OPEN')
    .map((position) => ({
      matchup: position.matchup,
      kickoff: position.kickoff,
    }));

  if (events.length === 0) {
    return {} as Record<string, string>;
  }

  const response = await fetch('/api/live-event-time', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ events }),
  });

  if (!response.ok) {
    return {} as Record<string, string>;
  }

  const payload = (await response.json()) as {
    statuses?: Record<string, string>;
  };

  return payload.statuses ?? {};
};

const searchUsers = async (query: string): Promise<SearchUser[]> => {
  if (!query.trim()) {
    return [];
  }

  const response = await fetch(`/api/users?q=${encodeURIComponent(query)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as { users?: SearchUser[] };
  return payload.users ?? [];
};

const getLegStatus = (
  position: PaperPosition,
  valuation: PositionValuation | null,
  liveLabel: string | undefined
) => {
  if (position.status === 'CLOSED') {
    return 'Settled';
  }

  if (liveLabel === 'Final') {
    return 'Closing';
  }

  if (!valuation) {
    return 'Pending Price';
  }

  if (valuation.currentPrice >= 0.6) {
    return 'Favored';
  }

  if (valuation.currentPrice <= 0.4) {
    return 'At Risk';
  }

  return liveLabel ?? 'Active';
};

const PortfolioPage = () => {
  const [state, setState] = useState<PaperPortfolioState>(defaultPortfolio());
  const [valuations, setValuations] = useState<
    Record<string, PositionValuation>
  >({});
  const [markets, setMarkets] = useState<MarketItem[]>([]);
  const [teams, setTeams] = useState<ParlayTeam[]>([]);
  const [liveLabels, setLiveLabels] = useState<Record<string, string>>({});
  const [teamBranding, setTeamBranding] = useState<
    Record<string, TeamBranding>
  >({});
  const [users, setUsers] = useState<SearchUser[]>([]);

  const [newTeamName, setNewTeamName] = useState('');
  const [memberQuery, setMemberQuery] = useState('');

  const [selectedMarketId, setSelectedMarketId] = useState('');
  const [selectedPositionSide, setSelectedPositionSide] =
    useState<PositionSide>('home');
  const [selectedBuySide, setSelectedBuySide] = useState<BuySide>('YES');
  const [selectedStake, setSelectedStake] = useState('25');

  const [commitTeamId, setCommitTeamId] = useState('');
  const [commitPositionId, setCommitPositionId] = useState('');
  const [commitShares, setCommitShares] = useState('10');
  const [sellPositionId, setSellPositionId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);

  const reloadTeams = async () => {
    const nextTeams = await fetchParlayTeams();
    setTeams(nextTeams);
  };

  const refreshDerivedData = async (positions: PaperPosition[]) => {
    const openPositions = positions.filter(
      (position) => position.status === 'OPEN'
    );

    const valuationEntries = await Promise.all(
      openPositions.map(async (position) => {
        const detail = await fetchMarketDetail(
          position.marketId,
          position.side,
          position.homeTeam,
          position.awayTeam
        );

        if (!detail) {
          return [position.id, null] as const;
        }

        const currentPrice =
          position.buySide === 'YES' ? detail.yesPrice : detail.noPrice;

        return [
          position.id,
          {
            currentPrice,
            currentValue: roundToCents(currentPrice * position.quantity),
            question: detail.question,
            updatedAt: detail.updatedAt,
          },
        ] as const;
      })
    );

    setValuations(
      valuationEntries.reduce<Record<string, PositionValuation>>(
        (acc, entry) => {
          const [positionId, valuation] = entry;
          if (valuation) {
            acc[positionId] = valuation;
          }
          return acc;
        },
        {}
      )
    );

    setLiveLabels(await fetchLiveLabels(openPositions));

    const teamNames = Array.from(
      new Set(
        openPositions.flatMap((position) => [
          position.homeTeam,
          position.awayTeam,
        ])
      )
    );
    setTeamBranding(await fetchTeamBranding(teamNames));
  };

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      setLoading(true);
      const [nextState, nextMarkets, nextTeams] = await Promise.all([
        fetchPortfolioStateForUser(),
        fetchFifaMarkets(),
        fetchParlayTeams(),
      ]);

      if (cancelled) {
        return;
      }

      setState(nextState);
      setMarkets(nextMarkets);
      setTeams(nextTeams);
      setSelectedMarketId(nextMarkets[0]?.id ?? '');
      await refreshDerivedData(nextState.positions);
      if (!cancelled) {
        setLoading(false);
      }
    };

    void init();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      void reloadTeams();
      void refreshDerivedData(state.positions);
    }, 30000);

    return () => {
      clearInterval(interval);
    };
  }, [state.positions]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const next = await searchUsers(memberQuery);
      if (!cancelled) {
        setUsers(next);
      }
    };

    if (memberQuery.trim().length >= 2) {
      void run();
    } else {
      setUsers([]);
    }

    return () => {
      cancelled = true;
    };
  }, [memberQuery]);

  const openPositions = useMemo(
    () => state.positions.filter((position) => position.status === 'OPEN'),
    [state.positions]
  );

  const closedPositions = useMemo(
    () => state.positions.filter((position) => position.status === 'CLOSED'),
    [state.positions]
  );

  const openValue = useMemo(
    () =>
      roundToCents(
        openPositions.reduce((total, position) => {
          return (
            total + (valuations[position.id]?.currentValue ?? position.stake)
          );
        }, 0)
      ),
    [openPositions, valuations]
  );

  const totalEquity = roundToCents(state.cash + openValue);
  const sellPosition = useMemo(
    () => state.positions.find((position) => position.id === sellPositionId) ?? null,
    [sellPositionId, state.positions]
  );
  const sellPositionValuation = sellPosition
    ? valuations[sellPosition.id] ?? null
    : null;
  const sellPositionCurrentValue = sellPosition
    ? sellPositionValuation?.currentValue ?? sellPosition.stake
    : 0;

  const persistAndRefresh = async (next: PaperPortfolioState) => {
    setState(next);
    await savePortfolioStateForUser(next);
    await refreshDerivedData(next.positions);
  };

  const handleAddPosition = async () => {
    const selectedMarket = markets.find(
      (market) => market.id === selectedMarketId
    );
    const stakeValue = Number(selectedStake);

    if (!selectedMarket || !Number.isFinite(stakeValue) || stakeValue <= 0) {
      return;
    }

    if (stakeValue > state.cash) {
      return;
    }

    const detail = await fetchMarketDetail(
      selectedMarket.id,
      selectedPositionSide,
      selectedMarket.homeTeam,
      selectedMarket.awayTeam
    );

    if (!detail) {
      return;
    }

    const entryPrice =
      selectedBuySide === 'YES' ? detail.yesPrice : detail.noPrice;
    if (entryPrice <= 0) {
      return;
    }

    const position: PaperPosition = {
      id: crypto.randomUUID(),
      marketId: selectedMarket.id,
      matchup: selectedMarket.matchup,
      homeTeam: selectedMarket.homeTeam,
      awayTeam: selectedMarket.awayTeam,
      side: selectedPositionSide,
      buySide: selectedBuySide,
      stake: roundToCents(stakeValue),
      entryPrice,
      quantity: roundToCents(stakeValue / entryPrice),
      kickoff: selectedMarket.kickoff,
      status: 'OPEN',
      createdAt: new Date().toISOString(),
      closedAt: null,
      closeValue: null,
    };

    const next: PaperPortfolioState = {
      cash: roundToCents(state.cash - stakeValue),
      positions: [position, ...state.positions],
    };

    await persistAndRefresh(next);
  };

  const handleSellPosition = async (positionId: string) => {
    const position = state.positions.find((entry) => entry.id === positionId);
    if (!position || position.status !== 'OPEN') {
      return;
    }

    const currentValue =
      valuations[position.id]?.currentValue ?? position.stake;

    const nextPositions = state.positions.map((entry) => {
      if (entry.id !== positionId) {
        return entry;
      }

      return {
        ...entry,
        status: 'CLOSED' as const,
        closedAt: new Date().toISOString(),
        closeValue: currentValue,
      };
    });

    const next: PaperPortfolioState = {
      cash: roundToCents(state.cash + currentValue),
      positions: nextPositions,
    };

    await persistAndRefresh(next);
  };

  const handleCreateTeam = async () => {
    const name = newTeamName.trim();
    if (!name) {
      return;
    }

    await fetch('/api/parlay-teams', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'create', name }),
    });

    setNewTeamName('');
    await reloadTeams();
  };

  const handleCommitShares = async () => {
    const shares = Number(commitShares);
    if (
      !commitTeamId ||
      !commitPositionId ||
      !Number.isFinite(shares) ||
      shares <= 0
    ) {
      return;
    }

    await fetch('/api/parlay-teams', {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'commit-share',
        teamId: commitTeamId,
        positionId: commitPositionId,
        shares,
      }),
    });

    await reloadTeams();
  };

  const handleClaim = async (teamId: string) => {
    await fetch('/api/parlay-teams', {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'claim', teamId }),
    });

    await reloadTeams();
  };

  const handleConfirmSellPosition = async () => {
    if (!sellPositionId) {
      return;
    }

    await handleSellPosition(sellPositionId);
    setSellPositionId(null);
  };

  return (
    <main className="dashboard-arcade landing-arcade relative min-h-screen overflow-hidden pt-16">
      <div className="landing-arcade__glow" />
      <div className="landing-arcade__scanlines" />
      <div className="dashboard-arcade__content relative z-10 mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <header className="landing-panel p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-bold text-3xl text-gray-900">Portfolio</h1>
              <p className="text-sm text-violet-800">
                Open paper trades for this user.
              </p>
            </div>
            <p className="text-sm text-violet-800">Sign in to create a Parlay Team.</p>
          </div>
        </header>

        {loading ? (
          <div className="landing-panel p-6 text-sm text-violet-900">
            Loading portfolio data
          </div>
        ) : (
          <>
            <section className="grid gap-4 md:grid-cols-3">
              <div className="landing-panel p-5">
                <p className="text-violet-800 text-xs">Cash</p>
                <p className="font-semibold text-2xl text-violet-950">
                  ${state.cash.toFixed(2)}
                </p>
              </div>
              <div className="landing-panel p-5">
                <p className="text-violet-800 text-xs">Open Position Value</p>
                <p className="font-semibold text-2xl text-violet-950">
                  ${openValue.toFixed(2)}
                </p>
              </div>
              <div className="landing-panel p-5">
                <p className="text-violet-800 text-xs">Total Equity</p>
                <p className="font-semibold text-2xl text-violet-950">
                  ${totalEquity.toFixed(2)}
                </p>
              </div>
            </section>

            <section className="landing-panel space-y-3 p-6">
              <h2 className="font-semibold text-lg text-violet-950">
                Add Position
              </h2>
              <div className="grid gap-3 md:grid-cols-4">
                <select
                  value={selectedMarketId}
                  onChange={(event) => setSelectedMarketId(event.target.value)}
                  className="rounded-md border border-violet-200 bg-white px-3 py-2 text-sm"
                >
                  {markets.map((market) => (
                    <option
                      key={market.id}
                      value={market.id}
                    >
                      {market.matchup}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedPositionSide}
                  onChange={(event) =>
                    setSelectedPositionSide(event.target.value as PositionSide)
                  }
                  className="rounded-md border border-violet-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="home">Home Leg</option>
                  <option value="draw">Draw Leg</option>
                  <option value="away">Away Leg</option>
                </select>
                <select
                  value={selectedBuySide}
                  onChange={(event) =>
                    setSelectedBuySide(event.target.value as BuySide)
                  }
                  className="rounded-md border border-violet-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="YES">Buy YES</option>
                  <option value="NO">Buy NO</option>
                </select>
                <div className="flex gap-2">
                  <input
                    value={selectedStake}
                    onChange={(event) => setSelectedStake(event.target.value)}
                    className="w-full rounded-md border border-violet-200 bg-white px-3 py-2 text-sm"
                    type="number"
                    min="1"
                  />
                  <button
                    type="button"
                    onClick={() => void handleAddPosition()}
                    className="rounded-md bg-violet-600 px-4 py-2 font-semibold text-sm text-white transition hover:bg-violet-700"
                  >
                    Buy
                  </button>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="font-semibold text-lg text-violet-950">
                Open Positions
              </h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {openPositions.map((position) => {
                  const valuation = valuations[position.id];
                  const label = liveLabels[position.matchup] ?? 'OPEN';
                  const homeBrand = teamBranding[position.homeTeam];
                  const awayBrand = teamBranding[position.awayTeam];

                  return (
                    <div
                      key={position.id}
                      className="landing-panel p-6 transition-shadow hover:shadow-lg"
                    >
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <h3 className="font-semibold text-lg text-violet-950">
                          {position.matchup}
                        </h3>
                        <span className="inline-block rounded-full bg-green-100 px-3 py-1 font-medium text-green-800 text-xs">
                          {label}
                        </span>
                      </div>

                      <div className="mb-4 flex items-center gap-2 text-violet-800/80 text-xs">
                        {new Intl.DateTimeFormat('en-US', {
                          month: 'short',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        }).format(new Date(position.kickoff))}
                      </div>

                      <div className="space-y-2 text-sm text-violet-900">
                        <div className="flex items-center gap-2">
                          {homeBrand?.logo ? (
                            <img
                              src={homeBrand.logo}
                              alt={position.homeTeam}
                              className="h-4 w-6 rounded object-cover"
                            />
                          ) : null}
                          <span>{position.homeTeam}</span>
                          <span>vs</span>
                          <span>{position.awayTeam}</span>
                          {awayBrand?.logo ? (
                            <img
                              src={awayBrand.logo}
                              alt={position.awayTeam}
                              className="h-4 w-6 rounded object-cover"
                            />
                          ) : null}
                        </div>

                        <p>
                          Entry: {position.buySide} ${position.entryPrice.toFixed(2)}
                        </p>
                        <p>
                          Now:{' '}
                          {valuation
                            ? `$${valuation.currentPrice.toFixed(2)}`
                            : '--'}
                        </p>
                        <p>
                          Value:{' '}
                          {valuation
                            ? `$${valuation.currentValue.toFixed(2)}`
                            : `$${position.stake.toFixed(2)}`}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => setSellPositionId(position.id)}
                        className="mt-4 w-full rounded-md border border-violet-200 px-3 py-2 font-semibold text-violet-900 text-xs transition hover:bg-violet-50"
                      >
                        Sell
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="landing-panel space-y-4 p-6">
                <h2 className="font-semibold text-lg text-violet-950">
                  Parlay Teams
                </h2>

                <div className="flex gap-2">
                  <input
                    value={newTeamName}
                    onChange={(event) => setNewTeamName(event.target.value)}
                    className="w-full rounded-md border border-violet-200 bg-white px-3 py-2 text-sm"
                    placeholder="New team name"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCreateTeam()}
                    className="rounded-md bg-violet-600 px-4 py-2 font-semibold text-sm text-white transition hover:bg-violet-700"
                  >
                    Create
                  </button>
                </div>

                <div className="grid gap-2 md:grid-cols-3">
                  <select
                    value={commitTeamId}
                    onChange={(event) => setCommitTeamId(event.target.value)}
                    className="rounded-md border border-violet-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Select Team</option>
                    {teams.map((team) => (
                      <option
                        key={team.id}
                        value={team.id}
                      >
                        {team.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={commitPositionId}
                    onChange={(event) =>
                      setCommitPositionId(event.target.value)
                    }
                    className="rounded-md border border-violet-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Select Position</option>
                    {openPositions.map((position) => (
                      <option
                        key={position.id}
                        value={position.id}
                      >
                        {position.matchup}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <input
                      value={commitShares}
                      onChange={(event) => setCommitShares(event.target.value)}
                      className="w-full rounded-md border border-violet-200 bg-white px-3 py-2 text-sm"
                      type="number"
                      min="1"
                    />
                    <button
                      type="button"
                      onClick={() => void handleCommitShares()}
                      className="rounded-md border border-violet-200 px-3 py-2 font-semibold text-sm text-violet-900 transition hover:bg-violet-50"
                    >
                      Commit
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  {teams.map((team) => (
                    <div
                      key={team.id}
                      className="rounded-md border border-violet-100 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-sm text-violet-950">
                          {team.name}
                        </p>
                        <button
                          type="button"
                          onClick={() => void handleClaim(team.id)}
                          className="rounded-md border border-violet-200 px-2 py-1 font-semibold text-violet-900 text-xs transition hover:bg-violet-50"
                        >
                          Claim
                        </button>
                      </div>
                      <p className="text-violet-800 text-xs">
                        {team.committedLegs.length} committed legs ·{' '}
                        {team.claimedAt ? 'Payout claimed' : 'Unclaimed'}
                      </p>
                      <ul className="mt-2 space-y-1 text-violet-700 text-xs">
                        {team.committedLegs.map((leg) => {
                          const position = state.positions.find(
                            (entry) => entry.id === leg.positionId
                          );
                          const valuation = valuations[leg.positionId] ?? null;
                          const liveLabel = position
                            ? liveLabels[position.matchup]
                            : undefined;
                          return (
                            <li key={`${team.id}-${leg.positionId}`}>
                              {position?.matchup ?? 'Unknown leg'} ·{' '}
                              {leg.shares} shares ·{' '}
                              {position
                                ? getLegStatus(position, valuation, liveLabel)
                                : 'Missing'}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>

              <div className="landing-panel space-y-4 p-6">
                <h2 className="font-semibold text-lg text-violet-950">
                  Team Member Search
                </h2>
                <input
                  value={memberQuery}
                  onChange={(event) => setMemberQuery(event.target.value)}
                  className="w-full rounded-md border border-violet-200 bg-white px-3 py-2 text-sm"
                  placeholder="Search users by name or email"
                />
                <ul className="space-y-2">
                  {users.map((entry) => (
                    <li
                      key={entry.id}
                      className="rounded-md border border-violet-100 px-3 py-2"
                    >
                      <p className="font-semibold text-sm text-violet-950">
                        {entry.name}
                      </p>
                      <p className="text-violet-800 text-xs">{entry.email}</p>
                    </li>
                  ))}
                </ul>

                <div>
                  <h3 className="mb-2 font-semibold text-sm text-violet-950">
                    Closed Positions
                  </h3>
                  <ul className="space-y-1 text-violet-800 text-xs">
                    {closedPositions.map((position) => (
                      <li key={position.id}>
                        {position.matchup} · Closed $
                        {position.closeValue?.toFixed(2) ?? '0.00'}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          </>
        )}
      </div>

      <Dialog
        open={sellPosition !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSellPositionId(null);
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="max-w-md border-violet-200 bg-white"
        >
          <DialogHeader>
            <DialogTitle className="text-violet-950">Confirm Sell</DialogTitle>
            <p className="text-sm text-violet-800">
              {sellPosition ? sellPosition.matchup : 'Loading position...'}
            </p>
            <DialogClose
              aria-label="Close sell modal"
              className="absolute top-4 right-4 rounded-sm p-1 text-violet-700 transition hover:bg-violet-100"
            >
              x
            </DialogClose>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-violet-800">
              You are about to close this paper position.
            </p>

            <div className="rounded-md border border-violet-200 bg-violet-50/40 p-3 text-sm text-violet-900">
              <p>
                Entry: {sellPosition?.buySide ?? '--'}{' '}
                {sellPosition ? `$${sellPosition.entryPrice.toFixed(2)}` : '--'}
              </p>
              <p>
                Current Value: ${sellPositionCurrentValue.toFixed(2)}
              </p>
            </div>

            <button
              type="button"
              disabled={!sellPosition}
              onClick={() => void handleConfirmSellPosition()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 font-semibold text-sm text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span>Confirm SELL</span>
              <span>${sellPositionCurrentValue.toFixed(2)}</span>
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
};

export const Route = createFileRoute('/_public/portfolio')({
  beforeLoad: ({ context }) => {
    if (!context.user) {
      throw redirect({
        to: '/auth/login',
        search: {
          redirect: '/portfolio',
        },
      });
    }
  },
  component: PortfolioPage,
});
