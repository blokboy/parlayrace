import { auth } from '@starter/backend/auth';
import { db } from '@starter/backend/db';
import { createFileRoute } from '@tanstack/react-router';

type SearchUser = {
  id: string;
  username: string;
};

const getSessionUser = async (request: Request) => {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ?? null;
};

const staticUsers: SearchUser[] = [
  { id: 'u-amy', username: 'amy_chen' },
  { id: 'u-mateo', username: 'mateo_silva' },
  { id: 'u-nora', username: 'nora_patel' },
  { id: 'u-jules', username: 'jules_park' },
];

export const Route = createFileRoute('/api/users')({
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

        const url = new URL(request.url);
        const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();

        const profileRows = await db.query.userProfile.findMany({
          columns: {
            id: true,
            username: true,
          },
          limit: 100,
        });

        const dbUsers: SearchUser[] = profileRows
          .filter((entry): entry is { id: string; username: string } => {
            return Boolean(entry.username);
          })
          .map((entry) => ({
            id: entry.id,
            username: entry.username,
          }));

        const fullSet: SearchUser[] = [...dbUsers, ...staticUsers];

        const deduped = Array.from(
          new Map(fullSet.map((entry) => [entry.id, entry])).values()
        );

        const users = query
          ? deduped.filter((entry) => {
              return entry.username.toLowerCase().includes(query);
            })
          : deduped.slice(0, 8);

        return Response.json({ ok: true, users });
      },
    },
  },
});
