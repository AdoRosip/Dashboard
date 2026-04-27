import { NextResponse } from "next/server";
import { analyzeOddsCoverage } from "@/lib/research/odds-coverage";

export async function GET() {
  try {
    const report = await analyzeOddsCoverage();
    return NextResponse.json(report);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
