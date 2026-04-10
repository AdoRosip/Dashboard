import { prisma } from "../db";
import { removeMargin } from "./margin";
import { oddsSportKeyForCompetition } from "./sport-keys";

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

export interface FetchOddsResult {
  sportKey: string;
  eventsProcessed: number;
  snapshotsUpserted: number;
}

function normalizeTeamName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/** Loose match between API-Football / DB team name and Odds API team string. */
export function teamsMatchOddsEvent(
  dbHome: string,
  dbAway: string,
  oddsHome: string,
  oddsAway: string,
): boolean {
  const h = normalizeTeamName(dbHome);
  const a = normalizeTeamName(dbAway);
  const oh = normalizeTeamName(oddsHome);
  const oa = normalizeTeamName(oddsAway);
  const direct =
    (h.includes(oh) || oh.includes(h)) && (a.includes(oa) || oa.includes(a));
  const swapped =
    (h.includes(oa) || oa.includes(h)) && (a.includes(oh) || oh.includes(a));
  return direct || swapped;
}

interface OddsOutcome {
  name: string;
  price: number;
  point?: number;
}

interface OddsMarket {
  key: string;
  outcomes: OddsOutcome[];
}

interface OddsBookmaker {
  key: string;
  markets: OddsMarket[];
}

interface OddsEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsBookmaker[];
}

async function fetchSportOdds(sportKey: string): Promise<OddsEvent[]> {
  const key = process.env.ODDS_API_KEY;
  if (!key) {
    console.warn("[odds] ODDS_API_KEY not set — skipping odds fetch");
    return [];
  }
  // Note: `btts` is not supported on all soccer sport_keys — keep to h2h + totals for reliability.
  const markets = ["h2h", "totals"].join(",");
  const url = `${ODDS_API_BASE}/sports/${sportKey}/odds/?apiKey=${encodeURIComponent(key)}&regions=eu,uk&markets=${markets}&oddsFormat=decimal`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    console.warn(`[odds] ${sportKey} HTTP ${res.status}: ${text.slice(0, 200)}`);
    return [];
  }
  return res.json() as Promise<OddsEvent[]>;
}

async function ensureOpeningSnapshot(
  fixtureId: number,
  bookmaker: string,
  market: string,
): Promise<boolean> {
  const existing = await prisma.oddsSnapshot.findFirst({
    where: { fixtureId, bookmaker, market, snapshotType: "opening" },
  });
  return !existing;
}

async function upsertSnapshot(params: {
  fixtureId: number;
  bookmaker: string;
  market: string;
  snapshotType: "opening" | "current" | "closing";
  outcome1: number;
  outcome2: number;
  outcome3?: number | null;
  implied: number[];
}) {
  const { fixtureId, bookmaker, market, snapshotType, outcome1, outcome2, outcome3, implied } =
    params;
  const overround = implied.reduce((a, b) => a + b, 0);
  await prisma.oddsSnapshot.create({
    data: {
      fixtureId,
      bookmaker,
      market,
      snapshotType,
      outcome1,
      outcome2,
      outcome3: outcome3 ?? null,
      overround,
      impliedProb1: implied[0] ?? 0,
      impliedProb2: implied[1] ?? 0,
      impliedProb3: implied.length > 2 ? implied[2] ?? null : null,
    },
  });
}

/** Order: outcome1 home, outcome2 draw, outcome3 away */
function orderH2hPrices(
  homeTeamName: string,
  awayTeamName: string,
  outcomes: OddsOutcome[],
): [number, number, number] | null {
  const nh = normalizeTeamName(homeTeamName);
  const na = normalizeTeamName(awayTeamName);
  const draw = outcomes.find((o) => o.name === "Draw");
  if (!draw) return null;
  const nonDraw = outcomes.filter((o) => o.name !== "Draw");
  if (nonDraw.length !== 2) return null;

  let homePrice: number | null = null;
  let awayPrice: number | null = null;
  for (const o of nonDraw) {
    const no = normalizeTeamName(o.name);
    const homeLike = nh && (no.includes(nh) || nh.includes(no));
    const awayLike = na && (no.includes(na) || na.includes(no));
    if (homeLike && !awayLike) homePrice = o.price;
    else if (awayLike && !homeLike) awayPrice = o.price;
  }
  if (homePrice != null && awayPrice != null) {
    return [homePrice, draw.price, awayPrice];
  }
  return [nonDraw[0].price, draw.price, nonDraw[1].price];
}

async function processH2hBookmaker(
  fixtureId: number,
  homeTeamName: string,
  awayTeamName: string,
  bookmaker: OddsBookmaker,
) {
  const m = bookmaker.markets.find((x) => x.key === "h2h");
  if (!m || m.outcomes.length < 3) return;

  const ordered = orderH2hPrices(homeTeamName, awayTeamName, m.outcomes);
  if (!ordered) return;

  const implied = removeMargin(ordered);
  const isFirst = await ensureOpeningSnapshot(fixtureId, bookmaker.key, "1x2");
  if (isFirst) {
    await upsertSnapshot({
      fixtureId,
      bookmaker: bookmaker.key,
      market: "1x2",
      snapshotType: "opening",
      outcome1: ordered[0],
      outcome2: ordered[1],
      outcome3: ordered[2],
      implied,
    });
  }
  await upsertSnapshot({
    fixtureId,
    bookmaker: bookmaker.key,
    market: "1x2",
    snapshotType: "current",
    outcome1: ordered[0],
    outcome2: ordered[1],
    outcome3: ordered[2],
    implied,
  });
}

