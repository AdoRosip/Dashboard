export const COMPETITIONS = [
  { code: "PL", id: "PL", name: "Premier League", country: "England", isEuropean: false },
  { code: "PD", id: "PD", name: "La Liga", country: "Spain", isEuropean: false },
  { code: "BL1", id: "BL1", name: "Bundesliga", country: "Germany", isEuropean: false },
  { code: "SA", id: "SA", name: "Serie A", country: "Italy", isEuropean: false },
  { code: "FL1", id: "FL1", name: "Ligue 1", country: "France", isEuropean: false },
  { code: "CL", id: "CL", name: "UEFA Champions League", country: "Europe", isEuropean: true },
  /** Internal id `EC` — football-data.org sends competition code **EL** for UEFA Europa League. */
  { code: "EC", id: "EC", name: "UEFA Europa League", country: "Europe", isEuropean: true },
  /** Internal id `CLI` — football-data.org sends **UCL** for UEFA Conference League (not Champions League). */
  { code: "CLI", id: "CLI", name: "UEFA Conference League", country: "Europe", isEuropean: true },
] as const;

export const COMPETITION_CODES = COMPETITIONS.map((c) => c.code);

export const UNDERSTAT_LEAGUE_MAP: Record<string, string> = {
  PL: "EPL",
  PD: "La_liga",
  BL1: "Bundesliga",
  SA: "Serie_A",
  FL1: "Ligue_1",
};

export const CURRENT_SEASON = "2025";

/** Default lookahead for upcoming fixtures, odds, V2 pipeline, and value picks (day-to-day). */
export const DEFAULT_UPCOMING_DAYS = 2;

/** Hard cap (~48h): do not fetch model/odds/value picks beyond this window. */
export const MAX_UPCOMING_DAYS = 2;

export const FOOTBALL_DATA_BASE = "https://api.football-data.org/v4";
export const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";
export const UNDERSTAT_BASE = "https://understat.com";

export const HOME_ADVANTAGE_BY_LEAGUE: Record<string, number> = {
  PL: 0.42,
  PD: 0.47,
  BL1: 0.45,
  SA: 0.44,
  FL1: 0.43,
  CL: 0.40,
  EC: 0.40,
  CLI: 0.40,
};
