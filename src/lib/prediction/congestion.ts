import { prisma } from "../db";
import { CURRENT_SEASON } from "../constants";
import { estimateTravelKmForAwayMatch, type TravelTier } from "../data/city-coordinates";

function norm(v: number, min: number, max: number): number {
  if (max === min) return 0;
  const t = (v - min) / (max - min);
  return Math.max(0, Math.min(1, t));
}

/** 1 day since last match → 1.0 load signal; 5+ days → 0 */
function restShortageSignal(daysSinceLastMatch: number): number {
  const d = Math.min(Math.max(daysSinceLastMatch, 0), 5);
  return (5 - d) / 5;
}

export interface CongestionComputeResult {
  matchesLast7Days: number;
  matchesLast14Days: number;
  matchesLast21Days: number;
  minutesKeyPlayersLast14Days: number;
  awayMatchesLast14Days: number;
  europeanAwayTripsLast14Days: number;
  estimatedTravelKmLast14Days: number;
  congestionScore: number;
  fatigueModifier: number;
  daysSinceLastMatch: number;
}

const EURO = new Set(["CL", "EC", "CLI"]);

function tierForFixture(competitionId: string, isAway: boolean): TravelTier {
  if (!isAway) return "domestic";
  return EURO.has(competitionId) ? "europe_long" : "domestic";
}

export async function computeTeamCongestionForFixture(
  teamId: number,
  fixtureId: number,
  fixtureDate: Date,
  season = CURRENT_SEASON,
): Promise<CongestionComputeResult> {
  const since21 = new Date(fixtureDate.getTime() - 21 * 24 * 60 * 60 * 1000);
  const since14 = new Date(fixtureDate.getTime() - 14 * 24 * 60 * 60 * 1000);
  const since7 = new Date(fixtureDate.getTime() - 7 * 24 * 60 * 60 * 1000);

  const finished = await prisma.fixture.findMany({
    where: {
      status: "FINISHED",
      utcDate: { gte: since21, lt: fixtureDate },
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
    },
    orderBy: { utcDate: "desc" },
    select: {
      id: true,
      utcDate: true,
      competitionId: true,
      homeTeamId: true,
      awayTeamId: true,
    },
  });

  const lastBefore = finished.filter((f) => f.utcDate < fixtureDate);
  const lastMatchDate = lastBefore[0]?.utcDate;
  const daysSinceLastMatch = lastMatchDate
    ? (fixtureDate.getTime() - lastMatchDate.getTime()) / (1000 * 60 * 60 * 24)
    : 7;

  const in7 = finished.filter((f) => f.utcDate >= since7);
  const in14 = finished.filter((f) => f.utcDate >= since14);
  const in21 = finished;

  let awayMatchesLast14Days = 0;
  let europeanAwayTripsLast14Days = 0;
  let estimatedTravelKmLast14Days = 0;

  for (const f of in14) {
    const isAway = f.awayTeamId === teamId;
    if (isAway) {
      awayMatchesLast14Days++;
      if (EURO.has(f.competitionId)) europeanAwayTripsLast14Days++;
      estimatedTravelKmLast14Days += estimateTravelKmForAwayMatch(
        tierForFixture(f.competitionId, isAway),
      );
    }
  }

  const topPlayers = await prisma.player.findMany({
    where: { teamId },
    select: { id: true },
    orderBy: { id: "asc" },
    take: 40,
  });
  const ids = topPlayers.map((p) => p.id);
  const pms = await prisma.playerMatchStats.findMany({
    where: {
      playerId: { in: ids },
      fixture: { utcDate: { gte: since14, lt: fixtureDate } },
    },
    select: { minutesPlayed: true, playerId: true },
  });
  const byPlayer = new Map<number, number>();
  for (const row of pms) {
    byPlayer.set(row.playerId, (byPlayer.get(row.playerId) ?? 0) + row.minutesPlayed);
  }
  const minutesSorted = [...byPlayer.values()].sort((a, b) => b - a);
  const top5 = minutesSorted.slice(0, 5);
  const minutesKeyPlayersLast14Days =
    top5.length > 0 ? top5.reduce((a, b) => a + b, 0) / top5.length : 0;

  const matchesLast7Days = in7.length;
  const matchesLast14Days = in14.length;
  const matchesLast21Days = in21.length;

  const congestionScore = Math.min(
    1,
    Math.max(
      0,
      0.3 * norm(matchesLast14Days, 1, 6) +
        0.25 * norm(minutesKeyPlayersLast14Days, 180, 900) +
        0.2 * restShortageSignal(daysSinceLastMatch) +
        0.15 * norm(europeanAwayTripsLast14Days, 0, 2) +
        0.1 * norm(matchesLast21Days, 2, 8),
    ),
  );

  const fatigueModifier = 1 - congestionScore * 0.12;

  return {
    matchesLast7Days,
    matchesLast14Days,
    matchesLast21Days,
    minutesKeyPlayersLast14Days,
    awayMatchesLast14Days,
    europeanAwayTripsLast14Days,
    estimatedTravelKmLast14Days,
    congestionScore,
    fatigueModifier,
    daysSinceLastMatch,
  };
}

export async function upsertTeamFixtureCongestion(
  teamId: number,
  fixtureId: number,
  fixtureDate: Date,
  season = CURRENT_SEASON,
) {
  const data = await computeTeamCongestionForFixture(teamId, fixtureId, fixtureDate, season);
  await prisma.teamFixtureCongestion.upsert({
    where: { teamId_fixtureId: { teamId, fixtureId } },
    create: {
      teamId,
      fixtureId,
      season,
      ...data,
    },
    update: { ...data },
  });
}
