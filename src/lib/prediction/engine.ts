/**
 * Prediction Engine — orchestrates feature computation → model → output.
 *
 * For a given fixture, pulls all relevant data from the database,
 * computes features, runs Dixon-Coles Poisson, and produces a full
 * prediction object with all market probabilities.
 */

import { prisma } from "../db";
import { CURRENT_SEASON } from "../constants";
import {
  computeAttackingFeatures,
  computeDefensiveFeatures,
  computeFormFeatures,
  computeH2HFeatures,
  computeSquadFeatures,
  computeContextFeatures,
  classifyTacticalMatchup,
  applyRegressionToMean,
  computeLambda,
  weightedAvg,
  getFeatureWeights,
  type H2HFeatures,
} from "./features";
import {
  buildScorelineMatrix,
  matchResultProbs,
  overUnderProbs,
  bttsProbs,
  cleanSheetProbs,
  scorelineMap,
  topScorelines,
  htFtProbs,
} from "./poisson";

export interface PredictionResult {
  fixtureId: number;
  modelVersion: string;

  probHomeWin: number;
  probDraw: number;
  probAwayWin: number;

  lambdaHome: number;
  lambdaAway: number;
  expectedTotalGoals: number;

  probOver05: number;
  probOver15: number;
  probOver25: number;
  probOver35: number;
  probOver45: number;

  probBttsYes: number;
  probBttsNo: number;

  probHomeCs: number;
  probAwayCs: number;

  scorelineProbabilities: Record<string, number>;
  htFtProbabilities: Record<string, number>;
  topScorelines: Array<{ home: number; away: number; prob: number }>;

  modelConfidence: number;
  featureWeights: Record<string, number>;
  featureBreakdown: FeatureBreakdown;
  insights: string[];
}

interface FeatureBreakdown {
  homeAttack: number;
  homeDefense: number;
  awayAttack: number;
  awayDefense: number;
  homeForm: number;
  awayForm: number;
  h2h: H2HFeatures;
  homeInjuryImpact: number;
  awayInjuryImpact: number;
  homeAdvantage: number;
  tacticalStyle: string;
}

const MODEL_VERSION = "v1.0-dc-poisson";
const LEAGUE_AVG_XG = 1.35;
const HOME_ADVANTAGE_GOALS = 0.25;

