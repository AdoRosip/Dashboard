import { prisma } from "../db";
import {
  FEATURE_SOURCE_SNAPSHOT_SOURCES,
  SAFE_RESEARCH_SNAPSHOT_TRUST_LEVELS,
  type SnapshotTrust,
} from "./snapshot-trust";

export type SupportedResearchMarket = "1x2_home" | "1x2_draw" | "1x2_away" | "over25";

export interface MarketResearchRow {
  snapshotId: number;
  fixtureId: number;
  snapshotTrust: SnapshotTrust;
  leakageChecked: boolean;
  asOfTime: string;
  competition: string;
  market: SupportedResearchMarket;
  outcome: 0 | 1;
  marketProb: number | null;
  marketOdds: number | null;
  modelFeatures: {
    homeAttack: number;
    homeAttackVenue: number;
    homeAttackCompetition: number;
    awayAttack: number;
    awayAttackVenue: number;
    awayAttackCompetition: number;
    homeDefense: number;
    homeDefenseVenue: number;
    homeDefenseCompetition: number;
    awayDefense: number;
    awayDefenseVenue: number;
    awayDefenseCompetition: number;
    homeForm: number;
    homeFormAgainst: number;
    homeFormPoints: number;
    awayForm: number;
    awayFormAgainst: number;
    awayFormPoints: number;
    homeSquad: number;
    homeSquadXa: number;
    awaySquad: number;
    awaySquadXa: number;
    homeMotivation: number;
    awayMotivation: number;
    homeFatigue: number;
    awayFatigue: number;
    homeCongestionScore: number | null;
    awayCongestionScore: number | null;
    h2hHomeWinRate: number;
    h2hAwayWinRate: number;
    h2hDrawRate: number;
    h2hAvgGoals: number;
    h2hBttsRate: number;
    h2hOver25Rate: number;
    homeAdvantage: number;
    homeShotVolume: number;
    awayShotVolume: number;
    homeShotQuality: number;
    awayShotQuality: number;
    homeConversionRate: number;
    awayConversionRate: number;
    homePpda: number;
    awayPpda: number;
    homeCleanSheetRate: number;
    awayCleanSheetRate: number;
    homeXgOverperformance: number;
    awayXgOverperformance: number;
    homePenaltyTakerAvailable: number;
    awayPenaltyTakerAvailable: number;
    homeKeyPlayerAbsence: number;
    awayKeyPlayerAbsence: number;
    leaguePositionGap: number;
    daysSinceLastMatch: number;
    avgOverround: number | null;
    bookmakerCount: number;
    oddsAgeHours: number | null;
    daysToKickoff: number;
    hasAnyOdds: number;
    openingBookmakerCount: number;
    currentBookmakerCount: number;
    closingBookmakerCount: number;
    oddsSnapshotTotalCount: number;
    marketFreshnessScore: number;
  };
}

export type FeatureSnapshotRow = {
  id: number;
  fixtureId: number;
  asOfTime: Date;
  snapshotTrust: string;
  leakageChecked: boolean;
  sourceMaxTimestamp: Date | null;
  leakageWarningsJson: string;
  sourceTimestampsJson: string;
  featureJson: string;
  targetJson: string | null;
};

export interface BuildResearchDatasetParams {
  market?: SupportedResearchMarket;
  limit?: number;
  onlySettled?: boolean;
  trustLevels?: readonly SnapshotTrust[];
}

export const MIN_SAFE_BASELINE_ROWS_PER_MARKET = 80;

export type ResearchReadinessStatus = "ready" | "insufficient_safe_data";

