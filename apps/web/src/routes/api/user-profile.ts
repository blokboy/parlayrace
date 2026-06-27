import { auth } from '@starter/backend/auth';
import { db } from '@starter/backend/db';
import { userProfile } from '@starter/backend/schema';
import { createFileRoute } from '@tanstack/react-router';

const normalizeUsername = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const username = value.trim();
  if (!username) {
    return null;
  }

  const usernamePattern = /^[a-zA-Z0-9_]{3,32}$/;
  if (!usernamePattern.test(username)) {
    return null;
  }

  return username;
};

const getSessionUser = async (request: Request) => {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ?? null;
};

export const Route = createFileRoute('/api/user-profile')({
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

        const profile = await db.query.userProfile.findFirst({
          where: (table, { eq }) => eq(table.id, user.id),
          columns: {
            username: true,
          },
        });

        return Response.json({
          ok: true,
          username: profile?.username ?? null,
        });
      },
      PUT: async ({ request }) => {
        const user = await getSessionUser(request);

        if (!user) {
          return Response.json(
            { ok: false, error: 'UNAUTHORIZED' },
            { status: 401 }
          );
        }

        const body = (await request.json().catch(() => ({}))) as {
          username?: unknown;
        };

        const username = normalizeUsername(body.username);
        if (!username) {
          return Response.json(
            {
              ok: false,
              error: 'INVALID_USERNAME',
              message:
                'Username must be 3-32 chars and only include letters, numbers, and underscore.',
            },
            { status: 400 }
          );
        }

        try {
          await db
            .insert(userProfile)
            .values({
              id: user.id,
              username,
            })
            .onConflictDoUpdate({
              target: userProfile.id,
              set: {
                username,
                updatedAt: new Date(),
              },
            });

          return Response.json({ ok: true, username });
        } catch {
          return Response.json(
            {
              ok: false,
              error: 'USERNAME_TAKEN',
              message: 'That username is already in use.',
            },
            { status: 409 }
          );
        }
      },
    },
  },
});
