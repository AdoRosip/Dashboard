import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { meanHeadlineBrier } from "@/lib/calibration";

export async function GET() {
  const [betting, buckets] = await Promise.all([
    prisma.bettingPerformance.findMany({ orderBy: { updatedAt: "desc" }, take: 20 }),
    prisma.calibrationBucket.findMany({ orderBy: { market: "asc" }, take: 200 }),
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
    brierScore: headlineBrier ?? brierAllMarkets,
    brierScoreAllMarkets: brierAllMarkets,
    brierScoreHeadline: headlineBrier,
    auditCount: audits.length,
  });
}
