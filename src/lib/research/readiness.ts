import { prisma } from "../db";
import { analyzeOddsCoverage } from "./odds-coverage";
import { SAFE_RESEARCH_SNAPSHOT_TRUST_LEVELS } from "./snapshot-trust";

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const RESEARCH_EVIDENCE_THRESHOLDS = {
  minHistoricalAnyOddsCoverage: 0.6,
  minHistoricalCurrent1x2Coverage: 0.6,
  minHistoricalClosingCoverage: 0.4,
  minSafeFeatureSnapshots: 300,
  minSafeSettledFixtures: 150,
  featureStoreLeakageRemediated: false,
  requiredSourceCategoriesComplete: true,
} as const;

export type ResearchEvidenceReadinessInput = {
  historicalAnyOddsCoverage: number;
  historicalCurrent1x2Coverage: number;
  historicalClosingCoverage: number;
  safeFeatureSnapshots?: number;
  safeSettledFixtures?: number;
  sourceCategoriesComplete?: boolean;
  featureStoreLeakageRemediated?: boolean;
};

export function assessResearchEvidenceReadiness(input: ResearchEvidenceReadinessInput) {
  const leakageRemediated =
    input.featureStoreLeakageRemediated ??
    RESEARCH_EVIDENCE_THRESHOLDS.featureStoreLeakageRemediated;
  const sourceCategoriesComplete =
    input.sourceCategoriesComplete ??
    !RESEARCH_EVIDENCE_THRESHOLDS.requiredSourceCategoriesComplete;
  const blockers: string[] = [];

  if (
    input.historicalAnyOddsCoverage <
    RESEARCH_EVIDENCE_THRESHOLDS.minHistoricalAnyOddsCoverage
  ) {
    blockers.push("Historical odds coverage is below the production-evidence threshold.");
  }
  if (
    input.historicalCurrent1x2Coverage <
    RESEARCH_EVIDENCE_THRESHOLDS.minHistoricalCurrent1x2Coverage
  ) {
    blockers.push("Historical current 1X2 odds coverage is below the production-evidence threshold.");
  }
  if (
    input.historicalClosingCoverage <
    RESEARCH_EVIDENCE_THRESHOLDS.minHistoricalClosingCoverage
  ) {
    blockers.push("Historical closing-line coverage is below the production-evidence threshold.");
  }
  if (!leakageRemediated) {
    blockers.push("Historical feature snapshots still have unresolved leakage risk.");
  }
  if (
    (input.safeFeatureSnapshots ?? 0) <
    RESEARCH_EVIDENCE_THRESHOLDS.minSafeFeatureSnapshots
  ) {
    blockers.push("Safe feature snapshot count is below the production-evidence threshold.");
  }
  if (
    (input.safeSettledFixtures ?? 0) <
    RESEARCH_EVIDENCE_THRESHOLDS.minSafeSettledFixtures
  ) {
    blockers.push("Safe settled fixture count is below the production-evidence threshold.");
  }
  if (
    RESEARCH_EVIDENCE_THRESHOLDS.requiredSourceCategoriesComplete &&
    !sourceCategoriesComplete
  ) {
    blockers.push("Forward-safe snapshots do not have complete source snapshot coverage.");
  }

  return {
    productionEvidenceReady: blockers.length === 0,
    leakageRisk: !leakageRemediated,
    sourceCategoriesComplete,
    blockers,
    thresholds: RESEARCH_EVIDENCE_THRESHOLDS,
  };
}

