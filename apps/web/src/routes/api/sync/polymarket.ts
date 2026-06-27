import { createFileRoute } from '@tanstack/react-router';

type PolymarketEvent = {
  id: string | number;
};

export const Route = createFileRoute('/api/sync/polymarket')({
  server: {
    handlers: {
      POST: async () => {
        const response = await fetch(
          'https://gamma-api.polymarket.com/events?limit=200&active=true&closed=false&tag_slug=soccer'
        );

        if (!response.ok) {
          return Response.json({ synced: false, count: 0 }, { status: 200 });
        }

        const events = (await response.json()) as PolymarketEvent[];

        return Response.json({
          synced: true,
          count: events.length,
          sourceProvider: 'POLYMARKET',
          category: 'fifa-games',
        });
      },
    },
  },
});
