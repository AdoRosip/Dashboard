import { NextResponse } from "next/server";
import { settleValuePicks } from "@/lib/odds/settle";
import { recomputeBettingPerformance } from "@/lib/odds/performance";

export async function POST() {
  try {
    const settled = await settleValuePicks();
    await recomputeBettingPerformance();
    return NextResponse.json({ ok: true, settled });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