function clamp01(n: number): number {
  return Math.max(0.001, Math.min(0.999, n));
}

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function buildResearchRowsFromSnapshotRow(
  row: FeatureSnapshotRow,
  options?: { requireTargets?: boolean },
): MarketResearchRow[] {
  const features = parseJson<Record<string, any>>(row.featureJson, {});
  const sourceTimestamps = parseJson<Record<string, any>>(row.sourceTimestampsJson, {});
  const targets = parseJson<Record<string, any> | null>(row.targetJson, null);
  if ((options?.requireTargets ?? true) && !targets) return [];
  const resolvedTargets = targets ?? {};

  const home = features.home ?? {};
  const away = features.away ?? {};
  const context = features.context ?? {};
  const h2h = features.h2h ?? {};
  const market = features.market ?? {};
  const baselines = market.baselines ?? {};
  const timelineCoverage = market.timelineCoverage ?? {};
  const latestOddsFetchAt = sourceTimestamps.latestOddsFetchAt
    ? new Date(String(sourceTimestamps.latestOddsFetchAt))
    : null;
  const kickoff = sourceTimestamps.kickoff ? new Date(String(sourceTimestamps.kickoff)) : row.asOfTime;
  const oddsAgeHours =
    latestOddsFetchAt && kickoff
      ? Math.max(0, (kickoff.getTime() - latestOddsFetchAt.getTime()) / (60 * 60 * 1000))
      : null;
  const openingBookmakerCount = Number(timelineCoverage.opening?.bookmakerCount ?? 0);
  const currentBookmakerCount = Number(timelineCoverage.current?.bookmakerCount ?? 0);
  const closingBookmakerCount = Number(timelineCoverage.closing?.bookmakerCount ?? 0);

  const baseFeatures = {
    homeAttack: Number(home.attackRatingOverall ?? 0),
    homeAttackVenue: Number(home.attackRatingVenue ?? home.attackRatingOverall ?? 0),
    homeAttackCompetition: Number(home.attackRatingCompetition ?? home.attackRatingOverall ?? 0),
    awayAttack: Number(away.attackRatingOverall ?? 0),
    awayAttackVenue: Number(away.attackRatingVenue ?? away.attackRatingOverall ?? 0),
    awayAttackCompetition: Number(away.attackRatingCompetition ?? away.attackRatingOverall ?? 0),
    homeDefense: Number(home.defenseRatingOverall ?? 0),
    homeDefenseVenue: Number(home.defenseRatingVenue ?? home.defenseRatingOverall ?? 0),
    homeDefenseCompetition: Number(home.defenseRatingCompetition ?? home.defenseRatingOverall ?? 0),
    awayDefense: Number(away.defenseRatingOverall ?? 0),
    awayDefenseVenue: Number(away.defenseRatingVenue ?? away.defenseRatingOverall ?? 0),
    awayDefenseCompetition: Number(away.defenseRatingCompetition ?? away.defenseRatingOverall ?? 0),
    homeForm: Number(home.formXgTrend ?? 0),
    homeFormAgainst: Number(home.formXgAgainstTrend ?? 0),
    homeFormPoints: Number(home.formPointsLast5 ?? 0),
    awayForm: Number(away.formXgTrend ?? 0),
    awayFormAgainst: Number(away.formXgAgainstTrend ?? 0),
    awayFormPoints: Number(away.formPointsLast5 ?? 0),
    homeSquad: 1 - Number(home.missingPlayersXgShare ?? 0),
    homeSquadXa: 1 - Number(home.missingPlayersXaShare ?? 0),
    awaySquad: 1 - Number(away.missingPlayersXgShare ?? 0),
    awaySquadXa: 1 - Number(away.missingPlayersXaShare ?? 0),
    homeMotivation: Number(context.homeMotivationModifier ?? 1),
    awayMotivation: Number(context.awayMotivationModifier ?? 1),
    homeFatigue: Number(context.homeFatigueModifier ?? 1),
    awayFatigue: Number(context.awayFatigueModifier ?? 1),
    homeCongestionScore:
      context.homeCongestionScore == null ? null : Number(context.homeCongestionScore),
    awayCongestionScore:
      context.awayCongestionScore == null ? null : Number(context.awayCongestionScore),
    h2hHomeWinRate: Number(h2h.homeWinRate ?? 0),
    h2hAwayWinRate: Number(h2h.awayWinRate ?? 0),
    h2hDrawRate: Number(h2h.drawRate ?? 0),
    h2hAvgGoals: Number(h2h.avgTotalGoals ?? 2.5),
    h2hBttsRate: Number(h2h.bttsRate ?? 0.5),
    h2hOver25Rate: Number(h2h.over25Rate ?? 0),
    homeAdvantage: Number(context.homeAdvantage ?? 0),
    homeShotVolume: Number(home.shotVolume ?? 0),
    awayShotVolume: Number(away.shotVolume ?? 0),
    homeShotQuality: Number(home.shotQuality ?? 0),
    awayShotQuality: Number(away.shotQuality ?? 0),
    homeConversionRate: Number(home.conversionRate ?? 1),
    awayConversionRate: Number(away.conversionRate ?? 1),
    homePpda: Number(home.ppda ?? 10),
    awayPpda: Number(away.ppda ?? 10),
    homeCleanSheetRate: Number(home.cleanSheetRate ?? 0),
    awayCleanSheetRate: Number(away.cleanSheetRate ?? 0),
    homeXgOverperformance: Number(home.xgOverperformance ?? 0),
    awayXgOverperformance: Number(away.xgOverperformance ?? 0),
    homePenaltyTakerAvailable: home.penaltyTakerAvailable ? 1 : 0,
    awayPenaltyTakerAvailable: away.penaltyTakerAvailable ? 1 : 0,
    homeKeyPlayerAbsence: home.keyPlayerAbsence ? 1 : 0,
    awayKeyPlayerAbsence: away.keyPlayerAbsence ? 1 : 0,
    leaguePositionGap: Number(context.leaguePositionGap ?? 0),
    daysSinceLastMatch: Number(context.daysSinceLastMatch ?? 7),
    avgOverround: market.avgOverround == null ? null : Number(market.avgOverround),
    bookmakerCount: Number(market.bookmakerCount ?? 0),
    oddsAgeHours,
    daysToKickoff: 0,
    hasAnyOdds: Number((market.oddsSnapshotTotalCount ?? 0) > 0),
    openingBookmakerCount,
    currentBookmakerCount,
    closingBookmakerCount,
    oddsSnapshotTotalCount: Number(market.oddsSnapshotTotalCount ?? 0),
    marketFreshnessScore:
      currentBookmakerCount > 0 && oddsAgeHours != null
        ? 1 / (1 + oddsAgeHours / 12)
        : 0,
  };

  return [
    {
      snapshotId: row.id,
      fixtureId: row.fixtureId,
      snapshotTrust: row.snapshotTrust as SnapshotTrust,
      leakageChecked: row.leakageChecked,
      asOfTime: row.asOfTime.toISOString(),
      competition: String(features.fixture?.competition ?? "unknown"),
      market: "1x2_home",
      outcome: resolvedTargets.homeWin ? 1 : 0,
      marketProb: baselines.current?.homeWin?.impliedProb ?? null,
      marketOdds: baselines.current?.homeWin?.odds ?? null,
      modelFeatures: baseFeatures,
    },
    {
      snapshotId: row.id,
      fixtureId: row.fixtureId,
      snapshotTrust: row.snapshotTrust as SnapshotTrust,
      leakageChecked: row.leakageChecked,
      asOfTime: row.asOfTime.toISOString(),
      competition: String(features.fixture?.competition ?? "unknown"),
      market: "1x2_draw",
      outcome: resolvedTargets.draw ? 1 : 0,
      marketProb: baselines.current?.draw?.impliedProb ?? null,
      marketOdds: baselines.current?.draw?.odds ?? null,
      modelFeatures: baseFeatures,
    },
    {
      snapshotId: row.id,
      fixtureId: row.fixtureId,
      snapshotTrust: row.snapshotTrust as SnapshotTrust,
      leakageChecked: row.leakageChecked,
      asOfTime: row.asOfTime.toISOString(),
      competition: String(features.fixture?.competition ?? "unknown"),
      market: "1x2_away",
      outcome: resolvedTargets.awayWin ? 1 : 0,
      marketProb: baselines.current?.awayWin?.impliedProb ?? null,
      marketOdds: baselines.current?.awayWin?.odds ?? null,
      modelFeatures: baseFeatures,
    },
    {
      snapshotId: row.id,
      fixtureId: row.fixtureId,
      snapshotTrust: row.snapshotTrust as SnapshotTrust,
      leakageChecked: row.leakageChecked,
      asOfTime: row.asOfTime.toISOString(),
      competition: String(features.fixture?.competition ?? "unknown"),
      market: "over25",
      outcome: resolvedTargets.over25 ? 1 : 0,
      marketProb: baselines.current?.over25?.impliedProb ?? null,
      marketOdds: baselines.current?.over25?.odds ?? null,
      modelFeatures: baseFeatures,
    },
  ];
}

