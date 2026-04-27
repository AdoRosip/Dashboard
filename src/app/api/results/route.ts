import { NextResponse } from "next/server";
import { buildMvpResultsReport } from "@/lib/mvp/results";

export async function GET() {
  try {
    const report = await buildMvpResultsReport();
    return NextResponse.json(report);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
