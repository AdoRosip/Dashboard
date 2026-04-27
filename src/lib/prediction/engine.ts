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
  boundedMultiplier,
  combineWeightedRate,
  computeWeightedLambdaV3,
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
import { computeSquadStrengthModifier } from "./rotation";
import { isDerbyOrRivalry } from "../data/rivalries";
import { dixonColesRhoBase, htGoalShare } from "./league-params";
import { ENGINE_LEAGUE_AVG_XG, ENGINE_MODEL_VERSION, ENGINE_V3_CONFIG } from "./model-config";

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
  /** Per-side λ multipliers (diagnostics); symmetric home/away structure. */
  featureWeights: {
    home: Record<string, number>;
    away: Record<string, number>;
  };
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

export const MODEL_VERSION = ENGINE_MODEL_VERSION;
const LEAGUE_AVG_XG = ENGINE_LEAGUE_AVG_XG;
const PREDICTION_CACHE_HOURS = 6;

const EUROPEAN_COMPETITIONS = new Set(["CL", "EC", "CLI"]);

const HOME_ADVANTAGE_GOALS_BY_LEAGUE: Record<string, number> = {
  PL: 0.22, PD: 0.32, BL1: 0.28, SA: 0.27, FL1: 0.25,
  CL: 0.20, EC: 0.20, CLI: 0.20,
};

function squadModFromAvailability(
  players: Array<{
    id: number;
    seasonAgg: Array<{ minutes: number; matches: number; xgPer90: number }>;
  }>,
  availability: Array<{ playerId: number; probStarting: number }>,
  teamXgPerGame: number,
  injuryFallback: number,
): number {
  if (availability.length === 0) return injuryFallback;
  const byId = new Map(availability.map((a) => [a.playerId, a]));
  const rows: { xgPer90: number; avgMinutesPerGame: number; probStarting: number }[] = [];
  for (const p of players) {
    const av = byId.get(p.id);
    if (!av) continue;
    const agg = p.seasonAgg[0];
    if (!agg) continue;
    const mpg = agg.matches > 0 ? agg.minutes / agg.matches : 90;
    rows.push({
      xgPer90: agg.xgPer90,
      avgMinutesPerGame: mpg,
      probStarting: av.probStarting,
    });
  }
  if (rows.length < 3) return injuryFallback;
  return computeSquadStrengthModifier(rows, teamXgPerGame);
}

function seasonAttackRate(
  stats: { xgFor: number; goalsScored: number; matchesPlayed: number } | null,
): number | null {
  if (!stats || stats.matchesPlayed <= 0) return null;
  if (stats.xgFor > 0) return stats.xgFor / stats.matchesPlayed;
  return stats.goalsScored / stats.matchesPlayed;
}

function seasonDefenseRate(
  stats: { xgAgainst: number; goalsConceded: number; matchesPlayed: number } | null,
): number | null {
  if (!stats || stats.matchesPlayed <= 0) return null;
  if (stats.xgAgainst > 0) return stats.xgAgainst / stats.matchesPlayed;
  return stats.goalsConceded / stats.matchesPlayed;
}

