/**
 * Understat Data Ingestion Pipeline
 *
 * Ingests data from Understat's JSON API into our Prisma DB:
 *   1. League-level: team xG season aggregates, player season aggregates
 *   2. Match-level: per-team xG breakdown (situational), per-player xG/xA
 *
 * Run standalone: npx tsx src/lib/scrapers/understat-ingest.ts
 * Or as part of the full refresh pipeline.
 */

import { PrismaClient } from "@prisma/client";
import { CURRENT_SEASON, UNDERSTAT_LEAGUE_MAP } from "../constants";
import {
  fetchLeagueData,
  fetchMatchData,
  aggregateTeamSeason,
  computePlayerPer90,
  aggregateShotsByContext,
  computePpda,
  type UnderstatLeagueData,
  type UnderstatTeamMatch,
} from "./understat";
import { matchTeamToDb, matchPlayerToDb } from "./name-mapping";

const prisma = new PrismaClient();

// ─── TEAM xG SEASON STATS ───────────────────────────────────────

/**
 * Ingest team-level xG aggregates from Understat into TeamSeasonStats.
 * Updates xgFor, xgAgainst, xgHome, xgAway for each team.
 */
export async function ingestTeamXg() {
  console.log("[Understat] Ingesting team xG season data...");

  for (const [compCode, usLeague] of Object.entries(UNDERSTAT_LEAGUE_MAP)) {
    const data = await fetchLeagueData(usLeague, CURRENT_SEASON);
    if (!data) {
      console.log(`  ${compCode}: No data available`);
      continue;
    }

    const allDbTeams = await prisma.team.findMany({
      select: { id: true, name: true, shortName: true, competitionId: true },
    });

    const teamIdMap = new Map<string, number>();
    let matched = 0;
    let created = 0;

    for (const [, usTeam] of Object.entries(data.teams)) {
      let dbId = matchTeamToDb(usTeam.title, allDbTeams);

      if (!dbId) {
        const stableId = 800000 + parseInt(usTeam.id);
        try {
          await prisma.team.upsert({
            where: { id: stableId },
            update: { name: usTeam.title, competitionId: compCode },
            create: { id: stableId, name: usTeam.title, competitionId: compCode },
          });
          dbId = stableId;
          allDbTeams.push({ id: stableId, name: usTeam.title, shortName: null, competitionId: compCode });
          created++;
        } catch {
          console.log(`  [WARN] Could not create team: "${usTeam.title}" in ${compCode}`);
          continue;
        }
      }

      teamIdMap.set(usTeam.title, dbId);
      matched++;

      const agg = aggregateTeamSeason(usTeam.history);

      await prisma.teamSeasonStats.upsert({
        where: {
          teamId_competitionId_season: {
            teamId: dbId,
            competitionId: compCode,
            season: CURRENT_SEASON,
          },
        },
        update: {
          xgFor: agg.xgFor,
          xgAgainst: agg.xgAgainst,
          xgHome: agg.xgHome,
          xgAway: agg.xgAway,
        },
        create: {
          teamId: dbId,
          competitionId: compCode,
          season: CURRENT_SEASON,
          xgFor: agg.xgFor,
          xgAgainst: agg.xgAgainst,
          xgHome: agg.xgHome,
          xgAway: agg.xgAway,
        },
      });
    }

    console.log(`  ${compCode}: ${matched}/${Object.keys(data.teams).length} teams matched (${created} newly created)`);

    await ingestPlayerSeasonAgg(compCode, data, teamIdMap);
    await ingestTeamMatchHistory(compCode, data, teamIdMap);
  }

  await logRefresh("understat-team-xg", "success");
}

// ─── PLAYER SEASON AGGREGATES ────────────────────────────────────

/**
 * Ingest player-level xG/xA from Understat into PlayerSeasonAgg.
 * Creates players that don't exist yet, then upserts their season stats.
 */
