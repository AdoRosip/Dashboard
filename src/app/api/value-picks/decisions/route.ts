import { NextResponse } from "next/server";
import { getBetDecisionHistory } from "@/lib/odds/bet-decisions";

export async function GET() {
  try {
    const decisions = await getBetDecisionHistory();
    return NextResponse.json(decisions);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
