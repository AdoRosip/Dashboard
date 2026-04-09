import { NextResponse } from "next/server";
import { refreshAll } from "@/lib/ingest";

export async function POST() {
  try {
    await refreshAll();
    return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ status: "error", message: msg }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    message: "Use POST to trigger a data refresh",
  });
}