async function ingestPlayerSeasonAgg(
  compCode: string,
  data: UnderstatLeagueData,
  teamIdMap: Map<string, number>,
) {
  console.log(`  [Understat] Ingesting player season agg for ${compCode}...`);

  const dbPlayers = await prisma.player.findMany({
    select: { id: true, name: true, teamId: true },
  });

  let upserted = 0;
  let created = 0;

  for (const usPlayer of data.players) {
    const teamId = teamIdMap.get(usPlayer.team_title);
    if (!teamId) continue;

    const minutes = parseInt(usPlayer.time) || 0;
    if (minutes < 90) continue;

    let playerId = matchPlayerToDb(
      usPlayer.player_name,
      usPlayer.team_title,
      dbPlayers,
      teamIdMap,
    );

    if (!playerId) {
      const understatId = parseInt(usPlayer.id);
      const stableId = 900000 + understatId;

      try {
        await prisma.player.upsert({
          where: { id: stableId },
          update: {
            name: usPlayer.player_name,
            teamId,
            position: mapPosition(usPlayer.position),
          },
          create: {
            id: stableId,
            name: usPlayer.player_name,
            teamId,
            position: mapPosition(usPlayer.position),
          },
        });
        playerId = stableId;
        dbPlayers.push({
          id: stableId,
          name: usPlayer.player_name,
          teamId,
        });
        created++;
      } catch {
        continue;
      }
    }

    const per90 = computePlayerPer90(usPlayer);
    const goals = parseInt(usPlayer.goals) || 0;
    const assists = parseInt(usPlayer.assists) || 0;
    const shots = parseInt(usPlayer.shots) || 0;
    const xg = parseFloat(usPlayer.xG) || 0;
    const xa = parseFloat(usPlayer.xA) || 0;
    const games = parseInt(usPlayer.games) || 0;

    try {
      await prisma.playerSeasonAgg.upsert({
        where: {
          playerId_competitionId_season: {
            playerId,
            competitionId: compCode,
            season: CURRENT_SEASON,
          },
        },
        update: {
          matches: games,
          minutes,
          goals,
          assists,
          xg: round(xg),
          xa: round(xa),
          goalsPer90: per90.goalsPer90,
          xgPer90: per90.xgPer90,
          xaPer90: per90.xaPer90,
          shotConversion: shots > 0 ? round(goals / shots) : 0,
        },
        create: {
          playerId,
          competitionId: compCode,
          season: CURRENT_SEASON,
          matches: games,
          minutes,
          goals,
          assists,
          xg: round(xg),
          xa: round(xa),
          goalsPer90: per90.goalsPer90,
          xgPer90: per90.xgPer90,
          xaPer90: per90.xaPer90,
          shotConversion: shots > 0 ? round(goals / shots) : 0,
        },
      });
      upserted++;
    } catch {
      // skip constraint violations for players on multiple teams
    }
  }

  console.log(`    Players: ${upserted} upserted, ${created} newly created`);
}

// ─── FIXTURES + TEAM MATCH HISTORY ───────────────────────────────

/**
 * Create fixtures from Understat's dates data and attach per-team
 * xG/PPDA/deep stats from match history. This backfills the full season
 * of fixtures that football-data.org's narrow date window doesn't cover.
 */
