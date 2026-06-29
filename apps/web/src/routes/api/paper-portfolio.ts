import { auth } from '@starter/backend/auth';
import { db } from '@starter/backend/db';
import { paperPortfolio } from '@starter/backend/schema';
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
  // Spreads/totals combo bets placed from the portfolio (absent ⇒ moneyline).
  betType?: 'moneyline' | 'spread' | 'total';
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

const initialState = (): PaperPortfolioState => ({
  cash: 1000,
  positions: [],
});

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

const getPortfolioStateForUser = async (
  userId: string
): Promise<PaperPortfolioState> => {
  const row = await db.query.paperPortfolio.findFirst({
    where: (table, { eq }) => eq(table.userId, userId),
    columns: {
      cashBalance: true,
      positions: true,
    },
  });

  if (!row) {
    await db.insert(paperPortfolio).values({ userId });
    return initialState();
  }

  return normalizeState({
    cash: row.cashBalance,
    positions: Array.isArray(row.positions) ? row.positions : [],
  });
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

        const current = await getPortfolioStateForUser(user.id);

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

        await db
          .insert(paperPortfolio)
          .values({
            userId: user.id,
            cashBalance: normalized.cash,
            positions: normalized.positions,
          })
          .onConflictDoUpdate({
            target: paperPortfolio.userId,
            set: {
              cashBalance: normalized.cash,
              positions: normalized.positions,
              updatedAt: new Date(),
            },
          });

        return Response.json({ ok: true, state: normalized });
      },
    },
  },
});
