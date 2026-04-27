import { NextResponse } from "next/server";
import { evaluateBaselines } from "@/lib/research/datasets";

export async function GET() {
  try {
    const report = await evaluateBaselines({ limit: 5000 });
    return NextResponse.json(report);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