async function ingestTeamMatchHistory(
  compCode: string,
  data: UnderstatLeagueData,
  teamIdMap: Map<string, number>,
) {
  console.log(`  [Understat] Ingesting fixtures + match stats for ${compCode}...`);

  let fixturesLinked = 0;
  let syntheticFixturesCreated = 0;
  let statsCreated = 0;
  const fixtureIdByUnderstatId = new Map<string, number>();

  for (const usDate of data.dates) {
    if (!usDate.isResult) continue;

    const homeTeamId = teamIdMap.get(usDate.h.title);
    const awayTeamId = teamIdMap.get(usDate.a.title);
    if (!homeTeamId || !awayTeamId) continue;

    const matchDate = new Date(usDate.datetime.replace(" ", "T") + "Z");
    const homeGoals = parseInt(usDate.goals.h) || 0;
    const awayGoals = parseInt(usDate.goals.a) || 0;

    try {
      const resolved = await upsertUnderstatFixture({
        understatId: usDate.id,
        competitionId: compCode,
        homeTeamId,
        awayTeamId,
        matchDate,
        homeGoals,
        awayGoals,
      });
      fixtureIdByUnderstatId.set(usDate.id, resolved.fixtureId);
      if (resolved.createdSynthetic) syntheticFixturesCreated++;
      else fixturesLinked++;
    } catch {
      continue;
    }
  }

  // Now attach per-team stats from team history
  const teamHistoryByDate = new Map<string, { teamId: number; usTeamTitle: string; match: UnderstatTeamMatch }>();
  for (const [, usTeam] of Object.entries(data.teams)) {
    const teamId = teamIdMap.get(usTeam.title);
    if (!teamId) continue;
    for (const match of usTeam.history) {
      const key = match.date.slice(0, 10) + "_" + (match.h_a === "h" ? "home" : "away") + "_" + teamId;
      teamHistoryByDate.set(key, { teamId, usTeamTitle: usTeam.title, match });
    }
  }

  for (const usDate of data.dates) {
    if (!usDate.isResult) continue;

    const homeTeamId = teamIdMap.get(usDate.h.title);
    const awayTeamId = teamIdMap.get(usDate.a.title);
    if (!homeTeamId || !awayTeamId) continue;

    const dateKey = usDate.datetime.slice(0, 10);
    const fixtureId =
      fixtureIdByUnderstatId.get(usDate.id) ??
      (await findCanonicalFixtureId(homeTeamId, awayTeamId, dateKey, compCode)) ??
      700000 + parseInt(usDate.id);

    for (const [teamId, isHome] of [[homeTeamId, true], [awayTeamId, false]] as [number, boolean][]) {
      const key = dateKey + "_" + (isHome ? "home" : "away") + "_" + teamId;
      const entry = teamHistoryByDate.get(key);
      if (!entry) continue;

      const m = entry.match;
      const ppda = computePpda(m.ppda);
      const deep = parseInt(m.deep) || 0;
      const xg = parseFloat(m.xG) || 0;
      const xga = parseFloat(m.xGA) || 0;
      const scored = parseInt(m.scored) || 0;
      const missed = parseInt(m.missed) || 0;

      try {
        await prisma.teamMatchStats.upsert({
          where: { fixtureId_teamId: { fixtureId, teamId } },
          update: {
            xg: round(xg), xgAgainst: round(xga), ppda, deepCompletions: deep,
            goalsScored: scored, goalsConceded: missed,
            xgOverperformance: round(scored - xg),
          },
          create: {
            fixtureId, teamId, competitionId: compCode, isHome,
            xg: round(xg), xgAgainst: round(xga), ppda, deepCompletions: deep,
            goalsScored: scored, goalsConceded: missed,
            xgOverperformance: round(scored - xg),
          },
        });
        statsCreated++;
      } catch {
        // skip
      }
    }
  }

  console.log(
    `    Fixtures: ${fixturesLinked} linked, ${syntheticFixturesCreated} synthetic created, TeamMatchStats: ${statsCreated} upserted`,
  );
}

// ─── MATCH-LEVEL DETAILED DATA (shots + rosters) ────────────────

/**
 * Ingest shot-by-shot and roster data for specific matches.
 * This is more expensive (1 API call per match) so should be used
 * selectively for upcoming/recent matches.
 */
