import { auth } from '@starter/backend/auth';
import { createFileRoute } from '@tanstack/react-router';

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

const initialState = (): PaperPortfolioState => ({
  cash: 1000,
  positions: [],
});

const getStore = () => {
  const scoped = globalThis as typeof globalThis & {
    __paperPortfolioStore?: Map<string, PaperPortfolioState>;
  };

  if (!scoped.__paperPortfolioStore) {
    scoped.__paperPortfolioStore = new Map<string, PaperPortfolioState>();
  }

  return scoped.__paperPortfolioStore;
};

const getSessionUser = async (request: Request) => {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ?? null;
};

const normalizeState = (
  value: Partial<PaperPortfolioState> | null | undefined
): PaperPortfolioState => {
  const fallback = initialState();

  if (!value) {
    return fallback;
  }

  return {
    cash: Number.isFinite(value.cash) ? Number(value.cash) : fallback.cash,
    positions: Array.isArray(value.positions)
      ? value.positions
      : fallback.positions,
  };
};

export const Route = createFileRoute('/api/paper-portfolio')({
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

        const store = getStore();
        const current = store.get(user.id) ?? initialState();

        return Response.json({
          ok: true,
          state: current,
        });
      },
      PUT: async ({ request }) => {
        const user = await getSessionUser(request);

        if (!user) {
          return Response.json(
            { ok: false, error: 'UNAUTHORIZED' },
            { status: 401 }
          );
        }

        const body = (await request.json().catch(() => ({}))) as {
          state?: Partial<PaperPortfolioState>;
        };

        const normalized = normalizeState(body.state);
        const store = getStore();
        store.set(user.id, normalized);

        return Response.json({ ok: true, state: normalized });
      },
    },
  },
});
