import { prisma } from "./db";
import { fetchFootballData } from "./api-client";
import {
  COMPETITIONS,
  CURRENT_SEASON,
  COMPETITION_CODES,
  DEFAULT_UPCOMING_DAYS,
  MAX_UPCOMING_DAYS,
} from "./constants";
import { refreshUnderstat } from "./scrapers/understat-ingest";
import { refreshV2ForUpcomingFixtures } from "./prediction/pipeline-v2";
import {
  refreshOddsForUpcomingFixtures,
  recomputeValuePicksForUpcoming,
} from "./odds";
import { settleValuePicks } from "./odds/settle";
import { recomputeBettingPerformance } from "./odds/performance";

// ─── TYPES ───────────────────────────────────────────────────────

interface FDTeam {
  id: number;
  name: string;
  shortName?: string;
  tla?: string;
  crest?: string;
}

interface FDScore {
  fullTime: { home: number | null; away: number | null };
  halfTime?: { home: number | null; away: number | null };
}

interface FDMatch {
  id: number;
  competition: { id: number; name: string; code: string; emblem?: string; area?: { name: string } };
  homeTeam: FDTeam;
  awayTeam: FDTeam;
  utcDate: string;
  status: string;
  matchday?: number;
  venue?: string;
  score?: FDScore;
}

interface FDStanding {
  table: Array<{
    team: FDTeam;
    position: number;
    playedGames: number;
    won: number;
    draw: number;
    lost: number;
    points: number;
    goalsFor: number;
    goalsAgainst: number;
    form: string | null;
  }>;
}

interface FDScorer {
  player: {
    id: number;
    name: string;
    nationality?: string;
    position?: string;
  };
  team: FDTeam;
  goals: number | null;
  assists: number | null;
}

// ─── HELPERS ─────────────────────────────────────────────────────

function toISODate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function clampUpcomingDays(n: number): number {
  return Math.min(Math.max(1, Math.floor(n)), MAX_UPCOMING_DAYS);
}

function seasonBounds(season: string): { start: Date; end: Date } {
  const startYear = parseInt(season, 10);
  if (Number.isNaN(startYear)) {
    const now = new Date();
    return {
      start: new Date(Date.UTC(now.getUTCFullYear(), 6, 1)),
      end: new Date(Date.UTC(now.getUTCFullYear() + 1, 5, 30, 23, 59, 59, 999)),
    };
  }
  return {
    start: new Date(Date.UTC(startYear, 6, 1)),
    end: new Date(Date.UTC(startYear + 1, 5, 30, 23, 59, 59, 999)),
  };
}

function computeWinner(home: number | null, away: number | null): string | null {
  if (home == null || away == null) return null;
  return home > away ? "HOME" : home < away ? "AWAY" : "DRAW";
}

/**
 * When Football-Data returns TIMED + null scores after full-time, we must not wipe
 * scores we already stored from a FINISHED ingest. Prefer API when it sends a number;
 * otherwise keep the existing DB value.
 */
function mergeScore(
  api: number | null | undefined,
  existing: number | null | undefined,
): number | null {
  if (api !== null && api !== undefined) return api;
  return existing ?? null;
}

async function logRefresh(
  source: string,
  status: string,
  message?: string,
  count = 0,
) {
  await prisma.dataRefreshLog.create({
    data: { source, status, message, count },
  });
}

async function ensureCompetitions() {
  for (const comp of COMPETITIONS) {
    await prisma.competition.upsert({
      where: { code: comp.code },
      update: { name: comp.name, country: comp.country, isEuropean: comp.isEuropean },
      create: {
        id: comp.code,
        code: comp.code,
        name: comp.name,
        country: comp.country,
        isEuropean: comp.isEuropean,
      },
    });
  }
}

const EUROPEAN_COMP_IDS = new Set(["CL", "EC", "CLI"]);

/**
 * football-data.org v4 league codes differ from our internal `competitionId` strings
 * (kept for Odds API + DB). Without this, EL matches were dropped in `upsertMatch`.
 * - UEFA Europa League → API **EL** → we store **EC**
 */
const FOOTBALL_DATA_CODE_TO_INTERNAL: Record<string, string> = {
  EL: "EC",
};