export async function ingestMatchDetails(matchIds: string[]) {
  console.log(`[Understat] Ingesting match details for ${matchIds.length} matches...`);

  let processed = 0;

  for (const usMatchId of matchIds) {
    const matchData = await fetchMatchData(usMatchId);
    if (!matchData) continue;

    const homeShots = matchData.shots?.h ?? [];
    const awayShots = matchData.shots?.a ?? [];

    if (homeShots.length === 0 && awayShots.length === 0) continue;

    const sample = homeShots[0] ?? awayShots[0];
    if (!sample) continue;

    const dateKey = sample.date?.slice(0, 10);
    const homeTeamName = sample.h_team;
    const awayTeamName = sample.a_team;

    const dbTeams = await prisma.team.findMany({
      select: { id: true, name: true, shortName: true },
    });

    const homeTeamId = matchTeamToDb(homeTeamName, dbTeams);
    const awayTeamId = matchTeamToDb(awayTeamName, dbTeams);

    if (!homeTeamId || !awayTeamId) {
      console.log(`  [WARN] Could not match teams: ${homeTeamName} vs ${awayTeamName}`);
      continue;
    }

    const dbFixture = await prisma.fixture.findFirst({
      where: {
        homeTeamId,
        awayTeamId,
        utcDate: {
          gte: new Date(dateKey + "T00:00:00Z"),
          lt: new Date(dateKey + "T23:59:59Z"),
        },
      },
    });

    if (!dbFixture) continue;

    const homeAgg = aggregateShotsByContext(homeShots);
    const awayAgg = aggregateShotsByContext(awayShots);

    try {
      await prisma.teamMatchStats.upsert({
        where: {
          fixtureId_teamId: { fixtureId: dbFixture.id, teamId: homeTeamId },
        },
        update: {
          xg: homeAgg.total,
          xgOpenPlay: homeAgg.openPlay,
          xgSetPiece: homeAgg.setPiece,
          xgCounter: homeAgg.counter,
          xgFirstHalf: homeAgg.firstHalf,
          xgSecondHalf: homeAgg.secondHalf,
          shots: homeAgg.shotCount,
          shotsOnTarget: homeAgg.onTarget,
        },
        create: {
          fixtureId: dbFixture.id,
          teamId: homeTeamId,
          competitionId: dbFixture.competitionId,
          isHome: true,
          xg: homeAgg.total,
          xgOpenPlay: homeAgg.openPlay,
          xgSetPiece: homeAgg.setPiece,
          xgCounter: homeAgg.counter,
          xgFirstHalf: homeAgg.firstHalf,
          xgSecondHalf: homeAgg.secondHalf,
          shots: homeAgg.shotCount,
          shotsOnTarget: homeAgg.onTarget,
        },
      });

      await prisma.teamMatchStats.upsert({
        where: {
          fixtureId_teamId: { fixtureId: dbFixture.id, teamId: awayTeamId },
        },
        update: {
          xg: awayAgg.total,
          xgOpenPlay: awayAgg.openPlay,
          xgSetPiece: awayAgg.setPiece,
          xgCounter: awayAgg.counter,
          xgFirstHalf: awayAgg.firstHalf,
          xgSecondHalf: awayAgg.secondHalf,
          shots: awayAgg.shotCount,
          shotsOnTarget: awayAgg.onTarget,
        },
        create: {
          fixtureId: dbFixture.id,
          teamId: awayTeamId,
          competitionId: dbFixture.competitionId,
          isHome: false,
          xg: awayAgg.total,
          xgOpenPlay: awayAgg.openPlay,
          xgSetPiece: awayAgg.setPiece,
          xgCounter: awayAgg.counter,
          xgFirstHalf: awayAgg.firstHalf,
          xgSecondHalf: awayAgg.secondHalf,
          shots: awayAgg.shotCount,
          shotsOnTarget: awayAgg.onTarget,
        },
      });
    } catch {
      // skip
    }

    await ingestMatchRosters(
      matchData,
      dbFixture.id,
      dbFixture.competitionId,
      homeTeamId,
      awayTeamId,
    );

    processed++;
  }

  console.log(`[Understat] Match details: ${processed}/${matchIds.length} processed`);
  await logRefresh("understat-match-details", "success", undefined, processed);
}

