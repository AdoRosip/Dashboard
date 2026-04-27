export const ENGINE_MODEL_VERSION = "v3.0-weighted-dc-poisson";

export const ENGINE_LEAGUE_AVG_XG = 1.35;

export const ENGINE_V3_CONFIG = {
  leagueAvgXg: ENGINE_LEAGUE_AVG_XG,
  rateWeights: {
    recentOverall: 0.45,
    recentVenue: 0.2,
    season: 0.25,
    leaguePrior: 0.1,
  },
  modifierCaps: {
    squad: { min: 0.75, max: 1.03 },
    form: { min: 0.93, max: 1.07 },
    h2h: { min: 0.96, max: 1.04 },
    fatigue: { min: 0.88, max: 1.0 },
    motivation: { min: 0.96, max: 1.04 },
    context: { min: 0.9, max: 1.1 },
    regression: { min: 0.92, max: 1.08 },
  },
  impacts: {
    formSlope: 0.25,
    h2h: 0.12,
  },
  h2hBaselines: {
    homeWinRate: 0.45,
    awayWinRate: 0.28,
    fullSample: 10,
  },
  lambdaCaps: {
    min: 0.3,
    max: 4.2,
  },
} as const;

export type EngineV3Config = typeof ENGINE_V3_CONFIG;
