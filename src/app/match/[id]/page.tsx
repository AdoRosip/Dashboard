import { fetchMatchData } from "@/lib/match-data";
import { notFound } from "next/navigation";
import { MatchDashboard } from "@/components/match-dashboard";

export const dynamic = "force-dynamic";

export default async function MatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const fixtureId = parseInt(id, 10);
  if (isNaN(fixtureId)) notFound();

  const data = await fetchMatchData(fixtureId);
  if (!data) notFound();

  const serialize = <T,>(obj: T): T => JSON.parse(JSON.stringify(obj));

  return (
    <MatchDashboard
      data={{
        fixture: serialize(data.fixture),
        homeStats: serialize(data.homeStats),
        awayStats: serialize(data.awayStats),
        homeForm: serialize(data.homeForm),
        awayForm: serialize(data.awayForm),
        h2h: serialize(data.h2h),
        homePlayers: serialize(data.homePlayers),
        awayPlayers: serialize(data.awayPlayers),
        prediction: serialize(data.prediction),
      }}
    />
  );
}
