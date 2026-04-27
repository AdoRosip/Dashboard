import { NextResponse } from "next/server";
import { buildValueBacktestReport } from "@/lib/odds/backtest";

export async function GET() {
  try {
    const report = await buildValueBacktestReport();
    return NextResponse.json(report);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
