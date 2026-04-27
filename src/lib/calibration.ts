import { prisma } from "./db";
import { MODEL_VERSION } from "./prediction/engine";
import { isHeadlineCalibrationMarket } from "./calibration/metrics";

/** Bucket key for calibration rows; uses kickoff calendar year (fixture has no season column). */
export function calibrationSeasonKeyFromFixture(utcDate: Date): string {
  return String(utcDate.getUTCFullYear());
}

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

async function rebuildCalibrationBuckets(): Promise<void> {
  const audits = await prisma.predictionAudit.findMany({
    select: {
      fixtureId: true,
      market: true,
      predictedProb: true,
      actualOutcome: true,
    },
  });

  await prisma.calibrationBucket.deleteMany();
  if (audits.length === 0) return;

  const fixtureIds = Array.from(new Set(audits.map((a) => a.fixtureId)));
  const fixtures = await prisma.fixture.findMany({
    where: { id: { in: fixtureIds } },
    select: { id: true, competitionId: true, utcDate: true },
  });
  const fixtureMap = new Map(fixtures.map((f) => [f.id, f]));

  const buckets = new Map<string, {
    market: string;
    league: string;
    season: string;
    probBucketLow: number;
    probBucketHigh: number;
    probBucketMid: number;
    totalPredictions: number;
    actualHits: number;
  }>();

  for (const audit of audits) {
    const fixture = fixtureMap.get(audit.fixtureId);
    if (!fixture) continue;

    const { low, high, mid } = bucketFor(audit.predictedProb);
    const season = calibrationSeasonKeyFromFixture(fixture.utcDate);
    const key = [
      audit.market,
      fixture.competitionId,
      season,
      low.toFixed(1),
      high.toFixed(1),
    ].join("|");

    const existing = buckets.get(key);
    if (existing) {
      existing.totalPredictions += 1;
      existing.actualHits += audit.actualOutcome ? 1 : 0;
      continue;
    }

    buckets.set(key, {
      market: audit.market,
      league: fixture.competitionId,
      season,
      probBucketLow: low,
      probBucketHigh: high,
      probBucketMid: mid,
      totalPredictions: 1,
      actualHits: audit.actualOutcome ? 1 : 0,
    });
  }

  for (const bucket of buckets.values()) {
    const actualRate = bucket.actualHits / bucket.totalPredictions;
    await prisma.calibrationBucket.create({
      data: {
        ...bucket,
        actualRate,
        calibrationError: Math.abs(bucket.probBucketMid - actualRate),
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
      const existingAudit = await prisma.predictionAudit.findFirst({
        where: { fixtureId: f.id, market: row.m },
        select: { id: true },
      });

      const payload = {
        fixtureId: f.id,
        market: row.m,
        modelVersion: pred.modelVersion,
        predictedProb: row.p,
        actualOutcome: row.hit,
        brierContribution: row.brier,
        logLoss: row.logLoss,
      };

      if (existingAudit) {
        await prisma.predictionAudit.update({
          where: { id: existingAudit.id },
          data: payload,
        });
      } else {
        await prisma.predictionAudit.create({ data: payload });
      }
    }
  }

  await rebuildCalibrationBuckets();
}

/** Mean Brier over headline markets only (1X2 binary outcomes + O/U + BTTS). */
export function meanHeadlineBrier(
  audits: Array<{ market: string; brierContribution: number }>,
): number | null {
  const subset = audits.filter((a) => isHeadlineCalibrationMarket(a.market));
  if (subset.length === 0) return null;
  return subset.reduce((s, a) => s + a.brierContribution, 0) / subset.length;
}
