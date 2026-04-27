import { prisma } from "../db";
import {
  resolveProfitLossForAggregate,
  resolveStakeForSettlement,
  expectedValuePerUnitStake,
} from "./stake-units";
import { MVP_PRODUCTION_POLICY } from "../mvp/policy";

type SettledBetDecisionBacktestRow = {
  id: number;
  market: string;
  modelProb: number;
  modelConfidence: number;
  bestOdds: number;
  edge: number;
  edgePct: number;
  rating: number | null;
  stakeUnits: number | null;
  profitLoss: number | null;
  outcome: string | null;
  closingLineValue: number | null;
  fixture: {
    competitionId: string;
  };
};

export interface BacktestBandSummary {
  label: string;
  min: number;
  max: number | null;
  picks: number;
  wins: number;
  losses: number;
  stake: number;
  profitLoss: number;
  roi: number;
  hitRate: number;
  avgOdds: number;
  avgEdgePct: number;
  avgExpectedValuePct: number;
  avgConfidencePct: number;
  avgClosingLineValuePct: number | null;
}

export interface BacktestThresholdSummary {
  label: string;
  threshold: number;
  picks: number;
  wins: number;
  losses: number;
  stake: number;
  profitLoss: number;
  roi: number;
  hitRate: number;
}

export interface ValueBacktestReport {
  sampleSize: number;
  gradedPicks: number;
  generatedAt: string;
  currentPolicy: {
    minEdge: number;
    minExpectedValue: number;
    minModelConfidence: number;
    minModelProb: number;
    minOdds: number;
  };
  overall: {
    picks: number;
    wins: number;
    losses: number;
    stake: number;
    profitLoss: number;
    roi: number;
    hitRate: number;
    avgEdgePct: number;
    avgExpectedValuePct: number;
    avgConfidencePct: number;
    avgClosingLineValuePct: number | null;
  };
  bands: {
    edgePct: BacktestBandSummary[];
    expectedValuePct: BacktestBandSummary[];
    confidencePct: BacktestBandSummary[];
    odds: BacktestBandSummary[];
  };
  thresholds: {
    minEdgePct: BacktestThresholdSummary[];
    minExpectedValuePct: BacktestThresholdSummary[];
    minConfidencePct: BacktestThresholdSummary[];
  };
}

type AnalyticPick = {
  market: string;
  competitionId: string;
  edgePct: number;
  expectedValuePct: number;
  confidencePct: number;
  bestOdds: number;
  stake: number;
  profitLoss: number;
  won: boolean;
  lost: boolean;
  closingLineValuePct: number | null;
};

const EDGE_BANDS = [
  { label: "<3%", min: Number.NEGATIVE_INFINITY, max: 3 },
  { label: "3-5%", min: 3, max: 5 },
  { label: "5-8%", min: 5, max: 8 },
  { label: "8-12%", min: 8, max: 12 },
  { label: "12%+", min: 12, max: null },
] as const;

const EV_BANDS = [
  { label: "<0%", min: Number.NEGATIVE_INFINITY, max: 0 },
  { label: "0-3%", min: 0, max: 3 },
  { label: "3-6%", min: 3, max: 6 },
  { label: "6-10%", min: 6, max: 10 },
  { label: "10%+", min: 10, max: null },
] as const;

const CONFIDENCE_BANDS = [
  { label: "<35%", min: Number.NEGATIVE_INFINITY, max: 35 },
  { label: "35-45%", min: 35, max: 45 },
  { label: "45-55%", min: 45, max: 55 },
  { label: "55-65%", min: 55, max: 65 },
  { label: "65%+", min: 65, max: null },
] as const;

const ODDS_BANDS = [
  { label: "<1.50", min: Number.NEGATIVE_INFINITY, max: 1.5 },
  { label: "1.50-2.00", min: 1.5, max: 2 },
  { label: "2.00-2.50", min: 2, max: 2.5 },
  { label: "2.50-3.50", min: 2.5, max: 3.5 },
  { label: "3.50+", min: 3.5, max: null },
] as const;

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function matchesBand(value: number, band: { min: number; max: number | null }): boolean {
  return value >= band.min && (band.max == null || value < band.max);
}

function summarizePicks(
  label: string,
  min: number,
  max: number | null,
  picks: AnalyticPick[],
): BacktestBandSummary {
  const stake = picks.reduce((sum, pick) => sum + pick.stake, 0);
  const profitLoss = picks.reduce((sum, pick) => sum + pick.profitLoss, 0);
  const wins = picks.filter((pick) => pick.won).length;
  const losses = picks.filter((pick) => pick.lost).length;
  const clvValues = picks
    .map((pick) => pick.closingLineValuePct)
    .filter((value): value is number => value != null);

  return {
    label,
    min,
    max,
    picks: picks.length,
    wins,
    losses,
    stake,
    profitLoss,
    roi: stake > 0 ? (profitLoss / stake) * 100 : 0,
    hitRate: wins + losses > 0 ? wins / (wins + losses) : 0,
    avgOdds: average(picks.map((pick) => pick.bestOdds)),
    avgEdgePct: average(picks.map((pick) => pick.edgePct)),
    avgExpectedValuePct: average(picks.map((pick) => pick.expectedValuePct)),
    avgConfidencePct: average(picks.map((pick) => pick.confidencePct)),
    avgClosingLineValuePct: clvValues.length > 0 ? average(clvValues) : null,
  };
}

