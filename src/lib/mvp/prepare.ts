import { refreshAll } from "../ingest";
import { prisma } from "../db";
import { DEFAULT_UPCOMING_DAYS } from "../constants";
import { FIXTURE_STATUS_LIVE } from "../odds/fixture-pick-status";
import { buildForwardFeatureSnapshots } from "../research/feature-store";
import { MVP_PRODUCTION_POLICY_VERSION } from "./policy";
import {
  MVP_PRODUCTION_VALUE_MARKETS,
  MVP_SUPPORTED_COMPETITION_CODES,
} from "./config";
import {
  getMvpProductHealth,
  MVP_PRODUCT_HEALTH_VERSION,
} from "./health";
import { MVP_PRODUCTION_MODEL_ROUTING_VERSION } from "./model-routing";

export interface MvpPrepareOptions {
  aheadDays?: number;
  resultsDaysBack?: number;
  skipUnderstat?: boolean;
  throwOnBlocked?: boolean;
}

export interface MvpPrepareResult {
  preparedAt: string;
  healthStatus: string;
  canPublish: boolean;
  activeProductionPicks: number;
  forwardFeatureSnapshots: number;
  policyVersion: string;
  routingVersion: string;
  healthVersion: string;
  blockers: string[];
  warnings: string[];
}

async function countActiveProductionPicks(now: Date): Promise<number> {
  return prisma.valuePick.count({
    where: {
      market: { in: [...MVP_PRODUCTION_VALUE_MARKETS] },
      settled: false,
      OR: [
        {
          fixture: {
            competitionId: { in: [...MVP_SUPPORTED_COMPETITION_CODES] },
            status: { in: [...FIXTURE_STATUS_LIVE] },
          },
        },
        {
          fixture: {
            competitionId: { in: [...MVP_SUPPORTED_COMPETITION_CODES] },
            utcDate: { gt: now },
          },
        },
      ],
    },
  });
}

export async function runMvpPreparation(
  options?: MvpPrepareOptions,
): Promise<MvpPrepareResult> {
  const aheadDays = Math.max(1, Number(options?.aheadDays ?? process.env.AHEAD_DAYS ?? DEFAULT_UPCOMING_DAYS));
  const resultsDaysBack = Math.max(1, Number(options?.resultsDaysBack ?? process.env.RESULTS_DAYS ?? 7));
  const skipUnderstat = options?.skipUnderstat ?? process.env.SKIP_UNDERSTAT === "true";
  const throwOnBlocked = options?.throwOnBlocked ?? true;

  try {
    await refreshAll({ aheadDays, resultsDaysBack, skipUnderstat });
    const forwardSnapshots = await buildForwardFeatureSnapshots({
      daysAhead: aheadDays,
      competitionIds: [...MVP_SUPPORTED_COMPETITION_CODES],
    });

    const health = await getMvpProductHealth(aheadDays);
    const now = new Date();
    const activeProductionPicks = health.canPublish ? await countActiveProductionPicks(now) : 0;

    const payload: MvpPrepareResult = {
      preparedAt: now.toISOString(),
      healthStatus: health.status,
      canPublish: health.canPublish,
      activeProductionPicks,
      forwardFeatureSnapshots: forwardSnapshots.built,
      policyVersion: MVP_PRODUCTION_POLICY_VERSION,
      routingVersion: MVP_PRODUCTION_MODEL_ROUTING_VERSION,
      healthVersion: MVP_PRODUCT_HEALTH_VERSION,
      blockers: health.blockers,
      warnings: health.warnings,
    };

    await prisma.dataRefreshLog.create({
      data: {
        source: "mvp_prepare",
        status: health.canPublish ? "success" : "blocked",
        count: activeProductionPicks,
        message: JSON.stringify(payload),
      },
    });

    if (!health.canPublish && throwOnBlocked) {
      throw new Error(
        `MVP prepare blocked: ${health.blockers.join(" | ") || "health gate failed"}`,
      );
    }

    return payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.dataRefreshLog.create({
      data: {
        source: "mvp_prepare",
        status: "failed",
        count: 0,
        message,
      },
    });
    throw error;
  }
}
