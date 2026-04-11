/**
 * League-specific Poisson / Dixon–Coles defaults (literature-style baselines).
 * Replace with MLE on historical scorelines per competition when data pipeline allows.
 */

/** Dixon–Coles ρ baseline by competition (negative → more 0–0 / 1–1 mass). */
export const DIXON_COLES_RHO_BASE: Record<string, number> = {
  PL: -0.055,
  PD: -0.048,
  BL1: -0.052,
  SA: -0.05,
  FL1: -0.05,
  CL: -0.058,
  EC: -0.058,
  CLI: -0.058,
};

export const DEFAULT_DIXON_COLES_RHO = -0.05;

export function dixonColesRhoBase(competitionId: string): number {
  return DIXON_COLES_RHO_BASE[competitionId] ?? DEFAULT_DIXON_COLES_RHO;
}

/**
 * Share of expected goals in first half (empirical ~0.41–0.44 by league).
 */
export const HT_GOAL_SHARE_BY_LEAGUE: Record<string, number> = {
  PL: 0.425,
  PD: 0.432,
  BL1: 0.418,
  SA: 0.428,
  FL1: 0.42,
  CL: 0.44,
  EC: 0.44,
  CLI: 0.44,
};

export const DEFAULT_HT_GOAL_SHARE = 0.42;

export function htGoalShare(competitionId: string): number {
  return HT_GOAL_SHARE_BY_LEAGUE[competitionId] ?? DEFAULT_HT_GOAL_SHARE;
}
