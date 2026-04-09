import { prisma } from "@/lib/db";
import { CURRENT_SEASON } from "@/lib/constants";
import { predictMatch, type PredictionResult } from "@/lib/prediction";

const EUROPEAN_COMPETITION_IDS = ["CL", "EC", "CLI"];

import type {
  Competition,
  Fixture,
  H2HMatch,
  Injury,
  Player,
  PlayerSeasonAgg,
  Team,
  TeamSeasonStats,
} from "@prisma/client";

type FixtureWithRelations = Fixture & {
  homeTeam: Team;
  awayTeam: Team;
  competition: Competition;
};

type PlayerWithRelations = Player & {
  seasonAgg: PlayerSeasonAgg[];
  injuries: Injury[];
};

type H2HWithComp = H2HMatch & { competition: Competition | null };

export interface MatchData {
  fixture: FixtureWithRelations;
  homeStats: TeamSeasonStats | null;
  awayStats: TeamSeasonStats | null;
  homeForm: FixtureWithRelations[];
  awayForm: FixtureWithRelations[];
  h2h: H2HWithComp[];
  homePlayers: PlayerWithRelations[];
  awayPlayers: PlayerWithRelations[];
  prediction: PredictionResult | null;
}

/**
 * Fetch team season stats with fallback for European competitions.
 * If the fixture is in CL/EC/CLI and no stats exist for that competition,
 * falls back to the team's domestic league stats.
 */
async function fetchTeamSeasonStats(
  teamId: number,
  fixtureCompetitionId: string,
  teamDomesticCompetitionId: string | null | undefined,
) {
  const stats = await prisma.teamSeasonStats.findFirst({
    where: {
      teamId,
      competitionId: fixtureCompetitionId,
      season: CURRENT_SEASON,
    },
  });

  if (
    !stats &&
    EUROPEAN_COMPETITION_IDS.includes(fixtureCompetitionId) &&
    teamDomesticCompetitionId
  ) {
    return prisma.teamSeasonStats.findFirst({
      where: {
        teamId,
        competitionId: teamDomesticCompetitionId,
        season: CURRENT_SEASON,
      },
    });
  }

  return stats;
}

/**
 * predictMatch handles its own DB cache check (6h TTL) and auto-saves.
 * We just need to catch failures gracefully.
 */
async function resolvePrediction(
  fixtureId: number,
): Promise<PredictionResult | null> {
  try {
    return await predictMatch(fixtureId);
  } catch {
    return null;
  }
}

/**
 * Fetch all match data needed for the match page and API.
 * Returns null if the fixture does not exist.
 */
export async function fetchMatchData(
  fixtureId: number,
): Promise<MatchData | null> {
  const fixture = await prisma.fixture.findUnique({
    where: { id: fixtureId },
    include: { homeTeam: true, awayTeam: true, competition: true },
  });

  if (!fixture) return null;

  const [homeStats, awayStats, homeForm, awayForm, homePlayers, awayPlayers] =
    await Promise.all([
      fetchTeamSeasonStats(
        fixture.homeTeamId,
        fixture.competitionId,
        fixture.homeTeam.competitionId,
      ),
      fetchTeamSeasonStats(
        fixture.awayTeamId,
        fixture.competitionId,
        fixture.awayTeam.competitionId,
      ),
      prisma.fixture.findMany({
        where: {
          status: "FINISHED",
          OR: [
            { homeTeamId: fixture.homeTeamId },
            { awayTeamId: fixture.homeTeamId },
          ],
        },
        orderBy: { utcDate: "desc" },
        take: 6,
        include: { homeTeam: true, awayTeam: true, competition: true },
      }),
      prisma.fixture.findMany({
        where: {
          status: "FINISHED",
          OR: [
            { homeTeamId: fixture.awayTeamId },
            { awayTeamId: fixture.awayTeamId },
          ],
        },
        orderBy: { utcDate: "desc" },
        take: 6,
        include: { homeTeam: true, awayTeam: true, competition: true },
      }),
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

  const [idA, idB] =
    fixture.homeTeamId < fixture.awayTeamId
      ? [fixture.homeTeamId, fixture.awayTeamId]
      : [fixture.awayTeamId, fixture.homeTeamId];

  const h2h = await prisma.h2HMatch.findMany({
    where: { teamAId: idA, teamBId: idB },
    orderBy: { date: "desc" },
    take: 10,
    include: { competition: true },
  });

  const prediction = await resolvePrediction(fixtureId);

  return {
    fixture,
    homeStats,
    awayStats,
    homeForm,
    awayForm,
    h2h,
    homePlayers,
    awayPlayers,
    prediction,
  };
}
