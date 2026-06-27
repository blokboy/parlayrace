import { auth } from '@starter/backend/auth';
import { db } from '@starter/backend/db';
import {
  parlayTeam,
  parlayTeamMember,
  parlayTeamParlay,
  parlayTeamParlayShare,
  userProfile,
} from '@starter/backend/schema';
import { createFileRoute } from '@tanstack/react-router';

type PaperPosition = {
  id: string;
  marketId: string;
  matchup: string;
  homeTeam: string;
  awayTeam: string;
  side: 'home' | 'draw' | 'away';
  buySide: 'YES' | 'NO';
  stake: number;
  entryPrice: number;
  quantity: number;
  kickoff: string;
  status: 'OPEN' | 'CLOSED';
  createdAt: string;
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
  positionSide: 'home' | 'draw' | 'away';
  buySide: 'YES' | 'NO';
  placedAt: string;
};

type ParlayTeamResponse = {
  id: string;
  name: string;
  captainUserId: string;
  members: TeamMember[];
  committedLegs: TeamCommittedLeg[];
  claimedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const MAX_ADDITIONAL_MEMBERS = 9;

const roundToCents = (value: number) => Math.round(value * 100) / 100;

const kickoffKey = (value: string): string | null => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 16);
};

const optionLabelForPosition = (position: PaperPosition): string => {
  if (position.side === 'home') {
    return position.homeTeam;
  }

  if (position.side === 'away') {
    return position.awayTeam;
  }

  return 'Draw';
};

const getSessionUser = async (request: Request) => {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ?? null;
};

const buildTeamResponses = async (
  teamIds: string[]
): Promise<ParlayTeamResponse[]> => {
  if (teamIds.length === 0) {
    return [];
  }

  const [teams, members, parlays, shares] = await Promise.all([
    db.query.parlayTeam.findMany({
      where: (table, { inArray }) => inArray(table.id, teamIds),
    }),
    db.query.parlayTeamMember.findMany({
      where: (table, { inArray }) => inArray(table.teamId, teamIds),
    }),
    db.query.parlayTeamParlay.findMany({
      where: (table, { inArray }) => inArray(table.teamId, teamIds),
    }),
    db.query.parlayTeamParlayShare.findMany({
      where: (table, { inArray }) => inArray(table.teamId, teamIds),
    }),
  ]);

  const userIds = Array.from(
    new Set([
      ...members.map((member) => member.userId),
      ...shares.map((share) => share.addedByUserId),
      ...teams.map((team) => team.createdByUserId),
    ])
  );

  const profiles =
    userIds.length > 0
      ? await db.query.userProfile.findMany({
          where: (table, { inArray }) => inArray(table.id, userIds),
          columns: {
            id: true,
            username: true,
          },
        })
      : [];

  const usernameById = new Map(
    profiles.map((profile) => [profile.id, profile.username ?? profile.id])
  );

  const portfolioRows =
    userIds.length > 0
      ? await db.query.paperPortfolio.findMany({
          where: (table, { inArray }) => inArray(table.userId, userIds),
          columns: {
            userId: true,
            positions: true,
          },
        })
      : [];

  const positionById = new Map<string, PaperPosition>();
  for (const row of portfolioRows) {
    const positions = Array.isArray(row.positions)
      ? (row.positions as PaperPosition[])
      : [];

    for (const position of positions) {
      if (!positionById.has(position.id)) {
        positionById.set(position.id, position);
      }
    }
  }

  const activeParlayByTeamId = new Map<string, string>();
  for (const teamId of teamIds) {
    const teamParlays = parlays
      .filter((parlay) => parlay.teamId === teamId)
      .sort((a, b) => {
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      });

    const active = teamParlays.find((parlay) => parlay.status === 'ACTIVE');
    const selected = active ?? teamParlays[0];

    if (selected) {
      activeParlayByTeamId.set(teamId, selected.id);
    }
  }

  return teams
    .map<ParlayTeamResponse>((team) => {
      const activeParlayId = activeParlayByTeamId.get(team.id) ?? null;

      const teamMembers = members
        .filter((member) => member.teamId === team.id)
        .map<TeamMember>((member) => ({
          id: member.userId,
          username:
            usernameById.get(member.userId) ??
            usernameById.get(team.createdByUserId) ??
            member.userId,
        }));

      const dedupedMembers = Array.from(
        new Map(teamMembers.map((member) => [member.id, member])).values()
      );

      const teamShares = shares
        .filter((share) => {
          if (activeParlayId && share.parlayId !== activeParlayId) {
            return false;
          }

          return share.teamId === team.id;
        })
        .sort((a, b) => a.sequence - b.sequence)
        .map<TeamCommittedLeg>((share) => {
          const position = positionById.get(share.positionId);

          return {
            id: share.id,
            parlayId: share.parlayId,
            positionId: share.positionId,
            sequence: share.sequence,
            addedByUserId: share.addedByUserId,
            addedByUsername:
              usernameById.get(share.addedByUserId) ?? share.addedByUserId,
            shares: share.shares,
            stake: share.stake,
            entryPrice: share.entryPrice,
            marketId: share.marketId ?? null,
            cardTitle: share.cardTitle,
            optionLabel: share.optionLabel,
            side: share.side,
            kickoff: position?.kickoff ?? share.placedAt.toISOString(),
            homeTeam: position?.homeTeam ?? '',
            awayTeam: position?.awayTeam ?? '',
            positionSide: position?.side ?? 'draw',
            buySide: position?.buySide ?? (share.side === 'NO' ? 'NO' : 'YES'),
            placedAt: share.placedAt.toISOString(),
          };
        });

      return {
        id: team.id,
        name: team.name,
        captainUserId: team.createdByUserId,
        members: dedupedMembers,
        committedLegs: teamShares,
        claimedAt: null,
        createdAt: team.createdAt.toISOString(),
        updatedAt: team.updatedAt.toISOString(),
      };
    })
    .sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
};

