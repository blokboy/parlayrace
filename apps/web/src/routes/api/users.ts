import { auth } from '@starter/backend/auth';
import { createFileRoute } from '@tanstack/react-router';

type SearchUser = {
  id: string;
  name: string;
  email: string;
};

const getSessionUser = async (request: Request) => {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ?? null;
};

const staticUsers: SearchUser[] = [
  { id: 'u-amy', name: 'Amy Chen', email: 'amy@example.com' },
  { id: 'u-mateo', name: 'Mateo Silva', email: 'mateo@example.com' },
  { id: 'u-nora', name: 'Nora Patel', email: 'nora@example.com' },
  { id: 'u-jules', name: 'Jules Park', email: 'jules@example.com' },
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

        const fullSet: SearchUser[] = [
          {
            id: user.id,
            name: user.name ?? 'You',
            email: user.email,
          },
          ...staticUsers,
        ];

        const deduped = Array.from(
          new Map(fullSet.map((entry) => [entry.id, entry])).values()
        );

        const users = query
          ? deduped.filter((entry) => {
              return (
                entry.name.toLowerCase().includes(query) ||
                entry.email.toLowerCase().includes(query)
              );
            })
          : deduped.slice(0, 8);

        return Response.json({ ok: true, users });
      },
    },
  },
});
