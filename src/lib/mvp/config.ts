export const MVP_SUPPORTED_COMPETITION_CODES = ["PL", "PD", "BL1", "SA", "FL1"] as const;

export const MVP_PRODUCTION_VALUE_MARKETS = [
  "1x2_home",
  "1x2_draw",
  "1x2_away",
] as const;

export const MVP_EXPERIMENTAL_VALUE_MARKETS = ["over25", "under25"] as const;

export type MvpProductionValueMarket = (typeof MVP_PRODUCTION_VALUE_MARKETS)[number];
export type MvpExperimentalValueMarket = (typeof MVP_EXPERIMENTAL_VALUE_MARKETS)[number];

export function isMvpSupportedCompetitionCode(code: string): boolean {
  return MVP_SUPPORTED_COMPETITION_CODES.includes(
    code as (typeof MVP_SUPPORTED_COMPETITION_CODES)[number],
  );
}

export function isMvpProductionValueMarket(market: string): boolean {
  return MVP_PRODUCTION_VALUE_MARKETS.includes(
    market as (typeof MVP_PRODUCTION_VALUE_MARKETS)[number],
  );
}
