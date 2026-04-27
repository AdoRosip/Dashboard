import { prisma } from "../db";
import { CURRENT_SEASON } from "../constants";
import { upsertTeamFixtureCongestion } from "./congestion";
import { upsertMatchImportanceRow } from "./motivation";
import { computeStartingProbability, type RotationInput } from "./rotation";

const EURO = new Set(["CL", "EC", "CLI"]);

function parseAge(dob: string | null | undefined): number {
  if (!dob) return 26;
  const y = parseInt(dob.slice(0, 4), 10);
  if (Number.isNaN(y)) return 26;
  return Math.max(16, new Date().getFullYear() - y);
}

function thisMatchImportanceTier(pos: number | null | undefined, md: number | null | undefined): string {
  const p = pos ?? 10;
  const m = md ?? 20;
  if (p <= 4 && m >= 30) return "title_race";
  if (p >= 15) return "relegation";
  if (p >= 8 && p <= 14) return "mid_table";
  return "mid_table";
}

async function nextFixtureAfter(teamId: number, after: Date) {
  return prisma.fixture.findFirst({
    where: {
      status: { in: ["SCHEDULED", "TIMED"] },
      utcDate: { gt: after },
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
    },
    orderBy: { utcDate: "asc" },
  });
}

/**
 * Distinguish UEL/UCL group stage (typically MD 1–6) from knockout rounds.
 * Knockout-only rotation stress should not apply to routine group fixtures.
 */
function nextEuropeanMatchImportance(
  next: { competitionId: string; matchday: number | null } | null,
): string | null {
  if (!next || !EURO.has(next.competitionId)) return null;
  const md = next.matchday;
  if (md == null) return "european_unknown";
  if (md <= 6) return "european_group";
  return "knockout_european";
}

function isKnockoutFixture(
  competitionId: string,
  matchday: number | null,
): boolean {
  if (!EURO.has(competitionId)) return false;
  if (matchday == null) return true;
  return matchday > 6;
}

export async function refreshV2ForUpcomingFixtures(aheadDays = 2) {
  const now = new Date();
  const end = new Date(now.getTime() + aheadDays * 24 * 60 * 60 * 1000);

  const fixtures = await prisma.fixture.findMany({
    where: {
      status: { in: ["SCHEDULED", "TIMED"] },
      utcDate: { gte: now, lte: end },
    },
    include: { homeTeam: true, awayTeam: true },
  });

  for (const fx of fixtures) {
    await upsertTeamFixtureCongestion(fx.homeTeamId, fx.id, fx.utcDate);
    await upsertTeamFixtureCongestion(fx.awayTeamId, fx.id, fx.utcDate);

    const isKnockout = isKnockoutFixture(fx.competitionId, fx.matchday);
    const homeStatsComp = fx.homeTeam.competitionId ?? fx.competitionId;
    const awayStatsComp = fx.awayTeam.competitionId ?? fx.competitionId;
    await upsertMatchImportanceRow(
      fx.id,
      fx.homeTeamId,
      fx.homeTeamId,
      fx.awayTeamId,
      fx.competitionId,
      homeStatsComp,
      fx.matchday,
      isKnockout,
    );
    await upsertMatchImportanceRow(
      fx.id,
      fx.awayTeamId,
      fx.homeTeamId,
      fx.awayTeamId,
      fx.competitionId,
      awayStatsComp,
      fx.matchday,
      isKnockout,
    );

    await upsertAvailabilitiesForTeam(fx.id, fx.homeTeamId, fx.utcDate, fx.matchday);
    await upsertAvailabilitiesForTeam(fx.id, fx.awayTeamId, fx.utcDate, fx.matchday);
  }
}

