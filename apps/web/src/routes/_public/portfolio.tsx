import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from '@starter/ui/components/shadcn/carousel';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@starter/ui/components/shadcn/dialog';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@starter/ui/components/shadcn/responsive-dialog';
import { Skeleton } from '@starter/ui/components/shadcn/skeleton';
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
  // Spreads/totals combo bets placed from the portfolio. Absent ⇒ legacy
  // moneyline position (side/buySide drive display & pricing as before).
  betType?: 'moneyline' | 'spread' | 'total';
  optionLabel?: string;
  line?: number;
  // The Polymarket spread/total sub-market + outcome, used to re-price the bet
  // via /api/markets/<sourceEventId>/combos.
  comboMarketId?: string;
  comboOutcomeLabel?: string;
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
  result: 'PENDING' | 'WON' | 'LOST' | 'ROLLED_OVER';
  principalShares: number;
  rolledInShares: number;
  effectiveShares: number;
  resolvedAt: string | null;
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
  category?: string | null;
};

type ComboMarketType = 'spread' | 'total';

type ComboOption = {
  marketType: ComboMarketType;
  line: number;
  sourceMarketId: string;
  outcomeLabel: string;
  label: string;
  price: number;
};

type ComboOptionsPayload = {
  spreads: ComboOption[];
  totals: ComboOption[];
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

type TeamButtonPalette = {
  background: string;
  color: string;
  border: string;
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
  const expanded =
    hex.length === 3
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
  const expanded =
    hex.length === 3
      ? `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
      : hex;

  const channel = (start: number) =>
    Math.max(
      0,
      Math.floor(
        Number.parseInt(expanded.slice(start, start + 2), 16) * (1 - factor)
      )
    );
  const toHex = (value: number) => value.toString(16).padStart(2, '0');
  return `#${toHex(channel(0))}${toHex(channel(2))}${toHex(channel(4))}`;
};

const getTeamButtonPalette = (team: {
  color: string | null;
}): TeamButtonPalette => {
  const normalizedColor = normalizeHexColor(team.color);

  if (!normalizedColor) {
    return { background: '#ffffff', color: '#4c1d95', border: '#c4b5fd' };
  }

  return {
    background: normalizedColor,
    color: getTextColorForBackground(normalizedColor),
    border: darkenHexColor(normalizedColor, 0.18),
  };
};

// Palette for a position/leg's chosen side — the team's color, or the default
// purple for a draw (or an unknown color).
const paletteForSelection = (
  selection: { side: PositionSide; homeTeam: string; awayTeam: string } | null,
  branding: Record<string, TeamBranding>
): TeamButtonPalette => {
  if (!selection || selection.side === 'draw') {
    return getTeamButtonPalette({ color: null });
  }

  const teamName =
    selection.side === 'home' ? selection.homeTeam : selection.awayTeam;
  return getTeamButtonPalette({ color: branding[teamName]?.color ?? null });
};

// The outcome a leg is hoping for: MLB shows team name + logo; FIFA shows
// country name + flag + the side picked; a draw stays purple.
const LegOutcomeBadge = ({
  leg,
  branding,
}: {
  leg: TeamCommittedLeg;
  branding: Record<string, TeamBranding>;
}) => {
  if (leg.positionSide === 'draw') {
    return (
      <span className="inline-flex items-center rounded-full border border-violet-300 bg-violet-100 px-2 py-0.5 font-semibold text-[11px] text-violet-800">
        Draw
      </span>
    );
  }

  const teamName = leg.positionSide === 'home' ? leg.homeTeam : leg.awayTeam;
  const brand = branding[teamName];
  const palette = getTeamButtonPalette({ color: brand?.color ?? null });
  const flag = countryNameToFlag(teamName);
  const isMlb = Boolean(brand?.logo);

  return (
    <span
      style={{
        backgroundColor: palette.background,
        color: palette.color,
        borderColor: palette.border,
      }}
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold text-[11px]"
    >
      {isMlb ? (
        <img
          src={brand?.logo}
          alt=""
          className="h-3.5 w-3.5 object-cover"
        />
      ) : flag ? (
        <span className="text-[12px] leading-none">{flag}</span>
      ) : null}
      <span>{teamName}</span>
      {isMlb ? null : <span className="opacity-80">· {leg.buySide}</span>}
    </span>
  );
};

// A parlay drops into history once its last leg kicked off more than this long
// ago (claimable parlays are kept up top regardless).
const PARLAY_HISTORY_CUTOFF_MS = 12 * 60 * 60 * 1000;

// The parlay's start time = its earliest leg kickoff (used for chronological
// ordering). Parlays with no legs sort last.
const parlayStartMs = (team: ParlayTeam): number => {
  if (team.committedLegs.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return team.committedLegs.reduce((min, leg) => {
    const ms = new Date(leg.kickoff).getTime();
    return Number.isFinite(ms) ? Math.min(min, ms) : min;
  }, Number.POSITIVE_INFINITY);
};

const parlayFirstLegStarted = (team: ParlayTeam): boolean => {
  const startMs = parlayStartMs(team);
  return Number.isFinite(startMs) && startMs <= Date.now();
};

// The leg number a parlay busted on (earliest lost leg), or null if none lost.
const parlayLostLegSequence = (team: ParlayTeam): number | null => {
  const lostLeg = team.committedLegs
    .filter((leg) => leg.result === 'LOST')
    .sort((a, b) => a.sequence - b.sequence)[0];
  return lostLeg ? lostLeg.sequence : null;
};

const isParlayInHistory = (team: ParlayTeam): boolean => {
  // Keep claimable parlays up top so the CLAIM action stays visible.
  if (team.canClaim) {
    return false;
  }

  // Once claimed or busted on a lost leg, the parlay is done — tuck it away.
  if (team.hasClaimed) {
    return true;
  }

  if (parlayLostLegSequence(team) !== null) {
    return true;
  }

  // An inactive, empty parlay drops into history 12h after creation. It returns
  // to the top the moment it has a pending (not-yet-started) leg.
  if (team.committedLegs.length === 0) {
    const createdMs = new Date(team.createdAt).getTime();
    return (
      Number.isFinite(createdMs) &&
      createdMs < Date.now() - PARLAY_HISTORY_CUTOFF_MS
    );
  }

  const latestKickoffMs = team.committedLegs.reduce((max, leg) => {
    const ms = new Date(leg.kickoff).getTime();
    return Number.isFinite(ms) ? Math.max(max, ms) : max;
  }, Number.NEGATIVE_INFINITY);

  return (
    Number.isFinite(latestKickoffMs) &&
    latestKickoffMs < Date.now() - PARLAY_HISTORY_CUTOFF_MS
  );
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

  if (leg.result === 'ROLLED_OVER') {
    return 'border-amber-200 text-amber-700';
  }

  if (status?.hasStarted) {
    return 'border-violet-200 text-violet-700';
  }

  return 'border-blue-200 text-blue-700';
};

// Timeline node + card outline color for a leg: won → green, lost → red,
// rolled over → amber, currently active (started, unresolved) → purple,
// pending (not started) → gray.
const getLegTimelineClasses = (
  leg: TeamCommittedLeg,
  status: LiveStatus | undefined
): { node: string; outline: string } => {
  if (leg.result === 'WON') {
    return { node: 'bg-green-500', outline: 'border-green-300' };
  }

  if (leg.result === 'LOST') {
    return { node: 'bg-red-500', outline: 'border-red-300' };
  }

  if (leg.result === 'ROLLED_OVER') {
    return { node: 'bg-amber-500', outline: 'border-amber-300' };
  }

  const kickoffMs = new Date(leg.kickoff).getTime();
  const hasStarted =
    Boolean(status?.hasStarted) ||
    (Number.isFinite(kickoffMs) && kickoffMs <= Date.now());

  if (hasStarted) {
    return { node: 'bg-violet-500', outline: 'border-violet-400' };
  }

  return { node: 'bg-gray-300', outline: 'border-gray-200' };
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

// Spreads/totals options for a game, fetched live (not persisted). marketId is
// the position's sourceEventId.
const fetchComboOptions = async (
  sourceEventId: string
): Promise<ComboOptionsPayload> => {
  const response = await fetch(`/api/markets/${sourceEventId}/combos`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    return { spreads: [], totals: [] };
  }

  return (await response.json()) as ComboOptionsPayload;
};

// Current price of a placed combo bet: re-fetch the game's options and match the
// stored sub-market + outcome. Returns null when the option is no longer offered.
const fetchComboPrice = async (
  position: PaperPosition
): Promise<number | null> => {
  if (!position.comboMarketId) {
    return null;
  }

  const data = await fetchComboOptions(position.marketId);
  const match = [...data.spreads, ...data.totals].find(
    (option) =>
      option.sourceMarketId === position.comboMarketId &&
      option.outcomeLabel === position.comboOutcomeLabel
  );

  return match ? match.price : null;
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

const rolloverParlayLeg = async (
  teamId: string,
  legId: string
): Promise<ParlayTeam | null> => {
  const response = await fetch('/api/parlay-teams', {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'manual-rollover',
      teamId,
      legId,
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
  const [showParlayHistory, setShowParlayHistory] = useState(false);
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
  const [rolloverLegId, setRolloverLegId] = useState<string | null>(null);
  const [sellPosition, setSellPosition] = useState<PaperPosition | null>(null);
  const [sellDetail, setSellDetail] = useState<MarketDetail | null>(null);
  const [sellShares, setSellShares] = useState(0);
  const [loadingSellDetail, setLoadingSellDetail] = useState(false);
  const [selling, setSelling] = useState(false);
  const [positionCurrentPricesById, setPositionCurrentPricesById] = useState<
    Record<string, number>
  >({});
  const [positionCategoryById, setPositionCategoryById] = useState<
    Record<string, string | null>
  >({});
  const [teamBrandingByName, setTeamBrandingByName] = useState<
    Record<string, TeamBranding>
  >({});
  // Spreads/Totals badge + carousel state, keyed so only one carousel is open.
  const [expandedCombo, setExpandedCombo] = useState<{
    positionId: string;
    type: ComboMarketType;
  } | null>(null);
  const [comboOptionsByEvent, setComboOptionsByEvent] = useState<
    Record<string, ComboOptionsPayload>
  >({});
  const [loadingCombosByEvent, setLoadingCombosByEvent] = useState<
    Record<string, boolean>
  >({});
  // The combo option the user is staking on (drives the add-bet sheet).
  const [comboBet, setComboBet] = useState<{
    position: PaperPosition;
    option: ComboOption;
  } | null>(null);
  const [comboStake, setComboStake] = useState(25);
  const [placingCombo, setPlacingCombo] = useState(false);

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

      // Combo bets re-price from the live combos endpoint; mirror the price into
      // both yes/no so the side-agnostic sell math reads it directly.
      const detail = sellPosition.comboMarketId
        ? await fetchComboPrice(sellPosition).then((price) =>
            price === null
              ? null
              : ({
                  marketId: sellPosition.comboMarketId ?? sellPosition.marketId,
                  question: sellPosition.optionLabel ?? '',
                  yesPrice: price,
                  noPrice: price,
                  updatedAt: null,
                  category: 'mlb-games',
                } satisfies MarketDetail)
          )
        : await fetchMarketDetail(sellPosition);

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
          // Combo bets price from the live combos endpoint; their game is
          // always MLB. Moneyline bets use the snapshot-backed detail route,
          // which also tells us the category (to decide whether to show badges).
          if (position.comboMarketId) {
            const price = await fetchComboPrice(position);
            return {
              id: position.id,
              price: price ?? position.entryPrice,
              category: 'mlb-games' as string | null,
            };
          }

          const detail = await fetchMarketDetail(position);

          if (!detail) {
            return {
              id: position.id,
              price: position.entryPrice,
              category: null,
            };
          }

          const currentPrice =
            position.buySide === 'NO' ? detail.noPrice : detail.yesPrice;

          return {
            id: position.id,
            price: currentPrice,
            category: detail.category ?? null,
          };
        })
      );

      if (cancelled) {
        return;
      }

      setPositionCurrentPricesById(
        Object.fromEntries(entries.map((e) => [e.id, e.price]))
      );
      setPositionCategoryById(
        Object.fromEntries(entries.map((e) => [e.id, e.category]))
      );
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

    // Legs are ordered by kickoff; the parlay locks once the earliest-starting
    // leg has kicked off.
    const earliestKickoffMs = selectedParlayTeam.committedLegs.reduce(
      (min, leg) => {
        const ms = new Date(leg.kickoff).getTime();
        return Number.isFinite(ms) ? Math.min(min, ms) : min;
      },
      Number.POSITIVE_INFINITY
    );

    return (
      Number.isFinite(earliestKickoffMs) && earliestKickoffMs <= Date.now()
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

  const hasUnresolvedLegs = useMemo(
    () =>
      parlayTeams.some((team) =>
        team.committedLegs.some((leg) => leg.result === 'PENDING')
      ),
    [parlayTeams]
  );

  const polyPollRateMs = hasUnresolvedLegs ? 5 * 60 * 1000 : 30 * 60 * 1000;

  useEffect(() => {
    if (!username) return;

    const id = setInterval(async () => {
      await fetch('/api/sync/polymarket', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      const teams = await fetchParlayTeams();
      setParlayTeams(teams);
    }, polyPollRateMs);

    return () => clearInterval(id);
  }, [username, polyPollRateMs]);

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
              expectedPayoff: roundToCents(leg.effectiveShares * currentPrice),
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

  // Claimable parlays come first, then active/pending chronologically by start
  // time (soonest first); history sorts most-recent first.
  const activeParlayTeams = parlayTeams
    .filter((team) => !isParlayInHistory(team))
    .sort((a, b) => {
      if (a.canClaim !== b.canClaim) {
        return a.canClaim ? -1 : 1;
      }
      return parlayStartMs(a) - parlayStartMs(b);
    });
  const historyParlayTeams = parlayTeams
    .filter((team) => isParlayInHistory(team))
    .sort((a, b) => parlayStartMs(b) - parlayStartMs(a));

  const renderParlayTeamCard = (team: ParlayTeam) => (
    <button
      key={team.id}
      type="button"
      onClick={() => openParlayTeamModal(team)}
      className="rounded-2xl border border-gray-200 bg-white p-4 text-left transition hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
    >
      {team.canClaim ? (
        <span className="mb-1 inline-flex rounded-full border border-emerald-500 bg-emerald-500 px-2 py-0.5 font-semibold text-[10px] text-white uppercase tracking-wide">
          Claimable
        </span>
      ) : team.hasClaimed ? (
        <span className="mb-1 inline-flex rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 font-semibold text-[10px] text-gray-500 uppercase tracking-wide">
          Claimed
        </span>
      ) : parlayLostLegSequence(team) !== null ? (
        <span className="mb-1 inline-flex rounded-full border border-red-300 bg-red-50 px-2 py-0.5 font-semibold text-[10px] text-red-700 uppercase tracking-wide">
          Lost on Leg {parlayLostLegSequence(team)}
        </span>
      ) : parlayFirstLegStarted(team) ? (
        <span className="mb-1 inline-flex rounded-full border border-green-200 bg-green-50 px-2 py-0.5 font-semibold text-[10px] text-green-700 uppercase tracking-wide">
          Active
        </span>
      ) : null}
      <h3 className="font-semibold text-base text-gray-900">{team.name}</h3>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex rounded-full border border-amber-200 bg-white px-2.5 py-1 font-semibold text-[11px] text-amber-800">
          Stake ${(teamMetricsById[team.id]?.totalStaked ?? 0).toFixed(2)}
        </span>
        <span className="inline-flex rounded-full border border-emerald-200 bg-white px-2.5 py-1 font-semibold text-[11px] text-emerald-800">
          Potential Payout $
          {(teamMetricsById[team.id]?.potentialPayout ?? 0).toFixed(2)}
        </span>
      </div>
      <p className="mt-1 text-gray-500 text-sm">
        {team.members.length} member{team.members.length === 1 ? '' : 's'}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {team.members.slice(0, 3).map((member) => (
          <span
            key={`${team.id}-${member.id}`}
            className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-1 font-semibold text-violet-700 text-xs"
          >
            {member.username}
          </span>
        ))}
      </div>
    </button>
  );

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

  const handleRolloverLeg = async (legId: string) => {
    if (!selectedParlayTeam || committingShare) {
      return;
    }

    setCommittingShare(true);
    setTeamModalFeedback(null);

    const nextTeam = await rolloverParlayLeg(selectedParlayTeam.id, legId);

    setCommittingShare(false);
    setRolloverLegId(null);

    if (!nextTeam) {
      setTeamModalFeedback('Unable to roll over this leg.');
      return;
    }

    setParlayTeams((current) =>
      current.map((team) => (team.id === nextTeam.id ? nextTeam : team))
    );
    setSelectedParlayTeam(nextTeam);
    setTeamModalFeedback('Leg rolled over into the next leg.');
  };

  const openSellModal = (position: PaperPosition) => {
    setSellPosition(position);
    setSellShares(roundToCents(position.quantity));
  };

  // Toggle the Spreads/Totals carousel under a card, lazily fetching the game's
  // options the first time it's opened.
  const toggleCombo = (position: PaperPosition, type: ComboMarketType) => {
    setExpandedCombo((current) =>
      current?.positionId === position.id && current.type === type
        ? null
        : { positionId: position.id, type }
    );

    const eventId = position.marketId;
    if (comboOptionsByEvent[eventId] || loadingCombosByEvent[eventId]) {
      return;
    }

    setLoadingCombosByEvent((map) => ({ ...map, [eventId]: true }));
    void fetchComboOptions(eventId)
      .then((data) =>
        setComboOptionsByEvent((map) => ({ ...map, [eventId]: data }))
      )
      .finally(() =>
        setLoadingCombosByEvent((map) => ({ ...map, [eventId]: false }))
      );
  };

  const openComboBet = (position: PaperPosition, option: ComboOption) => {
    setComboBet({ position, option });
    setComboStake(Math.max(0, Math.min(25, Math.floor(portfolioState.cash))));
  };

  const handleConfirmCombo = async () => {
    if (!comboBet || placingCombo) {
      return;
    }

    const { position, option } = comboBet;
    if (option.price <= 0 || comboStake <= 0) {
      return;
    }

    setPlacingCombo(true);

    const portfolio = await fetchPortfolioStateForUser();
    if (!portfolio) {
      setPlacingCombo(false);
      window.location.assign('/auth/login?redirect=/portfolio');
      return;
    }

    const effectiveStake = roundToCents(Math.min(comboStake, portfolio.cash));
    if (effectiveStake <= 0) {
      setPlacingCombo(false);
      return;
    }

    const newPosition: PaperPosition = {
      id: crypto.randomUUID(),
      marketId: position.marketId,
      matchup: position.matchup,
      homeTeam: position.homeTeam,
      awayTeam: position.awayTeam,
      // Combo bets are side-agnostic; keep schema-required fields neutral and
      // drive display/pricing off the combo fields instead.
      side: 'home',
      buySide: 'YES',
      stake: effectiveStake,
      entryPrice: option.price,
      quantity: roundToCents(effectiveStake / option.price),
      kickoff: position.kickoff,
      status: 'OPEN',
      createdAt: new Date().toISOString(),
      closedAt: null,
      closeValue: null,
      betType: option.marketType,
      optionLabel: option.label,
      line: option.line,
      comboMarketId: option.sourceMarketId,
      comboOutcomeLabel: option.outcomeLabel,
    };

    const nextState: PaperPortfolioState = {
      cash: roundToCents(portfolio.cash - effectiveStake),
      positions: [newPosition, ...portfolio.positions],
    };

    const saved = await savePortfolioStateForUser(nextState);
    setPlacingCombo(false);

    if (saved) {
      setPortfolioState(nextState);
      setComboBet(null);
      setExpandedCombo(null);
    }
  };

  const comboMaxPayout =
    comboBet && comboBet.option.price > 0
      ? roundToCents(comboStake / comboBet.option.price)
      : 0;

  const selectedSellPrice =
    sellPosition?.buySide === 'NO'
      ? (sellDetail?.noPrice ?? 0)
      : (sellDetail?.yesPrice ?? 0);

  const expectedSellValue = roundToCents(sellShares * selectedSellPrice);

  const addSharesPalette = paletteForSelection(
    selectedTeamPosition,
    teamBrandingByName
  );
  const sellPalette = paletteForSelection(sellPosition, teamBrandingByName);

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
            <>
              {/* summary stat cards */}
              <div className="mb-6 grid gap-4 sm:grid-cols-2">
                {[0, 1].map((i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-gray-200 bg-white p-4"
                  >
                    <Skeleton className="mb-2 h-3 w-24 rounded bg-gray-100" />
                    <Skeleton className="h-8 w-32 rounded bg-gray-100" />
                  </div>
                ))}
              </div>

              {/* position card skeletons */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
                  >
                    <Skeleton className="mb-3 h-5 w-40 rounded bg-gray-100" />
                    <div className="mb-3 flex items-center gap-2">
                      <Skeleton className="h-6 w-6 rounded bg-gray-100" />
                      <Skeleton className="h-4 w-28 rounded bg-gray-100" />
                      <Skeleton className="h-5 w-10 rounded-full bg-gray-100" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Skeleton className="h-14 rounded-lg bg-gray-100" />
                      <Skeleton className="h-14 rounded-lg bg-gray-100" />
                      <Skeleton className="h-14 rounded-lg bg-gray-100" />
                      <Skeleton className="h-14 rounded-lg bg-gray-100" />
                    </div>
                    <div className="mt-4 flex items-center justify-between border-gray-100 border-t pt-3">
                      <Skeleton className="h-3 w-32 rounded bg-gray-100" />
                      <Skeleton className="h-8 w-14 rounded-md bg-gray-100" />
                    </div>
                  </div>
                ))}
              </div>

              {/* parlay teams skeletons */}
              <div className="mt-8">
                <Skeleton className="mb-3 h-4 w-32 rounded bg-gray-100" />
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {[0, 1].map((i) => (
                    <div
                      key={i}
                      className="rounded-2xl border border-gray-200 bg-white p-4"
                    >
                      <Skeleton className="mb-2 h-5 w-36 rounded bg-gray-100" />
                      <div className="mb-2 flex gap-2">
                        <Skeleton className="h-5 w-20 rounded-full bg-gray-100" />
                        <Skeleton className="h-5 w-28 rounded-full bg-gray-100" />
                      </div>
                      <Skeleton className="mb-2 h-4 w-16 rounded bg-gray-100" />
                      <div className="flex gap-1.5">
                        <Skeleton className="h-6 w-16 rounded-full bg-gray-100" />
                        <Skeleton className="h-6 w-16 rounded-full bg-gray-100" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
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
                        {position.comboMarketId ? (
                          <div className="flex flex-wrap items-center gap-2 text-gray-700">
                            <span className="font-semibold text-gray-900">
                              {position.optionLabel}
                            </span>
                            <span className="inline-flex rounded-full border border-indigo-200 bg-white px-2.5 py-1 font-semibold text-indigo-700 text-xs uppercase tracking-wide">
                              {position.betType === 'spread'
                                ? 'Spread'
                                : 'Total'}
                            </span>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2 text-gray-700">
                            {position.side !== 'draw' ? (
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
                                  className="h-6 w-6 object-cover"
                                />
                              ) : (
                                <span>
                                  {countryNameToFlag(
                                    position.side === 'home'
                                      ? position.homeTeam
                                      : position.awayTeam
                                  )}
                                </span>
                              )
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
                        )}

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
                            {positionCurrentPricesById[position.id] ===
                            undefined ? (
                              <Skeleton className="mt-1 h-5 w-16 rounded bg-gray-100" />
                            ) : (
                              <p className="mt-1 font-semibold text-gray-900 text-sm">
                                $
                                {roundToCents(
                                  position.quantity *
                                    getPositionCurrentPrice(position)
                                ).toFixed(2)}
                              </p>
                            )}
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

                        {positionCategoryById[position.id] === 'mlb-games' &&
                        !position.comboMarketId ? (
                          <div className="mt-3 space-y-3">
                            <div className="flex flex-wrap items-center gap-2">
                              {(['spread', 'total'] as const).map((type) => {
                                const active =
                                  expandedCombo?.positionId === position.id &&
                                  expandedCombo.type === type;
                                return (
                                  <button
                                    key={type}
                                    type="button"
                                    onClick={() => toggleCombo(position, type)}
                                    className={`inline-flex rounded-full border px-3 py-1 font-semibold text-xs transition ${active ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-gray-600 hover:border-indigo-300 hover:text-indigo-700'}`}
                                  >
                                    {type === 'spread' ? 'Spreads' : 'Totals'}
                                  </button>
                                );
                              })}
                            </div>

                            {expandedCombo?.positionId === position.id
                              ? (() => {
                                  const eventId = position.marketId;
                                  const options = comboOptionsByEvent[eventId];
                                  const list =
                                    expandedCombo.type === 'spread'
                                      ? (options?.spreads ?? [])
                                      : (options?.totals ?? []);

                                  if (
                                    loadingCombosByEvent[eventId] &&
                                    !options
                                  ) {
                                    return (
                                      <Skeleton className="h-16 w-full rounded-lg bg-gray-100" />
                                    );
                                  }

                                  if (list.length === 0) {
                                    return (
                                      <p className="text-gray-500 text-xs">
                                        No{' '}
                                        {expandedCombo.type === 'spread'
                                          ? 'spread'
                                          : 'total'}{' '}
                                        markets available right now.
                                      </p>
                                    );
                                  }

                                  return (
                                    <Carousel
                                      opts={{ align: 'start', dragFree: true }}
                                      className="w-full"
                                    >
                                      <CarouselContent className="-ml-2">
                                        {list.map((option) => (
                                          <CarouselItem
                                            key={`${option.sourceMarketId}-${option.outcomeLabel}`}
                                            className="basis-1/2 pl-2"
                                          >
                                            <button
                                              type="button"
                                              onClick={() =>
                                                openComboBet(position, option)
                                              }
                                              className="flex w-full flex-col gap-1 rounded-lg border border-gray-200 bg-white p-3 text-left transition hover:border-indigo-300 hover:bg-indigo-50"
                                            >
                                              <span className="font-semibold text-gray-900 text-xs">
                                                {option.label}
                                              </span>
                                              <span className="font-semibold text-indigo-700 text-sm">
                                                ${option.price.toFixed(2)}
                                              </span>
                                            </button>
                                          </CarouselItem>
                                        ))}
                                      </CarouselContent>
                                    </Carousel>
                                  );
                                })()
                              : null}
                          </div>
                        ) : null}
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
                  <>
                    {activeParlayTeams.length > 0 ? (
                      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {activeParlayTeams.map((team) =>
                          renderParlayTeamCard(team)
                        )}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-gray-200 bg-white p-6 text-gray-500 text-sm">
                        No active parlay teams right now.
                      </div>
                    )}

                    {historyParlayTeams.length > 0 ? (
                      <div className="mt-4">
                        <div className="flex justify-center">
                          <button
                            type="button"
                            onClick={() =>
                              setShowParlayHistory((value) => !value)
                            }
                            className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-white px-[14px] py-[8px] font-semibold text-sm text-violet-700 transition hover:border-violet-300 hover:bg-violet-50"
                          >
                            {showParlayHistory ? 'Hide' : 'Show'} history (
                            {historyParlayTeams.length})
                            <span aria-hidden="true">
                              {showParlayHistory ? '▲' : '▼'}
                            </span>
                          </button>
                        </div>

                        {showParlayHistory ? (
                          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {historyParlayTeams.map((team) =>
                              renderParlayTeamCard(team)
                            )}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </>
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
            className="flex max-h-[70vh] w-full max-w-lg flex-col rounded-2xl bg-white p-6 shadow-2xl"
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
                className="rounded-full border border-violet-200 bg-white px-3 py-1 font-semibold text-violet-700 text-xs transition hover:border-violet-300 hover:bg-violet-50 disabled:opacity-60"
              >
                Close
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
                        className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 font-semibold text-violet-700 text-xs"
                      >
                        {member.username}
                        <button
                          type="button"
                          onClick={() => removeMember(member.id)}
                          className="font-semibold text-violet-700"
                        >
                          ✕
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
                            className="rounded-full bg-violet-600 px-2.5 py-1 font-semibold text-white text-xs transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
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
                className="w-full rounded-full bg-violet-600 px-4 py-3 font-semibold text-sm text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
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
              className="absolute top-4 right-4 rounded-full border border-violet-200 bg-white px-3 py-1 font-semibold text-violet-700 text-xs transition hover:border-violet-300 hover:bg-violet-50"
              disabled={committingShare}
            >
              Close
            </DialogClose>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-2 flex flex-wrap gap-2">
                <span className="inline-flex rounded-full border border-violet-200 bg-white px-2.5 py-1 font-semibold text-[11px] text-violet-800">
                  {selectedParlayTeam?.status ?? 'ACTIVE'}
                </span>
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
              </div>
              <p className="text-gray-600 text-sm">
                {selectedParlayTeam?.members.length ?? 0} members
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(selectedParlayTeam?.members ?? []).map((member) => (
                  <span
                    key={member.id}
                    className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-1 font-semibold text-violet-700 text-xs"
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
                <div className="mt-3 space-y-4">
                  {selectedParlayTeam.committedLegs.map((leg, legIndex) => {
                    const metrics = teamLegMetricsById[leg.id];
                    const liveStatus = teamLegLiveStatusesById[leg.id];
                    const timeline = getLegTimelineClasses(leg, liveStatus);
                    // A leg can only roll over while a later leg is still
                    // pending and hasn't kicked off yet (the rollover target).
                    // The final leg / single-leg parlay therefore can't roll.
                    const hasRolloverTarget =
                      selectedParlayTeam.committedLegs.some(
                        (other) =>
                          other.sequence > leg.sequence &&
                          other.result === 'PENDING' &&
                          new Date(other.kickoff).getTime() > Date.now()
                      );

                    return (
                      <div
                        key={`${selectedParlayTeam.id}-${leg.positionId}`}
                        className="relative"
                      >
                        {/* Connector lives only in the gap above each card. */}
                        {legIndex > 0 ? (
                          <div className="pointer-events-none absolute bottom-full left-1/2 h-4 w-px -translate-x-1/2 bg-gray-200" />
                        ) : null}
                        <div
                          className={`absolute top-0 left-1/2 z-10 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white ${timeline.node}`}
                        />
                        <div
                          className={`relative rounded-md border bg-white px-3 py-2 ${timeline.outline}`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex rounded-full border bg-white px-2 py-0.5 font-semibold text-[11px] ${getLegBadgeClassName(leg, liveStatus)}`}
                            >
                              Leg {leg.sequence}
                            </span>
                            <span className="inline-flex rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-700">
                              {leg.addedByUsername}
                            </span>
                            <LegOutcomeBadge
                              leg={leg}
                              branding={teamBrandingByName}
                            />
                          </div>

                          <div className="mt-2 flex items-start justify-between gap-2">
                            <p className="font-medium text-gray-900 text-sm">
                              {leg.cardTitle}
                            </p>
                            {leg.result === 'PENDING' &&
                            leg.addedByUsername === username &&
                            hasRolloverTarget ? (
                              rolloverLegId === leg.id ? (
                                <div className="flex flex-col items-end gap-1.5">
                                  <div className="flex gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleRolloverLeg(leg.id)
                                      }
                                      disabled={committingShare}
                                      className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 font-semibold text-[11px] text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      Submit
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setRolloverLegId(null)}
                                      className="rounded-full border border-gray-300 bg-white px-2.5 py-0.5 font-semibold text-[11px] text-gray-600"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                  <p className="max-w-[180px] text-right text-[10px] text-amber-700 leading-tight">
                                    WARNING! You are about to close out your leg
                                    and roll your profits into the next leg.
                                  </p>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setRolloverLegId(leg.id)}
                                  className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 font-semibold text-[11px] text-violet-700"
                                >
                                  Rollover
                                </button>
                              )
                            ) : null}
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                            <span className="inline-flex rounded-full border border-green-200 bg-white px-2 py-0.5 font-medium text-green-700">
                              {formatLiveSummary(
                                liveStatus,
                                liveStatus?.statusLabel ?? 'OPEN'
                              )}
                            </span>
                            <span className="text-gray-600">
                              {formatTradeTime(leg.kickoff)}
                            </span>
                          </div>

                          <div className="mt-2 grid grid-cols-2 gap-3">
                            <div className="rounded-lg border border-amber-100 bg-white p-2">
                              <span className="inline-flex rounded-full border border-amber-200 bg-white px-2 py-0.5 font-semibold text-[10px] text-amber-800 uppercase tracking-wide">
                                Shares
                              </span>
                              <p className="mt-1 font-semibold text-gray-900 text-sm">
                                {leg.effectiveShares.toFixed(2)}
                              </p>
                              {leg.rolledInShares > 0 ? (
                                <p className="text-[10px] text-gray-500">
                                  {leg.principalShares.toFixed(2)} principal +{' '}
                                  {leg.rolledInShares.toFixed(2)} rolled
                                </p>
                              ) : null}
                            </div>
                            <div className="rounded-lg border border-blue-100 bg-white p-2">
                              <span className="inline-flex rounded-full border border-blue-200 bg-white px-2 py-0.5 font-semibold text-[10px] text-blue-800 uppercase tracking-wide">
                                Entry Price
                              </span>
                              <p className="mt-1 font-semibold text-gray-900 text-sm">
                                ${leg.entryPrice.toFixed(2)}
                              </p>
                            </div>
                            <div className="rounded-lg border border-violet-100 bg-white p-2">
                              <span className="inline-flex rounded-full border border-violet-200 bg-white px-2 py-0.5 font-semibold text-[10px] text-violet-800 uppercase tracking-wide">
                                Current Price
                              </span>
                              {metrics === undefined ? (
                                <Skeleton className="mt-1 h-5 w-12 rounded bg-gray-100" />
                              ) : (
                                <p className="mt-1 font-semibold text-gray-900 text-sm">
                                  {metrics.currentPrice !== null &&
                                  metrics.currentPrice !== undefined
                                    ? `$${metrics.currentPrice.toFixed(2)}`
                                    : '--'}
                                </p>
                              )}
                            </div>
                            <div className="rounded-lg border border-emerald-100 bg-white p-2">
                              <span className="inline-flex rounded-full border border-emerald-200 bg-white px-2 py-0.5 font-semibold text-[10px] text-emerald-800 uppercase tracking-wide">
                                Expected Payoff
                              </span>
                              {metrics === undefined ? (
                                <Skeleton className="mt-1 h-5 w-14 rounded bg-gray-100" />
                              ) : (
                                <p className="mt-1 font-semibold text-gray-900 text-sm">
                                  {metrics.expectedPayoff !== null &&
                                  metrics.expectedPayoff !== undefined
                                    ? `$${metrics.expectedPayoff.toFixed(2)}`
                                    : '--'}
                                </p>
                              )}
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
            </div>

            {selectedParlayTeam?.canClaim || selectedParlayTeam?.hasClaimed ? (
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <p className="font-semibold text-gray-900 text-sm">
                  Claim Winnings
                </p>
                <div className="mt-3">
                  {selectedParlayTeam?.canClaim ? (
                    <button
                      type="button"
                      onClick={() => void handleClaimParlayTeam()}
                      disabled={committingShare}
                      className="inline-flex w-full items-center justify-center rounded-full bg-emerald-600 px-4 py-2 font-semibold text-sm text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {committingShare
                        ? 'Claiming...'
                        : `CLAIM $${selectedParlayTeam.claimAmount.toFixed(2)}`}
                    </button>
                  ) : (
                    <div className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-emerald-700 text-sm">
                      Claimed ${selectedParlayTeam?.claimAmount.toFixed(2)}.
                      This can only be done once.
                    </div>
                  )}
                </div>
              </div>
            ) : (
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

                  {selectedTeamPosition ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 leading-snug">
                      Heads up: committed shares leave this position and{' '}
                      <span className="font-semibold">cannot be withdrawn</span>{' '}
                      until the Parlay concludes with a victory. Shares can only
                      be sent once, and only in one direction.
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
                    style={{
                      backgroundColor: addSharesPalette.background,
                      color: addSharesPalette.color,
                      borderColor: addSharesPalette.border,
                    }}
                    className="inline-flex w-full items-center justify-center rounded-full border px-4 py-2 font-semibold text-sm transition disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {committingShare
                      ? 'Adding Shares...'
                      : 'Add Shares to Parlay Team'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ResponsiveDialog
        open={sellPosition !== null}
        onOpenChange={(open) => {
          if (!open && !selling) {
            setSellPosition(null);
            setSellDetail(null);
            setSellShares(0);
          }
        }}
      >
        <ResponsiveDialogContent
          showCloseButton={false}
          className="max-w-md border-violet-200 bg-white"
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-violet-950">
              {sellPosition?.comboMarketId
                ? sellPosition.optionLabel
                : sellPosition?.side === 'home'
                  ? sellPosition.homeTeam
                  : sellPosition?.side === 'away'
                    ? sellPosition.awayTeam
                    : 'Draw'}
            </ResponsiveDialogTitle>
            <p className="text-sm text-violet-800">
              {sellPosition ? sellPosition.matchup : 'Loading selection...'}
            </p>
            <ResponsiveDialogClose
              aria-label="Close trade modal"
              className="absolute top-4 right-4 rounded-full border border-violet-200 bg-white px-3 py-1 font-semibold text-violet-700 text-xs transition hover:border-violet-300 hover:bg-violet-50"
              disabled={selling}
            >
              Close
            </ResponsiveDialogClose>
          </ResponsiveDialogHeader>

          <div className="space-y-4 max-md:space-y-3">
            <p className="text-sm text-violet-800 max-md:text-xs">
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

            {loadingSellDetail ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full rounded-lg bg-violet-100" />
                <Skeleton className="h-4 w-56 rounded bg-violet-100" />
                <Skeleton className="h-4 w-full rounded bg-violet-100" />
              </div>
            ) : (
              <>
                <button
                  type="button"
                  disabled={
                    selling ||
                    !sellDetail ||
                    selectedSellPrice <= 0 ||
                    sellShares <= 0
                  }
                  onClick={() => void handleConfirmSell()}
                  style={{
                    backgroundColor: sellPalette.background,
                    color: sellPalette.color,
                    borderColor: sellPalette.border,
                  }}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border px-4 py-2 font-semibold text-sm transition disabled:cursor-not-allowed disabled:opacity-50 max-md:py-1.5"
                >
                  <span>Confirm SELL</span>
                  <span>${selectedSellPrice.toFixed(2)}</span>
                </button>

                <p className="text-sm text-violet-700">
                  Current market price ({sellPosition?.buySide ?? '--'}): $
                  {selectedSellPrice.toFixed(2)}
                </p>

                <div className="flex items-center justify-between">
                  <p className="text-sm text-violet-900">Expected Proceeds</p>
                  <p className="font-semibold text-sm text-violet-950">
                    ${expectedSellValue.toFixed(2)}
                  </p>
                </div>
              </>
            )}
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ResponsiveDialog
        open={comboBet !== null}
        onOpenChange={(open) => {
          if (!open && !placingCombo) {
            setComboBet(null);
          }
        }}
      >
        <ResponsiveDialogContent
          showCloseButton={false}
          className="max-w-md border-violet-200 bg-white"
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-violet-950">
              {comboBet?.option.label}
            </ResponsiveDialogTitle>
            <p className="text-sm text-violet-800">
              {comboBet ? comboBet.position.matchup : 'Loading selection...'}
            </p>
            <ResponsiveDialogClose
              aria-label="Close combo bet modal"
              className="absolute top-4 right-4 rounded-full border border-violet-200 bg-white px-3 py-1 font-semibold text-violet-700 text-xs transition hover:border-violet-300 hover:bg-violet-50"
              disabled={placingCombo}
            >
              Close
            </ResponsiveDialogClose>
          </ResponsiveDialogHeader>

          <div className="space-y-4 max-md:space-y-3">
            <p className="text-sm text-violet-800 max-md:text-xs">
              Choose your paper stake for this{' '}
              {comboBet?.option.marketType === 'spread' ? 'spread' : 'total'}{' '}
              bet.
            </p>

            <div className="grid grid-cols-4 gap-2">
              {[25, 50, 75, 100].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() =>
                    setComboStake(
                      Math.round(
                        (Math.floor(portfolioState.cash) * value) / 100
                      )
                    )
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
                  ${comboStake} / ${Math.floor(portfolioState.cash)}
                </p>
              </div>
              <input
                type="range"
                min="0"
                max={Math.max(0, Math.floor(portfolioState.cash))}
                step="1"
                value={comboStake}
                onChange={(event) => setComboStake(Number(event.target.value))}
                className="w-full"
              />
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm text-violet-900">Price</p>
              <p className="font-semibold text-sm text-violet-950">
                ${comboBet?.option.price.toFixed(2) ?? '--'}
              </p>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm text-violet-900">Expected Max Payout</p>
              <p className="font-semibold text-sm text-violet-950">
                ${comboMaxPayout.toFixed(2)}
              </p>
            </div>

            <button
              type="button"
              disabled={
                placingCombo ||
                !comboBet ||
                comboBet.option.price <= 0 ||
                comboStake <= 0
              }
              onClick={() => void handleConfirmCombo()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-violet-300 bg-violet-600 px-4 py-2 font-semibold text-sm text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50 max-md:py-1.5"
            >
              <span>{placingCombo ? 'Adding...' : 'Confirm Bet'}</span>
              <span>${comboBet?.option.price.toFixed(2) ?? '--'}</span>
            </button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
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
