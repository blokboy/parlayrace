import { createFileRoute } from '@tanstack/react-router';
import { syncPolyMarketMarkets } from '@/server/polymarket/sync';

export const Route = createFileRoute('/api/sync/polymarket/scheduled')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.POLYMARKET_SYNC_SECRET?.trim();
        const isDev = process.env.NODE_ENV === 'development';

        if (secret && !isDev) {
          const provided = request.headers.get('x-sync-secret');
          if (provided !== secret) {
            return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
          }
        }

        try {
          const result = await syncPolyMarketMarkets({ limit: 1000, batchSize: 50 });

          return Response.json({
            synced: result.observability.providerHealthy,
            count: result.jobs.catalog.success,
            mode: 'scheduled',
            ...result,
          });
        } catch (error) {
          return Response.json(
            {
              synced: false,
              mode: 'scheduled',
              error: error instanceof Error ? error.message : 'Sync failed',
              sourceProvider: 'POLYMARKET',
            },
            { status: 500 }
          );
        }
      },
    },
  },
});
