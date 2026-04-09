import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const league = searchParams.get("league");
  const days = parseInt(searchParams.get("days") ?? "3", 10);

  const now = new Date();
  const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const where: Record<string, unknown> = {
    utcDate: { gte: now, lte: until },
    status: { in: ["SCHEDULED", "TIMED"] },
  };

  if (league) {
    where.competitionId = league;
  }

  const fixtures = await prisma.fixture.findMany({
    where,
    include: {
      homeTeam: true,
      awayTeam: true,
      competition: true,
    },
    orderBy: { utcDate: "asc" },
  });

  // Group by date then competition
  const grouped: Record<
    string,
    Record<string, typeof fixtures>
  > = {};

  for (const f of fixtures) {
    const dateKey = f.utcDate.toISOString().split("T")[0];
    if (!grouped[dateKey]) grouped[dateKey] = {};
    if (!grouped[dateKey][f.competitionId])
      grouped[dateKey][f.competitionId] = [];
    grouped[dateKey][f.competitionId].push(f);
  }

  return NextResponse.json({
    fixtures,
    grouped,
    total: fixtures.length,
    lastRefresh: await prisma.dataRefreshLog.findFirst({
      orderBy: { timestamp: "desc" },
    }),
  });
}
