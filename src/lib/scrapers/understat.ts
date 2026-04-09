/**
 * Understat.com Scraper
 *
 * Understat exposes clean JSON API endpoints (no auth required):
 *   GET /getLeagueData/{league}/{season}  → { teams, players, dates }
 *   GET /getMatchData/{matchId}           → { shots, rosters, tmpl }
 *   GET /match/{id} (HTML)                → match_info embedded in script tag
 *
 * Data available:
 *   - Team per-match history: xG, xGA, npxG, npxGA, PPDA, deep completions, result
 *   - Player season aggregates: xG, xA, xGChain, xGBuildup, shots, key_passes
 *   - Match-level shots: per-shot xG with situation (OpenPlay, SetPiece, Counter, etc.)
 *   - Match rosters: per-player xG, xA, xGChain, xGBuildup, minutes, position
 */

const BASE_URL = "https://understat.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "X-Requested-With": "XMLHttpRequest",
  Accept: "application/json, text/javascript, */*; q=0.01",
};

let lastRequestTime = 0;
const MIN_INTERVAL = 1200;

async function throttledFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL) {
    await sleep(MIN_INTERVAL - elapsed);
  }
  lastRequestTime = Date.now();

  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`Understat ${res.status} for ${url}`);
  }
  return res;
}

// ─── TYPES ───────────────────────────────────────────────────────

export interface UnderstatTeamMatch {
  h_a: "h" | "a";
  xG: string;
  xGA: string;
  npxG: string;
  npxGA: string;
  ppda: { att: number; def: number } | string;
  ppda_allowed: { att: number; def: number } | string;
  deep: string;
  deep_allowed: string;
  scored: string;
  missed: string;
  xpts: string;
  result: "w" | "d" | "l";
  date: string;
  wins: string;
  draws: string;
  loses: string;
  pts: string;
  npxGD: string;
}

export interface UnderstatTeam {
  id: string;
  title: string;
  history: UnderstatTeamMatch[];
}

export interface UnderstatPlayer {
  id: string;
  player_name: string;
  games: string;
  time: string;
  goals: string;
  xG: string;
  assists: string;
  xA: string;
  shots: string;
  key_passes: string;
  yellow_cards: string;
  red_cards: string;
  position: string;
  team_title: string;
  npg: string;
  npxG: string;
  xGChain: string;
  xGBuildup: string;
}

export interface UnderstatFixture {
  id: string;
  isResult: boolean;
  h: { id: string; title: string; short_title: string };
  a: { id: string; title: string; short_title: string };
  goals: { h: string; a: string };
  xG: { h: string; a: string };
  datetime: string;
  forecast: { w: string; d: string; l: string };
}

export interface UnderstatLeagueData {
  teams: Record<string, UnderstatTeam>;
  players: UnderstatPlayer[];
  dates: UnderstatFixture[];
}

export interface UnderstatShot {
  id: string;
  minute: string;
  result: string;
  X: string;
  Y: string;
  xG: string;
  player: string;
  h_a: "h" | "a";
  player_id: string;
  situation: string;
  season: string;
  shotType: string;
  match_id: string;
  h_team: string;
  a_team: string;
  h_goals: string;
  a_goals: string;
  date: string;
  player_assisted: string;
  lastAction: string;
}

export interface UnderstatRosterPlayer {
  id: string;
  goals: string;
  own_goals: string;
  shots: string;
  xG: string;
  time: string;
  player_id: string;
  team_id: string;
  position: string;
  player: string;
  h_a: "h" | "a";
  yellow_card: string;
  red_card: string;
  roster_in: string;
  roster_out: string;
  key_passes: string;
  assists: string;
  xA: string;
  xGChain: string;
  xGBuildup: string;
  positionOrder: string;
}

export interface UnderstatMatchData {
  shots: { h: UnderstatShot[]; a: UnderstatShot[] };
  rosters: {
    h: Record<string, UnderstatRosterPlayer>;
    a: Record<string, UnderstatRosterPlayer>;
  };
}

export interface UnderstatMatchInfo {
  id: string;
  h: string;
  a: string;
  date: string;
  league_id: string;
  season: string;
  h_goals: string;
  a_goals: string;
  team_h: string;
  team_a: string;
  h_xg: string;
  a_xg: string;
  h_shot: string;
  a_shot: string;
  h_shotOnTarget: string;
  a_shotOnTarget: string;
  h_deep: string;
  a_deep: string;
  h_ppda: string;
  a_ppda: string;
}

// ─── API FUNCTIONS ───────────────────────────────────────────────

/**
 * Fetch league-level data: all teams with match history, all players,
 * and all match results with xG for a given league and season.
 */
