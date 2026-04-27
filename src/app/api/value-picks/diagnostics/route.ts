import { NextResponse } from "next/server";
import { DEFAULT_UPCOMING_DAYS } from "@/lib/constants";
import { getUpcomingValueDiagnostics } from "@/lib/odds/value-diagnostics";

export async function GET() {
  try {
    const diagnostics = await getUpcomingValueDiagnostics(DEFAULT_UPCOMING_DAYS);
    return NextResponse.json(diagnostics);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
