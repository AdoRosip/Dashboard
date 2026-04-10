import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { FLAG_EFFECTS } from "@/lib/context/flag-effects";

export async function GET() {
  const flags = await prisma.matchContextFlag.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { team: true, fixture: true },
  });
  const teams = await prisma.team.findMany({
    select: { id: true, name: true, shortName: true },
    orderBy: { name: "asc" },
    take: 200,
  });
  return NextResponse.json({ flags, flagTypes: Object.keys(FLAG_EFFECTS), teams });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      teamId?: number | null;
      fixtureId?: number | null;
      flagType: string;
      severity?: string;
      description?: string;
      lambdaMultiplier?: number;
      expiresAt?: string | null;
    };

    const def = FLAG_EFFECTS[body.flagType];
    if (!def) {
      return NextResponse.json({ error: "Unknown flagType" }, { status: 400 });
    }

    const expires =
      body.expiresAt != null && body.expiresAt !== ""
        ? new Date(body.expiresAt)
        : new Date(Date.now() + def.durationDays * 24 * 60 * 60 * 1000);

    const created = await prisma.matchContextFlag.create({
      data: {
        teamId: body.teamId ?? null,
        fixtureId: body.fixtureId ?? null,
        flagType: body.flagType,
        severity: body.severity ?? "moderate",
        description: body.description ?? def.description,
        lambdaMultiplier: body.lambdaMultiplier ?? def.lambdaMultiplier,
        expiresAt: expires,
        isActive: true,
      },
    });

    return NextResponse.json(created);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
