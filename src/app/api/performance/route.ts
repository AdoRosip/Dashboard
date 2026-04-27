import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { meanHeadlineBrier } from "@/lib/calibration";
import { buildValueBacktestReport } from "@/lib/odds/backtest";

export async function GET() {
  const [betting, buckets, valueBacktest] = await Promise.all([
    prisma.bettingPerformance.findMany({ orderBy: { updatedAt: "desc" }, take: 20 }),
    prisma.calibrationBucket.findMany({ orderBy: { market: "asc" }, take: 200 }),
    buildValueBacktestReport(),
  ]);

  const audits = await prisma.predictionAudit.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const headlineBrier = meanHeadlineBrier(audits);
  const brierAllMarkets =
    audits.length > 0
      ? audits.reduce((s, a) => s + a.brierContribution, 0) / audits.length
      : null;

  return NextResponse.json({
    betting,
    buckets,
    valueBacktest,
    brierScore: headlineBrier ?? brierAllMarkets,
    brierScoreAllMarkets: brierAllMarkets,
    brierScoreHeadline: headlineBrier,
    auditCount: audits.length,
  });
}
