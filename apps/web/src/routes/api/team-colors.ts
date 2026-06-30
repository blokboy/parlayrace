import { db } from '@starter/backend/db';
import { createFileRoute } from '@tanstack/react-router';

type TeamBranding = {
  name: string;
  logo: string;
  color: string | null;
};

// Branding (logo + color) for the requested team names, sourced from our synced
// markets. This covers BOTH FIFA national-team flags and MLB club logos — the
// sync persists each game's home/away logo on external_market, so a single DB
// lookup serves every league (no live tag-window dependency).
export const Route = createFileRoute('/api/team-colors')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const requestedTeams = (url.searchParams.get('teams') ?? '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);

        if (requestedTeams.length === 0) {
          return Response.json({ teams: {} as Record<string, TeamBranding> });
        }

        const rows = await db.query.externalMarket.findMany({
          where: (table, { and, eq, inArray, or }) =>
            and(
              eq(table.sourceProvider, 'POLYMARKET'),
              or(
                inArray(table.homeTeam, requestedTeams),
                inArray(table.awayTeam, requestedTeams)
              )
            ),
          columns: {
            homeTeam: true,
            homeLogo: true,
            homeColor: true,
            awayTeam: true,
            awayLogo: true,
            awayColor: true,
          },
        });

        const requested = new Set(requestedTeams);
        const teams: Record<string, TeamBranding> = {};

        for (const row of rows) {
          if (
            row.homeTeam &&
            row.homeLogo &&
            requested.has(row.homeTeam) &&
            !teams[row.homeTeam]
          ) {
            teams[row.homeTeam] = {
              name: row.homeTeam,
              logo: row.homeLogo,
              color: row.homeColor ?? null,
            };
          }
          if (
            row.awayTeam &&
            row.awayLogo &&
            requested.has(row.awayTeam) &&
            !teams[row.awayTeam]
          ) {
            teams[row.awayTeam] = {
              name: row.awayTeam,
              logo: row.awayLogo,
              color: row.awayColor ?? null,
            };
          }
        }

        return Response.json({ teams });
      },
    },
  },
});
