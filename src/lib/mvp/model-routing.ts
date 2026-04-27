import { COMPETITIONS } from "../constants";
import { prisma } from "../db";
import { buildFeatureSnapshotForFixture, FEATURE_STORE_VERSION } from "../research/feature-store";
import {
  buildResearchDataset,
  buildResearchRowsFromSnapshotRow,
  type FeatureSnapshotRow,
  type MarketResearchRow,
} from "../research/datasets";
import { applyPlattCalibration, fitPlattCalibrator } from "../models/calibration";
import { predictLogisticRegression, trainLogisticRegression } from "../models/logistic";
import { predictMatch, type PredictionResult } from "../prediction/engine";
import {
  MVP_PRODUCTION_VALUE_MARKETS,
  MVP_SUPPORTED_COMPETITION_CODES,
  type MvpProductionValueMarket,
} from "./config";

type ResearchBackedMarket = "1x2_home" | "1x2_draw";
type ModelRoute = "engine_v2" | "research_calibrated_v3";

export const MVP_PRODUCTION_MODEL_ROUTING_VERSION =
  process.env.MVP_PRODUCTION_MODEL_ROUTING_VERSION ?? "mvp_model_map_v1";

export const MVP_PRODUCTION_MARKET_MODEL_MAP: Record<MvpProductionValueMarket, ModelRoute> = {
  "1x2_home": "research_calibrated_v3",
  "1x2_draw": "research_calibrated_v3",
  "1x2_away": "engine_v2",
};

interface PlattCalibrator {
  weight: number;
  bias: number;
}

interface RuntimeMarketModel {
  market: ResearchBackedMarket;
  competitions: string[];
  firstTrainTime: number;
  predictor: ReturnType<typeof trainLogisticRegression>;
  calibrator: PlattCalibrator;
  trainingSampleSize: number;
}

interface ProductionPredictionSources {
  "1x2_home": ModelRoute;
  "1x2_draw": ModelRoute;
  "1x2_away": ModelRoute;
}

export interface ProductionValuePrediction extends Pick<
  PredictionResult,
  "fixtureId" | "probHomeWin" | "probDraw" | "probAwayWin" | "probOver25" | "modelConfidence"
> {
  modelVersion: string;
  routingVersion: string;
  marketSources: ProductionPredictionSources;
}

type RuntimeModelCache = {
  builtAt: number;
  models: Partial<Record<ResearchBackedMarket, RuntimeMarketModel>>;
} | null;

let runtimeModelCache: RuntimeModelCache = null;
const CACHE_TTL_MS = 15 * 60 * 1000;