function summarizeThreshold(
  label: string,
  threshold: number,
  picks: AnalyticPick[],
): BacktestThresholdSummary {
  const stake = picks.reduce((sum, pick) => sum + pick.stake, 0);
  const profitLoss = picks.reduce((sum, pick) => sum + pick.profitLoss, 0);
  const wins = picks.filter((pick) => pick.won).length;
  const losses = picks.filter((pick) => pick.lost).length;

  return {
    label,
    threshold,
    picks: picks.length,
    wins,
    losses,
    stake,
    profitLoss,
    roi: stake > 0 ? (profitLoss / stake) * 100 : 0,
    hitRate: wins + losses > 0 ? wins / (wins + losses) : 0,
  };
}

export async function buildValueBacktestReport(): Promise<ValueBacktestReport> {
  const settled = (await prisma.betDecision.findMany({
    where: {
      settled: true,
      outcome: { in: ["win", "loss"] },
      profitLoss: { not: null },
    },
    include: {
      fixture: {
        select: { competitionId: true },
      },
    },
    orderBy: { settledAt: "desc" },
  })) as SettledBetDecisionBacktestRow[];

  const picks: AnalyticPick[] = settled.map((pick) => {
    const stake = resolveStakeForSettlement({
      stakeUnits: pick.stakeUnits,
      rating: pick.rating ?? 1,
      modelProb: pick.modelProb,
      bestOdds: pick.bestOdds,
    });
    const profitLoss = resolveProfitLossForAggregate({
      stakeUnits: pick.stakeUnits,
      quarterKelly: 0,
      profitLoss: pick.profitLoss,
      outcome: pick.outcome,
      bestOdds: pick.bestOdds,
      rating: pick.rating ?? 1,
      modelProb: pick.modelProb,
    });

    return {
      market: pick.market,
      competitionId: pick.fixture.competitionId,
      edgePct: pick.edgePct,
      expectedValuePct: expectedValuePerUnitStake(pick.modelProb, pick.bestOdds) * 100,
      confidencePct: pick.modelConfidence * 100,
      bestOdds: pick.bestOdds,
      stake,
      profitLoss,
      won: pick.outcome === "win",
      lost: pick.outcome === "loss",
      closingLineValuePct:
        pick.closingLineValue != null ? pick.closingLineValue * 100 : null,
    };
  });

  const overall = summarizePicks("all", 0, null, picks);
  const edgeThresholds = [2, 3, 4, 5, 7, 10];
  const evThresholds = [0, 2, 4, 6, 8];
  const confidenceThresholds = [25, 35, 45, 55, 65];

  return {
    sampleSize: settled.length,
    gradedPicks: picks.length,
    generatedAt: new Date().toISOString(),
    currentPolicy: {
      minEdge: MVP_PRODUCTION_POLICY.minEdge,
      minExpectedValue: MVP_PRODUCTION_POLICY.minExpectedValue,
      minModelConfidence: MVP_PRODUCTION_POLICY.minModelConfidence,
      minModelProb: MVP_PRODUCTION_POLICY.minModelProb,
      minOdds: MVP_PRODUCTION_POLICY.minOdds,
    },
    overall: {
      picks: overall.picks,
      wins: overall.wins,
      losses: overall.losses,
      stake: overall.stake,
      profitLoss: overall.profitLoss,
      roi: overall.roi,
      hitRate: overall.hitRate,
      avgEdgePct: overall.avgEdgePct,
      avgExpectedValuePct: overall.avgExpectedValuePct,
      avgConfidencePct: overall.avgConfidencePct,
      avgClosingLineValuePct: overall.avgClosingLineValuePct,
    },
    bands: {
      edgePct: EDGE_BANDS.map((band) =>
        summarizePicks(
          band.label,
          band.min,
          band.max,
          picks.filter((pick) => matchesBand(pick.edgePct, band)),
        ),
      ),
      expectedValuePct: EV_BANDS.map((band) =>
        summarizePicks(
          band.label,
          band.min,
          band.max,
          picks.filter((pick) => matchesBand(pick.expectedValuePct, band)),
        ),
      ),
      confidencePct: CONFIDENCE_BANDS.map((band) =>
        summarizePicks(
          band.label,
          band.min,
          band.max,
          picks.filter((pick) => matchesBand(pick.confidencePct, band)),
        ),
      ),
      odds: ODDS_BANDS.map((band) =>
        summarizePicks(
          band.label,
          band.min,
          band.max,
          picks.filter((pick) => matchesBand(pick.bestOdds, band)),
        ),
      ),
    },
    thresholds: {
      minEdgePct: edgeThresholds.map((threshold) =>
        summarizeThreshold(
          `edge >= ${threshold}%`,
          threshold,
          picks.filter((pick) => pick.edgePct >= threshold),
        ),
      ),
      minExpectedValuePct: evThresholds.map((threshold) =>
        summarizeThreshold(
          `EV >= ${threshold}%`,
          threshold,
          picks.filter((pick) => pick.expectedValuePct >= threshold),
        ),
      ),
      minConfidencePct: confidenceThresholds.map((threshold) =>
        summarizeThreshold(
          `confidence >= ${threshold}%`,
          threshold,
          picks.filter((pick) => pick.confidencePct >= threshold),
        ),
      ),
    },
  };
}
