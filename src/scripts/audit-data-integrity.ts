import { prisma } from "../lib/db";

type DuplicateGroup = {
  competitionId: string;
  homeTeamId: number;
  awayTeamId: number;
  day: string;
  fixtures: Array<{
    id: number;
    utcDate: Date;
    homeTeam: { name: string };
    awayTeam: { name: string };
  }>;
};

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function findDuplicateFinishedFixtures(): Promise<DuplicateGroup[]> {
  const fixtures = await prisma.fixture.findMany({
    where: {
      status: "FINISHED",
      scoreHomeFt: { not: null },
      scoreAwayFt: { not: null },
    },
    select: {
      id: true,
      competitionId: true,
      homeTeamId: true,
      awayTeamId: true,
      utcDate: true,
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
    orderBy: { utcDate: "desc" },
  });

  const grouped = new Map<string, DuplicateGroup>();
  for (const fixture of fixtures) {
    const day = dayKey(fixture.utcDate);
    const key = [
      fixture.competitionId,
      fixture.homeTeamId,
      fixture.awayTeamId,
      day,
    ].join("|");
    const group = grouped.get(key) ?? {
      competitionId: fixture.competitionId,
      homeTeamId: fixture.homeTeamId,
      awayTeamId: fixture.awayTeamId,
      day,
      fixtures: [],
    };
    group.fixtures.push(fixture);
    grouped.set(key, group);
  }

  return Array.from(grouped.values()).filter((group) => group.fixtures.length > 1);
}

async function findInvalidLatest1x2CandidateSums() {
  const rows = await prisma.valuePickCandidate.findMany({
    orderBy: { evaluatedAt: "desc" },
    take: 1000,
    select: {
      fixtureId: true,
      market: true,
      modelProb: true,
      evaluatedAt: true,
    },
  });

  const latestByFixtureMarket = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.fixtureId}|${row.market}`;
    if (!latestByFixtureMarket.has(key)) latestByFixtureMarket.set(key, row);
  }

  const byFixture = new Map<number, (typeof rows)[number][]>();
  for (const row of latestByFixtureMarket.values()) {
    if (!row.market.startsWith("1x2_")) continue;
    const fixtureRows = byFixture.get(row.fixtureId) ?? [];
    fixtureRows.push(row);
    byFixture.set(row.fixtureId, fixtureRows);
  }

  const invalidRows = Array.from(byFixture.entries())
    .map(([fixtureId, fixtureRows]) => ({
      fixtureId,
      sum: fixtureRows.reduce((total, row) => total + row.modelProb, 0),
      markets: fixtureRows.map((row) => row.market).sort(),
    }))
    .filter(
      (row) =>
        row.markets.includes("1x2_home") &&
        row.markets.includes("1x2_draw") &&
        row.markets.includes("1x2_away") &&
        Math.abs(row.sum - 1) > 0.01,
    )
    .sort((a, b) => Math.abs(b.sum - 1) - Math.abs(a.sum - 1));

  const fixtures = await prisma.fixture.findMany({
    where: { id: { in: invalidRows.map((row) => row.fixtureId) } },
    select: {
      id: true,
      competitionId: true,
      status: true,
      utcDate: true,
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  });
  const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));

  return invalidRows.map((row) => ({
    ...row,
    fixture: fixtureById.get(row.fixtureId) ?? null,
  }));
}

async function main() {
  const [duplicateFixtures, invalid1x2Sums] = await Promise.all([
    findDuplicateFinishedFixtures(),
    findInvalidLatest1x2CandidateSums(),
  ]);

  console.log("Data integrity audit");
  console.log("====================");
  console.log(`Duplicate finished fixture groups: ${duplicateFixtures.length}`);
  for (const group of duplicateFixtures.slice(0, 20)) {
    const label = `${group.fixtures[0]?.homeTeam.name ?? group.homeTeamId} vs ${
      group.fixtures[0]?.awayTeam.name ?? group.awayTeamId
    }`;
    const ids = group.fixtures.map((fixture) => fixture.id).join(", ");
    console.log(`- ${group.day} ${group.competitionId}: ${label} [${ids}]`);
  }

  console.log("");
  console.log(`Invalid latest 1X2 candidate probability sums: ${invalid1x2Sums.length}`);
  for (const row of invalid1x2Sums.slice(0, 20)) {
    const fixture = row.fixture;
    const label = fixture
      ? `${fixture.utcDate.toISOString()} ${fixture.status} ${fixture.competitionId}: ${fixture.homeTeam.name} vs ${fixture.awayTeam.name}`
      : "fixture missing";
    console.log(`- fixture ${row.fixtureId}: sum=${row.sum.toFixed(4)} ${label}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
