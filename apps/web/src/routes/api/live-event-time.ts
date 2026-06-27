import { createFileRoute } from '@tanstack/react-router';

type LiveEventRequest = {
  events?: Array<{ matchup: string; kickoff: string }>;
};

type LiveEventResponse = {
  statuses: Record<string, string>;
};

const getStatusLabel = (kickoffIso: string): string => {
  const kickoff = new Date(kickoffIso);
  if (Number.isNaN(kickoff.getTime())) {
    return 'OPEN';
  }

  const now = new Date();
  const diffMinutes = Math.floor((now.getTime() - kickoff.getTime()) / 60000);

  if (diffMinutes < -120) {
    return 'OPEN';
  }

  if (diffMinutes < 0) {
    return `Starts in ${Math.abs(diffMinutes)}m`;
  }

  if (diffMinutes <= 120) {
    return `${diffMinutes}'`;
  }

  return 'Final';
};

export const Route = createFileRoute('/api/live-event-time')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request
          .json()
          .catch(() => ({}))) as LiveEventRequest;
        const events = body.events ?? [];

        const statuses = events.reduce<Record<string, string>>((acc, event) => {
          acc[event.matchup] = getStatusLabel(event.kickoff);
          return acc;
        }, {});

        return Response.json({ statuses } satisfies LiveEventResponse);
      },
    },
  },
});
