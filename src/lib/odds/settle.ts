import { prisma } from "../db";
import { removeMargin } from "./margin";
import { resolveStakeForSettlement } from "./stake-units";

type OpenValuePick = {
  id: number;
  fixtureId: number;
  market: string;
  bestBookmaker: string;
  impliedProb: number;
  stakeUnits: number | null;
  rating: number;
  modelProb: number;
  bestOdds: number;
  fixture: {
    status: string;
    scoreHomeFt: number | null;
    scoreAwayFt: number | null;
  };
};

type OpenBetDecision = {
  id: number;
  fixtureId: number;
  market: string;
  bestBookmaker: string;
  impliedProb: number;
  stakeUnits: number | null;
  rating: number | null;
  modelProb: number;
  bestOdds: number;
  fixture: {
    status: string;
    scoreHomeFt: number | null;
    scoreAwayFt: number | null;
  };
};

/** Fixtures that never produce a graded win/loss — picks are voided at settlement. */
export function isVoidFixtureStatus(status: string): boolean {
  return status === "CANCELLED" || status === "POSTPONED";
}

function outcome1x2(home: number, away: number): "home" | "draw" | "away" {
  if (home > away) return "home";
  if (away > home) return "away";
  return "draw";
}

/** Map value-pick market to OddsSnapshot market + outcome index (fair-implied column). */
function pickToSnapshotOutcome(pickMarket: string): {
  market: string;
  outcomeIndex: 0 | 1 | 2;
} | null {
  switch (pickMarket) {
    case "1x2_home":
      return { market: "1x2", outcomeIndex: 0 };
    case "1x2_draw":
      return { market: "1x2", outcomeIndex: 1 };
    case "1x2_away":
      return { market: "1x2", outcomeIndex: 2 };
    case "over25":
      return { market: "over_under_25", outcomeIndex: 0 };
    case "under25":
      return { market: "over_under_25", outcomeIndex: 1 };
    case "btts_yes":
      return { market: "btts", outcomeIndex: 0 };
    case "btts_no":
      return { market: "btts", outcomeIndex: 1 };
    default:
      return null;
  }
}

function fairImpliedAtOutcome(
  snap: { outcome1: number; outcome2: number; outcome3: number | null },
  outcomeIndex: 0 | 1 | 2,
): { implied: number; decimalOdds: number } | null {
  if (snap.outcome3 != null && snap.outcome3 > 0) {
    const fair = removeMargin([snap.outcome1, snap.outcome2, snap.outcome3]);
    const odds = [snap.outcome1, snap.outcome2, snap.outcome3];
    return { implied: fair[outcomeIndex] ?? 0, decimalOdds: odds[outcomeIndex] ?? 0 };
  }
  const fair = removeMargin([snap.outcome1, snap.outcome2]);
  const odds = [snap.outcome1, snap.outcome2];
  if (outcomeIndex >= 2) return null;
  return { implied: fair[outcomeIndex] ?? 0, decimalOdds: odds[outcomeIndex] ?? 0 };
}

async function resolveClosingLine(pick: {
  fixtureId: number;
  bestBookmaker: string;
  market: string;
  impliedProb: number;
}): Promise<{
  closingOdds: number;
  closingImplied: number;
  closingLineValue: number;
  /** Real `closing` snapshot vs fallback to latest `current` (not a true closing line). */
  closingLineSnapshotKind: "closing" | "current_fallback";
} | null> {
  const mapped = pickToSnapshotOutcome(pick.market);
  if (!mapped) return null;

  const trySnap = await prisma.oddsSnapshot.findFirst({
    where: {
      fixtureId: pick.fixtureId,
      bookmaker: pick.bestBookmaker,
      market: mapped.market,
      snapshotType: "closing",
    },
    orderBy: { fetchedAt: "desc" },
  });

  const snap =
    trySnap ??
    (await prisma.oddsSnapshot.findFirst({
      where: {
        fixtureId: pick.fixtureId,
        bookmaker: pick.bestBookmaker,
        market: mapped.market,
        snapshotType: "current",
      },
      orderBy: { fetchedAt: "desc" },
    }));

  if (!snap) return null;

  const fi = fairImpliedAtOutcome(snap, mapped.outcomeIndex);
  if (!fi || fi.decimalOdds <= 0) return null;

  const closingLineValue = fi.implied - pick.impliedProb;
  return {
    closingOdds: fi.decimalOdds,
    closingImplied: fi.implied,
    closingLineValue,
    closingLineSnapshotKind: trySnap ? "closing" : "current_fallback",
  };
}

/**
 * Settle unsettled value picks when full-time scores exist in the DB.
 *
 * We do **not** require `status === "FINISHED"` — Football-Data often lags and can leave
 * `SCHEDULED`/`TIMED` until the next ingest even after the match. If `scoreHomeFt` /
 * `scoreAwayFt` are present, that is enough to grade the bet (same as the UI using kickoff time).
 *
 * Over/Under 2.5 lines have no push — exactly 2 goals is Under, not void.
 */
