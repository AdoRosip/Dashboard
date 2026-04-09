import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { predictMatch, savePrediction } from "@/lib/prediction";
import { CURRENT_SEASON } from "@/lib/constants";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const fixtureId = parseInt(id, 10);
  if (isNaN(fixtureId)) {
    return NextResponse.json({ error: "Invalid match ID" }, { status: 400 });
  }

  const fixture = await prisma.fixture.findUnique({
    where: { id: fixtureId },
    include: {
      homeTeam: true,
      awayTeam: true,
      competition: true,
    },
  });

  if (!fixture) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  const [homeStats, awayStats] = await Promise.all([
    prisma.teamSeasonStats.findFirst({
      where: { teamId: fixture.homeTeamId, competitionId: fixture.competitionId, season: CURRENT_SEASON },
    }),
    prisma.teamSeasonStats.findFirst({
      where: { teamId: fixture.awayTeamId, competitionId: fixture.competitionId, season: CURRENT_SEASON },
    }),
  ]);

  const [homeForm, awayForm] = await Promise.all([
    prisma.fixture.findMany({
      where: {
        status: "FINISHED",
        OR: [{ homeTeamId: fixture.homeTeamId }, { awayTeamId: fixture.homeTeamId }],
      },
      orderBy: { utcDate: "desc" },
      take: 6,
      include: { homeTeam: true, awayTeam: true, competition: true },
    }),
    prisma.fixture.findMany({
      where: {
        status: "FINISHED",
        OR: [{ homeTeamId: fixture.awayTeamId }, { awayTeamId: fixture.awayTeamId }],
      },
      orderBy: { utcDate: "desc" },
      take: 6,
      include: { homeTeam: true, awayTeam: true, competition: true },
    }),
  ]);

  const [idA, idB] = fixture.homeTeamId < fixture.awayTeamId
    ? [fixture.homeTeamId, fixture.awayTeamId]
    : [fixture.awayTeamId, fixture.homeTeamId];

  const h2h = await prisma.h2HMatch.findMany({
    where: { teamAId: idA, teamBId: idB },
    orderBy: { date: "desc" },
    take: 10,
    include: { competition: true },
  });

  const [homePlayers, awayPlayers] = await Promise.all([
    prisma.player.findMany({
      where: { teamId: fixture.homeTeamId },
      include: {
        seasonAgg: { where: { season: CURRENT_SEASON } },
        injuries: true,
      },
      orderBy: { isKeyPlayer: "desc" },
    }),
    prisma.player.findMany({
      where: { teamId: fixture.awayTeamId },
      include: {
        seasonAgg: { where: { season: CURRENT_SEASON } },
        injuries: true,
      },
      orderBy: { isKeyPlayer: "desc" },
    }),
  ]);

  // Run prediction
  let prediction = null;
  try {
    prediction = await predictMatch(fixtureId);
    await savePrediction(prediction);
  } catch {
    // Prediction may fail if not enough data — serve page without it
  }

  return NextResponse.json({
    fixture,
    homeStats,
    awayStats,
    homeForm,
    awayForm,
    h2h,
    homePlayers,
    awayPlayers,
    prediction,
  });
}