function extractTotals25(bookmaker: OddsBookmaker): { over: number; under: number } | null {
  const m = bookmaker.markets.find((x) => x.key === "totals");
  if (!m) return null;
  const over = m.outcomes.find((o) => o.name === "Over" && (o.point === 2.5 || o.point === undefined));
  const under = m.outcomes.find((o) => o.name === "Under" && (o.point === 2.5 || o.point === undefined));
  if (!over || !under) {
    const over25 = m.outcomes.find((o) => o.name === "Over" && o.point === 2.5);
    const under25 = m.outcomes.find((o) => o.name === "Under" && o.point === 2.5);
    if (over25 && under25) return { over: over25.price, under: under25.price };
    return null;
  }
  return { over: over.price, under: under.price };
}

async function processTotalsBookmaker(fixtureId: number, bookmaker: OddsBookmaker) {
  const t = extractTotals25(bookmaker);
  if (!t) return;
  const implied = removeMargin([t.over, t.under]);
  const isFirst = await ensureOpeningSnapshot(fixtureId, bookmaker.key, "over_under_25");
  if (isFirst) {
    await upsertSnapshot({
      fixtureId,
      bookmaker: bookmaker.key,
      market: "over_under_25",
      snapshotType: "opening",
      outcome1: t.over,
      outcome2: t.under,
      implied,
    });
  }
  await upsertSnapshot({
    fixtureId,
    bookmaker: bookmaker.key,
    market: "over_under_25",
    snapshotType: "current",
    outcome1: t.over,
    outcome2: t.under,
    implied,
  });
}

function extractBtts(bookmaker: OddsBookmaker): { yes: number; no: number } | null {
  const m = bookmaker.markets.find((x) => x.key === "btts");
  if (!m) return null;
  const yes = m.outcomes.find((o) => o.name === "Yes" || /yes/i.test(o.name));
  const no = m.outcomes.find((o) => o.name === "No" || /no/i.test(o.name));
  if (!yes || !no) return null;
  return { yes: yes.price, no: no.price };
}

async function processBttsBookmaker(fixtureId: number, bookmaker: OddsBookmaker) {
  const b = extractBtts(bookmaker);
  if (!b) return;
  const implied = removeMargin([b.yes, b.no]);
  const isFirst = await ensureOpeningSnapshot(fixtureId, bookmaker.key, "btts");
  if (isFirst) {
    await upsertSnapshot({
      fixtureId,
      bookmaker: bookmaker.key,
      market: "btts",
      snapshotType: "opening",
      outcome1: b.yes,
      outcome2: b.no,
      implied,
    });
  }
  await upsertSnapshot({
    fixtureId,
    bookmaker: bookmaker.key,
    market: "btts",
    snapshotType: "current",
    outcome1: b.yes,
    outcome2: b.no,
    implied,
  });
}

/**
 * Fetch odds from The Odds API for upcoming fixtures (next `days` days) in DB.
 */
export async function refreshOddsForUpcomingFixtures(days = 7): Promise<FetchOddsResult[]> {
  const now = new Date();
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const fixtures = await prisma.fixture.findMany({
    where: {
      status: { in: ["SCHEDULED", "TIMED", "POSTPONED"] },
      utcDate: { gte: now, lte: end },
    },
    include: { homeTeam: true, awayTeam: true },
  });

  const bySport = new Map<string, typeof fixtures>();
  for (const f of fixtures) {
    const sk = oddsSportKeyForCompetition(f.competitionId);
    if (!sk) continue;
    const list = bySport.get(sk) ?? [];
    list.push(f);
    bySport.set(sk, list);
  }

  const results: FetchOddsResult[] = [];
  let totalSnaps = 0;

  for (const [sportKey, fixList] of bySport) {
    const events = await fetchSportOdds(sportKey);
    let processed = 0;
    const snapBeforeSport = await prisma.oddsSnapshot.count();

    for (const fx of fixList) {
      const ev = events.find(
        (e) =>
          sameDay(new Date(e.commence_time), fx.utcDate) &&
          teamsMatchOddsEvent(
            fx.homeTeam.name,
            fx.awayTeam.name,
            e.home_team,
            e.away_team,
          ),
      );
      if (!ev) continue;
      processed++;

      for (const bm of ev.bookmakers) {
        await processH2hBookmaker(fx.id, ev.home_team, ev.away_team, bm);
        await processTotalsBookmaker(fx.id, bm);
        await processBttsBookmaker(fx.id, bm);
      }
    }

    const snapAfterSport = await prisma.oddsSnapshot.count();
    const sportSnaps = Math.max(0, snapAfterSport - snapBeforeSport);
    totalSnaps += sportSnaps;
    results.push({ sportKey, eventsProcessed: processed, snapshotsUpserted: sportSnaps });
  }

  await prisma.dataRefreshLog.create({
    data: {
      source: "odds-api",
      status: "success",
      count: totalSnaps,
      message: JSON.stringify(results),
    },
  });

  return results;
}
