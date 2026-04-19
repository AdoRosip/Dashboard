import { NextResponse } from "next/server";
import { DEFAULT_UPCOMING_DAYS } from "@/lib/constants";
import { refreshOddsForUpcomingFixtures, recomputeValuePicksForUpcoming } from "@/lib/odds";

export async function POST() {
  try {
    const results = await refreshOddsForUpcomingFixtures(DEFAULT_UPCOMING_DAYS);
    const n = await recomputeValuePicksForUpcoming(DEFAULT_UPCOMING_DAYS);
    return NextResponse.json({ ok: true, results, valuePicksUpdated: n });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
