import { createFileRoute } from '@tanstack/react-router';
import { syncPolyMarketMarkets } from '@/server/polymarket/sync';

export const Route = createFileRoute('/api/sync/polymarket')({
  server: {
    handlers: {
      POST: async () => {
        try {
          const result = await syncPolyMarketMarkets({ limit: 400, batchSize: 100 });

          return Response.json({
            synced: result.observability.providerHealthy,
            count: result.jobs.catalog.success,
            category: 'fifa-games',
            ...result,
          });
        } catch (error) {
          return Response.json(
            {
              synced: false,
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
