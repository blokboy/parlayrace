import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

const PublicLayout = () => {
  return (
    <>
      <header className="landing-header fixed inset-x-0 top-0 z-50 bg-transparent">
        <div className="landing-header__inner mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link
            to="/"
            className="landing-header-brand"
          >
            Parlayrace
          </Link>
          <div className="flex items-center gap-2" />
        </div>
      </header>
      <Outlet />
    </>
  );
};

export const Route = createFileRoute('/_public')({
  component: PublicLayout,
});