function normalizeFootballDataCompetitionCode(apiCode: string): string {
  return FOOTBALL_DATA_CODE_TO_INTERNAL[apiCode] ?? apiCode;
}

async function upsertTeam(team: FDTeam, competitionId: string) {
  const isEuropean = EUROPEAN_COMP_IDS.has(competitionId);

  // Never overwrite a domestic competitionId with a European one.
  // A team's competitionId should reflect their primary domestic league.
  if (isEuropean) {
    const existing = await prisma.team.findUnique({ where: { id: team.id }, select: { competitionId: true } });
    if (existing?.competitionId && !EUROPEAN_COMP_IDS.has(existing.competitionId)) {
      await prisma.team.update({
        where: { id: team.id },
        data: {
          name: team.name,
          shortName: team.shortName ?? null,
          tla: team.tla ?? null,
          crest: team.crest ?? null,
        },
      });
      return;
    }
  }

  await prisma.team.upsert({
    where: { id: team.id },
    update: {
      name: team.name,
      shortName: team.shortName ?? null,
      tla: team.tla ?? null,
      crest: team.crest ?? null,
      competitionId,
    },
    create: {
      id: team.id,
      name: team.name,
      shortName: team.shortName ?? null,
      tla: team.tla ?? null,
      crest: team.crest ?? null,
      competitionId,
    },
  });
}

async function upsertMatch(match: FDMatch) {
  const compCode = normalizeFootballDataCompetitionCode(match.competition.code);
  const validCodes = COMPETITION_CODES as readonly string[];
  if (!validCodes.includes(compCode)) return;

  await upsertTeam(match.homeTeam, compCode);
  await upsertTeam(match.awayTeam, compCode);

  const apiHomeFt = match.score?.fullTime?.home;
  const apiAwayFt = match.score?.fullTime?.away;
  const apiHomeHt = match.score?.halfTime?.home;
  const apiAwayHt = match.score?.halfTime?.away;

  const existing = await prisma.fixture.findUnique({
    where: { id: match.id },
    select: {
      scoreHomeFt: true,
      scoreAwayFt: true,
      scoreHomeHt: true,
      scoreAwayHt: true,
    },
  });

  const scoreHomeFt = mergeScore(apiHomeFt, existing?.scoreHomeFt);
  const scoreAwayFt = mergeScore(apiAwayFt, existing?.scoreAwayFt);
  const scoreHomeHt = mergeScore(apiHomeHt, existing?.scoreHomeHt);
  const scoreAwayHt = mergeScore(apiAwayHt, existing?.scoreAwayHt);

  await prisma.fixture.upsert({
    where: { id: match.id },
    update: {
      utcDate: new Date(match.utcDate),
      status: match.status,
      matchday: match.matchday ?? null,
      scoreHomeFt,
      scoreAwayFt,
      scoreHomeHt,
      scoreAwayHt,
      winner: computeWinner(scoreHomeFt, scoreAwayFt),
    },
    create: {
      id: match.id,
      competitionId: compCode,
      homeTeamId: match.homeTeam.id,
      awayTeamId: match.awayTeam.id,
      utcDate: new Date(match.utcDate),
      status: match.status,
      matchday: match.matchday ?? null,
      venue: match.venue ?? null,
      scoreHomeFt,
      scoreAwayFt,
      scoreHomeHt,
      scoreAwayHt,
      winner: computeWinner(scoreHomeFt, scoreAwayFt),
    },
  });
}

// ─── FIXTURES — UPCOMING WINDOW ──────────────────────────────────
// Single API call for ALL competitions using date range filter.
// Default window: next 2 days. No reason to fetch 70 matches.

