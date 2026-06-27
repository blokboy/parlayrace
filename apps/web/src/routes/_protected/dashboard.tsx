import { createFileRoute } from '@tanstack/react-router';

type MarketCard = {
  matchup: string;
  kickoff: string;
  home: { name: string; logo: string; color: string | null };
  away: { name: string; logo: string; color: string | null };
};

type TeamButtonPalette = {
  background: string;
  color: string;
  border: string;
};

type PolymarketTeam = {
  name: string;
  logo: string;
  color: string | null;
  ordering: string | null;
};

type PolymarketEvent = {
  id: string | number;
  title: string;
  startDate: string;
  teams: PolymarketTeam[] | null;
};

const normalizeHexColor = (input: string | null | undefined): string | null => {
  if (!input) {
    return null;
  }

  const value = input.trim();
  if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(value)) {
    return value;
  }

  return null;
};

const getTextColorForBackground = (backgroundHex: string): string => {
  const hex = backgroundHex.replace('#', '');
  const isShort = hex.length === 3;
  const expanded = isShort
    ? `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
    : hex;

  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  return luminance > 0.65 ? '#111827' : '#ffffff';
};

const darkenHexColor = (hexColor: string, factor: number): string => {
  const hex = hexColor.replace('#', '');
  const isShort = hex.length === 3;
  const expanded = isShort
    ? `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
    : hex;

  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);

  const darkenedRed = Math.max(0, Math.floor(red * (1 - factor)));
  const darkenedGreen = Math.max(0, Math.floor(green * (1 - factor)));
  const darkenedBlue = Math.max(0, Math.floor(blue * (1 - factor)));

  const toHex = (value: number) => value.toString(16).padStart(2, '0');
  return `#${toHex(darkenedRed)}${toHex(darkenedGreen)}${toHex(darkenedBlue)}`;
};

const getTeamButtonPalette = (team: {
  color: string | null;
}): TeamButtonPalette => {
  const normalizedColor = normalizeHexColor(team.color);

  if (!normalizedColor) {
    return {
      background: '#ffffff',
      color: '#4c1d95',
      border: '#c4b5fd',
    };
  }

  return {
    background: normalizedColor,
    color: getTextColorForBackground(normalizedColor),
    border: darkenHexColor(normalizedColor, 0.18),
  };
};

const formatKickoff = (isoDate: string): string => {
  const value = new Date(isoDate);
  if (Number.isNaN(value.getTime())) {
    return 'TBD';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(value);
};

const toMarketCard = (event: PolymarketEvent): MarketCard | null => {
  if (!event.teams || event.teams.length < 2) {
    return null;
  }

  const home =
    event.teams.find((team) => team.ordering === 'home') ?? event.teams[0];
  const away =
    event.teams.find((team) => team.ordering === 'away') ??
    event.teams.find((team) => team.name !== home.name) ??
    event.teams[1];

  if (!home || !away) {
    return null;
  }

  return {
    matchup: `${home.name} vs ${away.name}`,
    kickoff: formatKickoff(event.startDate),
    home: {
      name: home.name,
      logo: home.logo,
      color: home.color,
    },
    away: {
      name: away.name,
      logo: away.logo,
      color: away.color,
    },
  };
};

const FlagButton = ({
  team,
  draw = false,
}: {
  team: { name: string; logo: string; color: string | null };
  draw?: boolean;
}) => {
  if (draw) {
    return (
      <button
        type="button"
        className="!bg-white hover:!bg-white w-full rounded-lg border border-violet-200 px-3 py-2 font-semibold text-sm text-violet-900 transition hover:border-violet-400 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Draw
      </button>
    );
  }

  const palette = getTeamButtonPalette(team);

  return (
    <button
      type="button"
      className="w-full rounded-lg border px-3 py-2 font-semibold text-sm transition disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        backgroundColor: palette.background,
        color: palette.color,
        borderColor: palette.border,
      }}
    >
      <span className="inline-flex items-center justify-center gap-2">
        <img
          src={team.logo}
          alt={`${team.name} flag`}
          className="h-4 w-6 rounded-[2px] object-cover"
        />
        <span>{team.name}</span>
      </span>
    </button>
  );
};

const DashboardPage = () => {
  const { marketCards } = Route.useLoaderData();

  return (
    <main className="dashboard-arcade landing-arcade relative min-h-screen overflow-hidden">
      <div className="landing-arcade__glow" />
      <div className="landing-arcade__scanlines" />
      <div className="dashboard-arcade__content relative z-10 mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="font-bold text-3xl text-gray-900">Markets</h1>
        </div>

        {marketCards.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {marketCards.map((card) => (
              <div
                key={card.matchup}
                className="landing-panel p-6 transition-shadow hover:shadow-lg"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-lg text-violet-950">
                    {card.matchup}
                  </h3>
                  <span className="inline-block rounded-full bg-green-100 px-3 py-1 font-medium text-green-800 text-xs">
                    OPEN
                  </span>
                </div>

                <div className="mb-4 flex items-center gap-2 text-violet-800/80 text-xs">
                  {card.kickoff}
                </div>

                <div className="flex flex-col gap-2">
                  <FlagButton team={card.home} />
                  <FlagButton
                    team={card.home}
                    draw={true}
                  />
                  <FlagButton team={card.away} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="landing-panel p-6 text-sm text-violet-900">
            No active soccer team markets are currently available from
            Polymarket.
          </div>
        )}
      </div>
    </main>
  );
};

export const Route = createFileRoute('/_protected/dashboard')({
  loader: async () => {
    try {
      const response = await fetch(
        'https://gamma-api.polymarket.com/events?limit=100&active=true&closed=false&tag_slug=soccer'
      );

      if (!response.ok) {
        return { marketCards: [] as MarketCard[] };
      }

      const events = (await response.json()) as PolymarketEvent[];
      const marketCards = events
        .map(toMarketCard)
        .filter((card): card is MarketCard => card !== null)
        .slice(0, 6);

      return { marketCards };
    } catch {
      return { marketCards: [] as MarketCard[] };
    }
  },
  component: DashboardPage,
});
