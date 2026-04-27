import { NextResponse } from "next/server";
import { DEFAULT_UPCOMING_DAYS } from "@/lib/constants";
import { runOddsCaptureCycle } from "@/lib/odds";

export async function POST() {
  try {
    const result = await runOddsCaptureCycle({ days: DEFAULT_UPCOMING_DAYS });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
