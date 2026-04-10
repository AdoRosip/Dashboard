import { NextResponse } from "next/server";
import { refreshOddsForUpcomingFixtures, recomputeValuePicksForUpcoming } from "@/lib/odds";

export async function POST() {
  try {
    const results = await refreshOddsForUpcomingFixtures(7);
    const n = await recomputeValuePicksForUpcoming(7);
    return NextResponse.json({ ok: true, results, valuePicksUpdated: n });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
