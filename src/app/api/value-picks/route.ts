import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { FIXTURE_STATUS_LIVE } from "@/lib/odds/fixture-pick-status";
import { getMvpProductHealth } from "@/lib/mvp/health";
import { attachValuePickRationale } from "@/lib/mvp/pick-rationale";
import {
  MVP_PRODUCTION_VALUE_MARKETS,
  MVP_SUPPORTED_COMPETITION_CODES,
} from "@/lib/mvp/config";

const include = {
  fixture: {
    include: { homeTeam: true, awayTeam: true, competition: true },
  },
} as const;

export async function GET() {
  const now = new Date();
  const [health, active, pendingSettlement] = await Promise.all([
    getMvpProductHealth(),
    prisma.valuePick.findMany({
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
      orderBy: [{ edge: "desc" }],
      include,
      take: 200,
    }),
    prisma.valuePick.findMany({
      where: {
        market: { in: [...MVP_PRODUCTION_VALUE_MARKETS] },
        settled: false,
        fixture: { competitionId: { in: [...MVP_SUPPORTED_COMPETITION_CODES] } },
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

  const [activeWithRationale, pendingWithRationale] = await Promise.all([
    attachValuePickRationale(active),
    attachValuePickRationale(pendingSettlement),
  ]);

  return NextResponse.json({
    health,
    active: health.canPublish ? activeWithRationale : [],
    pendingSettlement: pendingWithRationale,
  });
}