/**
 * Ingest per-player match stats from Understat rosters into PlayerMatchStats.
 */
async function ingestMatchRosters(
  matchData: Awaited<ReturnType<typeof fetchMatchData>>,
  fixtureId: number,
  competitionId: string,
  homeTeamId: number,
  awayTeamId: number,
) {
  if (!matchData?.rosters) return;

  const dbPlayers = await prisma.player.findMany({
    select: { id: true, name: true, teamId: true },
  });

  const sides = [
    { roster: matchData.rosters.h, teamId: homeTeamId, side: "h" as const },
    { roster: matchData.rosters.a, teamId: awayTeamId, side: "a" as const },
  ];

  for (const { roster, teamId } of sides) {
    for (const rp of Object.values(roster)) {
      const minutes = parseInt(rp.time) || 0;
      if (minutes === 0) continue;

      let playerId: number | null = null;

      for (const p of dbPlayers) {
        if (p.teamId === teamId && normalize(p.name) === normalize(rp.player)) {
          playerId = p.id;
          break;
        }
      }

      if (!playerId) {
        const usId = parseInt(rp.player_id);
        const stableId = 900000 + usId;
        try {
          await prisma.player.upsert({
            where: { id: stableId },
            update: { name: rp.player, teamId, position: rp.position },
            create: {
              id: stableId,
              name: rp.player,
              teamId,
              position: rp.position,
            },
          });
          playerId = stableId;
          dbPlayers.push({ id: stableId, name: rp.player, teamId });
        } catch {
          continue;
        }
      }

      try {
        await prisma.playerMatchStats.upsert({
          where: {
            fixtureId_playerId: { fixtureId, playerId },
          },
          update: {
            minutesPlayed: minutes,
            started: rp.roster_in === "0",
            positionPlayed: rp.position,
            goals: parseInt(rp.goals) || 0,
            assists: parseInt(rp.assists) || 0,
            shots: parseInt(rp.shots) || 0,
            xg: round(parseFloat(rp.xG) || 0),
            xa: round(parseFloat(rp.xA) || 0),
            keyPasses: parseInt(rp.key_passes) || 0,
          },
          create: {
            fixtureId,
            playerId,
            teamId,
            competitionId,
            minutesPlayed: minutes,
            started: rp.roster_in === "0",
            positionPlayed: rp.position,
            goals: parseInt(rp.goals) || 0,
            assists: parseInt(rp.assists) || 0,
            shots: parseInt(rp.shots) || 0,
            xg: round(parseFloat(rp.xG) || 0),
            xa: round(parseFloat(rp.xA) || 0),
            keyPasses: parseInt(rp.key_passes) || 0,
          },
        });
      } catch {
        // skip constraint issues
      }
    }
  }
}

// ─── RECENT MATCH IDS DISCOVERY ──────────────────────────────────

/**
 * Get Understat match IDs for recently finished matches (for detailed ingestion).
 */
export async function getRecentMatchIds(
  league: string,
  season: string,
  daysBack = 7,
): Promise<string[]> {
  const data = await fetchLeagueData(league, season);
  if (!data) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  return data.dates
    .filter((d) => {
      if (!d.isResult) return false;
      const matchDate = new Date(d.datetime);
      return matchDate >= cutoff;
    })
    .map((d) => d.id);
}

// ─── FULL UNDERSTAT REFRESH ──────────────────────────────────────

/**
 * Full Understat data refresh pipeline.
 * 1. Ingest league-level team xG + player aggregates for all leagues
 * 2. Ingest match-level details for recent matches (last N days)
 */
