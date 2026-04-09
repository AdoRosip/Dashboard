import { prisma } from "@/lib/db";
import { CURRENT_SEASON } from "@/lib/constants";
import { predictMatch } from "@/lib/prediction";
import { notFound } from "next/navigation";
import { MatchDashboard } from "@/components/match-dashboard";

export const dynamic = "force-dynamic";

export default async function MatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const fixtureId = parseInt(id, 10);
  if (isNaN(fixtureId)) notFound();

  const fixture = await prisma.fixture.findUnique({
    where: { id: fixtureId },
    include: { homeTeam: true, awayTeam: true, competition: true },
  });
  if (!fixture) notFound();

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
      where: { status: "FINISHED", OR: [{ homeTeamId: fixture.homeTeamId }, { awayTeamId: fixture.homeTeamId }] },
      orderBy: { utcDate: "desc" },
      take: 6,
      include: { homeTeam: true, awayTeam: true, competition: true },
    }),
    prisma.fixture.findMany({
      where: { status: "FINISHED", OR: [{ homeTeamId: fixture.awayTeamId }, { awayTeamId: fixture.awayTeamId }] },
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
      include: { seasonAgg: { where: { season: CURRENT_SEASON } }, injuries: true },
      orderBy: { isKeyPlayer: "desc" },
    }),
    prisma.player.findMany({
      where: { teamId: fixture.awayTeamId },
      include: { seasonAgg: { where: { season: CURRENT_SEASON } }, injuries: true },
      orderBy: { isKeyPlayer: "desc" },
    }),
  ]);

  let prediction = null;
  try {
    prediction = await predictMatch(fixtureId);
  } catch {
    // serve without prediction
  }

  const serialize = <T,>(obj: T): T => JSON.parse(JSON.stringify(obj));

  return (
    <MatchDashboard
      data={{
        fixture: serialize(fixture),
        homeStats: serialize(homeStats),
        awayStats: serialize(awayStats),
        homeForm: serialize(homeForm),
        awayForm: serialize(awayForm),
        h2h: serialize(h2h),
        homePlayers: serialize(homePlayers),
        awayPlayers: serialize(awayPlayers),
        prediction: serialize(prediction),
      }}
    />
  );
}
