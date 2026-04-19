/**
 * Discrete **stake units** instead of "% bankroll".
 *
 * Interpretation: **1u** = one standard bet in your own bankroll terms (e.g. if you always risk
 * €50 per unit, 1.5u = €75). This module only outputs the **relative** size; you map 1u → money
 * outside the app.
 *
 * Model:
 * - **Rating (1–5)** from `checkValue` already encodes minimum edge + confidence gates.
 * - **EV** = expected profit per 1 unit staked at the offered decimal odds:
 *   `EV = p·O − 1` (same sign as Kelly numerator at stake 1).
 * - Base tier from rating, then small EV-based nudge so thin +EV doesn’t get full size.
 */

export function expectedValuePerUnitStake(
  modelProb: number,
  decimalOdds: number,
): number {
  return modelProb * decimalOdds - 1;
}

const RATING_BASE_UNITS: Record<number, number> = {
  1: 0.5,
  2: 0.75,
  3: 1,
  4: 1.5,
  5: 2,
};

/**
 * Returns stake size in **units** (quarter-unit grid, clamped to [0.25, 2.5]).
 */
export function computeStakeUnits(params: {
  rating: number;
  modelProb: number;
  bestOdds: number;
}): number {
  const r = Math.min(5, Math.max(1, Math.floor(params.rating)));
  let u = RATING_BASE_UNITS[r] ?? 1;

  const ev = expectedValuePerUnitStake(params.modelProb, params.bestOdds);

  if (ev < 0.035) u -= 0.25;
  else if (ev >= 0.09) u += 0.25;

  u = Math.min(2.5, Math.max(0.25, u));
  return Math.round(u * 4) / 4;
}

export function formatStakeUnits(u: number): string {
  const x = Math.round(u * 100) / 100;
  const s = Number.isInteger(x) ? String(x) : x.toFixed(2);
  return `${s}u`;
}

/** Kelly was historically rounded so aggressively that `quarterKelly` became 0 despite real edge. */
const LEGACY_KELLY_ZERO_EPS = 1e-5;

type PickStakeLike = {
  stakeUnits: number | null;
  rating: number;
  modelProb: number;
  bestOdds: number;
};

/**
 * One consistent stake in **units** everywhere: stored `stakeUnits`, else rating+EV model.
 */
export function canonicalStakeUnits(p: PickStakeLike): number {
  if (p.stakeUnits != null) return p.stakeUnits;
  return computeStakeUnits({
    rating: p.rating,
    modelProb: p.modelProb,
    bestOdds: p.bestOdds,
  });
}

type PickProfitLike = PickStakeLike & {
  quarterKelly: number;
  profitLoss: number | null;
  outcome: string | null;
};

/**
 * Net P/L in **units**, always tied to {@link canonicalStakeUnits} and the graded outcome.
 *
 * We do **not** rescale legacy `profitLoss / quarterKelly` — that ratio explodes when Kelly was
 * rounded tiny vs stored P/L (bogus −18u on a −0.75u stake). For win/loss/void/push, P/L follows
 * the same math as settlement: win → U·(O−1), loss → −U, void/push → 0.
 */
export function canonicalProfitLossUnits(p: PickProfitLike): number {
  const U = canonicalStakeUnits(p);

  if (p.outcome === "win") {
    return U * (p.bestOdds - 1);
  }
  if (p.outcome === "loss") {
    return -U;
  }
  if (p.outcome === "void" || p.outcome === "push") {
    return 0;
  }

  return p.profitLoss ?? 0;
}

/** Same number as display / aggregates — use for green vs red styling. */
export function pickProfitLossNumericForUi(p: PickProfitLike): number {
  return canonicalProfitLossUnits(p);
}

/** Settlement & ROI: stake in units (ignores legacy Kelly sizing). */
export function resolveStakeForSettlement(p: PickStakeLike): number {
  return canonicalStakeUnits(p);
}

/** Aggregate net P/L per pick in units (matches UI). */
export function resolveProfitLossForAggregate(p: PickProfitLike): number {
  return canonicalProfitLossUnits(p);
}

function recoveryStakeMarker(p: PickStakeLike & { quarterKelly: number }): boolean {
  return (
    p.stakeUnits == null && Math.abs(p.quarterKelly) < LEGACY_KELLY_ZERO_EPS
  );
}

/** Stake column: always `…u`; trailing `*` = inferred because legacy quarter-Kelly was stored as 0. */
export function formatPickStakeDisplay(p: {
  stakeUnits: number | null;
  quarterKelly: number;
  rating: number;
  modelProb: number;
  bestOdds: number;
}): string {
  const u = canonicalStakeUnits(p);
  return formatStakeUnits(u) + (recoveryStakeMarker(p) ? " *" : "");
}

/** P/L column: always `…u` from stake + outcome (same as settlement). */
export function formatPickProfitLossDisplay(p: {
  stakeUnits: number | null;
  profitLoss: number | null;
  quarterKelly: number;
  rating: number;
  modelProb: number;
  bestOdds: number;
  outcome?: string | null;
}): string {
  const oc = p.outcome;
  if (
    p.profitLoss == null &&
    oc !== "win" &&
    oc !== "loss" &&
    oc !== "void" &&
    oc !== "push"
  ) {
    return "—";
  }
  const pl = canonicalProfitLossUnits(p as PickProfitLike);
  const sign = pl >= 0 ? "+" : "";
  return `${sign}${pl.toFixed(2)}u`;
}
