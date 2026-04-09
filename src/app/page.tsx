import { prisma } from "@/lib/db";
import { FixturesList } from "@/components/fixtures-list";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const now = new Date();
  const until = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const fixtures = await prisma.fixture.findMany({
    where: {
      utcDate: { gte: now, lte: until },
      status: { in: ["SCHEDULED", "TIMED"] },
    },
    include: {
      homeTeam: true,
      awayTeam: true,
      competition: true,
      predictions: {
        take: 1,
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { utcDate: "asc" },
  });

  const competitions = await prisma.competition.findMany({
    orderBy: { name: "asc" },
  });

  const lastRefresh = await prisma.dataRefreshLog.findFirst({
    orderBy: { timestamp: "desc" },
  });

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Upcoming Fixtures</h1>
          <p className="mt-1 text-sm text-text-muted">
            {fixtures.length} matches in the next 3 days
            {lastRefresh && (
              <span> · Last updated {new Date(lastRefresh.timestamp).toLocaleString()}</span>
            )}
          </p>
        </div>
      </div>
      <FixturesList
        fixtures={JSON.parse(JSON.stringify(fixtures))}
        competitions={JSON.parse(JSON.stringify(competitions))}
      />
    </div>
  );
}
