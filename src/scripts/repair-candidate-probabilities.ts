import { prisma } from "../lib/db";
import { expectedValuePerUnitStake } from "../lib/odds/stake-units";

type CandidateRow = {
  id: number;
  fixtureId: number;
  market: string;
  modelProb: number;
  modelConfidence: number;
  bestOdds: number;
  impliedProb: number;
  evaluatedAt: Date;
};

type InvalidTriplet = {
  fixtureId: number;
  sum: number;
  rows: CandidateRow[];
};

const APPLY = process.argv.includes("--apply") || process.env.APPLY === "true";
const TOLERANCE = 0.01;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function findInvalidLatestTriplets(): Promise<InvalidTriplet[]> {
  const rows = await prisma.valuePickCandidate.findMany({
    orderBy: { evaluatedAt: "desc" },
    take: 2000,
    select: {
      id: true,
      fixtureId: true,
      market: true,
      modelProb: true,
      modelConfidence: true,
      bestOdds: true,
      impliedProb: true,
      evaluatedAt: true,
    },
  });

  const latestByFixtureMarket = new Map<string, CandidateRow>();
  for (const row of rows) {
    if (!row.market.startsWith("1x2_")) continue;
    const key = `${row.fixtureId}|${row.market}`;
    if (!latestByFixtureMarket.has(key)) latestByFixtureMarket.set(key, row);
  }

  const byFixture = new Map<number, CandidateRow[]>();
  for (const row of latestByFixtureMarket.values()) {
    const fixtureRows = byFixture.get(row.fixtureId) ?? [];
    fixtureRows.push(row);
    byFixture.set(row.fixtureId, fixtureRows);
  }

  return Array.from(byFixture.entries())
    .map(([fixtureId, fixtureRows]) => ({
      fixtureId,
      sum: fixtureRows.reduce((total, row) => total + row.modelProb, 0),
      rows: fixtureRows,
    }))
    .filter((triplet) => {
      const markets = new Set(triplet.rows.map((row) => row.market));
      return (
        markets.has("1x2_home") &&
        markets.has("1x2_draw") &&
        markets.has("1x2_away") &&
        Number.isFinite(triplet.sum) &&
        triplet.sum > 0 &&
        Math.abs(triplet.sum - 1) > TOLERANCE
      );
    })
    .sort((a, b) => Math.abs(b.sum - 1) - Math.abs(a.sum - 1));
}

async function repairTriplet(triplet: InvalidTriplet): Promise<number> {
  let updated = 0;

  for (const row of triplet.rows) {
    const modelProb = row.modelProb / triplet.sum;
    const edge = modelProb - row.impliedProb;
    const expectedValue = expectedValuePerUnitStake(modelProb, row.bestOdds);
    const denom = row.bestOdds - 1;
    const kellyRaw = denom > 0 ? expectedValue / denom : 0;

    await prisma.valuePickCandidate.update({
      where: { id: row.id },
      data: {
        modelProb,
        edge: round2(edge),
        edgePct: round2(edge * 100),
        expectedValue,
        kellyFraction: Math.max(0, Math.min(0.1, kellyRaw)),
      },
    });
    updated++;
  }

  return updated;
}

async function main(): Promise<void> {
  const invalidTriplets = await findInvalidLatestTriplets();

  console.log("Repair latest 1X2 candidate probabilities");
  console.log("==========================================");
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`Invalid triplets found: ${invalidTriplets.length}`);
  for (const triplet of invalidTriplets.slice(0, 20)) {
    console.log(`- fixture ${triplet.fixtureId}: sum=${triplet.sum.toFixed(4)}`);
  }

  if (!APPLY) {
    console.log("");
    console.log("Dry-run only. Re-run with --apply to normalize these candidate rows.");
    return;
  }

  let updated = 0;
  for (const triplet of invalidTriplets) {
    updated += await repairTriplet(triplet);
  }

  console.log("");
  console.log(`Updated candidate rows: ${updated}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