export async function refreshUnderstat(detailDaysBack = 7) {
  console.log("=== Starting Understat refresh ===");
  const start = Date.now();

  await ingestTeamXg();

  for (const [, usLeague] of Object.entries(UNDERSTAT_LEAGUE_MAP)) {
    const recentIds = await getRecentMatchIds(
      usLeague,
      CURRENT_SEASON,
      detailDaysBack,
    );
    if (recentIds.length > 0) {
      console.log(
        `  ${usLeague}: ${recentIds.length} recent matches to detail-ingest`,
      );
      await ingestMatchDetails(recentIds);
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`=== Understat refresh complete in ${elapsed}s ===`);
}

// ─── HELPERS ─────────────────────────────────────────────────────

async function findCanonicalFixtureId(
  homeTeamId: number,
  awayTeamId: number,
  dateKey: string,
  compCode: string,
): Promise<number | null> {
  const dayStart = new Date(dateKey + "T00:00:00Z");
  const dayEnd = new Date(dateKey + "T23:59:59Z");

  const fixture = await prisma.fixture.findFirst({
    where: {
      competitionId: compCode,
      homeTeamId,
      awayTeamId,
      utcDate: { gte: dayStart, lt: dayEnd },
    },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  return fixture?.id ?? null;
}

async function upsertUnderstatFixture(params: {
  understatId: string;
  competitionId: string;
  homeTeamId: number;
  awayTeamId: number;
  matchDate: Date;
  homeGoals: number;
  awayGoals: number;
}): Promise<{ fixtureId: number; createdSynthetic: boolean }> {
  const dateKey = params.matchDate.toISOString().slice(0, 10);
  const canonicalFixtureId = await findCanonicalFixtureId(
    params.homeTeamId,
    params.awayTeamId,
    dateKey,
    params.competitionId,
  );
  const winner =
    params.homeGoals > params.awayGoals
      ? "HOME"
      : params.homeGoals < params.awayGoals
        ? "AWAY"
        : "DRAW";

  if (canonicalFixtureId != null) {
    await prisma.fixture.update({
      where: { id: canonicalFixtureId },
      data: {
        status: "FINISHED",
        scoreHomeFt: params.homeGoals,
        scoreAwayFt: params.awayGoals,
        winner,
      },
    });
    return { fixtureId: canonicalFixtureId, createdSynthetic: false };
  }

  const syntheticFixtureId = 700000 + parseInt(params.understatId);
  const existingSynthetic = await prisma.fixture.findUnique({
    where: { id: syntheticFixtureId },
    select: { id: true },
  });

  await prisma.fixture.upsert({
    where: { id: syntheticFixtureId },
    update: {
      status: "FINISHED",
      scoreHomeFt: params.homeGoals,
      scoreAwayFt: params.awayGoals,
      winner,
    },
    create: {
      id: syntheticFixtureId,
      competitionId: params.competitionId,
      homeTeamId: params.homeTeamId,
      awayTeamId: params.awayTeamId,
      utcDate: params.matchDate,
      status: "FINISHED",
      scoreHomeFt: params.homeGoals,
      scoreAwayFt: params.awayGoals,
      winner,
    },
  });

  return {
    fixtureId: syntheticFixtureId,
    createdSynthetic: existingSynthetic == null,
  };
}

function mapPosition(usPosition: string): string {
  const parts = usPosition
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const posMap: Record<string, string> = {
    F: "Forward",
    M: "Midfielder",
    D: "Defender",
    GK: "Goalkeeper",
    S: "Sub",
  };
  return parts.map((p) => posMap[p] || p).join(", ");
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

async function logRefresh(
  source: string,
  status: string,
  message?: string,
  count = 0,
) {
  try {
    await prisma.dataRefreshLog.create({
      data: { source, status, message, count },
    });
  } catch {
    // non-critical
  }
}

// ─── STANDALONE RUNNER ───────────────────────────────────────────

if (require.main === module) {
  refreshUnderstat()
    .then(() => {
      console.log("Done.");
      return prisma.$disconnect();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Fatal error:", err);
      prisma.$disconnect();
      process.exit(1);
    });
}
