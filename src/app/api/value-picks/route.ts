import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { FIXTURE_STATUS_LIVE } from "@/lib/odds/fixture-pick-status";

const include = {
  fixture: {
    include: { homeTeam: true, awayTeam: true, competition: true },
  },
} as const;

export async function GET() {
  const now = new Date();
  const [active, pendingSettlement] = await Promise.all([
    prisma.valuePick.findMany({
      where: {
        settled: false,
        OR: [
          { fixture: { status: { in: [...FIXTURE_STATUS_LIVE] } } },
          { fixture: { utcDate: { gt: now } } },
        ],
      },
      orderBy: [{ edge: "desc" }],
      include,
      take: 200,
    }),
    prisma.valuePick.findMany({
      where: {
        settled: false,
        NOT: {
          OR: [
            { fixture: { status: { in: [...FIXTURE_STATUS_LIVE] } } },
            { fixture: { utcDate: { gt: now } } },
          ],
        },
      },
      orderBy: [{ fixture: { utcDate: "desc" } }],
      include,
      take: 200,
    }),
  ]);

  return NextResponse.json({ active, pendingSettlement });
}