function numeric(value: number | null | undefined, fallback = 0): number {
  return Number.isFinite(value) ? Number(value) : fallback;
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

function splitModelAndCalibrationRows(rows: MarketResearchRow[]) {
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

function vectorizeMarketRow(
  row: MarketResearchRow,
  competitions: string[],
  firstTime: number,
): number[] {
  const f = row.modelFeatures;
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

  if (row.market === "1x2_draw") {
    const strengthDiff =
      (numeric(f.homeAttackVenue) - numeric(f.awayDefenseVenue)) -
      (numeric(f.awayAttackVenue) - numeric(f.homeDefenseVenue));
    return [
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
  }

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

  return [
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

function supportedCompetitionNames(): string[] {
  return COMPETITIONS.filter((competition) =>
    MVP_SUPPORTED_COMPETITION_CODES.includes(
      competition.code as (typeof MVP_SUPPORTED_COMPETITION_CODES)[number],
    ),
  ).map((competition) => competition.name);
}

async function buildRuntimeResearchModels(): Promise<Partial<Record<ResearchBackedMarket, RuntimeMarketModel>>> {
  const dataset = await buildResearchDataset({ limit: 5000 });
  const allowedCompetitions = new Set(supportedCompetitionNames());
  const supportedRows = dataset.filter((row) => allowedCompetitions.has(row.competition));
  const markets: ResearchBackedMarket[] = ["1x2_home", "1x2_draw"];
  const models: Partial<Record<ResearchBackedMarket, RuntimeMarketModel>> = {};

  for (const market of markets) {
    const rows = supportedRows
      .filter((row) => row.market === market)
      .slice()
      .sort((a, b) => new Date(a.asOfTime).getTime() - new Date(b.asOfTime).getTime());
    if (rows.length < 120) continue;

    const { modelTrainRows, calibrationRows } = splitModelAndCalibrationRows(rows);
    const competitions = competitionCatalog(rows);
    const firstTrainTime = new Date(rows[0]!.asOfTime).getTime();
    const latestTrainTime = new Date(modelTrainRows[modelTrainRows.length - 1]!.asOfTime).getTime();

    const predictor = trainLogisticRegression(
      modelTrainRows.map((row) => vectorizeMarketRow(row, competitions, firstTrainTime)),
      modelTrainRows.map((row) => row.outcome),
      {
        sampleWeights: modelTrainRows.map((row) => recencyWeight(row, latestTrainTime)),
      },
    );
    const calibration = fitPlattCalibrator(
      calibrationRows.map((row) =>
        predictLogisticRegression(predictor, vectorizeMarketRow(row, competitions, firstTrainTime)),
      ),
      calibrationRows.map((row) => row.outcome),
    );

    models[market] = {
      market,
      competitions,
      firstTrainTime,
      predictor,
      calibrator: calibration,
      trainingSampleSize: rows.length,
    };
  }

  return models;
}

async function getRuntimeResearchModels() {
  const now = Date.now();
  if (runtimeModelCache && now - runtimeModelCache.builtAt < CACHE_TTL_MS) {
    return runtimeModelCache.models;
  }

  const models = await buildRuntimeResearchModels();
  runtimeModelCache = {
    builtAt: now,
    models,
  };
  return models;
}

async function getFeatureRowsForFixture(fixtureId: number): Promise<MarketResearchRow[]> {
  await buildFeatureSnapshotForFixture(fixtureId, { mode: "forward" });
  const row = (await prisma.featureSnapshot.findUnique({
    where: {
      fixtureId_featureVersion_snapshotKind: {
        fixtureId,
        featureVersion: FEATURE_STORE_VERSION,
        snapshotKind: "prematch",
      },
    },
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
  })) as FeatureSnapshotRow | null;

  if (!row) {
    return [];
  }

  return buildResearchRowsFromSnapshotRow(row, { requireTargets: false });
}

function scoreResearchModel(
  model: RuntimeMarketModel,
  row: MarketResearchRow | undefined,
): number | null {
  if (!row) return null;
  const raw = predictLogisticRegression(
    model.predictor,
    vectorizeMarketRow(row, model.competitions, model.firstTrainTime),
  );
  return applyPlattCalibration(model.calibrator, raw);
}

export function normalizeProduction1x2Probs(input: {
  home: number;
  draw: number;
  away: number;
}): { home: number; draw: number; away: number } {
  const home = numeric(input.home);
  const draw = numeric(input.draw);
  const away = numeric(input.away);
  const sum = home + draw + away;

  if (sum <= 0) {
    throw new Error("Production 1X2 probabilities are invalid: sum is not positive.");
  }

  return {
    home: home / sum,
    draw: draw / sum,
    away: away / sum,
  };
}

export async function getProductionValuePrediction(
  fixtureId: number,
): Promise<ProductionValuePrediction> {
  const [enginePrediction, runtimeModels, featureRows] = await Promise.all([
    predictMatch(fixtureId),
    getRuntimeResearchModels(),
    getFeatureRowsForFixture(fixtureId),
  ]);

  const byMarket = new Map(featureRows.map((row) => [row.market, row]));

  const homeResearchProb = runtimeModels["1x2_home"]
    ? scoreResearchModel(runtimeModels["1x2_home"]!, byMarket.get("1x2_home"))
    : null;
  const drawResearchProb = runtimeModels["1x2_draw"]
    ? scoreResearchModel(runtimeModels["1x2_draw"]!, byMarket.get("1x2_draw"))
    : null;
  const normalized1x2 = normalizeProduction1x2Probs({
    home: homeResearchProb ?? enginePrediction.probHomeWin,
    draw: drawResearchProb ?? enginePrediction.probDraw,
    away: enginePrediction.probAwayWin,
  });

  return {
    fixtureId,
    modelVersion: `${enginePrediction.modelVersion}:${MVP_PRODUCTION_MODEL_ROUTING_VERSION}`,
    routingVersion: MVP_PRODUCTION_MODEL_ROUTING_VERSION,
    marketSources: {
      "1x2_home": homeResearchProb != null ? "research_calibrated_v3" : "engine_v2",
      "1x2_draw": drawResearchProb != null ? "research_calibrated_v3" : "engine_v2",
      "1x2_away": "engine_v2",
    },
    probHomeWin: normalized1x2.home,
    probDraw: normalized1x2.draw,
    probAwayWin: normalized1x2.away,
    probOver25: enginePrediction.probOver25,
    modelConfidence: enginePrediction.modelConfidence,
  };
}
