/**
 * Feature Engineering Pipeline
 *
 * Computes all features from spec Part 2 for a given fixture.
 * Each feature group returns a flat object merged into the final vector.
 */

import type { TeamSeasonStats, TeamMatchStats, TeamSituationalStats } from "@prisma/client";

// ─── TYPES ───────────────────────────────────────────────────────

export interface TeamFeatures {
  // 2.1 Attacking
  attackRatingOverall: number;
  attackRatingVenue: number;  // home for home team, away for away team
  attackRatingCompetition: number;
  shotVolume: number;
  shotQuality: number;
  conversionRate: number;
  setPieceThreat: number;
  counterAttackThreat: number;
  firstHalfGoalsPct: number;
  secondHalfGoalsPct: number;
  scoringConsistency: number;

  // 2.2 Defensive
  defenseRatingOverall: number;
  defenseRatingVenue: number;
  defenseRatingCompetition: number;
  ppda: number;
  cleanSheetRate: number;
  setPieceVulnerability: number;

  // 2.3 Form & Momentum
  formPointsLast5: number;
  formXgTrend: number;
  formXgAgainstTrend: number;
  xgOverperformance: number;

  // 2.4 H2H
  h2hWinRate: number;
  h2hAvgGoals: number;
  h2hBttsRate: number;

  // 2.5 Squad Availability
  missingPlayersXgShare: number;
  missingPlayersXaShare: number;
  keyPlayerAbsence: boolean;
  penaltyTakerAvailable: boolean;

  // 2.6 Contextual
  daysSinceLastMatch: number;
  isAfterEuropean: boolean;
  leaguePosition: number;
  motivationFactor: string;

  // Derived
  attackDefenseRatio: number;
}

export interface MatchFeatureVector {
  home: TeamFeatures;
  away: TeamFeatures;
  h2hFeatures: H2HFeatures;
  contextFeatures: ContextFeatures;
  tacticalFeatures: TacticalFeatures;
}

export interface H2HFeatures {
  totalMeetings: number;
  homeWinRate: number;
  awayWinRate: number;
  drawRate: number;
  avgTotalGoals: number;
  bttsRate: number;
  over25Rate: number;
  recentTrend: string;
}

export interface ContextFeatures {
  isDerby: boolean;
  leaguePositionGap: number;
  homeAdvantage: number;
  matchImportance: string;
}

export interface TacticalFeatures {
  styleClash: string;
  pressingMismatch: number;
}

// ─── EXPONENTIAL DECAY WEIGHTING ─────────────────────────────────

function exponentialDecayWeights(n: number, halfLife: number = 5): number[] {
  const decay = Math.log(2) / halfLife;
  const weights = [];
  for (let i = 0; i < n; i++) {
    weights.push(Math.exp(-decay * i));
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / sum);
}

export function weightedAvg(values: number[], halfLife: number = 5): number {
  if (values.length === 0) return 0;
  const weights = exponentialDecayWeights(values.length, halfLife);
  return values.reduce((sum, v, i) => sum + v * weights[i], 0);
}

