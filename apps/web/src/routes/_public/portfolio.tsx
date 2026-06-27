import { createFileRoute, redirect } from '@tanstack/react-router';

const PortfolioPage = () => {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <section className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-bold text-3xl text-slate-900">Portfolio</h1>
          <p className="text-slate-600 text-sm">
            Open paper trades for this user.
          </p>
        </div>
        <p className="text-slate-500 text-sm">
          Sign in to create a Parlay Team.
        </p>
      </section>

      <div className="mt-4 text-slate-600 text-sm">Loading portfolio data</div>
    </main>
  );
};

export const Route = createFileRoute('/_public/portfolio')({
  beforeLoad: ({ context }) => {
    if (!context.user) {
      throw redirect({
        to: '/auth/login',
        search: {
          redirect: '/portfolio',
        },
      });
    }
  },
  component: PortfolioPage,
});
