import { prisma } from "../db";
import { backfillOddsObservationHistoryFromSnapshots, recordOddsObservation } from "./history";
import { removeMargin } from "./margin";
import { oddsSportKeyForCompetition } from "./sport-keys";
import { remapH2hTripleToFixtureOrientation } from "./event-side";
import {
  isOddsEventSwappedVsFixture,
  normalizeTeamName,
  teamsMatchOddsEvent,
} from "./team-normalize";

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

export interface FetchOddsResult {
  sportKey: string;
  eventsFetched: number;
  fixturesTargeted: number;
  fixturesMatched: number;
  fixturesUnmatched: number;
  unmatchedFixtures: string[];
  snapshotsUpserted: number;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
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

/** Raw bookmaker margin: sum of implied probabilities before de-vig (always ≥ 1). */
function rawOverround(prices: number[]): number {
  return prices.reduce((s, o) => s + 1 / o, 0);
}

async function createOpeningSnapshotIfMissing(params: {
  fixtureId: number;
  bookmaker: string;
  market: string;
  outcome1: number;
  outcome2: number;
  outcome3?: number | null;
}): Promise<number> {
  const exists = await prisma.oddsSnapshot.findFirst({
    where: {
      fixtureId: params.fixtureId,
      bookmaker: params.bookmaker,
      market: params.market,
      snapshotType: "opening",
    },
  });
  if (exists) return 0;

  const prices =
    params.outcome3 != null && params.outcome3 > 0
      ? [params.outcome1, params.outcome2, params.outcome3]
      : [params.outcome1, params.outcome2];
  const implied = removeMargin(prices);
  const overround = rawOverround(prices);

  await prisma.oddsSnapshot.create({
    data: {
      fixtureId: params.fixtureId,
      bookmaker: params.bookmaker,
      market: params.market,
      snapshotType: "opening",
      outcome1: params.outcome1,
      outcome2: params.outcome2,
      outcome3: params.outcome3 ?? null,
      overround,
      impliedProb1: implied[0] ?? 0,
      impliedProb2: implied[1] ?? 0,
      impliedProb3: implied.length > 2 ? implied[2] ?? null : null,
    },
  });

  const added = await recordOddsObservation({
    fixtureId: params.fixtureId,
    bookmaker: params.bookmaker,
    market: params.market,
    snapshotType: "opening",
    outcome1: params.outcome1,
    outcome2: params.outcome2,
    outcome3: params.outcome3 ?? null,
    overround,
    impliedProb1: implied[0] ?? 0,
    impliedProb2: implied[1] ?? 0,
    impliedProb3: implied.length > 2 ? implied[2] ?? null : null,
  });
  return added ? 1 : 0;
}

async function upsertCurrentSnapshot(params: {
  fixtureId: number;
  bookmaker: string;
  market: string;
  outcome1: number;
  outcome2: number;
  outcome3?: number | null;
}): Promise<number> {
  const prices =
    params.outcome3 != null && params.outcome3 > 0
      ? [params.outcome1, params.outcome2, params.outcome3]
      : [params.outcome1, params.outcome2];
  const implied = removeMargin(prices);
  const overround = rawOverround(prices);

  const payload = {
    outcome1: params.outcome1,
    outcome2: params.outcome2,
    outcome3: params.outcome3 ?? null,
    overround,
    impliedProb1: implied[0] ?? 0,
    impliedProb2: implied[1] ?? 0,
    impliedProb3: implied.length > 2 ? implied[2] ?? null : null,
    fetchedAt: new Date(),
  };

  const existing = await prisma.oddsSnapshot.findFirst({
    where: {
      fixtureId: params.fixtureId,
      bookmaker: params.bookmaker,
      market: params.market,
      snapshotType: "current",
    },
  });

  if (existing) {
    await prisma.oddsSnapshot.update({ where: { id: existing.id }, data: payload });
    await prisma.oddsSnapshot.deleteMany({
      where: {
        fixtureId: params.fixtureId,
        bookmaker: params.bookmaker,
        market: params.market,
        snapshotType: "current",
        NOT: { id: existing.id },
      },
    });
  } else {
    await prisma.oddsSnapshot.create({
      data: {
        fixtureId: params.fixtureId,
        bookmaker: params.bookmaker,
        market: params.market,
        snapshotType: "current",
        ...payload,
      },
    });
  }

  const added = await recordOddsObservation({
    fixtureId: params.fixtureId,
    bookmaker: params.bookmaker,
    market: params.market,
    snapshotType: "current",
    outcome1: params.outcome1,
    outcome2: params.outcome2,
    outcome3: params.outcome3 ?? null,
    overround,
    impliedProb1: implied[0] ?? 0,
    impliedProb2: implied[1] ?? 0,
    impliedProb3: implied.length > 2 ? implied[2] ?? null : null,
  });
  return added ? 1 : 0;
}

async function upsertClosingSnapshot(params: {
  fixtureId: number;
  bookmaker: string;
  market: string;
  outcome1: number;
  outcome2: number;
  outcome3?: number | null;
}): Promise<number> {
  const prices =
    params.outcome3 != null && params.outcome3 > 0
      ? [params.outcome1, params.outcome2, params.outcome3]
      : [params.outcome1, params.outcome2];
  const implied = removeMargin(prices);
  const overround = rawOverround(prices);

  const payload = {
    outcome1: params.outcome1,
    outcome2: params.outcome2,
    outcome3: params.outcome3 ?? null,
    overround,
    impliedProb1: implied[0] ?? 0,
    impliedProb2: implied[1] ?? 0,
    impliedProb3: implied.length > 2 ? implied[2] ?? null : null,
    fetchedAt: new Date(),
  };

  const existing = await prisma.oddsSnapshot.findFirst({
    where: {
      fixtureId: params.fixtureId,
      bookmaker: params.bookmaker,
      market: params.market,
      snapshotType: "closing",
    },
  });

  if (existing) {
    await prisma.oddsSnapshot.update({ where: { id: existing.id }, data: payload });
  } else {
    await prisma.oddsSnapshot.create({
      data: {
        fixtureId: params.fixtureId,
        bookmaker: params.bookmaker,
        market: params.market,
        snapshotType: "closing",
        ...payload,
      },
    });
  }

  const added = await recordOddsObservation({
    fixtureId: params.fixtureId,
    bookmaker: params.bookmaker,
    market: params.market,
    snapshotType: "closing",
    outcome1: params.outcome1,
    outcome2: params.outcome2,
    outcome3: params.outcome3 ?? null,
    overround,
    impliedProb1: implied[0] ?? 0,
    impliedProb2: implied[1] ?? 0,
    impliedProb3: implied.length > 2 ? implied[2] ?? null : null,
  });
  return added ? 1 : 0;
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
  fixtureUtcDate: Date,
  fixtureHomeName: string,
  fixtureAwayName: string,
  eventHomeName: string,
  eventAwayName: string,
  bookmaker: OddsBookmaker,
  eventSwappedVsFixture: boolean,
): Promise<number> {
  const m = bookmaker.markets.find((x) => x.key === "h2h");
  if (!m || m.outcomes.length < 3) return 0;

  const orderedEvent = orderH2hPrices(eventHomeName, eventAwayName, m.outcomes);
  if (!orderedEvent) return 0;

  const [o1, o2, o3] = remapH2hTripleToFixtureOrientation(
    orderedEvent,
    eventSwappedVsFixture,
  );

  let observationsAdded = 0;
  observationsAdded += await createOpeningSnapshotIfMissing({
    fixtureId,
    bookmaker: bookmaker.key,
    market: "1x2",
    outcome1: o1,
    outcome2: o2,
    outcome3: o3,
  });
  observationsAdded += await upsertCurrentSnapshot({
    fixtureId,
    bookmaker: bookmaker.key,
    market: "1x2",
    outcome1: o1,
    outcome2: o2,
    outcome3: o3,
  });
  if (fixtureUtcDate.getTime() <= Date.now()) {
    observationsAdded += await upsertClosingSnapshot({
      fixtureId,
      bookmaker: bookmaker.key,
      market: "1x2",
      outcome1: o1,
      outcome2: o2,
      outcome3: o3,
    });
  }
  return observationsAdded;
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

async function processTotalsBookmaker(
  fixtureId: number,
  fixtureUtcDate: Date,
  bookmaker: OddsBookmaker,
): Promise<number> {
  const t = extractTotals25(bookmaker);
  if (!t) return 0;
  let observationsAdded = 0;
  observationsAdded += await createOpeningSnapshotIfMissing({
    fixtureId,
    bookmaker: bookmaker.key,
    market: "over_under_25",
    outcome1: t.over,
    outcome2: t.under,
  });
  observationsAdded += await upsertCurrentSnapshot({
    fixtureId,
    bookmaker: bookmaker.key,
    market: "over_under_25",
    outcome1: t.over,
    outcome2: t.under,
  });
  if (fixtureUtcDate.getTime() <= Date.now()) {
    observationsAdded += await upsertClosingSnapshot({
      fixtureId,
      bookmaker: bookmaker.key,
      market: "over_under_25",
      outcome1: t.over,
      outcome2: t.under,
    });
  }
  return observationsAdded;
}

/**
 * Fetch odds from The Odds API for upcoming fixtures (next `days` days) in DB.
 */
export async function refreshOddsForUpcomingFixtures(days = 2): Promise<FetchOddsResult[]> {
  await backfillOddsObservationHistoryFromSnapshots();
  const run = await prisma.oddsCaptureRun.create({
    data: {
      daysAhead: days,
    },
    select: { id: true },
  });

  try {
    const now = new Date();
    const recentPast = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const fixtures = await prisma.fixture.findMany({
      where: {
        status: { in: ["SCHEDULED", "TIMED", "POSTPONED"] },
        utcDate: { gte: recentPast, lte: end },
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
    let totalEventsFetched = 0;
    let totalFixturesTargeted = 0;
    let totalMatched = 0;
    let totalUnmatched = 0;
    let totalObservationsAdded = 0;

    for (const [sportKey, fixList] of bySport) {
      const events = await fetchSportOdds(sportKey);
      totalEventsFetched += events.length;
      totalFixturesTargeted += fixList.length;
      let matched = 0;
      const unmatchedFixtures: string[] = [];
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
        if (!ev) {
          unmatchedFixtures.push(`${fx.homeTeam.name} vs ${fx.awayTeam.name}`);
          continue;
        }
        matched++;

        const eventSwapped = isOddsEventSwappedVsFixture(
          fx.homeTeam.name,
          fx.awayTeam.name,
          ev.home_team,
          ev.away_team,
        );

        for (const bm of ev.bookmakers) {
          totalObservationsAdded += await processH2hBookmaker(
            fx.id,
            fx.utcDate,
            fx.homeTeam.name,
            fx.awayTeam.name,
            ev.home_team,
            ev.away_team,
            bm,
            eventSwapped,
          );
          totalObservationsAdded += await processTotalsBookmaker(fx.id, fx.utcDate, bm);
        }
      }

      totalMatched += matched;
      totalUnmatched += Math.max(0, fixList.length - matched);
      const snapAfterSport = await prisma.oddsSnapshot.count();
      const sportSnaps = Math.max(0, snapAfterSport - snapBeforeSport);
      totalSnaps += sportSnaps;
      results.push({
        sportKey,
        eventsFetched: events.length,
        fixturesTargeted: fixList.length,
        fixturesMatched: matched,
        fixturesUnmatched: Math.max(0, fixList.length - matched),
        unmatchedFixtures: unmatchedFixtures.slice(0, 10),
        snapshotsUpserted: sportSnaps,
      });
    }

    await prisma.oddsCaptureRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        sportResultsJson: JSON.stringify(results),
        eventsFetched: totalEventsFetched,
        fixturesTargeted: totalFixturesTargeted,
        fixturesMatched: totalMatched,
        fixturesUnmatched: totalUnmatched,
        snapshotsUpserted: totalSnaps,
        observationsAdded: totalObservationsAdded,
        completedAt: new Date(),
      },
    });

    await prisma.dataRefreshLog.create({
      data: {
        source: "odds-api",
        status: "success",
        count: totalSnaps,
        message: JSON.stringify(results),
      },
    });

    return results;
  } catch (error) {
    await prisma.oddsCaptureRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

export { teamsMatchOddsEvent } from "./team-normalize";
