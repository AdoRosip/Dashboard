import { DEFAULT_UPCOMING_DAYS } from "../lib/constants";
import { prisma } from "../lib/db";
import { runMvpPreparation } from "../lib/mvp/prepare";
import {
  recomputeBettingPerformance,
  runOddsCaptureCycle,
  settleValuePicks,
} from "../lib/odds";
import { evaluateBaselines } from "../lib/research/datasets";
import { buildLeakageAuditReport } from "../lib/research/leakage-audit";
import { buildResearchReadinessReport } from "../lib/research/readiness";
import { runWalkforwardEvaluation } from "../lib/research/walkforward";

type StepStatus = "completed" | "failed" | "skipped";

interface PipelineStep<T> {
  name: string;
  status: StepStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  result?: T;
  error?: string;
}

function parseBooleanEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") {
    return defaultValue;
  }
  return ["1", "true", "yes", "y"].includes(raw.toLowerCase());
}

function parsePositiveNumberEnv(name: string, defaultValue: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : defaultValue;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runStep<T>(
  name: string,
  action: () => Promise<T>,
): Promise<PipelineStep<T>> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();

  try {
    const result = await action();
    const completed = Date.now();
    return {
      name,
      status: "completed",
      startedAt,
      completedAt: new Date(completed).toISOString(),
      durationMs: completed - started,
      result,
    };
  } catch (error) {
    const completed = Date.now();
    return {
      name,
      status: "failed",
      startedAt,
      completedAt: new Date(completed).toISOString(),
      durationMs: completed - started,
      error: errorMessage(error),
    };
  }
}

function skippedStep<T>(name: string, reason: string): PipelineStep<T> {
  const now = new Date().toISOString();
  return {
    name,
    status: "skipped",
    startedAt: now,
    completedAt: now,
    durationMs: 0,
    error: reason,
  };
}

function extractStepResult<T>(step: PipelineStep<T>): T | null {
  return step.status === "completed" && step.result != null ? step.result : null;
}

function compactStep(step: PipelineStep<unknown>) {
  const base = {
    name: step.name,
    status: step.status,
    durationMs: step.durationMs,
    error: step.error,
  };

  if (step.status !== "completed" || step.result == null) {
    return base;
  }

  switch (step.name) {
    case "odds_capture": {
      const result = step.result as Awaited<ReturnType<typeof runOddsCaptureCycle>>;
      return {
        ...base,
        result: {
          daysAhead: result.daysAhead,
          valuePicksUpdated: result.valuePicksUpdated,
          fixturesMatched: result.results.reduce(
            (sum, row) => sum + row.fixturesMatched,
            0,
          ),
          fixturesUnmatched: result.results.reduce(
            (sum, row) => sum + row.fixturesUnmatched,
            0,
          ),
          snapshotsUpserted: result.results.reduce(
            (sum, row) => sum + row.snapshotsUpserted,
            0,
          ),
        },
      };
    }
    case "mvp_prepare": {
      const result = step.result as Awaited<ReturnType<typeof runMvpPreparation>>;
      return {
        ...base,
        result: {
          healthStatus: result.healthStatus,
          canPublish: result.canPublish,
          activeProductionPicks: result.activeProductionPicks,
          forwardFeatureSnapshots: result.forwardFeatureSnapshots,
          blockers: result.blockers,
          warnings: result.warnings,
        },
      };
    }
    case "leakage_audit": {
      const result = step.result as Awaited<ReturnType<typeof buildLeakageAuditReport>>;
      return {
        ...base,
        result: {
          status: result.status,
          summary: result.summary,
          blockers: result.blockers,
        },
      };
    }
    case "research_readiness": {
      const result = step.result as Awaited<ReturnType<typeof buildResearchReadinessReport>>;
      return {
        ...base,
        result: {
          productionEvidenceReady: result.summary.productionEvidenceReady,
          capturePipelineHealthy: result.summary.capturePipelineHealthy,
          safeFeatureSnapshots: result.summary.safeFeatureSnapshots,
          safeSettledFixtures: result.summary.safeSettledFixtures,
          historicalAnyOddsCoverage: result.summary.historicalAnyOddsCoverage,
          historicalCurrent1x2Coverage: result.summary.historicalCurrent1x2Coverage,
          historicalClosingCoverage: result.summary.historicalClosingCoverage,
          blockers: result.evidence.blockers,
        },
      };
    }
    case "research_baselines": {
      const result = step.result as Awaited<ReturnType<typeof evaluateBaselines>>;
      return {
        ...base,
        result: result.map((market) => ({
          market: market.market,
          status: market.status,
          sampleSize: market.sampleSize,
          minSafeRowsRequired: market.minSafeRowsRequired,
          blockers: market.blockers,
        })),
      };
    }
    case "research_walkforward": {
      const result = step.result as Awaited<ReturnType<typeof runWalkforwardEvaluation>>;
      return {
        ...base,
        result: {
          runId: result.runId,
          status: result.status,
          blockers: result.blockers,
          marketCount: result.markets.length,
        },
      };
    }
    default:
      return { ...base, result: step.result };
  }
}