export function researchSnapshotWhere(params?: BuildResearchDatasetParams) {
  const trustLevels = params?.trustLevels ?? SAFE_RESEARCH_SNAPSHOT_TRUST_LEVELS;
  return {
    ...(params?.onlySettled === false ? {} : { targetJson: { not: null } }),
    snapshotTrust: { in: [...trustLevels] },
  };
}

export async function buildResearchDataset(params?: BuildResearchDatasetParams) {
  const rows = (await prisma.featureSnapshot.findMany({
    where: researchSnapshotWhere(params),
    orderBy: { asOfTime: "desc" },
    take: params?.limit ?? 1000,
    select: {
      id: true,
      fixtureId: true,
      asOfTime: true,
      snapshotTrust: true,
      leakageChecked: true,
      sourceMaxTimestamp: true,
      leakageWarningsJson: true,
      featureJson: true,
      sourceTimestampsJson: true,
      targetJson: true,
    },
  })) as FeatureSnapshotRow[];

  const flattened = rows.flatMap((row) => buildResearchRowsFromSnapshotRow(row, { requireTargets: true }));
  return params?.market
    ? flattened.filter((row) => row.market === params.market)
    : flattened;
}

export function marketOnlyBaseline(row: MarketResearchRow): number {
  return row.marketProb == null ? 0.5 : clamp01(row.marketProb);
}

