import { prisma } from "../db";

type ObservationPayload = {
  fixtureId: number;
  bookmaker: string;
  market: string;
  snapshotType: string;
  outcome1: number;
  outcome2: number;
  outcome3?: number | null;
  overround: number;
  impliedProb1: number;
  impliedProb2: number;
  impliedProb3?: number | null;
  observedAt?: Date;
  source?: string;
};

function sameNumber(a: number | null | undefined, b: number | null | undefined): boolean {
  const x = a ?? null;
  const y = b ?? null;
  if (x == null || y == null) return x === y;
  return Math.abs(x - y) < 1e-9;
}

export async function recordOddsObservation(payload: ObservationPayload): Promise<boolean> {
  const observedAt = payload.observedAt ?? new Date();
  const latest = await prisma.oddsObservation.findFirst({
    where: {
      fixtureId: payload.fixtureId,
      bookmaker: payload.bookmaker,
      market: payload.market,
      snapshotType: payload.snapshotType,
    },
    orderBy: { observedAt: "desc" },
  });

  if (
    latest &&
    sameNumber(latest.outcome1, payload.outcome1) &&
    sameNumber(latest.outcome2, payload.outcome2) &&
    sameNumber(latest.outcome3, payload.outcome3 ?? null) &&
    sameNumber(latest.impliedProb1, payload.impliedProb1) &&
    sameNumber(latest.impliedProb2, payload.impliedProb2) &&
    sameNumber(latest.impliedProb3, payload.impliedProb3 ?? null) &&
    sameNumber(latest.overround, payload.overround)
  ) {
    return false;
  }

  await prisma.oddsObservation.create({
    data: {
      fixtureId: payload.fixtureId,
      bookmaker: payload.bookmaker,
      market: payload.market,
      snapshotType: payload.snapshotType,
      source: payload.source ?? "odds_api_refresh",
      outcome1: payload.outcome1,
      outcome2: payload.outcome2,
      outcome3: payload.outcome3 ?? null,
      overround: payload.overround,
      impliedProb1: payload.impliedProb1,
      impliedProb2: payload.impliedProb2,
      impliedProb3: payload.impliedProb3 ?? null,
      observedAt,
    },
  });
  return true;
}

export async function backfillOddsObservationHistoryFromSnapshots(): Promise<number> {
  const snapshots = await prisma.oddsSnapshot.findMany({
    orderBy: { fetchedAt: "asc" },
  });

  let created = 0;
  for (const snapshot of snapshots) {
    const exists = await prisma.oddsObservation.findFirst({
      where: {
        fixtureId: snapshot.fixtureId,
        bookmaker: snapshot.bookmaker,
        market: snapshot.market,
        snapshotType: snapshot.snapshotType,
        observedAt: snapshot.fetchedAt,
      },
      select: { id: true },
    });
    if (exists) continue;

    await prisma.oddsObservation.create({
      data: {
        fixtureId: snapshot.fixtureId,
        bookmaker: snapshot.bookmaker,
        market: snapshot.market,
        snapshotType: snapshot.snapshotType,
        source: "legacy_odds_snapshot",
        outcome1: snapshot.outcome1,
        outcome2: snapshot.outcome2,
        outcome3: snapshot.outcome3,
        overround: snapshot.overround,
        impliedProb1: snapshot.impliedProb1,
        impliedProb2: snapshot.impliedProb2,
        impliedProb3: snapshot.impliedProb3,
        observedAt: snapshot.fetchedAt,
      },
    });
    created++;
  }

  return created;
}