export async function fetchLeagueData(
  league: string,
  season: string,
): Promise<UnderstatLeagueData | null> {
  try {
    const res = await throttledFetch(
      `${BASE_URL}/getLeagueData/${league}/${season}`,
    );
    return (await res.json()) as UnderstatLeagueData;
  } catch (err) {
    console.error(
      `  [Understat] Failed to fetch league data for ${league}/${season}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Fetch match-level data: shot-by-shot xG and full rosters with
 * per-player xG/xA/xGChain/xGBuildup.
 */
export async function fetchMatchData(
  matchId: string,
): Promise<UnderstatMatchData | null> {
  try {
    const res = await throttledFetch(
      `${BASE_URL}/getMatchData/${matchId}`,
    );
    return (await res.json()) as UnderstatMatchData;
  } catch (err) {
    console.error(
      `  [Understat] Failed to fetch match data for ${matchId}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Fetch match info from the HTML page (embedded as JSON.parse in a script tag).
 * Contains shots, shots on target, PPDA, deep completions per team.
 */
export async function fetchMatchInfo(
  matchId: string,
): Promise<UnderstatMatchInfo | null> {
  try {
    const res = await throttledFetch(`${BASE_URL}/match/${matchId}`);
    const html = await res.text();

    const match = html.match(
      /var\s+match_info\s*=\s*JSON\.parse\('(.+?)'\)/,
    );
    if (!match) return null;

    const decoded = match[1].replace(
      /\\x([0-9A-Fa-f]{2})/g,
      (_, hex: string) => String.fromCharCode(parseInt(hex, 16)),
    );
    return JSON.parse(decoded) as UnderstatMatchInfo;
  } catch (err) {
    console.error(
      `  [Understat] Failed to fetch match info for ${matchId}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// ─── DERIVED COMPUTATIONS ────────────────────────────────────────

/**
 * Compute PPDA from the raw ppda object.
 * PPDA = Passes Allowed Per Defensive Action.
 * Lower = more aggressive pressing.
 */
export function computePpda(
  ppda: { att: number; def: number } | string | undefined,
): number | null {
  if (!ppda) return null;
  if (typeof ppda === "string") return parseFloat(ppda) || null;
  if (ppda.def === 0) return null;
  return ppda.att / ppda.def;
}

/**
 * Break down match shots into xG by situation.
 */
export function aggregateShotsByContext(shots: UnderstatShot[]) {
  let openPlay = 0;
  let setPiece = 0;
  let counter = 0;
  let penalty = 0;
  let fromCorner = 0;
  let directFk = 0;
  let firstHalf = 0;
  let secondHalf = 0;
  let total = 0;

  for (const shot of shots) {
    const xg = parseFloat(shot.xG) || 0;
    total += xg;

    const minute = parseInt(shot.minute) || 0;
    if (minute <= 45) firstHalf += xg;
    else secondHalf += xg;

    switch (shot.situation) {
      case "OpenPlay":
        openPlay += xg;
        break;
      case "FromCorner":
        fromCorner += xg;
        setPiece += xg;
        break;
      case "SetPiece":
        setPiece += xg;
        break;
      case "DirectFreekick":
        directFk += xg;
        setPiece += xg;
        break;
      case "Penalty":
        penalty += xg;
        break;
      default:
        openPlay += xg;
    }

    if (shot.lastAction === "CounterAttack" || shot.situation === "Counter") {
      counter += xg;
    }
  }

  return {
    total: round(total),
    openPlay: round(openPlay),
    setPiece: round(setPiece),
    counter: round(counter),
    penalty: round(penalty),
    fromCorner: round(fromCorner),
    directFk: round(directFk),
    firstHalf: round(firstHalf),
    secondHalf: round(secondHalf),
    shotCount: shots.length,
    onTarget: shots.filter(
      (s) => s.result === "Goal" || s.result === "SavedShot",
    ).length,
  };
}

/**
 * Aggregate a team's full season history from Understat match-by-match data.
 */
export function aggregateTeamSeason(history: UnderstatTeamMatch[]) {
  let totalXg = 0,
    totalXga = 0;
  let homeXg = 0,
    awayXg = 0;
  let homeXga = 0,
    awayXga = 0;
  let totalPpda = 0,
    ppdaCount = 0;
  let totalDeep = 0;
  let homeMatches = 0,
    awayMatches = 0;
  let scored = 0,
    conceded = 0;
  let cleanSheets = 0,
    btts = 0,
    over25 = 0;

  for (const m of history) {
    const xg = parseFloat(m.xG) || 0;
    const xga = parseFloat(m.xGA) || 0;
    const goals = parseInt(m.scored) || 0;
    const missed = parseInt(m.missed) || 0;
    const deep = parseInt(m.deep) || 0;

    totalXg += xg;
    totalXga += xga;
    scored += goals;
    conceded += missed;
    totalDeep += deep;

    if (missed === 0) cleanSheets++;
    if (goals > 0 && missed > 0) btts++;
    if (goals + missed > 2) over25++;

    const ppda = computePpda(m.ppda);
    if (ppda != null) {
      totalPpda += ppda;
      ppdaCount++;
    }

    if (m.h_a === "h") {
      homeXg += xg;
      homeXga += xga;
      homeMatches++;
    } else {
      awayXg += xg;
      awayXga += xga;
      awayMatches++;
    }
  }

  const n = history.length || 1;

  return {
    matchesPlayed: history.length,
    homeMatches,
    awayMatches,
    xgFor: round(totalXg),
    xgAgainst: round(totalXga),
    xgHome: round(homeXg),
    xgAway: round(awayXg),
    xgaHome: round(homeXga),
    xgaAway: round(awayXga),
    xgPerGame: round(totalXg / n),
    xgaPerGame: round(totalXga / n),
    avgPpda: ppdaCount > 0 ? round(totalPpda / ppdaCount) : null,
    avgDeep: round(totalDeep / n),
    goalsScored: scored,
    goalsConceded: conceded,
    cleanSheets,
    btts,
    over25,
  };
}

/**
 * Compute per-player 90-minute rates from Understat season data.
 */
export function computePlayerPer90(player: UnderstatPlayer) {
  const minutes = parseInt(player.time) || 0;
  const nineties = minutes / 90;
  if (nineties < 1) {
    return {
      goalsPer90: 0,
      xgPer90: 0,
      xaPer90: 0,
      shotsPer90: 0,
      keyPassesPer90: 0,
    };
  }

  return {
    goalsPer90: round((parseInt(player.goals) || 0) / nineties),
    xgPer90: round((parseFloat(player.xG) || 0) / nineties),
    xaPer90: round((parseFloat(player.xA) || 0) / nineties),
    shotsPer90: round((parseInt(player.shots) || 0) / nineties),
    keyPassesPer90: round((parseInt(player.key_passes) || 0) / nineties),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
