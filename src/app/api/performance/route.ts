import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const [betting, buckets] = await Promise.all([
    prisma.bettingPerformance.findMany({ orderBy: { updatedAt: "desc" }, take: 20 }),
    prisma.calibrationBucket.findMany({ orderBy: { market: "asc" }, take: 200 }),
  ]);

  const audits = await prisma.predictionAudit.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const brier =
    audits.length > 0
      ? audits.reduce((s, a) => s + a.brierContribution, 0) / audits.length
      : 0;

  return NextResponse.json({ betting, buckets, brierScore: brier, auditCount: audits.length });
}