export async function ingestFixtures(aheadDays = 2) {
  console.log(`Ingesting upcoming fixtures (next ${aheadDays} days)...`);
  await ensureCompetitions();

  const dateFrom = toISODate(new Date());
  const dateTo = toISODate(new Date(Date.now() + aheadDays * 24 * 60 * 60 * 1000));

  try {
    const data = await fetchFootballData<{ matches: FDMatch[] }>(
      `/matches?dateFrom=${dateFrom}&dateTo=${dateTo}&status=SCHEDULED,TIMED`,
    );

    let count = 0;
    for (const match of data.matches ?? []) {
      await upsertMatch(match);
      count++;
    }

    console.log(`  ${count} upcoming fixtures across all competitions`);
    await logRefresh("fixtures", "success", `${dateFrom} to ${dateTo}`, count);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  Error fetching fixtures: ${msg}`);
    await logRefresh("fixtures", "error", msg);
  }
}

// ─── RECENT RESULTS — LAST N DAYS ───────────────────────────────
// Date-range only (no status=FINISHED): Football-Data can expose fullTime scores while
// status is still TIMED; FINISHED-only would miss them until the status flips.

export async function ingestRecentResults(daysBack = 7) {
  console.log(`Ingesting recent results (last ${daysBack} days)...`);
  await ensureCompetitions();

  const dateTo = toISODate(new Date());
  const dateFrom = toISODate(new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000));

  try {
    const data = await fetchFootballData<{ matches: FDMatch[] }>(
      `/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`,
    );

    let count = 0;
    for (const match of data.matches ?? []) {
      await upsertMatch(match);
      count++;
    }

    console.log(`  ${count} recent results ingested`);
    await logRefresh("results", "success", `${dateFrom} to ${dateTo}`, count);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  Error fetching results: ${msg}`);
    await logRefresh("results", "error", msg);
  }
}

// ─── STANDINGS ───────────────────────────────────────────────────
// Still per-competition (no cross-competition endpoint for standings).
// Only fetch for the 5 domestic leagues — European cups don't have
// traditional standings after group stages.

const DOMESTIC_LEAGUES = COMPETITIONS.filter((c) => !c.isEuropean);

export async function ingestStandings() {
  console.log("Ingesting standings...");

  for (const comp of DOMESTIC_LEAGUES) {
    try {
      const data = await fetchFootballData<{ standings: FDStanding[] }>(
        `/competitions/${comp.code}/standings`,
      );

      const table = data.standings?.[0]?.table ?? [];

      for (const row of table) {
        await upsertTeam(row.team, comp.code);

        await prisma.teamSeasonStats.upsert({
          where: {
            teamId_competitionId_season: {
              teamId: row.team.id,
              competitionId: comp.code,
              season: CURRENT_SEASON,
            },
          },
          update: {
            matchesPlayed: row.playedGames,
            wins: row.won,
            draws: row.draw,
            losses: row.lost,
            points: row.points,
            position: row.position,
            goalsScored: row.goalsFor,
            goalsConceded: row.goalsAgainst,
            form: row.form ?? "",
          },
          create: {
            teamId: row.team.id,
            competitionId: comp.code,
            season: CURRENT_SEASON,
            matchesPlayed: row.playedGames,
            wins: row.won,
            draws: row.draw,
            losses: row.lost,
            points: row.points,
            position: row.position,
            goalsScored: row.goalsFor,
            goalsConceded: row.goalsAgainst,
            form: row.form ?? "",
          },
        });
      }
      console.log(`  ${comp.name}: ${table.length} teams`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Error fetching standings ${comp.name}: ${msg}`);
      await logRefresh("standings", "error", `${comp.name}: ${msg}`);
    }
  }

  await logRefresh("standings", "success");
}

// ─── TOP SCORERS ─────────────────────────────────────────────────
// Per-competition (no cross-comp endpoint). Domestic leagues only.

export async function ingestTopScorers() {
  console.log("Ingesting top scorers...");

  for (const comp of DOMESTIC_LEAGUES) {
    try {
      const data = await fetchFootballData<{ scorers: FDScorer[] }>(
        `/competitions/${comp.code}/scorers?limit=30`,
      );

      for (const scorer of data.scorers ?? []) {
        const playerId = scorer.player.id;
        const teamId = scorer.team.id;

        await prisma.player.upsert({
          where: { id: playerId },
          update: {
            name: scorer.player.name,
            position: scorer.player.position ?? null,
            nationality: scorer.player.nationality ?? null,
            teamId,
          },
          create: {
            id: playerId,
            teamId,
            name: scorer.player.name,
            position: scorer.player.position ?? null,
            nationality: scorer.player.nationality ?? null,
          },
        });

        await prisma.playerSeasonAgg.upsert({
          where: {
            playerId_competitionId_season: {
              playerId,
              competitionId: comp.code,
              season: CURRENT_SEASON,
            },
          },
          update: {
            goals: scorer.goals ?? 0,
            assists: scorer.assists ?? 0,
          },
          create: {
            playerId,
            competitionId: comp.code,
            season: CURRENT_SEASON,
            goals: scorer.goals ?? 0,
            assists: scorer.assists ?? 0,
          },
        });
      }
      console.log(
        `  ${comp.name}: ${data.scorers?.length ?? 0} scorers`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Error fetching scorers ${comp.name}: ${msg}`);
    }
  }

  await logRefresh("scorers", "success");
}