export async function predictMatch(fixtureId: number): Promise<PredictionResult> {
  // ── Check cache (Bug 5) ───────────────────────────────────
  const fixture = await prisma.fixture.findUnique({
    where: { id: fixtureId },
    include: {
      homeTeam: true,
      awayTeam: true,
      competition: true,
    },
  });

  if (!fixture) throw new Error(`Fixture ${fixtureId} not found`);

  const kickoff = new Date(fixture.utcDate);
  const fixtureStarted = kickoff.getTime() <= Date.now();

  const cached = await prisma.prediction.findFirst({
    where: { fixtureId, modelVersion: MODEL_VERSION },
    orderBy: { updatedAt: "desc" },
  });

  if (cached) {
    if (fixtureStarted) {
      return reconstructPredictionResult(cached, fixtureId);
    }
    const refTime = cached.updatedAt ?? cached.createdAt;
    const ageMs = Date.now() - refTime.getTime();
    if (ageMs < PREDICTION_CACHE_HOURS * 60 * 60 * 1000) {
      return reconstructPredictionResult(cached, fixtureId);
    }
  }

  if (fixtureStarted) {
    throw new Error(
      `Prediction snapshot unavailable for started fixture ${fixtureId}; refusing post-match recomputation`,
    );
  }

  const isEuropean = EUROPEAN_COMPETITIONS.has(fixture.competitionId);
  const homeAdvGoals = HOME_ADVANTAGE_GOALS_BY_LEAGUE[fixture.competitionId] ?? 0.25;

  // ── Fetch all data ──────────────────────────────────────────

  // For European fixtures, use the team's domestic league for season stats
  const homeStatsCompId = isEuropean
    ? (fixture.homeTeam.competitionId ?? fixture.competitionId)
    : fixture.competitionId;
  const awayStatsCompId = isEuropean
    ? (fixture.awayTeam.competitionId ?? fixture.competitionId)
    : fixture.competitionId;

  const [
    homeSeasonStats,
    awaySeasonStats,
    homeMatchStats,
    awayMatchStats,
    homeCongestion,
    awayCongestion,
    homeImportance,
    awayImportance,
    homeAvailability,
    awayAvailability,
  ] = await Promise.all([
    prisma.teamSeasonStats.findFirst({
      where: { teamId: fixture.homeTeamId, competitionId: homeStatsCompId, season: CURRENT_SEASON },
    }),
    prisma.teamSeasonStats.findFirst({
      where: { teamId: fixture.awayTeamId, competitionId: awayStatsCompId, season: CURRENT_SEASON },
    }),
    prisma.teamMatchStats.findMany({
      where: {
        teamId: fixture.homeTeamId,
        fixture: { utcDate: { lt: kickoff } },
      },
      orderBy: { fixture: { utcDate: "desc" } },
      take: 15,
      include: { fixture: { select: { utcDate: true, competitionId: true } } },
    }),
    prisma.teamMatchStats.findMany({
      where: {
        teamId: fixture.awayTeamId,
        fixture: { utcDate: { lt: kickoff } },
      },
      orderBy: { fixture: { utcDate: "desc" } },
      take: 15,
      include: { fixture: { select: { utcDate: true, competitionId: true } } },
    }),
    prisma.teamFixtureCongestion.findUnique({
      where: { teamId_fixtureId: { teamId: fixture.homeTeamId, fixtureId } },
    }),
    prisma.teamFixtureCongestion.findUnique({
      where: { teamId_fixtureId: { teamId: fixture.awayTeamId, fixtureId } },
    }),
    prisma.matchImportance.findUnique({
      where: { teamId_fixtureId: { teamId: fixture.homeTeamId, fixtureId } },
    }),
    prisma.matchImportance.findUnique({
      where: { teamId_fixtureId: { teamId: fixture.awayTeamId, fixtureId } },
    }),
    prisma.playerAvailability.findMany({
      where: { fixtureId, teamId: fixture.homeTeamId },
    }),
    prisma.playerAvailability.findMany({
      where: { fixtureId, teamId: fixture.awayTeamId },
    }),
  ]);

  const flagNow = new Date();
  const [homeContextFlags, awayContextFlags, matchLevelFlags] = await Promise.all([
    prisma.matchContextFlag.findMany({
      where: {
        isActive: true,
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: flagNow } }] },
          {
            OR: [
              { teamId: fixture.homeTeamId, fixtureId: null },
              { teamId: fixture.homeTeamId, fixtureId: fixture.id },
            ],
          },
        ],
      },
    }),
    prisma.matchContextFlag.findMany({
      where: {
        isActive: true,
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: flagNow } }] },
          {
            OR: [
              { teamId: fixture.awayTeamId, fixtureId: null },
              { teamId: fixture.awayTeamId, fixtureId: fixture.id },
            ],
          },
        ],
      },
    }),
    prisma.matchContextFlag.findMany({
      where: {
        isActive: true,
        teamId: null,
        fixtureId: fixture.id,
        OR: [{ expiresAt: null }, { expiresAt: { gt: flagNow } }],
      },
    }),
  ]);

  // H2H
  const [idA, idB] = fixture.homeTeamId < fixture.awayTeamId
    ? [fixture.homeTeamId, fixture.awayTeamId]
    : [fixture.awayTeamId, fixture.homeTeamId];

  const h2hMatches = await prisma.h2HMatch.findMany({
    where: {
      teamAId: idA,
      teamBId: idB,
      date: { lt: kickoff },
    },
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

  const h2hFeatures = computeH2HFeatures(
    h2hMatches,
    fixture.homeTeamId,
    fixture.awayTeamId,
  );

  const homeXgTotal = homeSeasonStats ? homeSeasonStats.xgFor / Math.max(homeSeasonStats.matchesPlayed, 1) : LEAGUE_AVG_XG;
  const awayXgTotal = awaySeasonStats ? awaySeasonStats.xgFor / Math.max(awaySeasonStats.matchesPlayed, 1) : LEAGUE_AVG_XG;

  const homeSquad = computeSquadFeatures(homePlayers, homeXgTotal);
  const awaySquad = computeSquadFeatures(awayPlayers, awayXgTotal);

  const lastHomeMatch = homeMatchStats[0];
  const lastHomeDate = lastHomeMatch ? new Date(lastHomeMatch.fixture.utcDate) : null;
  const lastAwayMatch = awayMatchStats[0];
  const lastAwayDate = lastAwayMatch ? new Date(lastAwayMatch.fixture.utcDate) : null;

  const priorMatchWasEuropean = (
    stats: typeof homeMatchStats,
  ): boolean => {
    const row = stats[0];
    if (!row?.fixture) return false;
    const prev = new Date(row.fixture.utcDate);
    if (prev.getTime() >= kickoff.getTime()) return false;
    return EUROPEAN_COMPETITIONS.has(row.fixture.competitionId);
  };
  const isAfterEuropean =
    priorMatchWasEuropean(homeMatchStats) || priorMatchWasEuropean(awayMatchStats);

  const contextFeatures = computeContextFeatures(
    homeSeasonStats,
    awaySeasonStats,
    lastHomeDate,
    isAfterEuropean,
    kickoff,
  );

  const tactical = classifyTacticalMatchup(
    homeDefense.ppda ?? 10,
    awayDefense.ppda ?? 10,
  );

  // ── Compute lambdas ────────────────────────────────────────

  const matchday = fixture.matchday ?? 20;

  const homeAttackRate = combineWeightedRate({
    recentOverall: homeAttack.attackRatingOverall,
    recentVenue: homeAttack.attackRatingVenue,
    season: seasonAttackRate(homeSeasonStats),
    leaguePrior: LEAGUE_AVG_XG,
    weights: ENGINE_V3_CONFIG.rateWeights,
  });
  const awayAttackRate = combineWeightedRate({
    recentOverall: awayAttack.attackRatingOverall,
    recentVenue: awayAttack.attackRatingVenue,
    season: seasonAttackRate(awaySeasonStats),
    leaguePrior: LEAGUE_AVG_XG,
    weights: ENGINE_V3_CONFIG.rateWeights,
  });
  const homeDefenseRate = combineWeightedRate({
    recentOverall: homeDefense.defenseRatingOverall,
    recentVenue: homeDefense.defenseRatingVenue,
    season: seasonDefenseRate(homeSeasonStats),
    leaguePrior: LEAGUE_AVG_XG,
    weights: ENGINE_V3_CONFIG.rateWeights,
  });
  const awayDefenseRate = combineWeightedRate({
    recentOverall: awayDefense.defenseRatingOverall,
    recentVenue: awayDefense.defenseRatingVenue,
    season: seasonDefenseRate(awaySeasonStats),
    leaguePrior: LEAGUE_AVG_XG,
    weights: ENGINE_V3_CONFIG.rateWeights,
  });

  const homeXgPerGame = homeAttackRate.value;
  const awayXgPerGame = awayAttackRate.value;
  const homeXgaPerGame = homeDefenseRate.value;
  const awayXgaPerGame = awayDefenseRate.value;

  // Regression to mean — clamped to [0.75, 1.25] to prevent extreme swings
  const homeRegressionRaw = applyRegressionToMean(
    homeXgPerGame, homeForm.xgOverperformance ?? 0, matchday, LEAGUE_AVG_XG,
  ) / Math.max(homeXgPerGame, 0.01);
  const homeRegression = boundedMultiplier(
    homeRegressionRaw,
    ENGINE_V3_CONFIG.modifierCaps.regression.min,
    ENGINE_V3_CONFIG.modifierCaps.regression.max,
  );

  const awayRegressionRaw = applyRegressionToMean(
    awayXgPerGame, awayForm.xgOverperformance ?? 0, matchday, LEAGUE_AVG_XG,
  ) / Math.max(awayXgPerGame, 0.01);
  const awayRegression = boundedMultiplier(
    awayRegressionRaw,
    ENGINE_V3_CONFIG.modifierCaps.regression.min,
    ENGINE_V3_CONFIG.modifierCaps.regression.max,
  );

  // Squad / injury: prefer probabilistic rotation model when availability rows exist
  const homeInjuryFallback = 1 - (homeSquad.missingPlayersXgShare ?? 0);
  const awayInjuryFallback = 1 - (awaySquad.missingPlayersXgShare ?? 0);

  const homeSquadMod = boundedMultiplier(
    squadModFromAvailability(
      homePlayers,
      homeAvailability,
      homeXgTotal,
      homeInjuryFallback,
    ),
    ENGINE_V3_CONFIG.modifierCaps.squad.min,
    ENGINE_V3_CONFIG.modifierCaps.squad.max,
  );
  const awaySquadMod = boundedMultiplier(
    squadModFromAvailability(
      awayPlayers,
      awayAvailability,
      awayXgTotal,
      awayInjuryFallback,
    ),
    ENGINE_V3_CONFIG.modifierCaps.squad.min,
    ENGINE_V3_CONFIG.modifierCaps.squad.max,
  );

  // Form modifiers (xG trend only — motivation handled via MatchImportance)
  const homeFormMod = boundedMultiplier(
    1 + (homeForm.formXgTrend ?? 0) * ENGINE_V3_CONFIG.impacts.formSlope,
    ENGINE_V3_CONFIG.modifierCaps.form.min,
    ENGINE_V3_CONFIG.modifierCaps.form.max,
  );
  const awayFormMod = boundedMultiplier(
    1 + (awayForm.formXgTrend ?? 0) * ENGINE_V3_CONFIG.impacts.formSlope,
    ENGINE_V3_CONFIG.modifierCaps.form.min,
    ENGINE_V3_CONFIG.modifierCaps.form.max,
  );

  const homeMotivationMod = boundedMultiplier(
    homeImportance?.lambdaModifier ?? 1.0,
    ENGINE_V3_CONFIG.modifierCaps.motivation.min,
    ENGINE_V3_CONFIG.modifierCaps.motivation.max,
  );
  const awayMotivationMod = boundedMultiplier(
    awayImportance?.lambdaModifier ?? 1.0,
    ENGINE_V3_CONFIG.modifierCaps.motivation.min,
    ENGINE_V3_CONFIG.modifierCaps.motivation.max,
  );

  const matchLevelMod = matchLevelFlags.reduce((m, f) => m * f.lambdaMultiplier, 1.0);
  const homeContextMod = Math.max(
    ENGINE_V3_CONFIG.modifierCaps.context.min,
    Math.min(
      ENGINE_V3_CONFIG.modifierCaps.context.max,
      homeContextFlags.reduce((m, f) => m * f.lambdaMultiplier, 1.0) * matchLevelMod,
    ),
  );
  const awayContextMod = Math.max(
    ENGINE_V3_CONFIG.modifierCaps.context.min,
    Math.min(
      ENGINE_V3_CONFIG.modifierCaps.context.max,
      awayContextFlags.reduce((m, f) => m * f.lambdaMultiplier, 1.0) * matchLevelMod,
    ),
  );

  // H2H modifiers (shrunk toward 1.0 by sample size, capped ±10%)
  const h2hWeight = Math.min(
    1.0,
    h2hFeatures.totalMeetings / ENGINE_V3_CONFIG.h2hBaselines.fullSample,
  );
  const homeH2hAdj =
    h2hWeight * (h2hFeatures.homeWinRate - ENGINE_V3_CONFIG.h2hBaselines.homeWinRate);
  const awayH2hAdj =
    h2hWeight * (h2hFeatures.awayWinRate - ENGINE_V3_CONFIG.h2hBaselines.awayWinRate);
  const homeH2hMod = boundedMultiplier(
    1 + homeH2hAdj * ENGINE_V3_CONFIG.impacts.h2h,
    ENGINE_V3_CONFIG.modifierCaps.h2h.min,
    ENGINE_V3_CONFIG.modifierCaps.h2h.max,
  );
  const awayH2hMod = boundedMultiplier(
    1 + awayH2hAdj * ENGINE_V3_CONFIG.impacts.h2h,
    ENGINE_V3_CONFIG.modifierCaps.h2h.min,
    ENGINE_V3_CONFIG.modifierCaps.h2h.max,
  );

  // Fatigue — graduated congestion model when precomputed rows exist
  const homeDaysSinceLast = contextFeatures.daysSinceLastMatch ?? 7;
  const awayDaysSinceLast = lastAwayDate
    ? (kickoff.getTime() - lastAwayDate.getTime()) / (1000 * 60 * 60 * 24)
    : 7;
  const homeFatigueMod = boundedMultiplier(
    homeCongestion?.fatigueModifier ?? (homeDaysSinceLast < 3 ? 0.95 : 1.0),
    ENGINE_V3_CONFIG.modifierCaps.fatigue.min,
    ENGINE_V3_CONFIG.modifierCaps.fatigue.max,
  );
  const awayFatigueMod = boundedMultiplier(
    awayCongestion?.fatigueModifier ?? (awayDaysSinceLast < 3 ? 0.95 : 1.0),
    ENGINE_V3_CONFIG.modifierCaps.fatigue.min,
    ENGINE_V3_CONFIG.modifierCaps.fatigue.max,
  );

  // Compute final lambdas
  const homeLambdaResult = computeWeightedLambdaV3({
    attackRating: homeXgPerGame,
    opponentDefenseRating: awayXgaPerGame,
    isHome: true,
    homeAdvantageGoals: homeAdvGoals,
    leagueAvgXg: ENGINE_V3_CONFIG.leagueAvgXg,
    modifiers: {
      squadStrengthModifier: homeSquadMod,
      formModifier: homeFormMod,
      h2hModifier: homeH2hMod,
      fatigueModifier: homeFatigueMod,
      motivationModifier: homeMotivationMod,
      contextModifier: homeContextMod,
      regressionModifier: homeRegression,
    },
    minLambda: ENGINE_V3_CONFIG.lambdaCaps.min,
    maxLambda: ENGINE_V3_CONFIG.lambdaCaps.max,
  });

  const awayLambdaResult = computeWeightedLambdaV3({
    attackRating: awayXgPerGame,
    opponentDefenseRating: homeXgaPerGame,
    isHome: false,
    homeAdvantageGoals: homeAdvGoals,
    leagueAvgXg: ENGINE_V3_CONFIG.leagueAvgXg,
    modifiers: {
      squadStrengthModifier: awaySquadMod,
      formModifier: awayFormMod,
      h2hModifier: awayH2hMod,
      fatigueModifier: awayFatigueMod,
      motivationModifier: awayMotivationMod,
      contextModifier: awayContextMod,
      regressionModifier: awayRegression,
    },
    minLambda: ENGINE_V3_CONFIG.lambdaCaps.min,
    maxLambda: ENGINE_V3_CONFIG.lambdaCaps.max,
  });
  const lambdaHome = homeLambdaResult.lambda;
  const lambdaAway = awayLambdaResult.lambda;

  // ── Build predictions ──────────────────────────────────────

  const derbyRho =
    isDerbyOrRivalry(fixture.homeTeamId, fixture.awayTeamId).isDerby ? -0.02 : 0;
  const rhoBase = dixonColesRhoBase(fixture.competitionId);
  const rho =
    (tactical.styleClash === "deep_block_vs_deep_block"
      ? rhoBase - 0.03
      : tactical.styleClash === "press_vs_press"
        ? rhoBase + 0.03
        : rhoBase) + derbyRho;

  const matrix = buildScorelineMatrix(lambdaHome, lambdaAway, rho);
  const result1x2 = matchResultProbs(matrix);
  const overUnder = overUnderProbs(matrix);
  const btts = bttsProbs(matrix);
  const cs = cleanSheetProbs(matrix);
  const scorelines = scorelineMap(matrix);
  const topLines = topScorelines(matrix, 10);
  const htft = htFtProbs(
    lambdaHome,
    lambdaAway,
    rho,
    htGoalShare(fixture.competitionId),
  );

  // Confidence: blend data richness with 1X2 sharpness (entropy); not the same as uncertainty.
  let dataPoints = 0;
  if (homeMatchStats.length > 0) dataPoints += homeMatchStats.length * 20;
  if (awayMatchStats.length > 0) dataPoints += awayMatchStats.length * 20;
  if (homeSeasonStats) dataPoints += 100;
  if (awaySeasonStats) dataPoints += 100;
  if (h2hMatches.length > 0) dataPoints += h2hMatches.length * 10;
  if (homePlayers.length > 0) dataPoints += 50;
  if (awayPlayers.length > 0) dataPoints += 50;

  const maxDataPoints = 1000;
  const dataQuality = Math.min(1, dataPoints / maxDataPoints);
  const ph = result1x2.home;
  const pd = result1x2.draw;
  const pa = result1x2.away;
  let entropy = 0;
  for (const x of [ph, pd, pa]) {
    if (x > 1e-12) entropy -= x * Math.log(x);
  }
  const entropyNorm = entropy / Math.log(3);
  const sharpness = 1 - entropyNorm;
  const confidence = Math.min(
    1,
    Math.max(0.12, 0.38 * dataQuality + 0.62 * sharpness),
  );

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
    homeVenueXg: homeAttack.attackRatingVenue ?? homeXgPerGame,
    awayVenueXga: awayDefense.defenseRatingVenue ?? awayXgaPerGame,
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
  });

  const result: PredictionResult = {
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
    featureWeights: {
      home: {
        attackRecentOverallWeight: round4(homeAttackRate.weights.recentOverall),
        attackRecentVenueWeight: round4(homeAttackRate.weights.recentVenue),
        attackSeasonWeight: round4(homeAttackRate.weights.season),
        attackLeaguePriorWeight: round4(homeAttackRate.weights.leaguePrior),
        defenseRecentOverallWeight: round4(homeDefenseRate.weights.recentOverall),
        defenseRecentVenueWeight: round4(homeDefenseRate.weights.recentVenue),
        defenseSeasonWeight: round4(homeDefenseRate.weights.season),
        defenseLeaguePriorWeight: round4(homeDefenseRate.weights.leaguePrior),
        baseLambda: round4(homeLambdaResult.baseLambda),
        combinedModifier: round4(homeLambdaResult.combinedModifier),
        homeAdvantageAdjustment: round4(homeLambdaResult.homeAdvantageAdjustment),
        squadStrengthModifier: round4(homeSquadMod),
        formModifier: round4(homeFormMod),
        motivationModifier: round4(homeMotivationMod),
        contextModifier: round4(homeContextMod),
        h2hModifier: round4(homeH2hMod),
        fatigueModifier: round4(homeFatigueMod),
        regressionModifier: round4(homeRegression),
      },
      away: {
        attackRecentOverallWeight: round4(awayAttackRate.weights.recentOverall),
        attackRecentVenueWeight: round4(awayAttackRate.weights.recentVenue),
        attackSeasonWeight: round4(awayAttackRate.weights.season),
        attackLeaguePriorWeight: round4(awayAttackRate.weights.leaguePrior),
        defenseRecentOverallWeight: round4(awayDefenseRate.weights.recentOverall),
        defenseRecentVenueWeight: round4(awayDefenseRate.weights.recentVenue),
        defenseSeasonWeight: round4(awayDefenseRate.weights.season),
        defenseLeaguePriorWeight: round4(awayDefenseRate.weights.leaguePrior),
        baseLambda: round4(awayLambdaResult.baseLambda),
        combinedModifier: round4(awayLambdaResult.combinedModifier),
        homeAdvantageAdjustment: round4(awayLambdaResult.homeAdvantageAdjustment),
        squadStrengthModifier: round4(awaySquadMod),
        formModifier: round4(awayFormMod),
        motivationModifier: round4(awayMotivationMod),
        contextModifier: round4(awayContextMod),
        h2hModifier: round4(awayH2hMod),
        fatigueModifier: round4(awayFatigueMod),
        regressionModifier: round4(awayRegression),
      },
    },
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
      homeAdvantage: homeAdvGoals,
      tacticalStyle: tactical.styleClash,
    },
    insights,
  };

  // Auto-save so subsequent page views hit the cache
  await savePrediction(result).catch(() => {});

  return result;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ─── CACHE RECONSTRUCTION ────────────────────────────────────

