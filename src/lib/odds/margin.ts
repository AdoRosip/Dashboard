/**
 * Multiplicative margin removal — returns fair probabilities summing to 1.
 */
export function removeMargin(odds: number[]): number[] {
  const implied = odds.map((o) => 1 / o);
  const total = implied.reduce((a, b) => a + b, 0);
  if (total <= 0) return implied.map(() => 0);
  return implied.map((p) => p / total);
}