export async function buildResearchReadinessReport() {
  const [
    coverage,
    latestCaptureRuns,
    oddsObservationCount,
    upcomingFixtures,
    snapshots,
    safeSnapshots,
    featureSourceSnapshots,
    safeSettledFixtures,
  ] =
    await Promise.all([
      analyzeOddsCoverage(),
      prisma.oddsCaptureRun.findMany({
        orderBy: { startedAt: "desc" },
        take: 12,
      }),
      prisma.oddsObservation.count(),
      prisma.fixture.findMany({
        where: {
          utcDate: {
            gte: new Date(),
            lte: new Date(Date.now() + 48 * 60 * 60 * 1000),
          },
          status: { in: ["SCHEDULED", "TIMED"] },
        },
        select: { id: true, competitionId: true },
      }),
      prisma.featureSnapshot.count(),
      prisma.featureSnapshot.count({
        where: {
          snapshotTrust: { in: [...SAFE_RESEARCH_SNAPSHOT_TRUST_LEVELS] },
        },
      }),
      prisma.featureSourceSnapshot.count(),
      prisma.featureSnapshot.findMany({
        where: {
          snapshotTrust: { in: [...SAFE_RESEARCH_SNAPSHOT_TRUST_LEVELS] },
          targetJson: { not: null },
          fixture: {
            scoreHomeFt: { not: null },
            scoreAwayFt: { not: null },
          },
        },
        select: { fixtureId: true },
        distinct: ["fixtureId"],
      }),
    ]);
  const unsafeSnapshots = Math.max(0, snapshots - safeSnapshots);
  const safeSettledFixtureCount = safeSettledFixtures.length;

  const fixtureIds = upcomingFixtures.map((f) => f.id);
  const upcomingObservedFixtures =
    fixtureIds.length > 0
      ? await prisma.oddsObservation.findMany({
          where: { fixtureId: { in: fixtureIds } },
          select: { fixtureId: true },
          distinct: ["fixtureId"],
        })
      : [];

  const recentCaptureStats = latestCaptureRuns.map((run) => ({
    id: run.id,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    status: run.status,
    daysAhead: run.daysAhead,
    eventsFetched: run.eventsFetched,
    fixturesTargeted: run.fixturesTargeted,
    fixturesMatched: run.fixturesMatched,
    fixturesUnmatched: run.fixturesUnmatched,
    snapshotsUpserted: run.snapshotsUpserted,
    observationsAdded: run.observationsAdded,
    sportResults: safeJsonParse(run.sportResultsJson, [] as unknown[]),
  }));

  const successfulRuns = latestCaptureRuns.filter((run) => run.status === "completed");
  const avgObservationsPerSuccessfulRun =
    successfulRuns.length > 0
      ? successfulRuns.reduce((sum, run) => sum + run.observationsAdded, 0) / successfulRuns.length
      : 0;
  const latestSuccessfulRun = successfulRuns[0] ?? null;
  const latestSuccessfulCaptureAgeHours =
    latestSuccessfulRun?.completedAt != null
      ? (Date.now() - latestSuccessfulRun.completedAt.getTime()) / (60 * 60 * 1000)
      : null;
  const capturePipelineHealthy =
    latestSuccessfulCaptureAgeHours != null &&
    latestSuccessfulCaptureAgeHours <= 12 &&
    avgObservationsPerSuccessfulRun > 0;
  const historicalMarketTrainingReady = coverage.summary.anyOddsCoverage >= 0.6;
  const historicalClosingCoverage =
    Math.max(coverage.summary.closing1x2Coverage, coverage.summary.closingOu25Coverage);
  const evidence = assessResearchEvidenceReadiness({
    historicalAnyOddsCoverage: coverage.summary.anyOddsCoverage,
    historicalCurrent1x2Coverage: coverage.summary.current1x2Coverage,
    historicalClosingCoverage,
    safeFeatureSnapshots: safeSnapshots,
    safeSettledFixtures: safeSettledFixtureCount,
    sourceCategoriesComplete: safeSnapshots > 0 && featureSourceSnapshots >= safeSnapshots,
  });

  const recommendations: string[] = [];
  if (!latestSuccessfulRun) {
    recommendations.push(
      "Run `npm run odds:capture` on a schedule to start recording real pre-match odds history.",
    );
  } else if (!capturePipelineHealthy) {
    recommendations.push(
      "Recent odds capture is stale or empty; restore a regular capture cadence before trusting market-aware research.",
    );
  }
  if (!historicalMarketTrainingReady) {
    recommendations.push(
      "Historical pre-match odds coverage is still below training quality; keep accumulating observations before promoting a market-aware model.",
    );
  }
  if (evidence.leakageRisk) {
    recommendations.push(
      "Rebuild historical feature snapshots from immutable pre-kickoff source snapshots before using walk-forward results as production evidence.",
    );
  }
  if (!evidence.productionEvidenceReady) {
    recommendations.push(
      "Do not market profitability claims until production-evidence readiness is true.",
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      featureSnapshots: snapshots,
      safeFeatureSnapshots: safeSnapshots,
      unsafeFeatureSnapshots: unsafeSnapshots,
      featureSourceSnapshots,
      safeSettledFixtures: safeSettledFixtureCount,
      oddsObservations: oddsObservationCount,
      recentCaptureRuns: latestCaptureRuns.length,
      avgObservationsPerSuccessfulRun,
      upcomingFixtures: upcomingFixtures.length,
      upcomingFixturesWithAnyOddsHistory: upcomingObservedFixtures.length,
      upcomingOddsCoverage:
        upcomingFixtures.length > 0 ? upcomingObservedFixtures.length / upcomingFixtures.length : 0,
      latestSuccessfulCaptureAt: latestSuccessfulRun?.completedAt ?? null,
      latestSuccessfulCaptureAgeHours,
      capturePipelineHealthy,
      historicalMarketTrainingReady,
      historicalAnyOddsCoverage: coverage.summary.anyOddsCoverage,
      historicalCurrent1x2Coverage: coverage.summary.current1x2Coverage,
      historicalCurrentOu25Coverage: coverage.summary.currentOu25Coverage,
      historicalClosingCoverage,
      productionEvidenceReady: evidence.productionEvidenceReady,
      featureSnapshotLeakageRisk: evidence.leakageRisk,
    },
    evidence,
    oddsCoverage: coverage,
    recentCaptureRuns: recentCaptureStats,
    recommendations,
  };
}
