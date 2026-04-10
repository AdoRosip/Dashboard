export interface RotationInput {
  playerAge: number;
  minutesLast7Days: number;
  minutesLast14Days: number;
  matchesLast7Days: number;
  startedLastMatch: boolean;
  playedFull90LastMatch: boolean;
  lastMatchWasEuropeanAway: boolean;
  daysUntilThisMatch: number;
  daysUntilNextMatch: number | null;
  nextMatchImportance: string | null;
  thisMatchImportance: string;
  isKeyPlayer: boolean;
  teamLeaguePosition: number;
  competitionStage: string;
  /** When set, enables end-of-season mid-table wind-down rule */
  seasonMatchday?: number;
  /** Relegated or title won — nothing at stake */
  deadRubber?: boolean;
}

export function computeStartingProbability(input: RotationInput): number {
  let p = 0.75;

  if (input.minutesLast7Days > 180 && input.daysUntilThisMatch <= 3) p *= 0.7;
  if (input.minutesLast7Days > 270) p *= 0.5;
  if (input.playedFull90LastMatch && input.daysUntilThisMatch <= 2) p *= 0.6;
  if (input.lastMatchWasEuropeanAway && input.daysUntilThisMatch <= 3) p *= 0.65;
  if (input.playerAge > 32 && input.minutesLast14Days > 450) p *= 0.8;
  if (input.playerAge > 35 && input.minutesLast14Days > 360) p *= 0.7;

  if (input.nextMatchImportance === "knockout_european" && input.thisMatchImportance === "mid_table") {
    p *= 0.55;
  }
  if (input.nextMatchImportance === "european_group" && input.thisMatchImportance === "mid_table") {
    p *= 0.92;
  }
  if (input.nextMatchImportance === "knockout_european" && input.thisMatchImportance === "title_race") {
    p *= 0.85;
  }
  if (
    input.teamLeaguePosition >= 8 &&
    input.teamLeaguePosition <= 14 &&
    (input.seasonMatchday ?? 0) > 32
  ) {
    p *= 0.85;
  }
  if (input.deadRubber) p *= 0.4;

  if (input.isKeyPlayer) {
    const heavyLoadOrShortRest =
      (input.minutesLast7Days > 180 && input.daysUntilThisMatch <= 3) ||
      input.minutesLast7Days > 270 ||
      (input.playedFull90LastMatch && input.daysUntilThisMatch <= 2);
    const strategicRotationRisk =
      (input.lastMatchWasEuropeanAway && input.daysUntilThisMatch <= 3) ||
      input.deadRubber ||
      (input.nextMatchImportance === "knockout_european" &&
        input.thisMatchImportance === "mid_table") ||
      (input.nextMatchImportance === "european_group" &&
        input.thisMatchImportance === "mid_table");
    if (!heavyLoadOrShortRest && !strategicRotationRisk) {
      p = Math.max(p, 0.65);
    }
  }

  return Math.max(0.05, Math.min(0.95, p));
}

/**
 * Probabilistic squad strength vs team xG per game.
 */
export function computeSquadStrengthModifier(
  rows: Array<{
    xgPer90: number;
    avgMinutesPerGame: number;
    probStarting: number;
  }>,
  teamXgPerGame: number,
): number {
  let expectedMissingXg = 0;
  for (const r of rows) {
    const scale = Math.min(1, Math.max(0, r.avgMinutesPerGame / 90));
    expectedMissingXg += r.xgPer90 * scale * (1 - r.probStarting);
  }
  const denom = Math.max(teamXgPerGame, 0.01);
  return Math.max(0.5, Math.min(1.05, 1 - expectedMissingXg / denom));
}
