/** Map internal competition codes to The Odds API `sport_key` values. */
export const COMPETITION_TO_ODDS_SPORT_KEY: Record<string, string> = {
  PL: "soccer_epl",
  PD: "soccer_spain_la_liga",
  BL1: "soccer_germany_bundesliga",
  SA: "soccer_italy_serie_a",
  FL1: "soccer_france_ligue_one",
  CL: "soccer_uefa_champs_league",
  EC: "soccer_uefa_europa_league",
  CLI: "soccer_conmebol_copa_libertadores",
};

export function oddsSportKeyForCompetition(competitionId: string): string | null {
  return COMPETITION_TO_ODDS_SPORT_KEY[competitionId] ?? null;
}