export function ratingsOnlyBaseline(row: MarketResearchRow): number {
  const f = row.modelFeatures;
  if (row.market === "over25") {
    const score =
      (f.homeAttack + f.awayAttack) -
      0.6 * (f.homeDefense + f.awayDefense) +
      0.5 * f.h2hOver25Rate +
      0.2 * (f.homeForm + f.awayForm);
    return clamp01(logistic((score - 1.2) * 1.1));
  }

  const homeStrength =
    f.homeAttack -
    0.6 * f.awayDefense +
    0.25 * f.homeAdvantage +
    0.18 * f.homeForm +
    0.12 * f.h2hHomeWinRate +
    0.08 * (f.homeMotivation - 1) -
    0.08 * (1 - f.homeFatigue);
  const awayStrength =
    f.awayAttack -
    0.6 * f.homeDefense +
    0.12 * f.awayForm +
    0.12 * f.h2hAwayWinRate +
    0.08 * (f.awayMotivation - 1) -
    0.08 * (1 - f.awayFatigue);
  const diff = homeStrength - awayStrength;

  if (row.market === "1x2_home") {
    return clamp01(logistic(diff * 1.2));
  }
  if (row.market === "1x2_away") {
    return clamp01(logistic(-diff * 1.2));
  }
  const drawBias = 1.15 - Math.abs(diff) + 0.35 * f.h2hDrawRate;
  return clamp01(logistic(drawBias * 0.9 - 0.4));
}

export function hybridBaseline(row: MarketResearchRow): number {
  const market = marketOnlyBaseline(row);
  const ratings = ratingsOnlyBaseline(row);
  const weight = row.market === "over25" ? 0.65 : 0.7;
  return clamp01(weight * market + (1 - weight) * ratings);
}

type BaselineMetrics = {
  brier: number;
  logLoss: number;
  sampleSize: number;
  coverage: number;
  avgPredictedProb: number;
  actualRate: number;
};

function scoreBaseline(
  rows: MarketResearchRow[],
  predictor: (row: MarketResearchRow) => number,
): BaselineMetrics {
  if (rows.length === 0) {
    return {
      brier: 0,
      logLoss: 0,
      sampleSize: 0,
      coverage: 0,
      avgPredictedProb: 0,
      actualRate: 0,
    };
  }

  let brier = 0;
  let logLoss = 0;
  let predicted = 0;
  let actual = 0;

  for (const row of rows) {
    const p = clamp01(predictor(row));
    const y = row.outcome;
    predicted += p;
    actual += y;
    brier += (p - y) ** 2;
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }

  return {
    brier: brier / rows.length,
    logLoss: logLoss / rows.length,
    sampleSize: rows.length,
    coverage: 1,
    avgPredictedProb: predicted / rows.length,
    actualRate: actual / rows.length,
  };
}

export async function evaluateBaselines(params?: {
  limit?: number;
  markets?: SupportedResearchMarket[];
  minSafeRowsPerMarket?: number;
}) {
  const markets = params?.markets ?? ["1x2_home", "1x2_draw", "1x2_away", "over25"];
  const rows = await buildResearchDataset({ limit: params?.limit ?? 2000 });
  const minSafeRowsPerMarket =
    params?.minSafeRowsPerMarket ?? MIN_SAFE_BASELINE_ROWS_PER_MARKET;

  return markets.map((market) => {
    const subset = rows.filter((row) => row.market === market);
    const withMarket = subset.filter((row) => row.marketProb != null);
    const status: ResearchReadinessStatus =
      subset.length >= minSafeRowsPerMarket ? "ready" : "insufficient_safe_data";
    const blockers =
      status === "ready"
        ? []
        : [
            `Only ${subset.length} safe ${market} row(s); ${minSafeRowsPerMarket} required.`,
          ];
    return {
      status,
      market,
      sampleSize: subset.length,
      minSafeRowsRequired: minSafeRowsPerMarket,
      blockers,
      marketCoverage: subset.length > 0 ? withMarket.length / subset.length : 0,
      marketOnly: scoreBaseline(withMarket, marketOnlyBaseline),
      ratingsOnly: scoreBaseline(subset, ratingsOnlyBaseline),
      hybrid: scoreBaseline(subset, hybridBaseline),
    };
  });
}

export { FEATURE_SOURCE_SNAPSHOT_SOURCES };
