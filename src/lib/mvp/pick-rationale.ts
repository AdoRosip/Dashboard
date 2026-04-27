import { prisma } from "../db";
import { MODEL_VERSION } from "../prediction/engine";
import { MVP_PRODUCTION_MARKET_MODEL_MAP } from "./model-routing";

type ProductionMarket = keyof typeof MVP_PRODUCTION_MARKET_MODEL_MAP;

type PickLike = {
  fixtureId: number;
  market: string;
  modelProb: number;
  modelConfidence: number;
  impliedProb: number;
  bestOdds: number;
  bestBookmaker: string;
  edgePct: number;
};

export interface ProductionPickRationale {
  modelSource: string;
  bookmakerCount: number;
  oddsAgeHours: number | null;
  dataQualityScore: number;
  summary: string[];
  topDrivers: string[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function parseInsights(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function toProductionMarket(market: string): ProductionMarket {
  if (market in MVP_PRODUCTION_MARKET_MODEL_MAP) {
    return market as ProductionMarket;
  }
  return "1x2_away";
}

function buildDataQualityScore(params: {
  modelConfidence: number;
  oddsAgeHours: number | null;
  bookmakerCount: number;
}): number {
  const freshnessScore =
    params.oddsAgeHours == null
      ? 0
      : params.oddsAgeHours <= 2
        ? 1
        : params.oddsAgeHours <= 6
          ? 0.85
          : params.oddsAgeHours <= 12
            ? 0.65
            : params.oddsAgeHours <= 24
              ? 0.35
              : 0.15;
  const coverageScore = clamp01(params.bookmakerCount / 6);
  return clamp01(params.modelConfidence * 0.45 + freshnessScore * 0.35 + coverageScore * 0.2);
}

export async function attachValuePickRationale<T extends PickLike>(
  picks: T[],
): Promise<Array<T & { rationale: ProductionPickRationale }>> {
  if (picks.length === 0) return [];

  const fixtureIds = Array.from(new Set(picks.map((pick) => pick.fixtureId)));
  const [predictions, snapshots] = await Promise.all([
    prisma.prediction.findMany({
      where: {
        fixtureId: { in: fixtureIds },
        modelVersion: MODEL_VERSION,
      },
      orderBy: [{ fixtureId: "asc" }, { updatedAt: "desc" }],
      select: {
        fixtureId: true,
        topInsights: true,
      },
    }),
    prisma.oddsSnapshot.findMany({
      where: {
        fixtureId: { in: fixtureIds },
        snapshotType: "current",
        market: "1x2",
      },
      select: {
        fixtureId: true,
        bookmaker: true,
        fetchedAt: true,
      },
    }),
  ]);

  const predictionByFixture = new Map<number, string[]>();
  for (const prediction of predictions) {
    if (!predictionByFixture.has(prediction.fixtureId)) {
      predictionByFixture.set(prediction.fixtureId, parseInsights(prediction.topInsights));
    }
  }

  const snapshotsByFixture = new Map<number, typeof snapshots>();
  for (const snapshot of snapshots) {
    const group = snapshotsByFixture.get(snapshot.fixtureId) ?? [];
    group.push(snapshot);
    snapshotsByFixture.set(snapshot.fixtureId, group);
  }

  return picks.map((pick) => {
    const marketSnapshots = snapshotsByFixture.get(pick.fixtureId) ?? [];
    const bestSnapshot =
      marketSnapshots.find((snapshot) => snapshot.bookmaker === pick.bestBookmaker) ?? null;
    const bookmakerCount = new Set(marketSnapshots.map((snapshot) => snapshot.bookmaker)).size;
    const oddsAgeHours =
      bestSnapshot != null
        ? (Date.now() - bestSnapshot.fetchedAt.getTime()) / (60 * 60 * 1000)
        : null;
    const expectedValue = pick.modelProb * pick.bestOdds - 1;

    return {
      ...pick,
      rationale: {
        modelSource: MVP_PRODUCTION_MARKET_MODEL_MAP[toProductionMarket(pick.market)],
        bookmakerCount,
        oddsAgeHours,
        dataQualityScore: buildDataQualityScore({
          modelConfidence: pick.modelConfidence,
          oddsAgeHours,
          bookmakerCount,
        }),
        summary: [
          `Edge +${pick.edgePct.toFixed(1)}% versus the de-vigged market.`,
          `EV ${(expectedValue * 100).toFixed(1)}% at ${pick.bestOdds.toFixed(2)} with ${pick.bestBookmaker}.`,
          `Confidence ${(pick.modelConfidence * 100).toFixed(0)}%; model ${(pick.modelProb * 100).toFixed(1)}% vs implied ${(pick.impliedProb * 100).toFixed(1)}%.`,
        ],
        topDrivers: (predictionByFixture.get(pick.fixtureId) ?? []).slice(0, 2),
      },
    };
  });
}