function parseStoredFeatureWeights(json: string): PredictionResult["featureWeights"] {
  const raw = JSON.parse(json || "{}") as Record<string, unknown>;
  if (
    raw.home &&
    raw.away &&
    typeof raw.home === "object" &&
    typeof raw.away === "object"
  ) {
    return raw as PredictionResult["featureWeights"];
  }
  const l = raw as Partial<{
    squadStrengthModifier: number;
    formModifier: number;
    motivationModifier: number;
    contextModifier: number;
    h2hModifier: number;
    fatigueModifier: number;
    regressionModifier: number;
  }>;
  return {
    home: {
      squadStrengthModifier: l.squadStrengthModifier ?? 1,
      formModifier: l.formModifier ?? 1,
      motivationModifier: l.motivationModifier ?? 1,
      contextModifier: l.contextModifier ?? 1,
      h2hModifier: l.h2hModifier ?? 1,
      fatigueModifier: l.fatigueModifier ?? 1,
      regressionModifier: l.regressionModifier ?? 1,
    },
    away: {
      squadStrengthModifier: 1,
      formModifier: 1,
      motivationModifier: 1,
      contextModifier: 1,
      h2hModifier: 1,
      fatigueModifier: 1,
      regressionModifier: 1,
    },
  };
}

function reconstructPredictionResult(
  cached: {
    fixtureId: number;
    modelVersion: string;
    createdAt: Date;
    updatedAt?: Date;
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
    scorelineProbabilities: string;
    htFtProbabilities: string;
    featureWeights: string;
    modelConfidence: number;
    topInsights: string;
    featureBreakdown: string;
  },
  fixtureId: number,
): PredictionResult {
  const scorelines: Record<string, number> = JSON.parse(cached.scorelineProbabilities || "{}");

  const topSorted = Object.entries(scorelines)
    .map(([key, prob]) => {
      const [h, a] = key.split("-").map(Number);
      return { home: h, away: a, prob };
    })
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 10);

  const defaultBreakdown: FeatureBreakdown = {
    homeAttack: 0, homeDefense: 0, awayAttack: 0, awayDefense: 0,
    homeForm: 0, awayForm: 0,
    h2h: { totalMeetings: 0, homeWinRate: 0.45, awayWinRate: 0.28, drawRate: 0.27, avgTotalGoals: 2.5, bttsRate: 0.5, over25Rate: 0.5, recentTrend: "neutral" },
    homeInjuryImpact: 0, awayInjuryImpact: 0,
    homeAdvantage: 0.25, tacticalStyle: "mixed",
  };

  let breakdown = defaultBreakdown;
  try {
    const parsed = JSON.parse(cached.featureBreakdown || "{}");
    if (parsed.homeAttack !== undefined) breakdown = parsed;
  } catch { /* use default */ }

  return {
    fixtureId,
    modelVersion: cached.modelVersion,
    probHomeWin: cached.probHomeWin,
    probDraw: cached.probDraw,
    probAwayWin: cached.probAwayWin,
    lambdaHome: cached.lambdaHome,
    lambdaAway: cached.lambdaAway,
    expectedTotalGoals: cached.expectedTotalGoals,
    probOver05: cached.probOver05,
    probOver15: cached.probOver15,
    probOver25: cached.probOver25,
    probOver35: cached.probOver35,
    probOver45: cached.probOver45,
    probBttsYes: cached.probBttsYes,
    probBttsNo: cached.probBttsNo,
    probHomeCs: cached.probHomeCs,
    probAwayCs: cached.probAwayCs,
    scorelineProbabilities: scorelines,
    htFtProbabilities: JSON.parse(cached.htFtProbabilities || "{}"),
    topScorelines: topSorted,
    modelConfidence: cached.modelConfidence,
    featureWeights: parseStoredFeatureWeights(cached.featureWeights),
    featureBreakdown: breakdown,
    insights: JSON.parse(cached.topInsights || "[]"),
  };
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
      featureBreakdown: JSON.stringify(pred.featureBreakdown),
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
      featureBreakdown: JSON.stringify(pred.featureBreakdown),
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
  homeVenueXg: number;
  awayVenueXga: number;
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
}

