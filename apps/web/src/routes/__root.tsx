/// <reference types="vite/client" />

import { Toaster } from '@starter/ui/components/shadcn/sonner';
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  redirect,
  Scripts,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { OptionalUserProvider } from '@/contexts/optional-user-context';
import { authLoader } from '@/lib/auth-loader';
import type { RouterContext } from '@/router';
import appCss from '@/styles/app.css?url';

const RootComponent = () => {
  const { user } = Route.useRouteContext();

  return (
    <RootDocument>
      <OptionalUserProvider user={user}>
        <Outlet />
      </OptionalUserProvider>
    </RootDocument>
  );
};

const RootDocument = ({ children }: Readonly<{ children: ReactNode }>) => {
  return (
    <html
      className="h-full"
      lang="en"
    >
      <head>
        <HeadContent />
      </head>
      <body className="h-full">
        {children}
        <Toaster
          closeButton
          richColors
        />
        <Scripts />
      </body>
    </html>
  );
};

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ location }) => {
    const { user, username } = await authLoader();

    const pathname = location.pathname;
    const onUsernamePage = pathname === '/auth/username';

    if (user && !username && !onUsernamePage) {
      throw redirect({
        to: '/auth/username',
      });
    }

    if (!user && onUsernamePage) {
      throw redirect({
        to: '/auth/login',
        search: {
          redirect: '/auth/username',
        },
      });
    }

    if (user && username && onUsernamePage) {
      throw redirect({
        to: '/dashboard',
      });
    }

    return { user, username };
  },
  head: () => {
    return {
      meta: [
        { charSet: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { title: 'Starter App' },
      ],
      links: [
        { rel: 'stylesheet', href: appCss },
        { rel: 'icon', type: 'image/png', href: '/favicon-32x32.png' },
      ],
    };
  },
  component: RootComponent,
  notFoundComponent: () => <div>Page not found</div>,
});
