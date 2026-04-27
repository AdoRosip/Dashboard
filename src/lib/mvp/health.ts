import { prisma } from "../db";
import { buildResearchReadinessReport } from "../research/readiness";
import { oddsSportKeyForCompetition } from "../odds/sport-keys";
import { getProductionValuePrediction } from "./model-routing";
import {
  MVP_PRODUCTION_VALUE_MARKETS,
  MVP_SUPPORTED_COMPETITION_CODES,
} from "./config";

export const MVP_PRODUCT_HEALTH_VERSION =
  process.env.MVP_PRODUCT_HEALTH_VERSION ?? "mvp_health_v1";

export const MVP_PRODUCT_HEALTH_THRESHOLDS = {
  maxCaptureAgeHours: 12,
  minUpcomingOddsCoverage: 0.6,
  minPredictionCoverage: 0.85,
  minFixtureMatchRate: 0.65,
  maxDuplicateFinishedFixtureGroups: 0,
} as const;

type HealthState = "healthy" | "degraded" | "blocked";

export interface MvpProductHealthReport {
  generatedAt: string;
  version: string;
  status: HealthState;
  canPublish: boolean;
  blockers: string[];
  warnings: string[];
  scope: {
    competitions: string[];
    markets: string[];
  };
  thresholds: typeof MVP_PRODUCT_HEALTH_THRESHOLDS;
  summary: {
    upcomingFixtures: number;
    fixturesWithCurrentOdds: number;
    upcomingOddsCoverage: number;
    fixturesWithPrediction: number;
    predictionCoverage: number;
    latestSuccessfulCaptureAt: string | null;
    latestSuccessfulCaptureAgeHours: number | null;
    latestCaptureMatchRate: number | null;
    historicalMarketTrainingReady: boolean;
    capturePipelineHealthy: boolean;
    duplicateFinishedFixtureGroups: number;
  };
}

