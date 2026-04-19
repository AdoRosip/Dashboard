import { prisma } from "../db";
import { predictMatch } from "../prediction/engine";
import { checkValue } from "./value";

/**
 * Recompute value picks for upcoming fixtures using latest model + current odds snapshots.
 */
export async function recomputeValuePicksForUpcoming(days = 2): Promise<number> {
  const now = new Date();
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const fixtures = await prisma.fixture.findMany({
    where: {
      // Keep in sync with `refreshOddsForUpcomingFixtures` window & statuses
      status: { in: ["SCHEDULED", "TIMED", "POSTPONED"] },
      utcDate: { gte: now, lte: end },
    },
  });

  let created = 0;

  for (const fx of fixtures) {
    let pred;
    try {
      pred = await predictMatch(fx.id);
    } catch {
      continue;
    }

    const snaps = await prisma.oddsSnapshot.findMany({
      where: { fixtureId: fx.id, snapshotType: "current" },
    });

    const byMarket = new Map<string, typeof snaps>();
    for (const s of snaps) {
      const list = byMarket.get(s.market) ?? [];
      list.push(s);
      byMarket.set(s.market, list);
    }

    const markets: Array<{
      key: string;
      modelProb: number;
      pickOutcome: "1" | "2" | "3";
    }> = [
      { key: "1x2_home", modelProb: pred.probHomeWin, pickOutcome: "1" },
      { key: "1x2_draw", modelProb: pred.probDraw, pickOutcome: "2" },
      { key: "1x2_away", modelProb: pred.probAwayWin, pickOutcome: "3" },
      { key: "over25", modelProb: pred.probOver25, pickOutcome: "1" },
      { key: "under25", modelProb: 1 - pred.probOver25, pickOutcome: "2" },
    ];

    for (const m of markets) {
      let dbMarket = "";
      let impliedProb = 0;
      let bestOdds = 0;
      let bestBook = "";

      if (m.key.startsWith("1x2")) {
        const list = byMarket.get("1x2") ?? [];
        const pick = m.pickOutcome;
        const perBm = list.map((s) => {
          const odds =
            pick === "1"
              ? s.outcome1
              : pick === "2"
                ? s.outcome2
                : s.outcome3 ?? s.outcome2;
          const imp =
            pick === "1"
              ? s.impliedProb1
              : pick === "2"
                ? s.impliedProb2
                : s.impliedProb3 ?? s.impliedProb2;
          return { bookmaker: s.bookmaker, odds, implied: imp };
        });
        if (perBm.length === 0) continue;
        const best = perBm.reduce((a, b) => (b.odds > a.odds ? b : a), perBm[0]!);
        dbMarket = m.key;
        impliedProb = best.implied;
        bestOdds = best.odds;
        bestBook = best.bookmaker;
      } else if (m.key === "over25" || m.key === "under25") {
        const list = byMarket.get("over_under_25") ?? [];
        if (list.length === 0) continue;
        const wantOver = m.key === "over25";
        const perBm = list.map((s) => ({
          bookmaker: s.bookmaker,
          odds: wantOver ? s.outcome1 : s.outcome2,
          implied: wantOver ? s.impliedProb1 : s.impliedProb2,
        }));
        const best = perBm.reduce((a, b) => (b.odds > a.odds ? b : a), perBm[0]!);
        dbMarket = m.key;
        impliedProb = best.implied;
        bestOdds = best.odds;
        bestBook = best.bookmaker;
      }

      if (!dbMarket || bestOdds <= 0) continue;

      const draft = checkValue({
        market: dbMarket,
        modelProb: m.modelProb,
        modelConfidence: pred.modelConfidence,
        bestOdds,
        impliedProb,
      });
      if (!draft) continue;

      draft.bestBookmaker = bestBook;

      const existing = await prisma.valuePick.findFirst({
        where: { fixtureId: fx.id, market: dbMarket, settled: false },
        select: { id: true },
      });
      const payload = {
        modelProb: draft.modelProb,
        modelConfidence: draft.modelConfidence,
        bestOdds: draft.bestOdds,
        bestBookmaker: draft.bestBookmaker,
        impliedProb: draft.impliedProb,
        edge: draft.edge,
        edgePct: draft.edgePct,
        kellyFraction: draft.kellyFraction,
        quarterKelly: draft.quarterKelly,
        halfKelly: draft.halfKelly,
        stakeUnits: draft.stakeUnits,
        rating: draft.rating,
        ratingLabel: draft.ratingLabel,
      };
      if (existing) {
        await prisma.valuePick.update({ where: { id: existing.id }, data: payload });
      } else {
        await prisma.valuePick.create({
          data: { fixtureId: fx.id, market: dbMarket, ...payload },
        });
      }
      created++;
    }
  }

  return created;
}
