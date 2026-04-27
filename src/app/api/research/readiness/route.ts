import { NextResponse } from "next/server";
import { buildResearchReadinessReport } from "@/lib/research/readiness";

export async function GET() {
  try {
    const report = await buildResearchReadinessReport();
    return NextResponse.json(report);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
