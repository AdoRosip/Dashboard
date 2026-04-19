import { prisma } from "./db";
import { CURRENT_SEASON } from "./constants";
import { MODEL_VERSION } from "./prediction/engine";
import { isHeadlineCalibrationMarket } from "./calibration/metrics";

const BUCKETS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

function bucketFor(p: number): { low: number; high: number; mid: number } {
  const x = Math.min(0.999, Math.max(0, p));
  for (let i = 0; i < BUCKETS.length - 1; i++) {
    const low = BUCKETS[i];
    const high = BUCKETS[i + 1];
    if (x >= low && x < high) return { low, high, mid: (low + high) / 2 };
  }
  return { low: 0.9, high: 1.0, mid: 0.95 };
}

async function upsertCalibrationBucket(params: {
  market: string;
  league: string;
  season: string;
  prob: number;
  hit: boolean;
}): Promise<void> {
  const { low, high, mid } = bucketFor(params.prob);
  const existing = await prisma.calibrationBucket.findFirst({
    where: {
      market: params.market,
      league: params.league,
      season: params.season,
      probBucketLow: low,
      probBucketHigh: high,
    },
  });
  const hits = params.hit ? 1 : 0;
  if (existing) {
    const tp = existing.totalPredictions + 1;
    const ah = existing.actualHits + hits;
    await prisma.calibrationBucket.update({
      where: { id: existing.id },
      data: {
        totalPredictions: tp,
        actualHits: ah,
        actualRate: ah / tp,
        calibrationError: Math.abs(mid - ah / tp),
      },
    });
  } else {
    await prisma.calibrationBucket.create({
      data: {
        market: params.market,
        league: params.league,
        season: params.season,
        probBucketLow: low,
        probBucketHigh: high,
        probBucketMid: mid,
        totalPredictions: 1,
        actualHits: hits,
        actualRate: hits,
        calibrationError: Math.abs(mid - hits),
      },
    });
  }
}

/**
 * Log probability vs outcome for finished fixtures using stored Prediction rows.
 * Uses latest `updatedAt` snapshot. Headline Brier uses 1X2 binary markets + O/U + BTTS.
 */
export async function runCalibrationForFinishedFixtures(): Promise<void> {
  const done = await prisma.fixture.findMany({
    where: {
      status: "FINISHED",
      scoreHomeFt: { not: null },
      scoreAwayFt: { not: null },
    },
    take: 2000,
    orderBy: { utcDate: "desc" },
  });

  for (const f of done) {
    const pred =
      (await prisma.prediction.findFirst({
        where: { fixtureId: f.id, modelVersion: MODEL_VERSION },
        orderBy: { updatedAt: "desc" },
      })) ??
      (await prisma.prediction.findFirst({
        where: { fixtureId: f.id },
        orderBy: { updatedAt: "desc" },
      }));
    if (!pred) continue;

    const league = f.competitionId;

    const hs = f.scoreHomeFt ?? 0;
    const as = f.scoreAwayFt ?? 0;
    const homeWin = hs > as;
    const awayWin = as > hs;
    const draw = hs === as;

    const markets: Array<{
      m: string;
      p: number;
      hit: boolean;
      brier: number;
      logLoss: number;
    }> = [
      {
        m: "1x2_home",
        p: pred.probHomeWin,
        hit: homeWin,
        brier: (pred.probHomeWin - (homeWin ? 1 : 0)) ** 2,
        logLoss:
          homeWin
            ? -Math.log(Math.max(1e-9, pred.probHomeWin))
            : -Math.log(Math.max(1e-9, 1 - pred.probHomeWin)),
      },
      {
        m: "1x2_draw",
        p: pred.probDraw,
        hit: draw,
        brier: (pred.probDraw - (draw ? 1 : 0)) ** 2,
        logLoss:
          draw
            ? -Math.log(Math.max(1e-9, pred.probDraw))
            : -Math.log(Math.max(1e-9, 1 - pred.probDraw)),
      },
      {
        m: "1x2_away",
        p: pred.probAwayWin,
        hit: awayWin,
        brier: (pred.probAwayWin - (awayWin ? 1 : 0)) ** 2,
        logLoss:
          awayWin
            ? -Math.log(Math.max(1e-9, pred.probAwayWin))
            : -Math.log(Math.max(1e-9, 1 - pred.probAwayWin)),
      },
      {
        m: "over25",
        p: pred.probOver25,
        hit: hs + as > 2,
        brier: (pred.probOver25 - (hs + as > 2 ? 1 : 0)) ** 2,
        logLoss:
          hs + as > 2
            ? -Math.log(Math.max(1e-9, pred.probOver25))
            : -Math.log(Math.max(1e-9, 1 - pred.probOver25)),
      },
      {
        m: "btts_yes",
        p: pred.probBttsYes,
        hit: hs > 0 && as > 0,
        brier: (pred.probBttsYes - (hs > 0 && as > 0 ? 1 : 0)) ** 2,
        logLoss:
          hs > 0 && as > 0
            ? -Math.log(Math.max(1e-9, pred.probBttsYes))
            : -Math.log(Math.max(1e-9, 1 - pred.probBttsYes)),
      },
    ];

    for (const row of markets) {
      const dup = await prisma.predictionAudit.findFirst({
        where: { fixtureId: f.id, market: row.m },
      });
      if (dup) continue;

      await prisma.predictionAudit.create({
        data: {
          fixtureId: f.id,
          market: row.m,
          modelVersion: pred.modelVersion,
          predictedProb: row.p,
          actualOutcome: row.hit,
          brierContribution: row.brier,
          logLoss: row.logLoss,
        },
      });

      await upsertCalibrationBucket({
        market: row.m,
        league,
        season: CURRENT_SEASON,
        prob: row.p,
        hit: row.hit,
      });
    }
  }
}

/** Mean Brier over headline markets only (1X2 binary outcomes + O/U + BTTS). */
export function meanHeadlineBrier(
  audits: Array<{ market: string; brierContribution: number }>,
): number | null {
  const subset = audits.filter((a) => isHeadlineCalibrationMarket(a.market));
  if (subset.length === 0) return null;
  return subset.reduce((s, a) => s + a.brierContribution, 0) / subset.length;
}
