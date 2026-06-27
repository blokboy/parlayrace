import { createFileRoute } from '@tanstack/react-router';

type PolymarketTeam = {
  name: string;
  logo: string;
  color: string | null;
};

type PolymarketEvent = {
  teams: PolymarketTeam[] | null;
};

type TeamBranding = {
  name: string;
  logo: string;
  color: string | null;
};

const normalizeHexColor = (input: string | null | undefined): string | null => {
  if (!input) {
    return null;
  }

  const value = input.trim();
  return /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(value) ? value : null;
};

export const Route = createFileRoute('/api/team-colors')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const teamsParam = url.searchParams.get('teams') ?? '';
        const requestedTeams = teamsParam
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);

        if (requestedTeams.length === 0) {
          return Response.json({ teams: {} as Record<string, TeamBranding> });
        }

        const response = await fetch(
          'https://gamma-api.polymarket.com/events?limit=200&active=true&closed=false&tag_slug=soccer'
        );

        if (!response.ok) {
          return Response.json(
            { teams: {} as Record<string, TeamBranding> },
            { status: 200 }
          );
        }

        const events = (await response.json()) as PolymarketEvent[];
        const catalog = new Map<string, TeamBranding>();

        for (const event of events) {
          if (!event.teams) {
            continue;
          }

          for (const team of event.teams) {
            if (!team.name || !team.logo) {
              continue;
            }

            if (!catalog.has(team.name)) {
              catalog.set(team.name, {
                name: team.name,
                logo: team.logo,
                color: normalizeHexColor(team.color),
              });
            }
          }
        }

        const teams = requestedTeams.reduce<Record<string, TeamBranding>>(
          (acc, name) => {
            const value = catalog.get(name);
            if (value) {
              acc[name] = value;
            }
            return acc;
          },
          {}
        );

        return Response.json({ teams });
      },
    },
  },
});
