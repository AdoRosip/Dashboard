import { NextResponse } from "next/server";
import { getMvpProductHealth } from "@/lib/mvp/health";

export async function GET() {
  try {
    const report = await getMvpProductHealth();
    return NextResponse.json(report);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
