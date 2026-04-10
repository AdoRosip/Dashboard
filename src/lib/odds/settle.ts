import { prisma } from "../db";

function outcome1x2(home: number, away: number): "home" | "draw" | "away" {
  if (home > away) return "home";
  if (away > home) return "away";
  return "draw";
}

/**
 * Settle unsettled value picks for finished fixtures.
 */
export async function settleValuePicks(): Promise<number> {
  const open = await prisma.valuePick.findMany({
    where: { settled: false },
    include: { fixture: true },
  });

  let n = 0;
  for (const pick of open) {
    const f = pick.fixture;
    if (f.status !== "FINISHED" || f.scoreHomeFt == null || f.scoreAwayFt == null) continue;

    const h = f.scoreHomeFt;
    const a = f.scoreAwayFt;
    const total = h + a;
    const res = outcome1x2(h, a);

    let won = false;
    let push = false;

    if (pick.market === "1x2_home") won = res === "home";
    else if (pick.market === "1x2_draw") won = res === "draw";
    else if (pick.market === "1x2_away") won = res === "away";
    else if (pick.market === "over25") {
      won = total > 2;
      push = total === 2;
    } else if (pick.market === "under25") {
      won = total < 3;
      push = total === 2;
    }     else if (pick.market === "btts_yes") won = h > 0 && a > 0;
    else if (pick.market === "btts_no") won = !(h > 0 && a > 0);

    const stake = pick.quarterKelly;
    let profitLoss = 0;
    let outcome: string = "loss";
    if (push) {
      outcome = "push";
      profitLoss = 0;
    } else if (won) {
      outcome = "win";
      profitLoss = stake * (pick.bestOdds - 1);
    } else {
      profitLoss = -stake;
    }

    await prisma.valuePick.update({
      where: { id: pick.id },
      data: {
        settled: true,
        settledAt: new Date(),
        outcome,
        profitLoss,
      },
    });
    n++;
  }

  return n;
}
