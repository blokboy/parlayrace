import {
  createFileRoute,
  Link,
  Outlet,
  useNavigate,
} from '@tanstack/react-router';
import { signInWithGoogle, signOut } from '@/lib/auth-client';

const PublicLayout = () => {
  const navigate = useNavigate();
  const user = Route.useRouteContext({ from: '__root__' }).user;

  return (
    <>
      <header className="landing-header">
        <div className="landing-header__inner mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link
            to="/"
            className="landing-header-brand"
          >
            Parlayrace
          </Link>
          <div className="flex items-center gap-2">
            {user ? (
              <>
                <button
                  type="button"
                  className="landing-header-button-ghost"
                  onClick={() => navigate({ to: '/portfolio' })}
                >
                  Portfolio
                </button>
                <button
                  type="button"
                  className="landing-header-button"
                  onClick={async () => {
                    await signOut();
                    window.location.assign('/');
                  }}
                >
                  Sign Out
                </button>
              </>
            ) : (
              <button
                type="button"
                className="landing-header-button"
                onClick={() =>
                  signInWithGoogle({
                    callbackURL: '/dashboard',
                    newUserCallbackURL: '/dashboard',
                  })
                }
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>
      <Outlet />
    </>
  );
};

export const Route = createFileRoute('/_public')({
  component: PublicLayout,
});
