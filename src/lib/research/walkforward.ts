import { prisma } from "../db";
import {
  buildResearchDataset,
  hybridBaseline,
  marketOnlyBaseline,
  ratingsOnlyBaseline,
  type MarketResearchRow,
  type SupportedResearchMarket,
} from "./datasets";
import { applyPlattCalibration, fitPlattCalibrator } from "../models/calibration";
import { predictLogisticRegression, trainLogisticRegression } from "../models/logistic";

type ModelKind = "ratings" | "hybrid";

export interface WalkforwardOptions {
  limit?: number;
  markets?: SupportedResearchMarket[];
  minTrainSize?: number;
  minTestSize?: number;
  maxFolds?: number;
  minSafeRows?: number;
}

export interface ProbabilityMetrics {
  brier: number;
  logLoss: number;
  sampleSize: number;
  avgPredictedProb: number;
  actualRate: number;
  coverage: number;
}

export interface WalkforwardFoldReport {
  fold: number;
  trainSize: number;
  testSize: number;
  trainFrom: string;
  trainTo: string;
  testFrom: string;
  testTo: string;
  marketCoverage: number;
  marketOnly: ProbabilityMetrics;
  ratingsBaseline: ProbabilityMetrics;
  hybridBaseline: ProbabilityMetrics;
  trainedRatings: ProbabilityMetrics;
  trainedHybrid: ProbabilityMetrics;
  calibratedRatings: ProbabilityMetrics;
  calibratedHybrid: ProbabilityMetrics;
}

export interface WalkforwardMarketReport {
  market: SupportedResearchMarket;
  sampleSize: number;
  folds: WalkforwardFoldReport[];
  aggregate: {
    foldCount: number;
    marketCoverage: number;
    marketOnly: ProbabilityMetrics;
    ratingsBaseline: ProbabilityMetrics;
    hybridBaseline: ProbabilityMetrics;
    trainedRatings: ProbabilityMetrics;
    trainedHybrid: ProbabilityMetrics;
    calibratedRatings: ProbabilityMetrics;
    calibratedHybrid: ProbabilityMetrics;
  };
}

function clamp01(n: number): number {
  return Math.max(0.001, Math.min(0.999, n));
}

