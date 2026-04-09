import { NextResponse } from "next/server";
import { fetchMatchData } from "@/lib/match-data";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const fixtureId = parseInt(id, 10);
  if (isNaN(fixtureId)) {
    return NextResponse.json({ error: "Invalid match ID" }, { status: 400 });
  }

  const data = await fetchMatchData(fixtureId);
  if (!data) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
