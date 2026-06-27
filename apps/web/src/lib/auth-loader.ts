import { db } from '@starter/backend/db';
import { createServerFn } from '@tanstack/react-start';
import { userMiddleware } from '@/middleware/user';

/**
 * Auth Loader - Server function to fetch the current user
 *
 * This loader uses userMiddleware to fetch the current user and returns it.
 * It does NOT enforce any route protection - individual routes should handle
 * their own authentication checks in their beforeLoad.
 *
 * Usage in root route:
 * ```typescript
 * export const Route = createRootRouteWithContext<RouterContext>()({
 *   beforeLoad: async () => {
 *     const { user } = await authLoader();
 *     return { user };
 *   }
 * });
 * ```
 *
 * Usage in protected routes:
 * ```typescript
 * export const Route = createFileRoute('/dashboard')({
 *   beforeLoad: ({ context }) => {
 *     if (!context.user) {
 *       throw redirect({ to: '/auth/login' });
 *     }
 *   }
 * });
 * ```
 */
export const authLoader = createServerFn()
  .middleware([userMiddleware])
  .handler(async ({ context }) => {
    const user = context.user ?? null;

    if (!user) {
      return {
        user: null,
        username: null,
      };
    }

    const profile = await db.query.userProfile.findFirst({
      where: (table, { eq }) => eq(table.id, user.id),
      columns: {
        username: true,
      },
    });

    // Return the user from context (set by userMiddleware)
    return {
      user,
      username: profile?.username ?? null,
    };
  });
