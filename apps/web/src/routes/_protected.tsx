import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

const ProtectedLayout = () => {
  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 bg-transparent landing-header">
        <div className="landing-header__inner mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link
            to="/"
            className="landing-header-brand"
          >
            Parlayrace
          </Link>
          <div className="flex items-center gap-2">
            <a
              href="/dashboard?auth=1"
              className="landing-header-button !text-white visited:!text-white hover:!text-white"
            >
              Get Started
            </a>
          </div>
        </div>
      </header>
      <div className="pt-16 dashboard-arcade landing-arcade">
        <Outlet />
      </div>
    </>
  );
};

export const Route = createFileRoute('/_protected')({
  component: ProtectedLayout,
});
