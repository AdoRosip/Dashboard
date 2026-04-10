/** Pairs of team IDs (football-data.org) with derby vs rivalry label. */
export const RIVALRIES: Array<[number, number, "derby" | "rivalry"]> = [
  [57, 73, "derby"],
  [64, 66, "rivalry"],
  [65, 66, "derby"],
  [61, 73, "rivalry"],
  [86, 81, "rivalry"],
  [86, 78, "derby"],
];

export function isDerbyOrRivalry(
  teamA: number,
  teamB: number,
): { isDerby: boolean; isRivalry: boolean } {
  const match = RIVALRIES.find(
    ([a, b]) => (a === teamA && b === teamB) || (a === teamB && b === teamA),
  );
  return {
    isDerby: match?.[2] === "derby",
    isRivalry: !!match,
  };
}
