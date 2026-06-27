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

type TeamMember = {
  id: string;
  username: string;
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
  username: string;
};

const MAX_ADDITIONAL_MEMBERS = 9;

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

const createParlayTeam = async (
  name: string,
  memberUsernames: string[],
  captainUsername: string | null
): Promise<ParlayTeam | null> => {
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

  const openPositions = useMemo(
    () =>
      portfolioState.positions.filter((position) => position.status === 'OPEN'),
    [portfolioState.positions]
  );

  const deployedCapital = useMemo(
    () =>
      openPositions.reduce((sum, position) => {
        return sum + position.stake;
      }, 0),
    [openPositions]
  );

  const createTeamFromModal = async () => {
    const name = teamName.trim();
    if (!name || creatingTeam) {
      return;
    }

    if (selectedMembers.length > MAX_ADDITIONAL_MEMBERS) {
      setTeamFeedback('You can add up to 9 members (10 total with captain).');
      return;
    }

    setCreatingTeam(true);
    setTeamFeedback(null);

    const nextTeam = await createParlayTeam(
      name,
      selectedMembers.map((member) => member.username),
      username
    );
    if (!nextTeam) {
      setTeamFeedback('Failed to create Parlay Team.');
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

  return (
    <main className="min-h-screen bg-white pt-16">
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
            className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-sm text-white transition hover:bg-blue-700"
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
              <div className="mb-6 rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-indigo-700 text-sm">
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
                        <span className="font-semibold text-gray-900">
                          {position.side === 'home'
                            ? position.homeTeam
                            : position.side === 'away'
                              ? position.awayTeam
                              : 'Draw'}
                        </span>
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 font-semibold text-xs ${position.buySide === 'YES' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}
                        >
                          {position.buySide}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-lg border border-violet-100 bg-violet-50/60 p-2">
                          <span className="inline-flex rounded-full bg-violet-200 px-2 py-0.5 font-semibold text-[10px] text-violet-800 uppercase tracking-wide">
                            Stake
                          </span>
                          <p className="mt-1 font-semibold text-gray-900 text-sm">
                            ${position.stake.toFixed(2)}
                          </p>
                        </div>
                        <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-2">
                          <span className="inline-flex rounded-full bg-amber-200 px-2 py-0.5 font-semibold text-[10px] text-amber-800 uppercase tracking-wide">
                            Shares
                          </span>
                          <p className="mt-1 font-semibold text-gray-900 text-sm">
                            {position.quantity.toFixed(2)}
                          </p>
                        </div>
                        <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-2">
                          <span className="inline-flex rounded-full bg-blue-200 px-2 py-0.5 font-semibold text-[10px] text-blue-800 uppercase tracking-wide">
                            Entry Price
                          </span>
                          <p className="mt-1 font-semibold text-gray-900 text-sm">
                            ${position.entryPrice.toFixed(2)}
                          </p>
                        </div>
                        <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-2">
                          <span className="inline-flex rounded-full bg-emerald-200 px-2 py-0.5 font-semibold text-[10px] text-emerald-800 uppercase tracking-wide">
                            Potential Payout
                          </span>
                          <p className="mt-1 font-semibold text-gray-900 text-sm">
                            ${position.quantity.toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 border-gray-100 border-t pt-3">
                      <p className="text-gray-500 text-xs">
                        Created {formatTradeTime(position.createdAt)}
                      </p>
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
                <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-6">
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
                    <article
                      key={team.id}
                      className="rounded-2xl border border-gray-200 bg-white p-4"
                    >
                      <h3 className="font-semibold text-base text-gray-900">
                        {team.name}
                      </h3>
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
                    </article>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
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
                        className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-blue-700 text-xs"
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
                <div className="mt-2 max-h-52 space-y-2 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2">
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
