import { prisma } from "./db";

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

/**
 * Log probability vs outcome for finished fixtures using stored Prediction rows.
 */
export async function runCalibrationForFinishedFixtures(): Promise<void> {
  const done = await prisma.fixture.findMany({
    where: {
      status: "FINISHED",
      scoreHomeFt: { not: null },
      scoreAwayFt: { not: null },
    },
    take: 300,
    orderBy: { utcDate: "desc" },
  });

  for (const f of done) {
    const pred = await prisma.prediction.findFirst({
      where: { fixtureId: f.id },
      orderBy: { createdAt: "desc" },
    });
    if (!pred) continue;

    const hs = f.scoreHomeFt ?? 0;
    const as = f.scoreAwayFt ?? 0;
    const homeWin = hs > as;
    const awayWin = as > hs;
    const draw = hs === as;

    const markets: Array<{ m: string; p: number; hit: boolean }> = [
      { m: "1x2_home", p: pred.probHomeWin, hit: homeWin },
      { m: "1x2_draw", p: pred.probDraw, hit: draw },
      { m: "1x2_away", p: pred.probAwayWin, hit: awayWin },
      { m: "over25", p: pred.probOver25, hit: hs + as > 2 },
      { m: "btts_yes", p: pred.probBttsYes, hit: hs > 0 && as > 0 },
    ];

    for (const row of markets) {
      const dup = await prisma.predictionAudit.findFirst({
        where: { fixtureId: f.id, market: row.m },
      });
      if (dup) continue;

      const y = row.hit ? 1 : 0;
      const brier = (row.p - y) ** 2;
      const logLoss =
        y === 1 ? -Math.log(Math.max(1e-9, row.p)) : -Math.log(Math.max(1e-9, 1 - row.p));

      await prisma.predictionAudit.create({
        data: {
          fixtureId: f.id,
          market: row.m,
          predictedProb: row.p,
          actualOutcome: row.hit,
          brierContribution: brier,
          logLoss,
        },
      });

      const { low, high, mid } = bucketFor(row.p);
      const existing = await prisma.calibrationBucket.findFirst({
        where: {
          market: row.m,
          league: "all",
          season: "2025",
          probBucketLow: low,
          probBucketHigh: high,
        },
      });
      const hits = row.hit ? 1 : 0;
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
            market: row.m,
            league: "all",
            season: "2025",
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
  }
}