export async function predictMatch(fixtureId: number): Promise<PredictionResult> {
  const fixture = await prisma.fixture.findUnique({
    where: { id: fixtureId },
    include: {
      homeTeam: true,
      awayTeam: true,
      competition: true,
    },
  });

  if (!fixture) throw new Error(`Fixture ${fixtureId} not found`);

  // ── Fetch all data ──────────────────────────────────────────

  const [
    homeSeasonStats,
    awaySeasonStats,
    homeMatchStats,
    awayMatchStats,
    homeSituational,
    awaySituational,
  ] = await Promise.all([
    prisma.teamSeasonStats.findFirst({
      where: { teamId: fixture.homeTeamId, competitionId: fixture.competitionId, season: CURRENT_SEASON },
    }),
    prisma.teamSeasonStats.findFirst({
      where: { teamId: fixture.awayTeamId, competitionId: fixture.competitionId, season: CURRENT_SEASON },
    }),
    prisma.teamMatchStats.findMany({
      where: { teamId: fixture.homeTeamId },
      orderBy: { fixture: { utcDate: "desc" } },
      take: 15,
    }),
    prisma.teamMatchStats.findMany({
      where: { teamId: fixture.awayTeamId },
      orderBy: { fixture: { utcDate: "desc" } },
      take: 15,
    }),
    prisma.teamSituationalStats.findFirst({
      where: { teamId: fixture.homeTeamId, competitionId: fixture.competitionId, season: CURRENT_SEASON },
    }),
    prisma.teamSituationalStats.findFirst({
      where: { teamId: fixture.awayTeamId, competitionId: fixture.competitionId, season: CURRENT_SEASON },
    }),
  ]);

  // H2H
  const [idA, idB] = fixture.homeTeamId < fixture.awayTeamId
    ? [fixture.homeTeamId, fixture.awayTeamId]
    : [fixture.awayTeamId, fixture.homeTeamId];

  const h2hMatches = await prisma.h2HMatch.findMany({
    where: { teamAId: idA, teamBId: idB },
    orderBy: { date: "desc" },
    take: 10,
  });

  // Players & injuries
  const [homePlayers, awayPlayers] = await Promise.all([
    prisma.player.findMany({
      where: { teamId: fixture.homeTeamId },
      include: {
        seasonAgg: { where: { season: CURRENT_SEASON } },
        injuries: { where: { status: { in: ["out", "doubt"] } } },
      },
    }),
    prisma.player.findMany({
      where: { teamId: fixture.awayTeamId },
      include: {
        seasonAgg: { where: { season: CURRENT_SEASON } },
        injuries: { where: { status: { in: ["out", "doubt"] } } },
      },
    }),
  ]);

  // ── Compute features ───────────────────────────────────────

  const homeAttack = computeAttackingFeatures(homeMatchStats, homeSeasonStats, true);
  const awayAttack = computeAttackingFeatures(awayMatchStats, awaySeasonStats, false);
  const homeDefense = computeDefensiveFeatures(homeMatchStats, homeSeasonStats, true);
  const awayDefense = computeDefensiveFeatures(awayMatchStats, awaySeasonStats, false);
  const homeForm = computeFormFeatures(homeMatchStats, homeSeasonStats);
  const awayForm = computeFormFeatures(awayMatchStats, awaySeasonStats);

  const h2hFeatures = computeH2HFeatures(h2hMatches, idA, fixture.homeTeamId);

  const homeXgTotal = homeSeasonStats ? homeSeasonStats.xgFor / Math.max(homeSeasonStats.matchesPlayed, 1) : LEAGUE_AVG_XG;
  const awayXgTotal = awaySeasonStats ? awaySeasonStats.xgFor / Math.max(awaySeasonStats.matchesPlayed, 1) : LEAGUE_AVG_XG;

  const homeSquad = computeSquadFeatures(homePlayers, homeXgTotal);
  const awaySquad = computeSquadFeatures(awayPlayers, awayXgTotal);

  const lastHomeMatch = homeMatchStats[0];
  const lastHomeDate = lastHomeMatch ? new Date() : null;

  const contextFeatures = computeContextFeatures(
    homeSeasonStats, awaySeasonStats, lastHomeDate, false,
  );

  const tactical = classifyTacticalMatchup(
    homeDefense.ppda ?? 10,
    awayDefense.ppda ?? 10,
  );

  // ── Compute lambdas ────────────────────────────────────────

  const homeAttackRating = homeAttack.attackRatingOverall ?? LEAGUE_AVG_XG;
  const awayAttackRating = awayAttack.attackRatingOverall ?? LEAGUE_AVG_XG;
  const homeDefRating = homeDefense.defenseRatingOverall ?? LEAGUE_AVG_XG;
  const awayDefRating = awayDefense.defenseRatingOverall ?? LEAGUE_AVG_XG;
  const matchday = fixture.matchday ?? 20;

  // If no match-level stats, fall back to season stats
  let homeXgPerGame: number;
  let awayXgPerGame: number;
  let homeXgaPerGame: number;
  let awayXgaPerGame: number;

  if (homeMatchStats.length > 0) {
    homeXgPerGame = homeAttackRating;
    homeXgaPerGame = homeDefRating;
  } else if (homeSeasonStats && homeSeasonStats.matchesPlayed > 0) {
    homeXgPerGame = homeSeasonStats.xgFor > 0
      ? homeSeasonStats.xgFor / homeSeasonStats.matchesPlayed
      : homeSeasonStats.goalsScored / homeSeasonStats.matchesPlayed;
    homeXgaPerGame = homeSeasonStats.xgAgainst > 0
      ? homeSeasonStats.xgAgainst / homeSeasonStats.matchesPlayed
      : homeSeasonStats.goalsConceded / homeSeasonStats.matchesPlayed;
  } else {
    homeXgPerGame = LEAGUE_AVG_XG;
    homeXgaPerGame = LEAGUE_AVG_XG;
  }

  if (awayMatchStats.length > 0) {
    awayXgPerGame = awayAttackRating;
    awayXgaPerGame = awayDefRating;
  } else if (awaySeasonStats && awaySeasonStats.matchesPlayed > 0) {
    awayXgPerGame = awaySeasonStats.xgFor > 0
      ? awaySeasonStats.xgFor / awaySeasonStats.matchesPlayed
      : awaySeasonStats.goalsScored / awaySeasonStats.matchesPlayed;
    awayXgaPerGame = awaySeasonStats.xgAgainst > 0
      ? awaySeasonStats.xgAgainst / awaySeasonStats.matchesPlayed
      : awaySeasonStats.goalsConceded / awaySeasonStats.matchesPlayed;
  } else {
    awayXgPerGame = LEAGUE_AVG_XG;
    awayXgaPerGame = LEAGUE_AVG_XG;
  }

  // Regression to mean
  const homeRegression = applyRegressionToMean(
    homeXgPerGame, homeForm.xgOverperformance ?? 0, matchday, LEAGUE_AVG_XG,
  ) / Math.max(homeXgPerGame, 0.01);

  const awayRegression = applyRegressionToMean(
    awayXgPerGame, awayForm.xgOverperformance ?? 0, matchday, LEAGUE_AVG_XG,
  ) / Math.max(awayXgPerGame, 0.01);

  // Fatigue adjustments
  const homeFatigue = (contextFeatures.daysSinceLastMatch ?? 7) < 3 ? 0.05 : 0;
  const awayFatigue = 0;

  // H2H shrinkage
  const h2hWeight = Math.min(1.0, h2hFeatures.totalMeetings / 10);
  const h2hHomeAdj = h2hWeight * (h2hFeatures.homeWinRate - 0.45) + 0;
  const h2hAwayAdj = h2hWeight * (h2hFeatures.awayWinRate - 0.28) + 0;

  // Motivation boost
  const motivBoost = contextFeatures.motivationFactor === "high_positive" ? 0.05
    : contextFeatures.motivationFactor === "high_negative" ? 0.03
    : 0;

  // Compute final lambdas
  const lambdaHome = computeLambda({
    attackRating: homeXgPerGame,
    opponentDefenseRating: awayXgaPerGame,
    venueAttackRating: homeAttack.attackRatingVenue ?? homeXgPerGame,
    opponentVenueDefenseRating: awayDefense.defenseRatingVenue ?? awayXgaPerGame,
    homeAdvantage: HOME_ADVANTAGE_GOALS,
    injuryDiscount: homeSquad.missingPlayersXgShare ?? 0,
    formBoost: (homeForm.formXgTrend ?? 0) * 2,
    h2hAdjustment: h2hHomeAdj,
    fatigueAdjustment: homeFatigue,
    motivationBoost: motivBoost,
    regressionFactor: homeRegression,
  }, true);

  const lambdaAway = computeLambda({
    attackRating: awayXgPerGame,
    opponentDefenseRating: homeXgaPerGame,
    venueAttackRating: awayAttack.attackRatingVenue ?? awayXgPerGame,
    opponentVenueDefenseRating: homeDefense.defenseRatingVenue ?? homeXgaPerGame,
    homeAdvantage: HOME_ADVANTAGE_GOALS,
    injuryDiscount: awaySquad.missingPlayersXgShare ?? 0,
    formBoost: (awayForm.formXgTrend ?? 0) * 2,
    h2hAdjustment: h2hAwayAdj,
    fatigueAdjustment: awayFatigue,
    motivationBoost: motivBoost,
    regressionFactor: awayRegression,
  }, false);

  // ── Build predictions ──────────────────────────────────────

  const rho = tactical.styleClash === "deep_block_vs_deep_block" ? -0.08
    : tactical.styleClash === "press_vs_press" ? -0.02
    : -0.05;

  const matrix = buildScorelineMatrix(lambdaHome, lambdaAway, rho);
  const result1x2 = matchResultProbs(matrix);
  const overUnder = overUnderProbs(matrix);
  const btts = bttsProbs(matrix);
  const cs = cleanSheetProbs(matrix);
  const scorelines = scorelineMap(matrix);
  const topLines = topScorelines(matrix, 10);
  const htft = htFtProbs(lambdaHome, lambdaAway, rho);

  // Confidence: based on data availability
  let dataPoints = 0;
  if (homeMatchStats.length > 0) dataPoints += homeMatchStats.length * 20;
  if (awayMatchStats.length > 0) dataPoints += awayMatchStats.length * 20;
  if (homeSeasonStats) dataPoints += 100;
  if (awaySeasonStats) dataPoints += 100;
  if (h2hMatches.length > 0) dataPoints += h2hMatches.length * 10;
  if (homePlayers.length > 0) dataPoints += 50;
  if (awayPlayers.length > 0) dataPoints += 50;

  const maxDataPoints = 1000;
  const confidence = Math.min(1, dataPoints / maxDataPoints);

  // ── Generate insights ──────────────────────────────────────

  const insights = generatePredictionInsights({
    homeTeamName: fixture.homeTeam.shortName ?? fixture.homeTeam.name,
    awayTeamName: fixture.awayTeam.shortName ?? fixture.awayTeam.name,
    lambdaHome,
    lambdaAway,
    homeXgPerGame,
    awayXgPerGame,
    homeXgaPerGame,
    awayXgaPerGame,
    homeForm: homeForm.formPointsLast5 ?? 0,
    awayForm: awayForm.formPointsLast5 ?? 0,
    homeOverperf: homeForm.xgOverperformance ?? 0,
    awayOverperf: awayForm.xgOverperformance ?? 0,
    h2h: h2hFeatures,
    homeInjuryImpact: homeSquad.missingPlayersXgShare ?? 0,
    awayInjuryImpact: awaySquad.missingPlayersXgShare ?? 0,
    homeKeyAbsent: homeSquad.keyPlayerAbsence ?? false,
    awayKeyAbsent: awaySquad.keyPlayerAbsence ?? false,
    tactical,
    contextFeatures,
    result1x2,
    overUnder,
    btts,
    homeSeasonStats,
    awaySeasonStats,
    homeSituational,
    awaySituational,
  });

  return {
    fixtureId,
    modelVersion: MODEL_VERSION,
    probHomeWin: round4(result1x2.home),
    probDraw: round4(result1x2.draw),
    probAwayWin: round4(result1x2.away),
    lambdaHome: round4(lambdaHome),
    lambdaAway: round4(lambdaAway),
    expectedTotalGoals: round4(lambdaHome + lambdaAway),
    probOver05: round4(overUnder["over05"] ?? 0),
    probOver15: round4(overUnder["over15"] ?? 0),
    probOver25: round4(overUnder["over25"] ?? 0),
    probOver35: round4(overUnder["over35"] ?? 0),
    probOver45: round4(overUnder["over45"] ?? 0),
    probBttsYes: round4(btts.yes),
    probBttsNo: round4(btts.no),
    probHomeCs: round4(cs.home),
    probAwayCs: round4(cs.away),
    scorelineProbabilities: scorelines,
    htFtProbabilities: htft,
    topScorelines: topLines.map((l) => ({ ...l, prob: round4(l.prob) })),
    modelConfidence: round4(confidence),
    featureWeights: getFeatureWeights() as unknown as Record<string, number>,
    featureBreakdown: {
      homeAttack: round4(homeXgPerGame),
      homeDefense: round4(homeXgaPerGame),
      awayAttack: round4(awayXgPerGame),
      awayDefense: round4(awayXgaPerGame),
      homeForm: homeForm.formPointsLast5 ?? 0,
      awayForm: awayForm.formPointsLast5 ?? 0,
      h2h: h2hFeatures,
      homeInjuryImpact: round4(homeSquad.missingPlayersXgShare ?? 0),
      awayInjuryImpact: round4(awaySquad.missingPlayersXgShare ?? 0),
      homeAdvantage: HOME_ADVANTAGE_GOALS,
      tacticalStyle: tactical.styleClash,
    },
    insights,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ─── SAVE PREDICTION ─────────────────────────────────────────

export async function savePrediction(pred: PredictionResult) {
  const fixture = await prisma.fixture.findUnique({
    where: { id: pred.fixtureId },
  });
  if (!fixture) return;

  await prisma.prediction.upsert({
    where: {
      fixtureId_modelVersion: {
        fixtureId: pred.fixtureId,
        modelVersion: pred.modelVersion,
      },
    },
    update: {
      probHomeWin: pred.probHomeWin,
      probDraw: pred.probDraw,
      probAwayWin: pred.probAwayWin,
      lambdaHome: pred.lambdaHome,
      lambdaAway: pred.lambdaAway,
      expectedTotalGoals: pred.expectedTotalGoals,
      probOver05: pred.probOver05,
      probOver15: pred.probOver15,
      probOver25: pred.probOver25,
      probOver35: pred.probOver35,
      probOver45: pred.probOver45,
      probBttsYes: pred.probBttsYes,
      probBttsNo: pred.probBttsNo,
      probHomeCs: pred.probHomeCs,
      probAwayCs: pred.probAwayCs,
      scorelineProbabilities: JSON.stringify(pred.scorelineProbabilities),
      htFtProbabilities: JSON.stringify(pred.htFtProbabilities),
      featureWeights: JSON.stringify(pred.featureWeights),
      modelConfidence: pred.modelConfidence,
      topInsights: JSON.stringify(pred.insights),
    },
    create: {
      fixtureId: pred.fixtureId,
      competitionId: fixture.competitionId,
      modelVersion: pred.modelVersion,
      probHomeWin: pred.probHomeWin,
      probDraw: pred.probDraw,
      probAwayWin: pred.probAwayWin,
      lambdaHome: pred.lambdaHome,
      lambdaAway: pred.lambdaAway,
      expectedTotalGoals: pred.expectedTotalGoals,
      probOver05: pred.probOver05,
      probOver15: pred.probOver15,
      probOver25: pred.probOver25,
      probOver35: pred.probOver35,
      probOver45: pred.probOver45,
      probBttsYes: pred.probBttsYes,
      probBttsNo: pred.probBttsNo,
      probHomeCs: pred.probHomeCs,
      probAwayCs: pred.probAwayCs,
      scorelineProbabilities: JSON.stringify(pred.scorelineProbabilities),
      htFtProbabilities: JSON.stringify(pred.htFtProbabilities),
      featureWeights: JSON.stringify(pred.featureWeights),
      modelConfidence: pred.modelConfidence,
      topInsights: JSON.stringify(pred.insights),
    },
  });
}

// ─── PREDICTION INSIGHT GENERATOR ────────────────────────────

interface InsightInput {
  homeTeamName: string;
  awayTeamName: string;
  lambdaHome: number;
  lambdaAway: number;
  homeXgPerGame: number;
  awayXgPerGame: number;
  homeXgaPerGame: number;
  awayXgaPerGame: number;
  homeForm: number;
  awayForm: number;
  homeOverperf: number;
  awayOverperf: number;
  h2h: H2HFeatures;
  homeInjuryImpact: number;
  awayInjuryImpact: number;
  homeKeyAbsent: boolean;
  awayKeyAbsent: boolean;
  tactical: { styleClash: string; pressingMismatch: number };
  contextFeatures: { daysSinceLastMatch?: number; isAfterEuropean?: boolean; motivationFactor?: string; isDerby?: boolean };
  result1x2: { home: number; draw: number; away: number };
  overUnder: Record<string, number>;
  btts: { yes: number; no: number };
  homeSeasonStats: { matchesPlayedHome?: number; goalsHome?: number; concededHome?: number; cleanSheets?: number; matchesPlayed?: number; bttsCount?: number } | null;
  awaySeasonStats: { matchesPlayedAway?: number; goalsAway?: number; concededAway?: number; cleanSheets?: number; matchesPlayed?: number } | null;
  homeSituational: { goals76to90?: number; conceded0to15?: number; winPctScoringFirst?: number } | null;
  awaySituational: { goals76to90?: number; conceded0to15?: number; winPctScoringFirst?: number } | null;
}

function generatePredictionInsights(ctx: InsightInput): string[] {
  const insights: string[] = [];

  // Attacking strength
  if (ctx.homeXgPerGame > 2.0)
    insights.push(`${ctx.homeTeamName} creates high-quality chances at home (${ctx.homeXgPerGame.toFixed(2)} xG/game) — primary driver for home win probability`);

  if (ctx.awayXgaPerGame > 1.7)
    insights.push(`${ctx.awayTeamName} has been leaky on the road, conceding ${ctx.awayXgaPerGame.toFixed(2)} xG/game away`);

  if (ctx.awayXgPerGame > 1.8)
    insights.push(`${ctx.awayTeamName} carries attacking threat (${ctx.awayXgPerGame.toFixed(2)} xG/game) even away from home`);

  // Form
  if (ctx.homeForm >= 12)
    insights.push(`${ctx.homeTeamName} is in excellent form — ${ctx.homeForm} points from last 5 matches`);
  else if (ctx.homeForm <= 5)
    insights.push(`${ctx.homeTeamName} is in poor form — only ${ctx.homeForm} points from last 5`);

  if (ctx.awayForm >= 12)
    insights.push(`${ctx.awayTeamName} is in excellent form — ${ctx.awayForm} points from last 5 matches`);

  // xG regression warnings
  if (ctx.homeOverperf > 0.3)
    insights.push(`⚠ ${ctx.homeTeamName} is significantly overperforming xG (+${ctx.homeOverperf.toFixed(2)}/game) — regression likely`);
  if (ctx.homeOverperf < -0.3)
    insights.push(`${ctx.homeTeamName} is underperforming xG (${ctx.homeOverperf.toFixed(2)}/game) — expect improvement`);
  if (ctx.awayOverperf > 0.3)
    insights.push(`⚠ ${ctx.awayTeamName} is overperforming xG (+${ctx.awayOverperf.toFixed(2)}/game) — regression risk`);

  // Injury impact
  if (ctx.homeInjuryImpact > 0.25)
    insights.push(`🚨 CRITICAL: ${ctx.homeTeamName} is missing players responsible for ${(ctx.homeInjuryImpact * 100).toFixed(0)}% of their xG`);
  if (ctx.awayInjuryImpact > 0.25)
    insights.push(`🚨 CRITICAL: ${ctx.awayTeamName} is missing players responsible for ${(ctx.awayInjuryImpact * 100).toFixed(0)}% of their xG`);
  if (ctx.homeKeyAbsent)
    insights.push(`${ctx.homeTeamName} is missing a key player — reduced attacking potency`);
  if (ctx.awayKeyAbsent)
    insights.push(`${ctx.awayTeamName} is missing a key player — defensive vulnerability exposed`);

  // H2H
  if (ctx.h2h.totalMeetings >= 3) {
    if (ctx.h2h.bttsRate > 0.7)
      insights.push(`Both teams scored in ${Math.round(ctx.h2h.bttsRate * 100)}% of recent H2H meetings — BTTS looks strong`);
    if (ctx.h2h.over25Rate > 0.7)
      insights.push(`H2H history is high-scoring: Over 2.5 goals in ${Math.round(ctx.h2h.over25Rate * 100)}% of meetings`);
    if (ctx.h2h.avgTotalGoals > 3.0)
      insights.push(`H2H average of ${ctx.h2h.avgTotalGoals.toFixed(1)} goals per meeting supports Over 2.5`);
  }

  // Tactical
  if (ctx.tactical.styleClash === "press_vs_press")
    insights.push("Both teams press aggressively — expect a high-tempo, open game with turnovers");
  if (ctx.tactical.styleClash === "press_vs_deep_block")
    insights.push("Tactical contrast: high press vs deep block — could produce a chess match");
  if (ctx.tactical.styleClash === "deep_block_vs_deep_block")
    insights.push("Both teams sit deep — low-scoring grind likely, Under 2.5 favored");
  if (ctx.tactical.pressingMismatch > 5)
    insights.push(`Big tactical mismatch in pressing intensity (${ctx.tactical.pressingMismatch.toFixed(1)} PPDA gap)`);

  // Context
  if (ctx.contextFeatures.daysSinceLastMatch != null && ctx.contextFeatures.daysSinceLastMatch < 3)
    insights.push(`${ctx.homeTeamName} playing on short rest — fatigue risk factored in`);
  if (ctx.contextFeatures.isAfterEuropean)
    insights.push("Midweek European football may lead to rotation and fatigue");
  if (ctx.contextFeatures.isDerby)
    insights.push("Derby match — historically tighter margins with fewer goals and more cards");
  if (ctx.contextFeatures.motivationFactor === "high_negative")
    insights.push("Relegation stakes in play — expect maximum intensity from both sides");

  // Scoring patterns
  if (ctx.homeSituational?.goals76to90 && ctx.homeSituational.goals76to90 > 3)
    insights.push(`${ctx.homeTeamName} is dangerous late — disproportionate goals in 76-90 min`);
  if (ctx.awaySituational?.conceded0to15 && ctx.awaySituational.conceded0to15 > 3)
    insights.push(`${ctx.awayTeamName} is vulnerable early — concedes frequently in the first 15 minutes`);

  // Clean sheet sustainability
  if (ctx.homeSeasonStats) {
    const mp = ctx.homeSeasonStats.matchesPlayed ?? 1;
    const csRate = (ctx.homeSeasonStats.cleanSheets ?? 0) / mp;
    if (csRate > 0.45 && ctx.homeXgaPerGame > 1.0)
      insights.push(`⚠ ${ctx.homeTeamName}'s clean sheet rate (${(csRate * 100).toFixed(0)}%) looks unsustainably high relative to xG conceded`);
  }

  // BTTS from season stats
  if (ctx.homeSeasonStats && ctx.homeSeasonStats.matchesPlayed) {
    const bttsPct = (ctx.homeSeasonStats.bttsCount ?? 0) / ctx.homeSeasonStats.matchesPlayed;
    if (bttsPct > 0.6)
      insights.push(`Both teams score in ${(bttsPct * 100).toFixed(0)}% of ${ctx.homeTeamName}'s matches this season`);
  }

  // Model summary insight
  const mostLikely = ctx.result1x2.home > ctx.result1x2.away ? "Home Win" : ctx.result1x2.away > ctx.result1x2.home ? "Away Win" : "Draw";
  const mostLikelyProb = Math.max(ctx.result1x2.home, ctx.result1x2.draw, ctx.result1x2.away);
  insights.unshift(
    `Model favors ${mostLikely} (${(mostLikelyProb * 100).toFixed(1)}%) with expected ${ctx.lambdaHome.toFixed(1)}-${ctx.lambdaAway.toFixed(1)} scoreline`,
  );

  return insights.slice(0, 12);
}
