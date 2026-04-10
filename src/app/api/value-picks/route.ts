import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const picks = await prisma.valuePick.findMany({
    where: { settled: false },
    orderBy: { flaggedAt: "desc" },
    include: {
      fixture: {
        include: { homeTeam: true, awayTeam: true, competition: true },
      },
    },
    take: 200,
  });

  return NextResponse.json(picks);
}