async function upsertAvailabilitiesForTeam(
  fixtureId: number,
  teamId: number,
  fixtureDate: Date,
  matchday: number | null,
) {
  const since7 = new Date(fixtureDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  const since14 = new Date(fixtureDate.getTime() - 14 * 24 * 60 * 60 * 1000);

  const stats = await prisma.teamSeasonStats.findFirst({
    where: { teamId, season: CURRENT_SEASON },
    orderBy: { matchesPlayed: "desc" },
  });
  const pos = stats?.position ?? 10;

  const players = await prisma.player.findMany({
    where: { teamId },
    include: {
      seasonAgg: { where: { season: CURRENT_SEASON }, take: 1 },
    },
  });

  const next = await nextFixtureAfter(teamId, fixtureDate);
  const daysUntilThisMatch =
    (fixtureDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  const daysUntilNext = next
    ? (next.utcDate.getTime() - fixtureDate.getTime()) / (1000 * 60 * 60 * 24)
    : null;

  const nextImp = nextEuropeanMatchImportance(next);

  for (const pl of players) {
    const agg = pl.seasonAgg[0];
    const recentWindow = await prisma.playerMatchStats.findMany({
      where: {
        playerId: pl.id,
        fixture: { utcDate: { gte: since14, lt: fixtureDate } },
      },
      orderBy: { fixture: { utcDate: "desc" } },
      include: { fixture: true },
    });

    let minutes7 = 0;
    let minutes14 = 0;
    let matches7 = 0;
    let startedLast = false;
    let full90Last = false;
    let lastEuroAway = false;

    for (const m of recentWindow) {
      const d = m.fixture.utcDate;
      if (d >= since14) minutes14 += m.minutesPlayed;
      if (d >= since7) {
        minutes7 += m.minutesPlayed;
        matches7++;
      }
    }

    const last = recentWindow[0];
    if (last) {
      startedLast = last.started;
      full90Last = last.minutesPlayed >= 85;
      const f = last.fixture;
      lastEuroAway =
        f.awayTeamId === teamId && EURO.has(f.competitionId);
    }

    const startsRate =
      agg && agg.matches > 0 ? (agg.starts ?? 0) / agg.matches : 0.5;

    const input: RotationInput = {
      playerAge: parseAge(pl.dateOfBirth),
      minutesLast7Days: minutes7,
      minutesLast14Days: minutes14,
      matchesLast7Days: matches7,
      startedLastMatch: startedLast,
      playedFull90LastMatch: full90Last,
      lastMatchWasEuropeanAway: lastEuroAway,
      daysUntilThisMatch: Math.max(0.5, daysUntilThisMatch),
      daysUntilNextMatch: daysUntilNext,
      nextMatchImportance: nextImp,
      thisMatchImportance: thisMatchImportanceTier(pos, matchday),
      isKeyPlayer: pl.isKeyPlayer,
      teamLeaguePosition: pos,
      competitionStage: "league",
      seasonMatchday: matchday ?? undefined,
      deadRubber: false,
    };

    let prob = computeStartingProbability(input);
    if (startsRate < 0.4) prob = Math.min(prob, 0.45);

    let reason = "fit";
    const inj = await prisma.injury.findFirst({
      where: { playerId: pl.id, status: { in: ["out", "doubt"] } },
    });
    if (inj) {
      reason = inj.status === "out" ? "injured" : "doubt";
      prob = inj.status === "out" ? 0.05 : 0.35;
    }

    await prisma.playerAvailability.upsert({
      where: { playerId_fixtureId: { playerId: pl.id, fixtureId } },
      create: {
        playerId: pl.id,
        fixtureId,
        teamId,
        probStarting: prob,
        probInSquad: Math.min(0.98, prob + 0.15),
        reason,
        minutesLast7Days: minutes7,
        minutesLast14Days: minutes14,
        matchesLast7Days: matches7,
        daysUntilNextMatch: daysUntilNext != null ? Math.round(daysUntilNext) : null,
        nextMatchImportance: nextImp,
        travelDistanceLast3: 0,
        playerAge: parseAge(pl.dateOfBirth),
      },
      update: {
        probStarting: prob,
        probInSquad: Math.min(0.98, prob + 0.15),
        reason,
        minutesLast7Days: minutes7,
        minutesLast14Days: minutes14,
        matchesLast7Days: matches7,
        daysUntilNextMatch: daysUntilNext != null ? Math.round(daysUntilNext) : null,
        nextMatchImportance: nextImp,
        playerAge: parseAge(pl.dateOfBirth),
      },
    });
  }
}
