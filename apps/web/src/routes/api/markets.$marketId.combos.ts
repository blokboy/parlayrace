import { createFileRoute } from '@tanstack/react-router';
import { fetchEventCombos } from '@/server/polymarket/combos';

// Live combo add-on options for a single game (MLB/FIFA spreads+totals, tennis
// set markets). $marketId is the persisted sourceEventId. Serves both the
// portfolio carousel and ongoing combo pricing.
export const Route = createFileRoute('/api/markets/$marketId/combos')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const payload = await fetchEventCombos(params.marketId);
        return Response.json(payload);
      },
    },
  },
});