// ─── DERIVED STATS ───────────────────────────────────────────────
// Computed from local DB data — no API calls.

export async function computeDerivedStats() {
  console.log("Computing derived stats...");
  const { start: seasonStart, end: seasonEnd } = seasonBounds(CURRENT_SEASON);

  const teams = await prisma.team.findMany();

  for (const team of teams) {
    if (!team.competitionId) continue;

    const [homeFixtures, awayFixtures] = await Promise.all([
      prisma.fixture.findMany({
        where: {
          status: "FINISHED",
          competitionId: team.competitionId,
          homeTeamId: team.id,
          utcDate: { gte: seasonStart, lte: seasonEnd },
        },
        orderBy: { utcDate: "desc" },
      }),
      prisma.fixture.findMany({
        where: {
          status: "FINISHED",
          competitionId: team.competitionId,
          awayTeamId: team.id,
          utcDate: { gte: seasonStart, lte: seasonEnd },
        },
        orderBy: { utcDate: "desc" },
      }),
    ]);

    let goalsHome = 0, concededHome = 0, goalsAway = 0, concededAway = 0;
    let cleanSheets = 0, btts = 0, over25 = 0;
    let matchesHome = 0, matchesAway = 0;

    for (const m of homeFixtures) {
      if (m.scoreHomeFt != null && m.scoreAwayFt != null) {
        goalsHome += m.scoreHomeFt;
        concededHome += m.scoreAwayFt;
        matchesHome++;
        if (m.scoreAwayFt === 0) cleanSheets++;
        if (m.scoreHomeFt > 0 && m.scoreAwayFt > 0) btts++;
        if (m.scoreHomeFt + m.scoreAwayFt > 2) over25++;
      }
    }

    for (const m of awayFixtures) {
      if (m.scoreHomeFt != null && m.scoreAwayFt != null) {
        goalsAway += m.scoreAwayFt;
        concededAway += m.scoreHomeFt;
        matchesAway++;
        if (m.scoreHomeFt === 0) cleanSheets++;
        if (m.scoreHomeFt > 0 && m.scoreAwayFt > 0) btts++;
        if (m.scoreHomeFt + m.scoreAwayFt > 2) over25++;
      }
    }

    await prisma.teamSeasonStats.updateMany({
      where: {
        teamId: team.id,
        competitionId: team.competitionId,
        season: CURRENT_SEASON,
      },
      data: {
        goalsHome, goalsAway, concededHome, concededAway,
        cleanSheets, bttsCount: btts, over25Count: over25,
        matchesPlayedHome: matchesHome, matchesPlayedAway: matchesAway,
      },
    });
  }

  // Mark key players (top 3 goal contributors per team) — atomic batch
  const playerStats = await prisma.playerSeasonAgg.findMany({
    where: { season: CURRENT_SEASON },
    include: { player: true },
    orderBy: { goals: "desc" },
  });

  const teamTopPlayers = new Map<number, number[]>();
  for (const ps of playerStats) {
    const teamId = ps.player.teamId;
    const list = teamTopPlayers.get(teamId) ?? [];
    if (list.length < 3) {
      list.push(ps.playerId);
      teamTopPlayers.set(teamId, list);
    }
  }

  const allKeyPlayerIds = Array.from(teamTopPlayers.values()).flat();
  await prisma.$transaction([
    prisma.player.updateMany({ data: { isKeyPlayer: false } }),
    prisma.player.updateMany({
      where: { id: { in: allKeyPlayerIds } },
      data: { isKeyPlayer: true },
    }),
  ]);

  console.log("Derived stats computed.");
  await logRefresh("derived", "success");
}