export const Route = createFileRoute('/api/parlay-teams')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await getSessionUser(request);

        if (!user) {
          return Response.json(
            { ok: false, error: 'UNAUTHORIZED' },
            { status: 401 }
          );
        }

        const memberships = await db.query.parlayTeamMember.findMany({
          where: (table, { eq }) => eq(table.userId, user.id),
          columns: {
            teamId: true,
          },
        });

        const teamIds = Array.from(
          new Set(memberships.map((membership) => membership.teamId))
        );

        const teams = await buildTeamResponses(teamIds);

        return Response.json({ ok: true, teams });
      },
      POST: async ({ request }) => {
        const user = await getSessionUser(request);

        if (!user) {
          return Response.json(
            { ok: false, error: 'UNAUTHORIZED' },
            { status: 401 }
          );
        }

        const body = (await request.json().catch(() => ({}))) as {
          action?: string;
          name?: string;
          memberUsernames?: string[];
          captainUsername?: string;
        };

        if (body.action !== 'create' || !body.name?.trim()) {
          return Response.json(
            { ok: false, error: 'INVALID_CREATE' },
            { status: 400 }
          );
        }

        const uniqueMemberUsernames = Array.from(
          new Set(
            (body.memberUsernames ?? [])
              .map((entry) => entry.trim())
              .filter(Boolean)
          )
        );

        if (uniqueMemberUsernames.length > MAX_ADDITIONAL_MEMBERS) {
          return Response.json(
            {
              ok: false,
              error: 'MAX_MEMBERS_EXCEEDED',
              message: 'A team can include up to 10 members total.',
            },
            { status: 400 }
          );
        }

        const captainUsername =
          body.captainUsername?.trim() || user.name || user.email.split('@')[0];

        await db
          .insert(userProfile)
          .values({
            id: user.id,
            username: captainUsername,
          })
          .onConflictDoUpdate({
            target: userProfile.id,
            set: {
              updatedAt: new Date(),
            },
          });

        const matchedProfiles = uniqueMemberUsernames.length
          ? await db.query.userProfile.findMany({
              where: (table, { inArray }) =>
                inArray(table.username, uniqueMemberUsernames),
              columns: {
                id: true,
                username: true,
              },
            })
          : [];

        const matchedByUsername = new Map(
          matchedProfiles
            .filter((profile): profile is { id: string; username: string } =>
              Boolean(profile.username)
            )
            .map((profile) => [profile.username, profile.id])
        );

        const memberIds = [
          user.id,
          ...uniqueMemberUsernames
            .map((username) => matchedByUsername.get(username) ?? null)
            .filter((id): id is string => Boolean(id)),
        ];

        const uniqueMemberIds = Array.from(new Set(memberIds));

        const [createdTeam] = await db
          .insert(parlayTeam)
          .values({
            name: body.name.trim(),
            createdByUserId: user.id,
          })
          .returning({
            id: parlayTeam.id,
          });

        await db.insert(parlayTeamMember).values(
          uniqueMemberIds.map((memberId) => ({
            teamId: createdTeam.id,
            userId: memberId,
          }))
        );

        await db.insert(parlayTeamParlay).values({
          teamId: createdTeam.id,
          startedByUserId: user.id,
          status: 'ACTIVE',
        });

        const teams = await buildTeamResponses([createdTeam.id]);
        const team = teams[0] ?? null;

        return Response.json({ ok: true, team, teams });
      },
      PATCH: async ({ request }) => {
        const user = await getSessionUser(request);

        if (!user) {
          return Response.json(
            { ok: false, error: 'UNAUTHORIZED' },
            { status: 401 }
          );
        }

        const body = (await request.json().catch(() => ({}))) as {
          action?: string;
          teamId?: string;
          positionId?: string;
          shares?: number;
        };

        if (!body.teamId) {
          return Response.json(
            { ok: false, error: 'TEAM_NOT_FOUND' },
            { status: 404 }
          );
        }

        const teamId = body.teamId;

        const memberRow = await db.query.parlayTeamMember.findFirst({
          where: (table, { and, eq }) =>
            and(eq(table.teamId, teamId), eq(table.userId, user.id)),
        });

        if (!memberRow) {
          return Response.json(
            { ok: false, error: 'TEAM_NOT_FOUND' },
            { status: 404 }
          );
        }

        if (body.action === 'commit-share') {
          if (
            !body.positionId ||
            !Number.isFinite(body.shares) ||
            Number(body.shares) <= 0
          ) {
            return Response.json(
              { ok: false, error: 'INVALID_COMMIT' },
              { status: 400 }
            );
          }

          const targetShares = roundToCents(Number(body.shares));

          const teamMembers = await db.query.parlayTeamMember.findMany({
            where: (table, { eq }) => eq(table.teamId, teamId),
            columns: {
              userId: true,
            },
          });

          const teamMemberIds = teamMembers.map((member) => member.userId);

          const memberPortfolios = await db.query.paperPortfolio.findMany({
            where: (table, { inArray }) => inArray(table.userId, teamMemberIds),
            columns: {
              userId: true,
              positions: true,
            },
          });

          const positionById = new Map<string, PaperPosition>();
          for (const portfolio of memberPortfolios) {
            const positions = Array.isArray(portfolio.positions)
              ? (portfolio.positions as PaperPosition[])
              : [];

            for (const position of positions) {
              if (!positionById.has(position.id)) {
                positionById.set(position.id, position);
              }
            }
          }

          const currentUserPortfolio = memberPortfolios.find(
            (portfolio) => portfolio.userId === user.id
          );
          const currentUserPositions = Array.isArray(
            currentUserPortfolio?.positions
          )
            ? (currentUserPortfolio?.positions as PaperPosition[])
            : [];

          const targetPosition = currentUserPositions.find(
            (position) => position.id === body.positionId
          );

          if (!targetPosition || targetPosition.status !== 'OPEN') {
            return Response.json(
              { ok: false, error: 'POSITION_NOT_FOUND' },
              { status: 400 }
            );
          }

          const teamParlays = await db.query.parlayTeamParlay.findMany({
            where: (table, { eq }) => eq(table.teamId, teamId),
          });

          const activeParlay =
            teamParlays.find((parlay) => parlay.status === 'ACTIVE') ??
            teamParlays.sort((a, b) => {
              return (
                new Date(b.createdAt).getTime() -
                new Date(a.createdAt).getTime()
              );
            })[0] ??
            null;

          const ensuredParlay =
            activeParlay ??
            (
              await db
                .insert(parlayTeamParlay)
                .values({
                  teamId,
                  startedByUserId: user.id,
                  status: 'ACTIVE',
                })
                .returning({
                  id: parlayTeamParlay.id,
                })
            )[0];

          const existingShares = await db.query.parlayTeamParlayShare.findMany({
            where: (table, { and, eq }) =>
              and(
                eq(table.teamId, teamId),
                eq(table.parlayId, ensuredParlay.id)
              ),
          });

          const alreadyCommittedByUserForPosition = roundToCents(
            existingShares
              .filter(
                (share) =>
                  share.positionId === body.positionId &&
                  share.addedByUserId === user.id
              )
              .reduce((sum, share) => sum + share.shares, 0)
          );

          if (
            targetShares + alreadyCommittedByUserForPosition >
            targetPosition.quantity
          ) {
            return Response.json(
              {
                ok: false,
                error: 'INSUFFICIENT_SHARES',
                message:
                  'Cannot commit more shares than this position contains.',
              },
              { status: 400 }
            );
          }

          const targetKickoff = kickoffKey(targetPosition.kickoff);

          const hasKickoffConflict = existingShares.some((share) => {
            if (share.positionId === body.positionId) {
              return false;
            }

            const existingPosition = positionById.get(share.positionId);
            if (!existingPosition) {
              return false;
            }

            const existingKickoff = kickoffKey(existingPosition.kickoff);
            return targetKickoff !== null && existingKickoff === targetKickoff;
          });

          if (hasKickoffConflict) {
            return Response.json(
              {
                ok: false,
                error: 'CONFLICTING_START_TIME',
                message:
                  'Cannot add a leg with a conflicting start time to this Parlay Team.',
              },
              { status: 400 }
            );
          }

          const highestSequence = existingShares.reduce((max, share) => {
            return Math.max(max, share.sequence);
          }, 0);

          const optionLabel = optionLabelForPosition(targetPosition);
          const side = targetPosition.buySide;
          const entryPrice = roundToCents(targetPosition.entryPrice);
          const stake = roundToCents(targetShares * entryPrice);

          await db.insert(parlayTeamParlayShare).values({
            parlayId: ensuredParlay.id,
            teamId,
            addedByUserId: user.id,
            positionId: body.positionId,
            sequence: highestSequence + 1,
            placedAt: new Date(targetPosition.createdAt),
            cardTitle: targetPosition.matchup,
            marketId: targetPosition.marketId,
            optionLabel,
            side,
            shares: targetShares,
            stake,
            entryPrice,
          });
        } else if (body.action === 'claim') {
          return Response.json(
            { ok: false, error: 'INVALID_ACTION' },
            { status: 400 }
          );
        } else {
          return Response.json(
            { ok: false, error: 'INVALID_ACTION' },
            { status: 400 }
          );
        }

        const teams = await buildTeamResponses([teamId]);
        const team = teams[0] ?? null;

        return Response.json({ ok: true, team, teams });
      },
    },
  },
});