function numeric(value: number | null | undefined, fallback = 0): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function avg(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function competitionCatalog(rows: MarketResearchRow[]): string[] {
  return Array.from(new Set(rows.map((row) => row.competition))).sort();
}

function recencyWeight(row: MarketResearchRow, latestTime: number): number {
  const ageDays = Math.max(
    0,
    (latestTime - new Date(row.asOfTime).getTime()) / (24 * 60 * 60 * 1000),
  );
  return 0.35 + 0.65 * Math.exp(-ageDays / 45);
}

function vectorizeResearchRow(
  row: MarketResearchRow,
  kind: ModelKind,
  competitions: string[],
  firstTime: number,
): number[] {
  const f = row.modelFeatures;
  const marketProb = row.marketProb == null ? 0.5 : row.marketProb;
  const marketOdds = row.marketOdds == null ? 2 : row.marketOdds;
  const asOfTime = new Date(row.asOfTime).getTime();
  const relativeDayIndex = Math.max(0, (asOfTime - firstTime) / (24 * 60 * 60 * 1000));
  const competitionFlags = competitions.map((competition) => (row.competition === competition ? 1 : 0));

  const shared = [
    numeric(f.avgOverround),
    numeric(f.bookmakerCount),
    numeric(f.oddsAgeHours, 72),
    numeric(f.daysToKickoff),
    numeric(f.hasAnyOdds),
    numeric(f.openingBookmakerCount),
    numeric(f.currentBookmakerCount),
    numeric(f.closingBookmakerCount),
    numeric(f.oddsSnapshotTotalCount),
    numeric(f.marketFreshnessScore),
    relativeDayIndex,
    ...competitionFlags,
  ];

  let base: number[];
  if (row.market === "over25") {
    base = [
      numeric(f.homeAttack),
      numeric(f.awayAttack),
      numeric(f.homeAttackVenue),
      numeric(f.awayAttackVenue),
      numeric(f.homeAttackCompetition),
      numeric(f.awayAttackCompetition),
      numeric(f.homeDefense),
      numeric(f.awayDefense),
      numeric(f.homeDefenseVenue),
      numeric(f.awayDefenseVenue),
      numeric(f.homeShotVolume + f.awayShotVolume),
      numeric((f.homeShotQuality + f.awayShotQuality) / 2),
      numeric((f.homeConversionRate + f.awayConversionRate) / 2),
      numeric(f.homeForm + f.awayForm),
      numeric(f.homeFormAgainst + f.awayFormAgainst),
      numeric(f.homeFormPoints + f.awayFormPoints),
      numeric(f.h2hAvgGoals),
      numeric(f.h2hBttsRate),
      numeric(f.h2hOver25Rate),
      numeric(f.homeCleanSheetRate + f.awayCleanSheetRate),
      numeric(f.homeXgOverperformance + f.awayXgOverperformance),
      numeric((f.homePpda + f.awayPpda) / 2),
      numeric(Math.abs(f.homePpda - f.awayPpda)),
      numeric(f.homeSquad + f.awaySquad),
      numeric(f.homeSquadXa + f.awaySquadXa),
      numeric(f.homePenaltyTakerAvailable + f.awayPenaltyTakerAvailable),
      numeric(f.homeKeyPlayerAbsence + f.awayKeyPlayerAbsence),
      numeric(f.homeMotivation + f.awayMotivation),
      numeric(f.homeFatigue + f.awayFatigue),
      numeric(f.homeCongestionScore) + numeric(f.awayCongestionScore),
      ...shared,
    ];
  } else if (row.market === "1x2_draw") {
    const strengthDiff =
      (numeric(f.homeAttackVenue) - numeric(f.awayDefenseVenue)) -
      (numeric(f.awayAttackVenue) - numeric(f.homeDefenseVenue));
    base = [
      numeric(Math.abs(strengthDiff)),
      numeric(Math.abs(f.homeAttack - f.awayAttack)),
      numeric(Math.abs(f.homeDefense - f.awayDefense)),
      numeric(Math.abs(f.homeForm - f.awayForm)),
      numeric(Math.abs(f.homeFormPoints - f.awayFormPoints)),
      numeric(f.h2hDrawRate),
      numeric(f.h2hAvgGoals),
      numeric(f.h2hBttsRate),
      numeric(f.homeCleanSheetRate + f.awayCleanSheetRate),
      numeric((f.homePpda + f.awayPpda) / 2),
      numeric(Math.abs(f.homePpda - f.awayPpda)),
      numeric(Math.abs(f.homeSquad - f.awaySquad)),
      numeric(Math.abs(f.homeSquadXa - f.awaySquadXa)),
      numeric(Math.abs(f.homeMotivation - f.awayMotivation)),
      numeric(Math.abs(f.homeFatigue - f.awayFatigue)),
      numeric(f.leaguePositionGap),
      numeric(f.homeAdvantage),
      ...shared,
    ];
  } else {
    const homeStrength =
      numeric(f.homeAttackVenue) +
      numeric(f.homeAttackCompetition) -
      numeric(f.awayDefenseVenue) -
      numeric(f.awayDefenseCompetition);
    const awayStrength =
      numeric(f.awayAttackVenue) +
      numeric(f.awayAttackCompetition) -
      numeric(f.homeDefenseVenue) -
      numeric(f.homeDefenseCompetition);
    base = [
      homeStrength,
      awayStrength,
      homeStrength - awayStrength,
      numeric(f.homeAttack - f.awayAttack),
      numeric(f.awayDefense - f.homeDefense),
      numeric(f.homeForm - f.awayForm),
      numeric(f.homeFormAgainst - f.awayFormAgainst),
      numeric(f.homeFormPoints - f.awayFormPoints),
      numeric(f.homeSquad - f.awaySquad),
      numeric(f.homeSquadXa - f.awaySquadXa),
      numeric(f.homeMotivation - f.awayMotivation),
      numeric(f.homeFatigue - f.awayFatigue),
      numeric(f.homeCongestionScore) - numeric(f.awayCongestionScore),
      numeric(f.h2hHomeWinRate - f.h2hAwayWinRate),
      numeric(f.h2hDrawRate),
      numeric(f.homeShotVolume - f.awayShotVolume),
      numeric(f.homeShotQuality - f.awayShotQuality),
      numeric(f.homeConversionRate - f.awayConversionRate),
      numeric(f.homePpda - f.awayPpda),
      numeric(f.homeCleanSheetRate - f.awayCleanSheetRate),
      numeric(f.homeXgOverperformance - f.awayXgOverperformance),
      numeric(f.homePenaltyTakerAvailable - f.awayPenaltyTakerAvailable),
      numeric(f.homeKeyPlayerAbsence - f.awayKeyPlayerAbsence),
      numeric(f.leaguePositionGap),
      numeric(f.homeAdvantage),
      ...shared,
    ];
  }

  if (kind === "ratings") {
    return base;
  }

  return [
    ...base,
    marketProb,
    marketOdds,
    row.marketProb == null ? 0 : 1,
    marketProb * marketOdds,
  ];
}

function scoreRows(
  rows: MarketResearchRow[],
  predictor: (row: MarketResearchRow) => number | null,
): ProbabilityMetrics {
  if (rows.length === 0) {
    return {
      brier: 0,
      logLoss: 0,
      sampleSize: 0,
      avgPredictedProb: 0,
      actualRate: 0,
      coverage: 0,
    };
  }

  const predictions = rows
    .map((row) => ({ row, pred: predictor(row) }))
    .filter((item) => item.pred != null) as Array<{ row: MarketResearchRow; pred: number }>;

  if (predictions.length === 0) {
    return {
      brier: 0,
      logLoss: 0,
      sampleSize: 0,
      avgPredictedProb: 0,
      actualRate: 0,
      coverage: 0,
    };
  }

  let brier = 0;
  let logLoss = 0;
  let predicted = 0;
  let actual = 0;

  for (const item of predictions) {
    const p = clamp01(item.pred);
    const y = item.row.outcome;
    predicted += p;
    actual += y;
    brier += (p - y) ** 2;
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }

  return {
    brier: brier / predictions.length,
    logLoss: logLoss / predictions.length,
    sampleSize: predictions.length,
    avgPredictedProb: predicted / predictions.length,
    actualRate: actual / predictions.length,
    coverage: predictions.length / rows.length,
  };
}

function aggregateMetrics(metrics: ProbabilityMetrics[]): ProbabilityMetrics {
  const totalSampleSize = metrics.reduce((sum, metric) => sum + metric.sampleSize, 0);
  if (totalSampleSize === 0) {
    return {
      brier: 0,
      logLoss: 0,
      sampleSize: 0,
      avgPredictedProb: 0,
      actualRate: 0,
      coverage: avg(metrics.map((metric) => metric.coverage)),
    };
  }

  const weighted = <K extends keyof ProbabilityMetrics>(key: K): number =>
    metrics.reduce((sum, metric) => sum + metric[key] * metric.sampleSize, 0) / totalSampleSize;

  return {
    brier: weighted("brier"),
    logLoss: weighted("logLoss"),
    sampleSize: totalSampleSize,
    avgPredictedProb: weighted("avgPredictedProb"),
    actualRate: weighted("actualRate"),
    coverage: avg(metrics.map((metric) => metric.coverage)),
  };
}

function buildFoldStarts(total: number, minTrainSize: number, minTestSize: number, maxFolds: number): number[] {
  const remaining = total - minTrainSize;
  if (remaining < minTestSize) return [];
  const testSize = Math.max(minTestSize, Math.floor(remaining / maxFolds));
  const starts: number[] = [];
  let trainEnd = minTrainSize;
  while (trainEnd + minTestSize <= total && starts.length < maxFolds) {
    starts.push(trainEnd);
    trainEnd += testSize;
  }
  return starts;
}

function splitModelAndCalibrationRows(rows: MarketResearchRow[]): {
  modelTrainRows: MarketResearchRow[];
  calibrationRows: MarketResearchRow[];
} {
  const calibrationSize = Math.max(30, Math.floor(rows.length * 0.2));
  const calibrationStart = Math.max(0, rows.length - calibrationSize);
  const calibrationRows = rows.slice(calibrationStart);
  const modelTrainRows = rows.slice(0, calibrationStart);

  if (modelTrainRows.length < 60) {
    return {
      modelTrainRows: rows,
      calibrationRows: rows,
    };
  }

  return { modelTrainRows, calibrationRows };
}

async function evaluateWalkforwardMarket(
  market: SupportedResearchMarket,
  rows: MarketResearchRow[],
  options: Required<WalkforwardOptions>,
): Promise<WalkforwardMarketReport> {
  const ordered = rows
    .filter((row) => row.market === market)
    .slice()
    .sort((a, b) => new Date(a.asOfTime).getTime() - new Date(b.asOfTime).getTime());

  const foldStarts = buildFoldStarts(
    ordered.length,
    options.minTrainSize,
    options.minTestSize,
    options.maxFolds,
  );

  const folds: WalkforwardFoldReport[] = [];

  for (let idx = 0; idx < foldStarts.length; idx++) {
    const trainEnd = foldStarts[idx]!;
    const nextStart = foldStarts[idx + 1] ?? ordered.length;
    const testEnd = Math.min(ordered.length, Math.max(trainEnd + options.minTestSize, nextStart));
    const trainRows = ordered.slice(0, trainEnd);
    const testRows = ordered.slice(trainEnd, testEnd);
    if (trainRows.length < options.minTrainSize || testRows.length < options.minTestSize) continue;

    const { modelTrainRows, calibrationRows } = splitModelAndCalibrationRows(trainRows);
    const competitions = competitionCatalog(trainRows);
    const firstTrainTime = new Date(trainRows[0]!.asOfTime).getTime();
    const latestModelTrainTime = new Date(modelTrainRows[modelTrainRows.length - 1]!.asOfTime).getTime();

    const ratingsModel = trainLogisticRegression(
      modelTrainRows.map((row) => vectorizeResearchRow(row, "ratings", competitions, firstTrainTime)),
      modelTrainRows.map((row) => row.outcome),
      {
        sampleWeights: modelTrainRows.map((row) => recencyWeight(row, latestModelTrainTime)),
      },
    );
    const hybridModel = trainLogisticRegression(
      modelTrainRows.map((row) => vectorizeResearchRow(row, "hybrid", competitions, firstTrainTime)),
      modelTrainRows.map((row) => row.outcome),
      {
        sampleWeights: modelTrainRows.map((row) => recencyWeight(row, latestModelTrainTime)),
      },
    );

    const ratingsCalibration = fitPlattCalibrator(
      calibrationRows.map((row) =>
        predictLogisticRegression(
          ratingsModel,
          vectorizeResearchRow(row, "ratings", competitions, firstTrainTime),
        ),
      ),
      calibrationRows.map((row) => row.outcome),
    );
    const hybridCalibration = fitPlattCalibrator(
      calibrationRows.map((row) =>
        predictLogisticRegression(
          hybridModel,
          vectorizeResearchRow(row, "hybrid", competitions, firstTrainTime),
        ),
      ),
      calibrationRows.map((row) => row.outcome),
    );

    folds.push({
      fold: idx + 1,
      trainSize: trainRows.length,
      testSize: testRows.length,
      trainFrom: trainRows[0]!.asOfTime,
      trainTo: trainRows[trainRows.length - 1]!.asOfTime,
      testFrom: testRows[0]!.asOfTime,
      testTo: testRows[testRows.length - 1]!.asOfTime,
      marketCoverage: testRows.filter((row) => row.marketProb != null).length / testRows.length,
      marketOnly: scoreRows(testRows, (row) => (row.marketProb == null ? null : marketOnlyBaseline(row))),
      ratingsBaseline: scoreRows(testRows, ratingsOnlyBaseline),
      hybridBaseline: scoreRows(testRows, hybridBaseline),
      trainedRatings: scoreRows(testRows, (row) =>
        predictLogisticRegression(
          ratingsModel,
          vectorizeResearchRow(row, "ratings", competitions, firstTrainTime),
        ),
      ),
      trainedHybrid: scoreRows(testRows, (row) =>
        predictLogisticRegression(
          hybridModel,
          vectorizeResearchRow(row, "hybrid", competitions, firstTrainTime),
        ),
      ),
      calibratedRatings: scoreRows(testRows, (row) =>
        applyPlattCalibration(
          ratingsCalibration,
          predictLogisticRegression(
            ratingsModel,
            vectorizeResearchRow(row, "ratings", competitions, firstTrainTime),
          ),
        ),
      ),
      calibratedHybrid: scoreRows(testRows, (row) =>
        applyPlattCalibration(
          hybridCalibration,
          predictLogisticRegression(
            hybridModel,
            vectorizeResearchRow(row, "hybrid", competitions, firstTrainTime),
          ),
        ),
      ),
    });
  }

  return {
    market,
    sampleSize: ordered.length,
    folds,
    aggregate: {
      foldCount: folds.length,
      marketCoverage: avg(folds.map((fold) => fold.marketCoverage)),
      marketOnly: aggregateMetrics(folds.map((fold) => fold.marketOnly)),
      ratingsBaseline: aggregateMetrics(folds.map((fold) => fold.ratingsBaseline)),
      hybridBaseline: aggregateMetrics(folds.map((fold) => fold.hybridBaseline)),
      trainedRatings: aggregateMetrics(folds.map((fold) => fold.trainedRatings)),
      trainedHybrid: aggregateMetrics(folds.map((fold) => fold.trainedHybrid)),
      calibratedRatings: aggregateMetrics(folds.map((fold) => fold.calibratedRatings)),
      calibratedHybrid: aggregateMetrics(folds.map((fold) => fold.calibratedHybrid)),
    },
  };
}

export async function runWalkforwardEvaluation(options?: WalkforwardOptions) {
  const version = "hybrid_logistic_v3";
  const params: Required<WalkforwardOptions> = {
    limit: options?.limit ?? 5000,
    markets: options?.markets ?? ["1x2_home", "1x2_draw", "1x2_away", "over25"],
    minTrainSize: options?.minTrainSize ?? 160,
    minTestSize: options?.minTestSize ?? 40,
    maxFolds: options?.maxFolds ?? 5,
    minSafeRows: options?.minSafeRows ?? 200,
  };

  const run = await prisma.researchRun.create({
    data: {
      runType: "walkforward_evaluation",
      version,
      paramsJson: JSON.stringify(params),
    },
    select: { id: true },
  });

  try {
    const rows = await buildResearchDataset({ limit: params.limit });
    if (rows.length < params.minSafeRows) {
      await prisma.researchRun.update({
        where: { id: run.id },
        data: {
          status: "completed",
          rowCount: rows.length,
          errorMessage: `Insufficient safe data: ${rows.length}/${params.minSafeRows} row(s).`,
          completedAt: new Date(),
        },
      });

      return {
        runId: run.id,
        version,
        generatedAt: new Date().toISOString(),
        status: "insufficient_safe_data" as const,
        blockers: [
          `Only ${rows.length} safe research row(s); ${params.minSafeRows} required.`,
        ],
        params,
        markets: [],
      };
    }

    const markets = await Promise.all(
      params.markets.map((market) => evaluateWalkforwardMarket(market, rows, params)),
    );

    await prisma.researchRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        rowCount: rows.length,
        completedAt: new Date(),
      },
    });

    return {
      runId: run.id,
      version,
      generatedAt: new Date().toISOString(),
      status: "ready" as const,
      blockers: [],
      params,
      markets,
    };
  } catch (error) {
    await prisma.researchRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        completedAt: new Date(),
      },
    });
    throw error;
  }
}