async function main() {
  const aheadDays = parsePositiveNumberEnv("AHEAD_DAYS", DEFAULT_UPCOMING_DAYS);
  const skipOddsCapture = parseBooleanEnv("PIPELINE_SKIP_ODDS_CAPTURE", false);
  const skipMvpPrepare = parseBooleanEnv("PIPELINE_SKIP_MVP_PREPARE", false);
  const skipResearch = parseBooleanEnv("PIPELINE_SKIP_RESEARCH", false);
  const verbose = parseBooleanEnv("PIPELINE_VERBOSE", false);

  const steps: PipelineStep<unknown>[] = [];

  steps.push(
    skipOddsCapture
      ? skippedStep("odds_capture", "PIPELINE_SKIP_ODDS_CAPTURE=true")
      : await runStep("odds_capture", () =>
          runOddsCaptureCycle({
            days: aheadDays,
            recomputeValuePicks: true,
            includeReadiness: false,
          }),
        ),
  );

  steps.push(
    skipMvpPrepare
      ? skippedStep("mvp_prepare", "PIPELINE_SKIP_MVP_PREPARE=true")
      : await runStep("mvp_prepare", () =>
          runMvpPreparation({ aheadDays, throwOnBlocked: false }),
        ),
  );

  steps.push(
    await runStep("settle_and_performance", async () => {
      const settledPicks = await settleValuePicks();
      await recomputeBettingPerformance();
      return { settledPicks };
    }),
  );

  const leakageAuditStep: PipelineStep<Awaited<ReturnType<typeof buildLeakageAuditReport>>> = skipResearch
    ? skippedStep("leakage_audit", "PIPELINE_SKIP_RESEARCH=true")
    : await runStep("leakage_audit", () => buildLeakageAuditReport());
  steps.push(leakageAuditStep);

  const readinessStep: PipelineStep<Awaited<ReturnType<typeof buildResearchReadinessReport>>> = skipResearch
    ? skippedStep("research_readiness", "PIPELINE_SKIP_RESEARCH=true")
    : await runStep("research_readiness", () => buildResearchReadinessReport());
  steps.push(readinessStep);

  const baselinesStep: PipelineStep<Awaited<ReturnType<typeof evaluateBaselines>>> = skipResearch
    ? skippedStep("research_baselines", "PIPELINE_SKIP_RESEARCH=true")
    : await runStep("research_baselines", () => evaluateBaselines({ limit: 5000 }));
  steps.push(baselinesStep);

  const walkforwardStep: PipelineStep<Awaited<ReturnType<typeof runWalkforwardEvaluation>>> = skipResearch
    ? skippedStep("research_walkforward", "PIPELINE_SKIP_RESEARCH=true")
    : await runStep("research_walkforward", () => runWalkforwardEvaluation());
  steps.push(walkforwardStep);

  const readiness = extractStepResult(readinessStep);
  const leakageAudit = extractStepResult(leakageAuditStep);
  const baselines = extractStepResult(baselinesStep);
  const walkforward = extractStepResult(walkforwardStep);
  const failedSteps = steps.filter((step) => step.status === "failed");

  const summary = {
    generatedAt: new Date().toISOString(),
    status: failedSteps.length > 0 ? "failed" : "completed",
    productionEvidenceReady:
      readiness != null ? readiness.summary.productionEvidenceReady : false,
    canMarketProfitability:
      readiness != null &&
      readiness.summary.productionEvidenceReady &&
      leakageAudit != null &&
      leakageAudit.status === "pass" &&
      Array.isArray(baselines) &&
      baselines.every((market) => market.status === "ready") &&
      walkforward != null &&
      walkforward.status === "ready",
    nextAction:
      readiness?.summary.productionEvidenceReady === true
        ? "Review ready baseline and walk-forward metrics before making any profitability claim."
        : "Keep collecting forward-safe odds/features and settled outcomes; do not market profitability claims yet.",
    failedSteps: failedSteps.map((step) => ({
      name: step.name,
      error: step.error,
    })),
    blockers: readiness?.evidence.blockers ?? [],
  };

  console.log(
    JSON.stringify(
      {
        summary,
        steps: verbose ? steps : steps.map(compactStep),
      },
      null,
      2,
    ),
  );

  if (failedSteps.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
