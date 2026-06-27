import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@starter/ui/components/shadcn/dialog';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';

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

type TeamMember = {
  id: string;
  username: string;
};

type TeamCommittedLeg = {
  id: string;
  parlayId: string;
  positionId: string;
  sequence: number;
  addedByUserId: string;
  addedByUsername: string;
  shares: number;
  stake: number;
  entryPrice: number;
  marketId: string | null;
  cardTitle: string;
  optionLabel: string;
  side: string;
  kickoff: string;
  homeTeam: string;
  awayTeam: string;
  positionSide: PositionSide;
  buySide: BuySide;
  placedAt: string;
  result: 'PENDING' | 'WON' | 'LOST';
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
  status: 'ACTIVE' | 'LOST' | 'WON';
  claimableAmount: number;
  settledAmount: number;
  canClaim: boolean;
  hasClaimed: boolean;
  claimAmount: number;
};

type SearchUser = {
  id: string;
  username: string;
};

type MarketDetail = {
  marketId: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  updatedAt: string | null;
};

type TeamLegLiveMetrics = {
  currentPrice: number | null;
  expectedPayoff: number | null;
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

type TeamBranding = {
  name: string;
  logo: string;
  color: string | null;
};

const countryCodeByName: Record<string, string> = {
  argentina: 'AR',
  australia: 'AU',
  belgium: 'BE',
  brazil: 'BR',
  cameroon: 'CM',
  canada: 'CA',
  croatia: 'HR',
  denmark: 'DK',
  ecuador: 'EC',
  england: 'GB',
  france: 'FR',
  germany: 'DE',
  ghana: 'GH',
  iran: 'IR',
  japan: 'JP',
  mexico: 'MX',
  morocco: 'MA',
  netherlands: 'NL',
  panama: 'PA',
  poland: 'PL',
  portugal: 'PT',
  qatar: 'QA',
  'saudi arabia': 'SA',
  senegal: 'SN',
  serbia: 'RS',
  'south korea': 'KR',
  'korea republic': 'KR',
  spain: 'ES',
  switzerland: 'CH',
  tunisia: 'TN',
  'united states': 'US',
  usa: 'US',
  uruguay: 'UY',
  wales: 'GB',
};

const countryNameToFlag = (name: string): string => {
  const code = countryCodeByName[name.trim().toLowerCase()];
  if (!code || code.length !== 2) {
    return '';
  }

  return code
    .toUpperCase()
    .split('')
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join('');
};

const formatLiveSummary = (
  status: LiveStatus | undefined,
  fallback: string
): string => {
  if (!status) {
    return fallback;
  }

  if (status.eventTime ?? status.statusLabel) {
    return status.eventTime ?? status.statusLabel;
  }

  return fallback;
};

const getLiveBadgeLabel = (status: LiveStatus | undefined): string => {
  if (!status) {
    return 'OPEN';
  }

  if (status.scoreLabel) {
    return status.scoreLabel;
  }

  if (status.homeScore !== null && status.awayScore !== null) {
    return `${status.homeScore}-${status.awayScore}`;
  }

  return status.statusLabel;
};

const getLegBadgeClassName = (
  leg: TeamCommittedLeg,
  status: LiveStatus | undefined
) => {
  if (leg.result === 'WON') {
    return 'border-green-200 text-green-700';
  }

  if (leg.result === 'LOST') {
    return 'border-red-200 text-red-700';
  }

  if (status?.hasStarted) {
    return 'border-violet-200 text-violet-700';
  }

  return 'border-blue-200 text-blue-700';
};

const MAX_ADDITIONAL_MEMBERS = 9;
const roundToCents = (value: number) => Math.round(value * 100) / 100;

const defaultPortfolio = (): PaperPortfolioState => ({
  cash: 1000,
  positions: [],
});

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

const fetchMarketDetail = async (
  position: PaperPosition
): Promise<MarketDetail | null> => {
  const query = new URLSearchParams({
    side: position.side,
    homeTeam: position.homeTeam,
    awayTeam: position.awayTeam,
  });

  const response = await fetch(
    `/api/markets/${position.marketId}?${query.toString()}`,
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

const fetchTeamBranding = async (
  teamNames: string[]
): Promise<Record<string, TeamBranding>> => {
  if (teamNames.length === 0) {
    return {};
  }

  const response = await fetch(
    `/api/team-colors?teams=${encodeURIComponent(teamNames.join(','))}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }
  );

  if (!response.ok) {
    return {};
  }

  const payload = (await response.json()) as {
    teams?: Record<string, TeamBranding>;
  };

  return payload.teams ?? {};
};

const createParlayTeam = async (
  name: string,
  memberUsernames: string[],
  captainUsername: string | null
): Promise<{ team: ParlayTeam | null; message: string | null }> => {
  const response = await fetch('/api/parlay-teams', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'create',
      name,
      memberUsernames,
      captainUsername,
    }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      message?: string;
      error?: string;
    };

    return {
      team: null,
      message:
        payload.message ??
        (payload.error
          ? String(payload.error)
          : 'Failed to create Parlay Team.'),
    };
  }

  const payload = (await response.json()) as {
    team?: ParlayTeam;
  };

  return {
    team: payload.team ?? null,
    message: null,
  };
};

const commitShareToParlayTeam = async (
  teamId: string,
  positionId: string,
  shares: number
): Promise<ParlayTeam | null> => {
  const response = await fetch('/api/parlay-teams', {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'commit-share',
      teamId,
      positionId,
      shares,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    team?: ParlayTeam;
  };

  return payload.team ?? null;
};

const claimParlayTeam = async (teamId: string): Promise<ParlayTeam | null> => {
  const response = await fetch('/api/parlay-teams', {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'claim',
      teamId,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    team?: ParlayTeam;
  };

  return payload.team ?? null;
};

const searchUsersByUsername = async (query: string): Promise<SearchUser[]> => {
  const response = await fetch(`/api/users?q=${encodeURIComponent(query)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as {
    users?: SearchUser[];
  };

  return payload.users ?? [];
};

const formatTradeTime = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
};

const kickoffKey = (value: string): string | null => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 16);
};

const PortfolioPage = () => {
  const { username } = Route.useRouteContext();
  const [portfolioState, setPortfolioState] = useState<PaperPortfolioState>(
    defaultPortfolio()
  );
  const [parlayTeams, setParlayTeams] = useState<ParlayTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const [memberResults, setMemberResults] = useState<SearchUser[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<SearchUser[]>([]);
  const [searchingMembers, setSearchingMembers] = useState(false);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [teamFeedback, setTeamFeedback] = useState<string | null>(null);
  const [selectedParlayTeam, setSelectedParlayTeam] =
    useState<ParlayTeam | null>(null);
  const [selectedTeamPositionId, setSelectedTeamPositionId] = useState('');
  const [sharesToCommit, setSharesToCommit] = useState(0);
  const [committingShare, setCommittingShare] = useState(false);
  const [teamModalFeedback, setTeamModalFeedback] = useState<string | null>(
    null
  );
  const [teamLegMetricsById, setTeamLegMetricsById] = useState<
    Record<string, TeamLegLiveMetrics>
  >({});
  const [teamLegLiveStatusesById, setTeamLegLiveStatusesById] = useState<
    Record<string, LiveStatus>
  >({});
  const teamLegLiveStatusesRef = useRef<Record<string, LiveStatus>>({});
  const [sellPosition, setSellPosition] = useState<PaperPosition | null>(null);
  const [sellDetail, setSellDetail] = useState<MarketDetail | null>(null);
  const [sellShares, setSellShares] = useState(0);
  const [loadingSellDetail, setLoadingSellDetail] = useState(false);
  const [selling, setSelling] = useState(false);
  const [positionCurrentPricesById, setPositionCurrentPricesById] = useState<
    Record<string, number>
  >({});
  const [teamBrandingByName, setTeamBrandingByName] = useState<
    Record<string, TeamBranding>
  >({});

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const [portfolio, teams] = await Promise.all([
        fetchPortfolioStateForUser(),
        fetchParlayTeams(),
      ]);

      if (cancelled) {
        return;
      }

      setPortfolioState(portfolio);
      setParlayTeams(teams);
      setLoading(false);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!teamModalOpen) {
      return;
    }

    let cancelled = false;

    const runSearch = async () => {
      setSearchingMembers(true);
      const users = await searchUsersByUsername(memberQuery.trim());

      if (cancelled) {
        return;
      }

      setMemberResults(users);
      setSearchingMembers(false);
    };

    void runSearch();

    return () => {
      cancelled = true;
    };
  }, [teamModalOpen, memberQuery]);

  useEffect(() => {
    if (!sellPosition) {
      setSellDetail(null);
      return;
    }

    let cancelled = false;

    const loadSellDetail = async () => {
      setLoadingSellDetail(true);
      const detail = await fetchMarketDetail(sellPosition);

      if (!cancelled) {
        setSellDetail(detail);
        setLoadingSellDetail(false);
      }
    };

    void loadSellDetail();

    return () => {
      cancelled = true;
    };
  }, [sellPosition]);

  const openPositions = useMemo(
    () =>
      portfolioState.positions.filter((position) => position.status === 'OPEN'),
    [portfolioState.positions]
  );

  useEffect(() => {
    if (openPositions.length === 0) {
      setPositionCurrentPricesById({});
      return;
    }

    let cancelled = false;

    const loadCurrentPrices = async () => {
      const entries = await Promise.all(
        openPositions.map(async (position) => {
          const detail = await fetchMarketDetail(position);

          if (!detail) {
            return [position.id, position.entryPrice] as const;
          }

          const currentPrice =
            position.buySide === 'NO' ? detail.noPrice : detail.yesPrice;

          return [position.id, currentPrice] as const;
        })
      );

      if (cancelled) {
        return;
      }

      setPositionCurrentPricesById(Object.fromEntries(entries));
    };

    void loadCurrentPrices();

    return () => {
      cancelled = true;
    };
  }, [openPositions]);

  useEffect(() => {
    const teamNames = Array.from(
      new Set(
        openPositions.flatMap((position) => [
          position.homeTeam,
          position.awayTeam,
        ])
      )
    );

    if (teamNames.length === 0) {
      setTeamBrandingByName({});
      return;
    }

    let cancelled = false;

    const loadTeamBranding = async () => {
      const teams = await fetchTeamBranding(teamNames);
      if (!cancelled) {
        setTeamBrandingByName(teams);
      }
    };

    void loadTeamBranding();

    return () => {
      cancelled = true;
    };
  }, [openPositions]);

  const getPositionCurrentPrice = (position: PaperPosition) => {
    return positionCurrentPricesById[position.id] ?? position.entryPrice;
  };

  const deployedCapital = useMemo(
    () =>
      openPositions.reduce((sum, position) => {
        const currentPrice = positionCurrentPricesById[position.id];
        const effectivePrice =
          typeof currentPrice === 'number' ? currentPrice : position.entryPrice;

        return sum + position.quantity * effectivePrice;
      }, 0),
    [openPositions, positionCurrentPricesById]
  );

  const positionsById = useMemo(() => {
    return new Map(
      portfolioState.positions.map((position) => [position.id, position])
    );
  }, [portfolioState.positions]);

  const teamMetricsById = useMemo(() => {
    return parlayTeams.reduce<
      Record<
        string,
        {
          totalStaked: number;
          potentialPayout: number;
        }
      >
    >((acc, team) => {
      const totalStaked = team.committedLegs.reduce(
        (sum, leg) => sum + leg.stake,
        0
      );

      const potentialPayout = roundToCents(
        team.committedLegs.reduce((sum, leg) => sum + leg.shares, 0)
      );

      acc[team.id] = {
        totalStaked,
        potentialPayout,
      };

      return acc;
    }, {});
  }, [parlayTeams, positionsById]);

  const selectedTeamOpenPositions = useMemo(() => {
    if (!selectedParlayTeam) {
      return [] as PaperPosition[];
    }

    const firstLeg = [...selectedParlayTeam.committedLegs].sort(
      (a, b) => a.sequence - b.sequence
    )[0];
    const firstLegKickoffMs = firstLeg
      ? new Date(firstLeg.kickoff).getTime()
      : Number.NaN;
    const firstLegStarted =
      Number.isFinite(firstLegKickoffMs) && firstLegKickoffMs <= Date.now();

    if (firstLegStarted) {
      return [] as PaperPosition[];
    }

    const teamPositionIds = new Set(
      selectedParlayTeam.committedLegs.map((leg) => leg.positionId)
    );
    const teamKickoffKeys = new Set(
      selectedParlayTeam.committedLegs
        .map((leg) => kickoffKey(leg.kickoff))
        .filter((value): value is string => Boolean(value))
    );

    return openPositions.filter((position) => {
      if (teamPositionIds.has(position.id)) {
        return false;
      }

      const positionKickoffKey = kickoffKey(position.kickoff);
      if (!positionKickoffKey) {
        return true;
      }

      return !teamKickoffKeys.has(positionKickoffKey);
    });
  }, [openPositions, positionsById, selectedParlayTeam]);

  const selectedTeamPosition = useMemo(() => {
    return (
      selectedTeamOpenPositions.find(
        (position) => position.id === selectedTeamPositionId
      ) ?? null
    );
  }, [selectedTeamOpenPositions, selectedTeamPositionId]);

  const selectedParlayFirstLegStarted = useMemo(() => {
    if (!selectedParlayTeam || selectedParlayTeam.committedLegs.length === 0) {
      return false;
    }

    const firstLeg = [...selectedParlayTeam.committedLegs].sort(
      (a, b) => a.sequence - b.sequence
    )[0];
    const firstLegKickoffMs = new Date(firstLeg.kickoff).getTime();

    return (
      Number.isFinite(firstLegKickoffMs) && firstLegKickoffMs <= Date.now()
    );
  }, [selectedParlayTeam]);

  useEffect(() => {
    teamLegLiveStatusesRef.current = teamLegLiveStatusesById;
  }, [teamLegLiveStatusesById]);

  useEffect(() => {
    if (!selectedParlayTeam || selectedParlayTeam.committedLegs.length === 0) {
      setTeamLegLiveStatusesById({});
      return;
    }

    let cancelled = false;

    const pollLiveStatuses = async (legs: TeamCommittedLeg[]) => {
      const response = await fetch('/api/live-event-time', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          events: legs.map((leg) => ({
            marketId: leg.id,
            matchup: leg.cardTitle,
            kickoff: leg.kickoff,
            homeTeam: leg.homeTeam,
            awayTeam: leg.awayTeam,
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
        setTeamLegLiveStatusesById(payload.statuses ?? {});
      }
    };

    const pollIfNeeded = async () => {
      const now = Date.now();
      const legsForPolling = selectedParlayTeam.committedLegs.filter((leg) => {
        const kickoffTime = new Date(leg.kickoff).getTime();
        if (Number.isNaN(kickoffTime) || kickoffTime > now) {
          return false;
        }

        const status = teamLegLiveStatusesRef.current[leg.id];
        return !status?.isFinal;
      });

      if (legsForPolling.length === 0) {
        return;
      }

      await pollLiveStatuses(legsForPolling);
    };

    void pollLiveStatuses(selectedParlayTeam.committedLegs);
    const interval = setInterval(() => {
      void pollIfNeeded();
    }, 60000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedParlayTeam]);

  useEffect(() => {
    if (!selectedParlayTeam || selectedParlayTeam.committedLegs.length === 0) {
      setTeamLegMetricsById({});
      return;
    }

    let cancelled = false;

    const loadLegMetrics = async () => {
      const entries = await Promise.all(
        selectedParlayTeam.committedLegs.map(async (leg) => {
          if (!leg.marketId) {
            return [
              leg.id,
              { currentPrice: null, expectedPayoff: null },
            ] as const;
          }

          const query = new URLSearchParams({
            side: leg.positionSide,
            homeTeam: leg.homeTeam,
            awayTeam: leg.awayTeam,
          });

          const response = await fetch(
            `/api/markets/${leg.marketId}?${query.toString()}`,
            {
              method: 'GET',
              headers: { Accept: 'application/json' },
            }
          );

          if (!response.ok) {
            return [
              leg.id,
              { currentPrice: null, expectedPayoff: null },
            ] as const;
          }

          const detail = (await response.json()) as MarketDetail;
          const currentPrice =
            leg.buySide === 'NO' ? detail.noPrice : detail.yesPrice;

          return [
            leg.id,
            {
              currentPrice,
              expectedPayoff: roundToCents(leg.shares * currentPrice),
            },
          ] as const;
        })
      );

      if (cancelled) {
        return;
      }

      setTeamLegMetricsById(Object.fromEntries(entries));
    };

    void loadLegMetrics();

    return () => {
      cancelled = true;
    };
  }, [selectedParlayTeam]);

  const createTeamFromModal = async () => {
    const name = teamName.trim();
    if (!name || creatingTeam) {
      return;
    }

    if (selectedMembers.length === 0) {
      setTeamFeedback('Add at least one other user to your Parlay Team.');
      return;
    }

    if (selectedMembers.length > MAX_ADDITIONAL_MEMBERS) {
      setTeamFeedback('You can add up to 9 members (10 total with captain).');
      return;
    }

    setCreatingTeam(true);
    setTeamFeedback(null);

    const createResult = await createParlayTeam(
      name,
      selectedMembers.map((member) => member.username),
      username
    );
    const nextTeam = createResult.team;

    if (!nextTeam) {
      setTeamFeedback(createResult.message ?? 'Failed to create Parlay Team.');
      setCreatingTeam(false);
      return;
    }

    setParlayTeams((current) => [nextTeam, ...current]);
    setTeamName('');
    setMemberQuery('');
    setMemberResults([]);
    setSelectedMembers([]);
    setCreatingTeam(false);
    setTeamModalOpen(false);
    setTeamFeedback(`Created Parlay Team "${nextTeam.name}".`);
  };

  const addMember = (member: SearchUser) => {
    setSelectedMembers((current) => {
      if (current.some((entry) => entry.id === member.id)) {
        return current;
      }

      if (current.length >= MAX_ADDITIONAL_MEMBERS) {
        setTeamFeedback('You can add up to 9 members (10 total with captain).');
        return current;
      }

      return [...current, member];
    });
  };

  const removeMember = (memberId: string) => {
    setTeamFeedback(null);
    setSelectedMembers((current) =>
      current.filter((member) => member.id !== memberId)
    );
  };

  const openParlayTeamModal = (team: ParlayTeam) => {
    setSelectedParlayTeam(team);
    setTeamModalFeedback(null);
    setSelectedTeamPositionId('');
    setSharesToCommit(0);
  };

  const handleCommitShareToTeam = async () => {
    if (
      !selectedParlayTeam ||
      !selectedTeamPosition ||
      sharesToCommit <= 0 ||
      committingShare
    ) {
      return;
    }

    const clampedShares = roundToCents(
      Math.min(sharesToCommit, selectedTeamPosition.quantity)
    );

    if (clampedShares <= 0) {
      return;
    }

    setCommittingShare(true);
    setTeamModalFeedback(null);

    const nextTeam = await commitShareToParlayTeam(
      selectedParlayTeam.id,
      selectedTeamPosition.id,
      clampedShares
    );

    setCommittingShare(false);

    if (!nextTeam) {
      setTeamModalFeedback('Unable to add shares to this Parlay Team.');
      return;
    }

    setParlayTeams((current) =>
      current.map((team) => (team.id === nextTeam.id ? nextTeam : team))
    );
    setSelectedParlayTeam(nextTeam);
    setSelectedTeamPositionId('');
    setSharesToCommit(0);
    setTeamModalFeedback('Shares added to Parlay Team.');
  };

  const handleClaimParlayTeam = async () => {
    if (!selectedParlayTeam?.canClaim || committingShare) {
      return;
    }

    setCommittingShare(true);
    setTeamModalFeedback(null);

    const nextTeam = await claimParlayTeam(selectedParlayTeam.id);

    setCommittingShare(false);

    if (!nextTeam) {
      setTeamModalFeedback('Unable to claim Parlay Team winnings.');
      return;
    }

    setParlayTeams((current) =>
      current.map((team) => (team.id === nextTeam.id ? nextTeam : team))
    );
    setSelectedParlayTeam(nextTeam);
    setTeamModalFeedback(`Claimed $${nextTeam.claimAmount.toFixed(2)}.`);
  };

  const openSellModal = (position: PaperPosition) => {
    setSellPosition(position);
    setSellShares(roundToCents(position.quantity));
  };

  const selectedSellPrice =
    sellPosition?.buySide === 'NO'
      ? (sellDetail?.noPrice ?? 0)
      : (sellDetail?.yesPrice ?? 0);

  const expectedSellValue = roundToCents(sellShares * selectedSellPrice);

  const handleConfirmSell = async () => {
    if (
      !sellPosition ||
      !sellDetail ||
      selectedSellPrice <= 0 ||
      sellShares <= 0 ||
      selling
    ) {
      return;
    }

    setSelling(true);

    const effectiveSellShares = roundToCents(
      Math.min(sellShares, sellPosition.quantity)
    );

    if (effectiveSellShares <= 0) {
      setSelling(false);
      return;
    }

    const proceeds = roundToCents(effectiveSellShares * selectedSellPrice);
    const remainingShares = roundToCents(
      sellPosition.quantity - effectiveSellShares
    );

    const nextPositions = portfolioState.positions.map((position) => {
      if (position.id !== sellPosition.id) {
        return position;
      }

      if (remainingShares <= 0) {
        return {
          ...position,
          quantity: 0,
          stake: 0,
          status: 'CLOSED' as const,
          closedAt: new Date().toISOString(),
          closeValue: proceeds,
        };
      }

      const ratio = remainingShares / position.quantity;

      return {
        ...position,
        quantity: remainingShares,
        stake: roundToCents(position.stake * ratio),
      };
    });

    const nextState: PaperPortfolioState = {
      cash: roundToCents(portfolioState.cash + proceeds),
      positions: nextPositions,
    };

    const saved = await savePortfolioStateForUser(nextState);
    setSelling(false);

    if (!saved) {
      setTeamFeedback('Unable to sell shares right now. Please try again.');
      return;
    }

    setPortfolioState(nextState);
    setSellPosition(null);
    setSellDetail(null);
    setSellShares(0);
    setTeamFeedback('Position sold successfully.');
  };

  return (
    <main className="portfolio-arcade landing-arcade relative min-h-screen overflow-hidden pt-16">
      <div className="landing-arcade__glow" />
      <div className="landing-arcade__scanlines" />

      <div className="portfolio-arcade__content relative z-10">
        <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-8 flex items-end justify-between gap-4">
            <div>
              <h1 className="font-bold text-3xl text-gray-900">Portfolio</h1>
              <p className="mt-1 text-gray-600 text-sm">
                Open paper trades for this user.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setTeamModalOpen(true);
                setMemberQuery('');
                setMemberResults([]);
                setSelectedMembers([]);
                setTeamFeedback(null);
              }}
              className="landing-header-button"
            >
              Create Parlay Team
            </button>
          </div>

          {loading ? (
            <div className="rounded-lg border border-gray-200 bg-white p-4 text-gray-600 text-sm">
              Loading portfolio data
            </div>
          ) : (
            <>
              <div className="mb-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-gray-200 bg-white p-4">
                  <p className="text-gray-500 text-xs uppercase tracking-wide">
                    Paper Balance
                  </p>
                  <p className="mt-1 font-semibold text-2xl text-gray-900">
                    ${portfolioState.cash.toFixed(2)}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-4">
                  <p className="text-gray-500 text-xs uppercase tracking-wide">
                    Capital Deployed
                  </p>
                  <p className="mt-1 font-semibold text-2xl text-gray-900">
                    ${deployedCapital.toFixed(2)}
                  </p>
                </div>
              </div>

              {teamFeedback ? (
                <div className="mb-6 rounded-lg border border-indigo-200 bg-white p-4 text-indigo-700 text-sm">
                  {teamFeedback}
                </div>
              ) : null}

              {openPositions.length === 0 ? (
                <div className="rounded-lg border border-gray-300 border-dashed bg-white p-10 text-center text-gray-500">
                  No open paper trades yet.
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {openPositions.map((position) => (
                    <article
                      key={position.id}
                      className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
                    >
                      <h3 className="font-semibold text-base text-gray-900">
                        {position.matchup}
                      </h3>

                      <div className="mt-3 space-y-2 text-sm">
                        <div className="flex flex-wrap items-center gap-2 text-gray-700">
                          {position.side !== 'draw' &&
                          teamBrandingByName[
                            position.side === 'home'
                              ? position.homeTeam
                              : position.awayTeam
                          ]?.logo ? (
                            <img
                              src={
                                teamBrandingByName[
                                  position.side === 'home'
                                    ? position.homeTeam
                                    : position.awayTeam
                                ]?.logo
                              }
                              alt=""
                              className="h-4 w-4 object-cover"
                            />
                          ) : null}
                          {position.side !== 'draw' ? (
                            <span>
                              {countryNameToFlag(
                                position.side === 'home'
                                  ? position.homeTeam
                                  : position.awayTeam
                              )}
                            </span>
                          ) : null}
                          <span className="font-semibold text-gray-900">
                            {position.side === 'home'
                              ? position.homeTeam
                              : position.side === 'away'
                                ? position.awayTeam
                                : 'Draw'}
                          </span>
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 font-semibold text-xs ${position.buySide === 'YES' ? 'border-emerald-200 bg-white text-emerald-700' : 'border-rose-200 bg-white text-rose-700'}`}
                          >
                            {position.buySide}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-lg border border-violet-100 bg-white p-2">
                            <span className="inline-flex rounded-full border border-violet-200 bg-white px-2 py-0.5 font-semibold text-[10px] text-violet-800 uppercase tracking-wide">
                              Stake
                            </span>
                            <p className="mt-1 font-semibold text-gray-900 text-sm">
                              ${position.stake.toFixed(2)}
                            </p>
                          </div>
                          <div className="rounded-lg border border-amber-100 bg-white p-2">
                            <span className="inline-flex rounded-full border border-amber-200 bg-white px-2 py-0.5 font-semibold text-[10px] text-amber-800 uppercase tracking-wide">
                              Shares
                            </span>
                            <p className="mt-1 font-semibold text-gray-900 text-sm">
                              {position.quantity.toFixed(2)}
                            </p>
                          </div>
                          <div className="rounded-lg border border-blue-100 bg-white p-2">
                            <span className="inline-flex rounded-full border border-blue-200 bg-white px-2 py-0.5 font-semibold text-[10px] text-blue-800 uppercase tracking-wide">
                              Entry Price
                            </span>
                            <p className="mt-1 font-semibold text-gray-900 text-sm">
                              ${position.entryPrice.toFixed(2)}
                            </p>
                          </div>
                          <div className="rounded-lg border border-emerald-100 bg-white p-2">
                            <span className="inline-flex rounded-full border border-emerald-200 bg-white px-2 py-0.5 font-semibold text-[10px] text-emerald-800 uppercase tracking-wide">
                              Current Value
                            </span>
                            <p className="mt-1 font-semibold text-gray-900 text-sm">
                              $
                              {roundToCents(
                                position.quantity *
                                  getPositionCurrentPrice(position)
                              ).toFixed(2)}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 border-gray-100 border-t pt-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-gray-500 text-xs">
                            Created {formatTradeTime(position.createdAt)}
                          </p>
                          <button
                            type="button"
                            onClick={() => openSellModal(position)}
                            className="landing-header-button"
                          >
                            SELL
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}

              <div className="mt-8">
                <h2 className="mb-3 font-semibold text-gray-500 text-sm uppercase tracking-wide">
                  Parlay Teams
                </h2>
                {parlayTeams.length === 0 ? (
                  <div className="rounded-2xl border border-blue-200 bg-white p-6">
                    <h3 className="font-semibold text-slate-900 text-xl">
                      No teams yet. Start a Parlay Team with your crew.
                    </h3>
                    <p className="mt-2 text-slate-700 text-sm leading-6">
                      Use the Create Parlay Team button to set one up.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {parlayTeams.map((team) => (
                      <button
                        key={team.id}
                        type="button"
                        onClick={() => openParlayTeamModal(team)}
                        className="rounded-2xl border border-gray-200 bg-white p-4 text-left transition hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                      >
                        <h3 className="font-semibold text-base text-gray-900">
                          {team.name}
                        </h3>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="inline-flex rounded-full border border-amber-200 bg-white px-2.5 py-1 font-semibold text-[11px] text-amber-800">
                            Stake $
                            {(
                              teamMetricsById[team.id]?.totalStaked ?? 0
                            ).toFixed(2)}
                          </span>
                          <span className="inline-flex rounded-full border border-emerald-200 bg-white px-2.5 py-1 font-semibold text-[11px] text-emerald-800">
                            Potential Payout $
                            {(
                              teamMetricsById[team.id]?.potentialPayout ?? 0
                            ).toFixed(2)}
                          </span>
                        </div>
                        <p className="mt-1 text-gray-500 text-sm">
                          {team.members.length} member
                          {team.members.length === 1 ? '' : 's'}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {team.members.slice(0, 3).map((member) => (
                            <span
                              key={`${team.id}-${member.id}`}
                              className="inline-flex items-center rounded-full bg-gray-100 px-2 py-1 text-gray-700 text-xs"
                            >
                              {member.username}
                            </span>
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {teamModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 p-4 backdrop-blur-sm"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-team-modal-title"
            className="flex h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  id="create-team-modal-title"
                  className="font-bold text-gray-900 text-lg"
                >
                  Create Parlay Team
                </h2>
                <p className="mt-1 text-gray-600 text-sm">
                  Name your team and select members by username.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTeamModalOpen(false)}
                disabled={creatingTeam}
                className="rounded-md px-2 py-1 font-semibold text-gray-500 text-sm transition hover:bg-gray-100 disabled:opacity-60"
              >
                X
              </button>
            </div>

            <div className="mt-5 space-y-4 overflow-y-auto pr-1">
              <div>
                <label
                  htmlFor="team-name-input"
                  className="font-medium text-gray-700 text-sm"
                >
                  Parlay Team Name
                </label>
                <input
                  id="team-name-input"
                  value={teamName}
                  onChange={(event) => setTeamName(event.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  placeholder="Team name"
                />
              </div>

              <div>
                <label
                  htmlFor="member-search-input"
                  className="font-medium text-gray-700 text-sm"
                >
                  Member Search (username)
                </label>
                <input
                  id="member-search-input"
                  value={memberQuery}
                  onChange={(event) => setMemberQuery(event.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  placeholder="Search username"
                />
              </div>

              <div>
                <p className="font-medium text-gray-700 text-sm">
                  Selected Members
                </p>
                {selectedMembers.length === 0 ? (
                  <p className="mt-1 text-gray-500 text-xs">
                    No members selected.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedMembers.map((member) => (
                      <span
                        key={member.id}
                        className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white px-2.5 py-1 text-blue-700 text-xs"
                      >
                        {member.username}
                        <button
                          type="button"
                          onClick={() => removeMember(member.id)}
                          className="font-semibold text-blue-700"
                        >
                          X
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="font-medium text-gray-700 text-sm">
                  Search Results
                </p>
                <div className="mt-2 max-h-52 space-y-2 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
                  {searchingMembers ? (
                    <p className="text-gray-500 text-xs">
                      Searching usernames...
                    </p>
                  ) : memberResults.length === 0 ? (
                    <p className="text-gray-500 text-xs">No users found.</p>
                  ) : (
                    memberResults.map((member) => {
                      const isSelected = selectedMembers.some(
                        (entry) => entry.id === member.id
                      );
                      const reachedMaxMembers =
                        selectedMembers.length >= MAX_ADDITIONAL_MEMBERS;
                      const isCaptainUsername =
                        Boolean(username) && member.username === username;

                      return (
                        <div
                          key={member.id}
                          className="flex items-center justify-between rounded-md bg-white px-3 py-2"
                        >
                          <span className="font-medium text-gray-800 text-sm">
                            {member.username}
                          </span>
                          <button
                            type="button"
                            onClick={() => addMember(member)}
                            disabled={
                              isSelected ||
                              reachedMaxMembers ||
                              isCaptainUsername
                            }
                            className="rounded-md bg-blue-600 px-2.5 py-1 font-semibold text-white text-xs transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isCaptainUsername
                              ? 'Captain'
                              : isSelected
                                ? 'Selected'
                                : reachedMaxMembers
                                  ? 'Max Reached'
                                  : 'Add'}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
                <p className="mt-2 text-gray-500 text-xs">
                  Up to 9 members can be added here. Team max is 10 including
                  you.
                </p>
              </div>
            </div>

            <div className="mt-auto pt-4">
              <button
                type="button"
                onClick={() => void createTeamFromModal()}
                disabled={
                  creatingTeam ||
                  teamName.trim().length === 0 ||
                  selectedMembers.length === 0 ||
                  selectedMembers.length > MAX_ADDITIONAL_MEMBERS
                }
                className="w-full rounded-md bg-blue-600 px-4 py-3 font-semibold text-sm text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creatingTeam ? 'Creating...' : 'Create Team'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <Dialog
        open={selectedParlayTeam !== null}
        onOpenChange={(open) => {
          if (!open && !committingShare) {
            setSelectedParlayTeam(null);
            setSelectedTeamPositionId('');
            setSharesToCommit(0);
            setTeamModalFeedback(null);
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="max-w-xl border-violet-200 bg-white"
        >
          <DialogHeader>
            <DialogTitle className="text-violet-950">
              {selectedParlayTeam?.name ?? 'Parlay Team'}
            </DialogTitle>
            <p className="text-sm text-violet-800">
              View team details and add shares from your open positions.
            </p>
            <DialogClose
              aria-label="Close parlay team modal"
              className="absolute top-4 right-4 rounded-sm p-1 text-violet-700 transition hover:bg-violet-100"
              disabled={committingShare}
            >
              x
            </DialogClose>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-2 flex flex-wrap gap-2">
                <span className="inline-flex rounded-full border border-amber-200 bg-white px-2.5 py-1 font-semibold text-[11px] text-amber-800">
                  Stake $
                  {(
                    teamMetricsById[selectedParlayTeam?.id ?? '']
                      ?.totalStaked ?? 0
                  ).toFixed(2)}
                </span>
                <span className="inline-flex rounded-full border border-emerald-200 bg-white px-2.5 py-1 font-semibold text-[11px] text-emerald-800">
                  Potential Payout $
                  {(
                    teamMetricsById[selectedParlayTeam?.id ?? '']
                      ?.potentialPayout ?? 0
                  ).toFixed(2)}
                </span>
                <span className="inline-flex rounded-full border border-violet-200 bg-white px-2.5 py-1 font-semibold text-[11px] text-violet-800">
                  {selectedParlayTeam?.status ?? 'ACTIVE'}
                </span>
              </div>
              <p className="text-gray-600 text-sm">
                {selectedParlayTeam?.members.length ?? 0} members
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(selectedParlayTeam?.members ?? []).map((member) => (
                  <span
                    key={member.id}
                    className="inline-flex items-center rounded-full bg-gray-100 px-2 py-1 text-gray-700 text-xs"
                  >
                    {member.username}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="font-semibold text-gray-900 text-sm">
                Committed Legs
              </p>
              {selectedParlayTeam?.committedLegs.length ? (
                <div className="mt-3 space-y-0">
                  {selectedParlayTeam.committedLegs.map((leg) => {
                    const metrics = teamLegMetricsById[leg.id];
                    const liveStatus = teamLegLiveStatusesById[leg.id];

                    return (
                      <div
                        key={`${selectedParlayTeam.id}-${leg.positionId}`}
                        className="relative pl-8"
                      >
                        <div className="absolute top-0 bottom-0 left-3 w-px bg-gray-200" />
                        <div className="absolute top-4 left-[9px] h-3 w-3 rounded-full border border-white bg-violet-500" />
                        <div className="rounded-md border border-gray-200 bg-white px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex rounded-full border bg-white px-2 py-0.5 font-semibold text-[11px] ${getLegBadgeClassName(leg, liveStatus)}`}
                            >
                              Leg {leg.sequence}
                            </span>
                            <span className="inline-flex rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-700">
                              {leg.addedByUsername}
                            </span>
                          </div>

                          <div className="mt-2 flex items-center justify-between gap-2">
                            <p className="font-medium text-gray-900 text-sm">
                              {leg.cardTitle}
                            </p>
                            <button
                              type="button"
                              className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 font-semibold text-[11px] text-violet-700"
                            >
                              Rollover
                            </button>
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                            <span className="inline-flex rounded-full border border-green-200 bg-white px-2 py-0.5 font-medium text-green-700">
                              {getLiveBadgeLabel(liveStatus)}
                            </span>
                            <span className="text-gray-600">
                              {formatLiveSummary(
                                liveStatus,
                                formatTradeTime(leg.kickoff)
                              )}
                            </span>
                          </div>

                          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded border border-gray-200 bg-white px-2 py-1">
                              <p className="text-gray-500">Shares</p>
                              <p className="font-semibold text-gray-900">
                                {leg.shares.toFixed(2)}
                              </p>
                            </div>
                            <div className="rounded border border-gray-200 bg-white px-2 py-1">
                              <p className="text-gray-500">Entry Price</p>
                              <p className="font-semibold text-gray-900">
                                ${leg.entryPrice.toFixed(2)}
                              </p>
                            </div>
                            <div className="rounded border border-gray-200 bg-white px-2 py-1">
                              <p className="text-gray-500">Current Price</p>
                              <p className="font-semibold text-gray-900">
                                {metrics?.currentPrice !== null &&
                                metrics?.currentPrice !== undefined
                                  ? `$${metrics.currentPrice.toFixed(2)}`
                                  : '--'}
                              </p>
                            </div>
                            <div className="rounded border border-gray-200 bg-white px-2 py-1">
                              <p className="text-gray-500">Expected Payoff</p>
                              <p className="font-semibold text-gray-900">
                                {metrics?.expectedPayoff !== null &&
                                metrics?.expectedPayoff !== undefined
                                  ? `$${metrics.expectedPayoff.toFixed(2)}`
                                  : '--'}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-2 text-gray-500 text-sm">
                  No legs committed yet.
                </p>
              )}

              {selectedParlayTeam?.canClaim ? (
                <button
                  type="button"
                  onClick={() => void handleClaimParlayTeam()}
                  disabled={committingShare}
                  className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-sm text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Claim ${selectedParlayTeam.claimAmount.toFixed(2)}
                </button>
              ) : selectedParlayTeam?.hasClaimed ? (
                <div className="mt-4 rounded-md border border-emerald-200 bg-white px-3 py-2 text-emerald-700 text-sm">
                  Claimed ${selectedParlayTeam.claimAmount.toFixed(2)}.
                </div>
              ) : null}
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="font-semibold text-gray-900 text-sm">
                Add Shares from Portfolio
              </p>

              <div className="mt-3 space-y-3">
                <select
                  value={selectedTeamPositionId}
                  onChange={(event) => {
                    const positionId = event.target.value;
                    setSelectedTeamPositionId(positionId);

                    const position = selectedTeamOpenPositions.find(
                      (entry) => entry.id === positionId
                    );
                    setSharesToCommit(
                      position ? roundToCents(position.quantity) : 0
                    );
                  }}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Select an open position</option>
                  {selectedTeamOpenPositions.map((position) => (
                    <option
                      key={position.id}
                      value={position.id}
                    >
                      {position.matchup} · {position.side.toUpperCase()} ·{' '}
                      {position.quantity.toFixed(2)} shares
                    </option>
                  ))}
                </select>

                {selectedTeamOpenPositions.length === 0 ? (
                  <p className="text-gray-500 text-xs">
                    {selectedParlayFirstLegStarted
                      ? 'No eligible positions available. Once the first leg starts, no more legs can be added.'
                      : 'No eligible positions available. Legs with conflicting start times cannot be added to this Parlay Team.'}
                  </p>
                ) : null}

                {selectedTeamPosition ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-4 gap-2">
                      {[25, 50, 75, 100].map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => {
                            setSharesToCommit(
                              roundToCents(
                                (selectedTeamPosition.quantity * value) / 100
                              )
                            );
                          }}
                          className="rounded-md border border-violet-200 bg-white px-3 py-1 font-semibold text-sm text-violet-900 transition hover:border-violet-300 hover:bg-violet-50"
                        >
                          {value}%
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center justify-between">
                      <p className="text-sm text-violet-900">Shares to Add</p>
                      <p className="text-sm text-violet-900">
                        {sharesToCommit.toFixed(2)} /{' '}
                        {selectedTeamPosition.quantity.toFixed(2)}
                      </p>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max={Math.max(0, selectedTeamPosition.quantity)}
                      step="0.01"
                      value={sharesToCommit}
                      onChange={(event) =>
                        setSharesToCommit(Number(event.target.value))
                      }
                      className="w-full"
                    />
                  </div>
                ) : null}

                {teamModalFeedback ? (
                  <div className="rounded-md border border-indigo-200 bg-white px-3 py-2 text-indigo-700 text-sm">
                    {teamModalFeedback}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => void handleCommitShareToTeam()}
                  disabled={
                    selectedParlayFirstLegStarted ||
                    !selectedTeamPosition ||
                    sharesToCommit <= 0 ||
                    committingShare
                  }
                  className="inline-flex w-full items-center justify-center rounded-lg bg-violet-600 px-4 py-2 font-semibold text-sm text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {committingShare
                    ? 'Adding Shares...'
                    : 'Add Shares to Parlay Team'}
                </button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={sellPosition !== null}
        onOpenChange={(open) => {
          if (!open && !selling) {
            setSellPosition(null);
            setSellDetail(null);
            setSellShares(0);
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="max-w-md border-violet-200 bg-white"
        >
          <DialogHeader>
            <DialogTitle className="text-violet-950">
              {sellPosition?.side === 'home'
                ? sellPosition.homeTeam
                : sellPosition?.side === 'away'
                  ? sellPosition.awayTeam
                  : 'Draw'}
            </DialogTitle>
            <p className="text-sm text-violet-800">
              {sellPosition ? sellPosition.matchup : 'Loading selection...'}
            </p>
            <DialogClose
              aria-label="Close trade modal"
              className="absolute top-4 right-4 rounded-sm p-1 text-violet-700 transition hover:bg-violet-100"
              disabled={selling}
            >
              x
            </DialogClose>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-violet-800">
              Choose how many shares to sell from this position.
            </p>

            <div className="grid grid-cols-4 gap-2">
              {[25, 50, 75, 100].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    if (!sellPosition) {
                      return;
                    }

                    setSellShares(
                      roundToCents((sellPosition.quantity * value) / 100)
                    );
                  }}
                  className="rounded-md border border-violet-200 bg-white px-3 py-1 font-semibold text-sm text-violet-900 transition hover:border-violet-300 hover:bg-violet-50"
                >
                  {value}%
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm text-violet-900">Shares to Sell</p>
                <p className="text-sm text-violet-900">
                  {sellShares.toFixed(2)} /{' '}
                  {sellPosition?.quantity.toFixed(2) ?? '0.00'}
                </p>
              </div>
              <input
                type="range"
                min="0"
                max={sellPosition ? Math.max(0, sellPosition.quantity) : 0}
                step="0.01"
                value={sellShares}
                onChange={(event) => setSellShares(Number(event.target.value))}
                className="w-full"
              />
            </div>

            <button
              type="button"
              disabled={
                loadingSellDetail ||
                selling ||
                !sellDetail ||
                selectedSellPrice <= 0 ||
                sellShares <= 0
              }
              onClick={() => void handleConfirmSell()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 font-semibold text-sm text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span>Confirm SELL</span>
              <span>
                {sellDetail ? `$${selectedSellPrice.toFixed(2)}` : '--'}
              </span>
            </button>

            <p className="text-sm text-violet-700">
              Current market price ({sellPosition?.buySide ?? '--'}):{' '}
              {sellDetail ? `$${selectedSellPrice.toFixed(2)}` : '--'}
            </p>

            <div className="flex items-center justify-between">
              <p className="text-sm text-violet-900">Expected Proceeds</p>
              <p className="font-semibold text-sm text-violet-950">
                ${expectedSellValue.toFixed(2)}
              </p>
            </div>
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
