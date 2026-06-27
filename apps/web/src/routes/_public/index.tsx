import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';

const LandingPage = () => {
  const navigate = useNavigate();

  return (
    <main className="landing-arcade relative min-h-screen overflow-hidden">
      <div className="landing-arcade__glow" />
      <div className="landing-arcade__scanlines" />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-4 py-6 sm:px-6 lg:px-8">
        <section className="w-full max-w-4xl">
          <div className="mx-auto w-full space-y-6">
            <div className="landing-panel p-6 sm:p-8">
              <p className="landing-kicker">Imported Odds. Team Parlays.</p>
              <h1 className="landing-title mt-4 max-w-2xl text-5xl leading-[0.95] text-slate-900 sm:text-7xl">
                Prediction Markets,
                <br />
                Made for Friends
              </h1>
              <p className="mt-5 mb-5 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">
                Create an account to start tracking events, building positions,
                and making parlays with your crew.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="rounded-full bg-violet-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-700"
                  onClick={() => navigate({ to: '/auth/login' })}
                >
                  Get Started
                </button>
                <Link
                  to="/dashboard"
                  className="rounded-full border border-violet-200 bg-white px-5 py-3 text-sm font-semibold text-violet-600 transition hover:bg-violet-50 hover:text-violet-700"
                >
                  Explore Dashboard
                </Link>
              </div>
              <div
                id="arcade-features"
                className="landing-feature-grid mt-8"
              >
                <article className="landing-feature-card">
                  <p className="landing-feature-title">Buy and Sell Positions</p>
                  <p className="landing-feature-body">
                    Scan Polymarket quickly with clear hierarchy, concise data,
                    and simple decisions.
                  </p>
                </article>
                <article className="landing-feature-card">
                  <p className="landing-feature-title">Shared Team Parlays</p>
                  <p className="landing-feature-body">
                    Build collaborative parlays with friends and keep every leg
                    visible in one feed.
                  </p>
                </article>
                <article className="landing-feature-card">
                  <p className="landing-feature-title">Transparent Outcomes</p>
                  <p className="landing-feature-body">
                    Track open and settled positions with straightforward status
                    states and payout visibility.
                  </p>
                </article>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-violet-100 bg-white/85 p-4 shadow-[0_12px_40px_rgba(76,29,149,0.08)] backdrop-blur">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  Live Markets
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">24/7</p>
              </div>
              <div className="rounded-2xl border border-violet-100 bg-white/85 p-4 shadow-[0_12px_40px_rgba(76,29,149,0.08)] backdrop-blur">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  Crew Parlays
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">Co-op</p>
              </div>
              <div className="rounded-2xl border border-violet-100 bg-white/85 p-4 shadow-[0_12px_40px_rgba(76,29,149,0.08)] backdrop-blur">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  Retro Score
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">Live</p>
              </div>
            </div>
            <div className="overflow-hidden rounded-3xl border border-violet-100 bg-white/90 p-5 shadow-[0_24px_80px_rgba(76,29,149,0.12)] backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="landing-kicker text-[0.72rem]">Session Feed</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Live markets and team activity update in real time.
                  </p>
                </div>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  Live
                </span>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between text-sm text-slate-500">
                    <span>Track</span>
                    <span className="font-semibold text-slate-700">Markets</span>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-slate-200">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-amber-400"
                      style={{ width: '25%' }}
                    />
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between text-sm text-slate-500">
                    <span>Make</span>
                    <span className="font-semibold text-slate-700">
                      Predictions
                    </span>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-slate-200">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-amber-400"
                      style={{ width: '75%' }}
                    />
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between text-sm text-slate-500">
                    <span>Play</span>
                    <span className="font-semibold text-slate-700">Together</span>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-slate-200">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-amber-400"
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
};

export const Route = createFileRoute('/_public/')({
  component: LandingPage,
  head: () => ({
    meta: [
      { title: 'Parlayrace' },
      {
        name: 'description',
        content: 'Prediction Markets, Made for Friends',
      },
    ],
  }),
});