function generatePredictionInsights(ctx: InsightInput): string[] {
  const insights: string[] = [];

  // Attacking strength — use venue-specific xG when available
  if (ctx.homeVenueXg > 2.0)
    insights.push(`${ctx.homeTeamName} creates high-quality chances at home (${ctx.homeVenueXg.toFixed(2)} xG/game at home)`);
  else if (ctx.homeXgPerGame > 2.0)
    insights.push(`${ctx.homeTeamName} is a prolific attack (${ctx.homeXgPerGame.toFixed(2)} xG/game overall)`);

  if (ctx.awayVenueXga > 1.7)
    insights.push(`${ctx.awayTeamName} has been leaky away from home, conceding ${ctx.awayVenueXga.toFixed(2)} xG/game away`);
  else if (ctx.awayXgaPerGame > 1.7)
    insights.push(`${ctx.awayTeamName} has a porous defense (${ctx.awayXgaPerGame.toFixed(2)} xGA/game overall)`);

  if (ctx.awayXgPerGame > 1.8)
    insights.push(`${ctx.awayTeamName} carries attacking threat (${ctx.awayXgPerGame.toFixed(2)} xG/game overall)`);

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

  // Clean sheet sustainability
  if (ctx.homeSeasonStats) {
    const mp = ctx.homeSeasonStats.matchesPlayed ?? 1;
    const csRate = (ctx.homeSeasonStats.cleanSheets ?? 0) / mp;
    if (csRate > 0.45 && ctx.homeXgaPerGame > 1.0)
      insights.push(`⚠ ${ctx.homeTeamName}'s clean sheet rate (${(csRate * 100).toFixed(0)}%) looks unsustainably high relative to xG conceded`);
  }

  // BTTS from season stats (bttsCount may span home+away, so cap at matchesPlayed)
  if (ctx.homeSeasonStats && ctx.homeSeasonStats.matchesPlayed) {
    const mp = ctx.homeSeasonStats.matchesPlayed;
    const bttsRaw = ctx.homeSeasonStats.bttsCount ?? 0;
    const bttsPct = Math.min(1, bttsRaw / mp);
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