export async function settleValuePicks(): Promise<number> {
  const open = await prisma.valuePick.findMany({
    where: { settled: false },
    include: { fixture: true },
  }) as OpenValuePick[];

  let n = 0;
  for (const pick of open) {
    const f = pick.fixture;

    if (isVoidFixtureStatus(f.status)) {
      await prisma.valuePick.update({
        where: { id: pick.id },
        data: {
          settled: true,
          settledAt: new Date(),
          outcome: "void",
          profitLoss: 0,
          closingLineSnapshotKind: null,
        },
      });
      n++;
      continue;
    }

    if (f.scoreHomeFt == null || f.scoreAwayFt == null) continue;

    const h = f.scoreHomeFt;
    const a = f.scoreAwayFt;
    const total = h + a;
    const res = outcome1x2(h, a);

    let won = false;

    if (pick.market === "1x2_home") won = res === "home";
    else if (pick.market === "1x2_draw") won = res === "draw";
    else if (pick.market === "1x2_away") won = res === "away";
    else if (pick.market === "over25") won = total > 2;
    else if (pick.market === "under25") won = total < 3;
    else if (pick.market === "btts_yes") won = h > 0 && a > 0;
    else if (pick.market === "btts_no") won = !(h > 0 && a > 0);

    const stake = resolveStakeForSettlement({
      stakeUnits: pick.stakeUnits,
      rating: pick.rating,
      modelProb: pick.modelProb,
      bestOdds: pick.bestOdds,
    });
    let profitLoss = 0;
    let outcome: string = "loss";
    if (won) {
      outcome = "win";
      profitLoss = stake * (pick.bestOdds - 1);
    } else {
      profitLoss = -stake;
    }

    const closing = await resolveClosingLine({
      fixtureId: pick.fixtureId,
      bestBookmaker: pick.bestBookmaker,
      market: pick.market,
      impliedProb: pick.impliedProb,
    });

    await prisma.valuePick.update({
      where: { id: pick.id },
      data: {
        settled: true,
        settledAt: new Date(),
        outcome,
        profitLoss,
        ...(closing
          ? {
              closingOdds: closing.closingOdds,
              closingImplied: closing.closingImplied,
              closingLineValue: closing.closingLineValue,
              closingLineSnapshotKind: closing.closingLineSnapshotKind,
            }
          : {}),
      },
    });
    n++;
  }

  const openDecisions = (await prisma.betDecision.findMany({
    where: { settled: false },
    include: { fixture: true },
  })) as OpenBetDecision[];

  for (const decision of openDecisions) {
    const f = decision.fixture;

    if (isVoidFixtureStatus(f.status)) {
      await prisma.betDecision.update({
        where: { id: decision.id },
        data: {
          settled: true,
          settledAt: new Date(),
          outcome: "void",
          profitLoss: 0,
          closingLineSnapshotKind: null,
        },
      });
      n++;
      continue;
    }

    if (f.scoreHomeFt == null || f.scoreAwayFt == null) continue;

    const h = f.scoreHomeFt;
    const a = f.scoreAwayFt;
    const total = h + a;
    const res = outcome1x2(h, a);

    let won = false;

    if (decision.market === "1x2_home") won = res === "home";
    else if (decision.market === "1x2_draw") won = res === "draw";
    else if (decision.market === "1x2_away") won = res === "away";
    else if (decision.market === "over25") won = total > 2;
    else if (decision.market === "under25") won = total < 3;
    else if (decision.market === "btts_yes") won = h > 0 && a > 0;
    else if (decision.market === "btts_no") won = !(h > 0 && a > 0);

    const stake = resolveStakeForSettlement({
      stakeUnits: decision.stakeUnits,
      rating: decision.rating ?? 1,
      modelProb: decision.modelProb,
      bestOdds: decision.bestOdds,
    });
    let profitLoss = 0;
    let outcome: string = "loss";
    if (won) {
      outcome = "win";
      profitLoss = stake * (decision.bestOdds - 1);
    } else {
      profitLoss = -stake;
    }

    const closing = await resolveClosingLine({
      fixtureId: decision.fixtureId,
      bestBookmaker: decision.bestBookmaker,
      market: decision.market,
      impliedProb: decision.impliedProb,
    });

    await prisma.betDecision.update({
      where: { id: decision.id },
      data: {
        settled: true,
        settledAt: new Date(),
        outcome,
        profitLoss,
        ...(closing
          ? {
              closingOdds: closing.closingOdds,
              closingImplied: closing.closingImplied,
              closingLineValue: closing.closingLineValue,
              closingLineSnapshotKind: closing.closingLineSnapshotKind,
            }
          : {}),
      },
    });
    n++;
  }

  return n;
}
