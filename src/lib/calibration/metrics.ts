/**
 * Headline calibration metrics: per-outcome 1X2 (binary) + O/U + BTTS.
 * Multinomial Brier helpers below are optional for offline analysis.
 */
export const HEADLINE_CALIBRATION_MARKETS = new Set([
  "1x2_home",
  "1x2_draw",
  "1x2_away",
  "over25",
  "btts_yes",
]);

export function isHeadlineCalibrationMarket(market: string): boolean {
  return HEADLINE_CALIBRATION_MARKETS.has(market);
}

/** Multinomial Brier for 3-way 1X2: sum_k (p_k - y_k)^2 */
export function brierScore1x2Multinomial(
  p: { home: number; draw: number; away: number },
  outcome: "home" | "draw" | "away",
): number {
  const y = { home: 0, draw: 0, away: 0 };
  y[outcome] = 1;
  return (
    (p.home - y.home) ** 2 + (p.draw - y.draw) ** 2 + (p.away - y.away) ** 2
  );
}

export function outcome1x2FromScore(
  hs: number,
  as: number,
): "home" | "draw" | "away" {
  if (hs > as) return "home";
  if (as > hs) return "away";
  return "draw";
}

export function logLoss1x2Multinomial(
  p: { home: number; draw: number; away: number },
  outcome: "home" | "draw" | "away",
): number {
  const pc = Math.max(1e-9, outcome === "home" ? p.home : outcome === "draw" ? p.draw : p.away);
  return -Math.log(pc);
}
