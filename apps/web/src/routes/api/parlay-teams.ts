import { auth } from '@starter/backend/auth';
import { createFileRoute } from '@tanstack/react-router';

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

const getStore = () => {
  const scoped = globalThis as typeof globalThis & {
    __parlayTeamsStore?: Map<string, ParlayTeam[]>;
  };

  if (!scoped.__parlayTeamsStore) {
    scoped.__parlayTeamsStore = new Map<string, ParlayTeam[]>();
  }

  return scoped.__parlayTeamsStore;
};

const getSessionUser = async (request: Request) => {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ?? null;
};

const nowIso = () => new Date().toISOString();

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

        const teams = getStore().get(user.id) ?? [];
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
        };

        if (body.action !== 'create' || !body.name?.trim()) {
          return Response.json(
            { ok: false, error: 'INVALID_CREATE' },
            { status: 400 }
          );
        }

        const store = getStore();
        const teams = store.get(user.id) ?? [];
        const team: ParlayTeam = {
          id: crypto.randomUUID(),
          name: body.name.trim(),
          captainUserId: user.id,
          members: [
            {
              id: user.id,
              name: user.name ?? 'Captain',
              email: user.email,
            },
          ],
          committedLegs: [],
          claimedAt: null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };

        const next = [team, ...teams];
        store.set(user.id, next);

        return Response.json({ ok: true, team, teams: next });
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

        const store = getStore();
        const teams = store.get(user.id) ?? [];
        const teamIndex = teams.findIndex((team) => team.id === body.teamId);

        if (teamIndex < 0) {
          return Response.json(
            { ok: false, error: 'TEAM_NOT_FOUND' },
            { status: 404 }
          );
        }

        const team = teams[teamIndex];

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

          const existing = team.committedLegs.find(
            (leg) => leg.positionId === body.positionId
          );

          if (existing) {
            existing.shares = Number(body.shares);
          } else {
            team.committedLegs.push({
              positionId: body.positionId,
              shares: Number(body.shares),
            });
          }

          team.updatedAt = nowIso();
        } else if (body.action === 'claim') {
          team.claimedAt = nowIso();
          team.updatedAt = nowIso();
        } else {
          return Response.json(
            { ok: false, error: 'INVALID_ACTION' },
            { status: 400 }
          );
        }

        const next = [...teams];
        next[teamIndex] = team;
        store.set(user.id, next);

        return Response.json({ ok: true, team, teams: next });
      },
    },
  },
});