interface CaptureSportResult {
  sportKey?: string;
  fixturesTargeted?: number;
  fixturesMatched?: number;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function getScopedCaptureMatchRate(
  sportResultsJson: string,
  scopeSportKeys: readonly string[],
): number | null {
  const scope = new Set(scopeSportKeys);
  const sportResults = safeJsonParse(sportResultsJson, [] as CaptureSportResult[]);
  const scoped = sportResults.filter((row) => row.sportKey && scope.has(row.sportKey));
  const fixturesTargeted = scoped.reduce((sum, row) => sum + (row.fixturesTargeted ?? 0), 0);
  const fixturesMatched = scoped.reduce((sum, row) => sum + (row.fixturesMatched ?? 0), 0);
  return fixturesTargeted > 0 ? fixturesMatched / fixturesTargeted : null;
}

async function countDuplicateFinishedFixtureGroups(): Promise<number> {
  const fixtures = await prisma.fixture.findMany({
    where: {
      competitionId: { in: [...MVP_SUPPORTED_COMPETITION_CODES] },
      status: "FINISHED",
      scoreHomeFt: { not: null },
      scoreAwayFt: { not: null },
    },
    select: {
      competitionId: true,
      homeTeamId: true,
      awayTeamId: true,
      utcDate: true,
    },
  });

  const counts = new Map<string, number>();
  for (const fixture of fixtures) {
    const day = fixture.utcDate.toISOString().slice(0, 10);
    const key = [
      fixture.competitionId,
      fixture.homeTeamId,
      fixture.awayTeamId,
      day,
    ].join("|");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from(counts.values()).filter((count) => count > 1).length;
}

export async function getMvpProductHealth(days = 2): Promise<MvpProductHealthReport> {
  const now = new Date();
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const thresholds = MVP_PRODUCT_HEALTH_THRESHOLDS;
  const mvpScopeSportKeys = MVP_SUPPORTED_COMPETITION_CODES.map((code) =>
    oddsSportKeyForCompetition(code),
  ).filter((value): value is string => value != null);

  const [
    upcomingFixtures,
    fixturesWithCurrentOdds,
    latestCaptureRun,
    readiness,
    duplicateFinishedFixtureGroups,
  ] = await Promise.all([
    prisma.fixture.findMany({
      where: {
        competitionId: { in: [...MVP_SUPPORTED_COMPETITION_CODES] },
        status: { in: ["SCHEDULED", "TIMED"] },
        utcDate: { gte: now, lte: end },
      },
      select: { id: true },
      orderBy: { utcDate: "asc" },
    }),
    prisma.oddsSnapshot.findMany({
      where: {
        snapshotType: "current",
        market: "1x2",
        fixture: {
          competitionId: { in: [...MVP_SUPPORTED_COMPETITION_CODES] },
          status: { in: ["SCHEDULED", "TIMED"] },
          utcDate: { gte: now, lte: end },
        },
      },
      select: { fixtureId: true },
      distinct: ["fixtureId"],
    }),
    prisma.oddsCaptureRun.findFirst({
      where: { status: "completed" },
      orderBy: { completedAt: "desc" },
    }),
    buildResearchReadinessReport(),
    countDuplicateFinishedFixtureGroups(),
  ]);

  const predictionResults = await Promise.all(
    upcomingFixtures.map(async (fixture) => {
      try {
        await getProductionValuePrediction(fixture.id);
        return true;
      } catch {
        return false;
      }
    }),
  );

  const fixturesWithPrediction = predictionResults.filter(Boolean).length;
  const upcomingOddsCoverage = ratio(fixturesWithCurrentOdds.length, upcomingFixtures.length);
  const predictionCoverage = ratio(fixturesWithPrediction, upcomingFixtures.length);
  const latestSuccessfulCaptureAgeHours =
    latestCaptureRun?.completedAt != null
      ? (Date.now() - latestCaptureRun.completedAt.getTime()) / (60 * 60 * 1000)
      : null;
  const latestCaptureMatchRate =
    latestCaptureRun != null
      ? getScopedCaptureMatchRate(latestCaptureRun.sportResultsJson, mvpScopeSportKeys)
      : null;

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!latestCaptureRun?.completedAt) {
    blockers.push("No successful odds capture run recorded.");
  } else if (
    latestSuccessfulCaptureAgeHours != null &&
    latestSuccessfulCaptureAgeHours > thresholds.maxCaptureAgeHours
  ) {
    blockers.push(
      `Odds capture is stale at ${latestSuccessfulCaptureAgeHours.toFixed(1)}h old.`,
    );
  }

  if (upcomingFixtures.length > 0 && upcomingOddsCoverage < thresholds.minUpcomingOddsCoverage) {
    blockers.push(
      `Upcoming 1x2 odds coverage is ${(upcomingOddsCoverage * 100).toFixed(1)}%, below the ${(thresholds.minUpcomingOddsCoverage * 100).toFixed(0)}% minimum.`,
    );
  }

  if (upcomingFixtures.length > 0 && predictionCoverage < thresholds.minPredictionCoverage) {
    blockers.push(
      `Production prediction coverage is ${(predictionCoverage * 100).toFixed(1)}%, below the ${(thresholds.minPredictionCoverage * 100).toFixed(0)}% minimum.`,
    );
  }

  if (
    latestCaptureMatchRate != null &&
    latestCaptureRun?.fixturesTargeted &&
    latestCaptureRun.fixturesTargeted > 0 &&
    latestCaptureMatchRate < thresholds.minFixtureMatchRate
  ) {
    blockers.push(
      `Recent odds fixture match rate is ${(latestCaptureMatchRate * 100).toFixed(1)}%, below the ${(thresholds.minFixtureMatchRate * 100).toFixed(0)}% minimum.`,
    );
  }

  if (duplicateFinishedFixtureGroups > thresholds.maxDuplicateFinishedFixtureGroups) {
    blockers.push(
      `Found ${duplicateFinishedFixtureGroups} duplicate finished fixture group(s); run the data cleanup before publishing.`,
    );
  }

  if (upcomingFixtures.length === 0) {
    warnings.push("No MVP-scope upcoming fixtures found in the next 48h.");
  }

  if (!readiness.summary.capturePipelineHealthy) {
    warnings.push("Capture pipeline is not in a healthy state according to readiness checks.");
  }

  if (!readiness.summary.historicalMarketTrainingReady) {
    warnings.push("Historical market coverage is still below the research-ready threshold.");
  }

  const canPublish = blockers.length === 0;
  const status: HealthState = !canPublish ? "blocked" : warnings.length > 0 ? "degraded" : "healthy";

  return {
    generatedAt: new Date().toISOString(),
    version: MVP_PRODUCT_HEALTH_VERSION,
    status,
    canPublish,
    blockers,
    warnings,
    scope: {
      competitions: [...MVP_SUPPORTED_COMPETITION_CODES],
      markets: [...MVP_PRODUCTION_VALUE_MARKETS],
    },
    thresholds,
    summary: {
      upcomingFixtures: upcomingFixtures.length,
      fixturesWithCurrentOdds: fixturesWithCurrentOdds.length,
      upcomingOddsCoverage,
      fixturesWithPrediction,
      predictionCoverage,
      latestSuccessfulCaptureAt: latestCaptureRun?.completedAt?.toISOString() ?? null,
      latestSuccessfulCaptureAgeHours,
      latestCaptureMatchRate,
      historicalMarketTrainingReady: readiness.summary.historicalMarketTrainingReady,
      capturePipelineHealthy: readiness.summary.capturePipelineHealthy,
      duplicateFinishedFixtureGroups,
    },
  };
}