function linearSlope(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// ─── FEATURE COMPUTATION ─────────────────────────────────────────

export function computeAttackingFeatures(
  matchStats: TeamMatchStats[],
  seasonStats: TeamSeasonStats | null,
  isHome: boolean,
): Partial<TeamFeatures> {
  const recent = matchStats.slice(0, 10);
  const venueMatches = recent.filter((m) => m.isHome === isHome);

  const xgValues = recent.map((m) => m.xg);
  const goalValues = recent.map((m) => m.goalsScored);
  const venueXg = venueMatches.map((m) => m.xg);

  const totalShots = recent.reduce((s, m) => s + m.shots, 0);
  const totalXg = recent.reduce((s, m) => s + m.xg, 0);
  const totalGoals = recent.reduce((s, m) => s + m.goalsScored, 0);
  const totalSetPieceXg = recent.reduce((s, m) => s + m.xgSetPiece, 0);
  const totalCounterXg = recent.reduce((s, m) => s + m.xgCounter, 0);
  const totalFirstHalfGoals = recent.reduce((s, m) => s + m.goalsFirstHalf, 0);

  const gamesPlayed = recent.length || 1;

  return {
    attackRatingOverall: weightedAvg(xgValues),
    attackRatingVenue: venueXg.length > 0 ? weightedAvg(venueXg) : weightedAvg(xgValues),
    attackRatingCompetition: seasonStats
      ? seasonStats.xgFor / Math.max(seasonStats.matchesPlayed, 1)
      : weightedAvg(xgValues),
    shotVolume: totalShots / gamesPlayed,
    shotQuality: totalShots > 0 ? totalXg / totalShots : 0,
    conversionRate: totalXg > 0 ? totalGoals / totalXg : 1,
    setPieceThreat: totalXg > 0 ? totalSetPieceXg / totalXg : 0,
    counterAttackThreat: totalXg > 0 ? totalCounterXg / totalXg : 0,
    firstHalfGoalsPct: totalGoals > 0 ? totalFirstHalfGoals / totalGoals : 0.42,
    secondHalfGoalsPct: totalGoals > 0 ? 1 - totalFirstHalfGoals / totalGoals : 0.58,
    scoringConsistency: stdDev(goalValues),
  };
}

export function computeDefensiveFeatures(
  matchStats: TeamMatchStats[],
  seasonStats: TeamSeasonStats | null,
  isHome: boolean,
): Partial<TeamFeatures> {
  const recent = matchStats.slice(0, 10);
  const venueMatches = recent.filter((m) => m.isHome === isHome);

  const xgaValues = recent.map((m) => m.xgAgainst);
  const venueXga = venueMatches.map((m) => m.xgAgainst);
  const ppdaValues = recent.filter((m) => m.ppda != null).map((m) => m.ppda!);
  const csCount = recent.filter((m) => m.goalsConceded === 0).length;
  return {
    defenseRatingOverall: weightedAvg(xgaValues),
    defenseRatingVenue: venueXga.length > 0 ? weightedAvg(venueXga) : weightedAvg(xgaValues),
    defenseRatingCompetition: seasonStats
      ? seasonStats.xgAgainst / Math.max(seasonStats.matchesPlayed, 1)
      : weightedAvg(xgaValues),
    ppda: ppdaValues.length > 0 ? ppdaValues.reduce((a, b) => a + b, 0) / ppdaValues.length : 10,
    cleanSheetRate: recent.length > 0 ? csCount / recent.length : 0,
    // Schema lacks defensive set-piece xGA; xgFromSetPieces is attacking-side only.
    setPieceVulnerability: 0,
  };
}

export function computeFormFeatures(
  matchStats: TeamMatchStats[],
  seasonStats: TeamSeasonStats | null,
): Partial<TeamFeatures> {
  const last6 = matchStats.slice(0, 6);
  const last5 = matchStats.slice(0, 5);

  // Form points from results
  let formPoints = 0;
  for (const m of last5) {
    if (m.goalsScored > m.goalsConceded) formPoints += 3;
    else if (m.goalsScored === m.goalsConceded) formPoints += 1;
  }

  const xgValues = last6.map((m) => m.xg);
  const xgaValues = last6.map((m) => m.xgAgainst);
  const goalValues = last6.map((m) => m.goalsScored);

  const totalXg = xgValues.reduce((a, b) => a + b, 0);
  const totalGoals = goalValues.reduce((a, b) => a + b, 0);

  return {
    formPointsLast5: formPoints,
    formXgTrend: linearSlope(xgValues.reverse()),
    formXgAgainstTrend: linearSlope(xgaValues.reverse()),
    xgOverperformance: last6.length > 0 ? (totalGoals - totalXg) / last6.length : 0,
  };
}

export function computeH2HFeatures(
  h2hMatches: Array<{ scoreA: number; scoreB: number; xgA?: number | null; xgB?: number | null }>,
  teamAId: number,
  homeTeamId: number,
): H2HFeatures {
  const n = h2hMatches.length;
  if (n === 0) {
    return {
      totalMeetings: 0,
      homeWinRate: 0.45,
      awayWinRate: 0.28,
      drawRate: 0.27,
      avgTotalGoals: 2.5,
      bttsRate: 0.5,
      over25Rate: 0.5,
      recentTrend: "neutral",
    };
  }

  let homeWins = 0, awayWins = 0, draws = 0, totalGoals = 0, btts = 0, over25 = 0;

  for (const m of h2hMatches) {
    const homeScore = teamAId === homeTeamId ? m.scoreA : m.scoreB;
    const awayScore = teamAId === homeTeamId ? m.scoreB : m.scoreA;
    totalGoals += homeScore + awayScore;
    if (homeScore > awayScore) homeWins++;
    else if (homeScore < awayScore) awayWins++;
    else draws++;
    if (homeScore > 0 && awayScore > 0) btts++;
    if (homeScore + awayScore > 2) over25++;
  }

  const last3 = h2hMatches.slice(0, 3);
  let last3HomeWins = 0;
  for (const m of last3) {
    const hs = teamAId === homeTeamId ? m.scoreA : m.scoreB;
    const as_ = teamAId === homeTeamId ? m.scoreB : m.scoreA;
    if (hs > as_) last3HomeWins++;
  }

  return {
    totalMeetings: n,
    homeWinRate: homeWins / n,
    awayWinRate: awayWins / n,
    drawRate: draws / n,
    avgTotalGoals: totalGoals / n,
    bttsRate: btts / n,
    over25Rate: over25 / n,
    recentTrend: last3HomeWins >= 2 ? "home_dominant" : last3HomeWins === 0 ? "away_dominant" : "balanced",
  };
}

export function computeSquadFeatures(
  players: Array<{
    isKeyPlayer: boolean;
    seasonAgg: Array<{ xgPer90: number; xaPer90: number; isPenaltyTaker: boolean; minutes: number; matches: number }>;
    injuries: Array<{ status: string }>;
  }>,
  teamTotalXg: number,
): Partial<TeamFeatures> {
  let missingXg = 0, missingXa = 0;
  let keyAbsent = false;
  let penaltyTakerFit = true;

  for (const p of players) {
    const injured = p.injuries.some((i) => i.status === "out" || i.status === "doubt");
    if (!injured) continue;

    const agg = p.seasonAgg[0];
    if (agg) {
      // Scale per-90 rate by actual minutes-per-game to get per-game contribution.
      // A sub averaging 45 min/game with 0.5 xgPer90 contributes ~0.25 xG/game, not 0.5.
      const minsPerGame = agg.matches > 0 ? agg.minutes / agg.matches : 90;
      const scaleFactor = minsPerGame / 90;
      missingXg += agg.xgPer90 * scaleFactor;
      missingXa += agg.xaPer90 * scaleFactor;
      if (agg.isPenaltyTaker) penaltyTakerFit = false;
    }
    if (p.isKeyPlayer) keyAbsent = true;
  }

  const totalXg90 = teamTotalXg > 0 ? teamTotalXg : 1;

  return {
    missingPlayersXgShare: missingXg / totalXg90,
    missingPlayersXaShare: missingXa / totalXg90,
    keyPlayerAbsence: keyAbsent,
    penaltyTakerAvailable: penaltyTakerFit,
  };
}

export function computeContextFeatures(
  homeStats: TeamSeasonStats | null,
  awayStats: TeamSeasonStats | null,
  lastMatchDate: Date | null,
  isAfterEuropean: boolean,
): ContextFeatures & Partial<TeamFeatures> {
  const homePos = homeStats?.position ?? 10;
  const awayPos = awayStats?.position ?? 10;
  const gap = Math.abs(homePos - awayPos);

  let motivation = "neutral";
  if (homePos <= 4 || awayPos <= 4) motivation = "high_positive";
  else if (homePos >= 17 || awayPos >= 17) motivation = "high_negative";

  const daysSince = lastMatchDate
    ? (Date.now() - lastMatchDate.getTime()) / (1000 * 60 * 60 * 24)
    : 7;

  return {
    isDerby: false,
    leaguePositionGap: gap,
    homeAdvantage: 0,
    matchImportance: motivation,
    daysSinceLastMatch: daysSince,
    isAfterEuropean,
    leaguePosition: homePos,
    motivationFactor: motivation,
  };
}

export function classifyTacticalMatchup(
  homePpda: number,
  awayPpda: number,
): TacticalFeatures {
  const highPress = 8;
  const deepBlock = 12;

  let style = "mixed";
  if (homePpda < highPress && awayPpda < highPress) style = "press_vs_press";
  else if (homePpda < highPress && awayPpda > deepBlock) style = "press_vs_deep_block";
  else if (homePpda > deepBlock && awayPpda < highPress) style = "deep_block_vs_press";
  else if (homePpda > deepBlock && awayPpda > deepBlock) style = "deep_block_vs_deep_block";
  else if (homePpda < highPress) style = "possession_vs_counter";

  return {
    styleClash: style,
    pressingMismatch: Math.abs(homePpda - awayPpda),
  };
}

// ─── REGRESSION TO MEAN SAFEGUARDS ──────────────────────────────

export function applyRegressionToMean(
  attackRating: number,
  xgOverperformance: number,
  matchday: number,
  leagueAvg: number = 1.35,
): number {
  let adjusted = attackRating;

  // Teams overperforming xG will regress
  if (xgOverperformance > 0.3) {
    adjusted *= 0.85 + 0.15 * Math.exp(-xgOverperformance);
  } else if (xgOverperformance < -0.3) {
    adjusted *= 1.10 - 0.10 * Math.exp(xgOverperformance);
  }

  // Early-season shrinkage toward league average
  if (matchday < 6) {
    const currentWeight = matchday / 10;
    adjusted = currentWeight * adjusted + (1 - currentWeight) * leagueAvg;
  }

  return Math.max(0.2, adjusted);
}

// ─── LAMBDA COMPUTATION ──────────────────────────────────────────

/**
 * All modifiers should already be multiplicative factors close to 1.0
 * when passed in. The caller (engine.ts) is responsible for computing
 * each modifier from raw features before calling computeLambda.
 */
export interface LambdaInputs {
  /** Team's xG-per-game attacking rate */
  attackRating: number;
  /** Opponent's xGA-per-game rate */
  opponentDefenseRating: number;
  /** Whether this team is the home side */
  isHome: boolean;
  /** Additive home-advantage in goals (typically 0.2–0.3) */
  homeAdvantageGoals: number;
  /** ~0.85 if missing 15% of xG production, 1.0 if fully fit */
  injuryModifier: number;
  /** ~1.05 if trending up, ~0.95 if trending down */
  formModifier: number;
  /** ~1.02 based on head-to-head record */
  h2hModifier: number;
  /** ~0.95 if short rest / European midweek, 1.0 otherwise */
  fatigueModifier: number;
  /** ~0.95 if overperforming xG, ~1.05 if underperforming (clamped [0.75,1.25]) */
  regressionModifier: number;
}

const LEAGUE_AVG_XG = 1.35;

export function computeLambda(inputs: LambdaInputs): number {
  // Dixon-Coles style: strength ratios relative to league average
  const attackStrength = inputs.attackRating / LEAGUE_AVG_XG;
  const defenseWeakness = inputs.opponentDefenseRating / LEAGUE_AVG_XG;

  let lambda = LEAGUE_AVG_XG * attackStrength * defenseWeakness;

  // Symmetric home advantage: zero-sum so total expected goals aren't inflated
  lambda += inputs.isHome
    ? inputs.homeAdvantageGoals / 2
    : -inputs.homeAdvantageGoals / 2;

  lambda *= inputs.injuryModifier;
  lambda *= inputs.formModifier;
  lambda *= inputs.h2hModifier;
  lambda *= inputs.fatigueModifier;
  lambda *= inputs.regressionModifier;

  return Math.max(0.3, Math.min(5.0, lambda));
}
