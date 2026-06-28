import { createFileRoute } from '@tanstack/react-router';
import { syncPolyMarketMarkets } from '@/server/polymarket/sync';

export const Route = createFileRoute('/api/sync/polymarket')({
  server: {
    handlers: {
      POST: async () => {
        const result = await syncPolyMarketMarkets({ limit: 50, batchSize: 25 });

        return Response.json({
          synced: result.synced,
          count: result.count,
          sourceProvider: 'POLYMARKET',
          category: 'fifa-games',
        });
      },
    },
  },
});