// ─── H2H ─────────────────────────────────────────────────────────
// Built from local finished fixtures — no API calls.

export async function buildH2H() {
  console.log("Building H2H records...");

  const finishedFixtures = await prisma.fixture.findMany({
    where: {
      status: "FINISHED",
      scoreHomeFt: { not: null },
      scoreAwayFt: { not: null },
    },
  });

  for (const f of finishedFixtures) {
    const [teamAId, teamBId] =
      f.homeTeamId < f.awayTeamId
        ? [f.homeTeamId, f.awayTeamId]
        : [f.awayTeamId, f.homeTeamId];

    const scoreA = f.homeTeamId === teamAId ? f.scoreHomeFt! : f.scoreAwayFt!;
    const scoreB = f.homeTeamId === teamAId ? f.scoreAwayFt! : f.scoreHomeFt!;

    try {
      await prisma.h2HMatch.upsert({
        where: {
          teamAId_teamBId_date: { teamAId, teamBId, date: f.utcDate },
        },
        update: { scoreA, scoreB, competitionId: f.competitionId },
        create: {
          teamAId, teamBId,
          fixtureId: f.id,
          date: f.utcDate,
          scoreA, scoreB,
          competitionId: f.competitionId,
          homeTeamId: f.homeTeamId,
        },
      });
    } catch {
      // skip duplicates
    }
  }

  console.log("H2H records built.");
  await logRefresh("h2h", "success");
}

// ─── REFRESH ORCHESTRATION ───────────────────────────────────────
// API call budget (free tier):
//   football-data.org: 10/min → we use ~12 calls total
//     1 call  — upcoming fixtures (date-filtered, all comps)
//     1 call  — recent results (date-filtered, all comps)
//     5 calls — standings (domestic leagues only)
//     5 calls — top scorers (domestic leagues only)
//   Understat: 6 calls (1 per league) + match details
//   Local DB: derived stats, H2H — zero API calls

export async function refreshAll(options?: {
  aheadDays?: number;
  resultsDaysBack?: number;
  skipUnderstat?: boolean;
}) {
  const {
    aheadDays: rawAhead = DEFAULT_UPCOMING_DAYS,
    resultsDaysBack = 7,
    skipUnderstat = false,
  } = options ?? {};
  const aheadDays = clampUpcomingDays(rawAhead);

  console.log("=== Starting data refresh ===");
  console.log(`  Window: upcoming ${aheadDays}d, results ${resultsDaysBack}d back`);
  const start = Date.now();

  await ensureCompetitions();
  await ingestFixtures(aheadDays);
  await ingestRecentResults(resultsDaysBack);
  await ingestStandings();
  await ingestTopScorers();

  if (!skipUnderstat) {
    await refreshUnderstat(resultsDaysBack);
  }

  await computeDerivedStats();
  await buildH2H();

  try {
    console.log("V2 modifiers (congestion, motivation, availability)...");
    await refreshV2ForUpcomingFixtures(aheadDays);
  } catch (e) {
    console.warn("V2 pipeline:", e);
  }

  if (process.env.ODDS_API_KEY) {
    try {
      console.log("Odds API + value picks...");
      await refreshOddsForUpcomingFixtures(aheadDays);
      await recomputeValuePicksForUpcoming(aheadDays);
    } catch (e) {
      console.warn("Odds/value:", e);
    }
  }

  try {
    const settled = await settleValuePicks();
    if (settled > 0) console.log(`Settled ${settled} value pick(s).`);
    await recomputeBettingPerformance();
  } catch (e) {
    console.warn("Betting settlement:", e);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`=== Refresh complete in ${elapsed}s ===`);
}

// ─── CLI ENTRY POINT ─────────────────────────────────────────────

if (require.main === module) {
  const aheadDays = clampUpcomingDays(
    parseInt(process.env.AHEAD_DAYS || String(DEFAULT_UPCOMING_DAYS), 10),
  );
  const resultsDaysBack = parseInt(process.env.RESULTS_DAYS || "7");
  const skipUnderstat = process.env.SKIP_UNDERSTAT === "true";

  refreshAll({ aheadDays, resultsDaysBack, skipUnderstat })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Fatal error:", err);
      process.exit(1);
    });
}
