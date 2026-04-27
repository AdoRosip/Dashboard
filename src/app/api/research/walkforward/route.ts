import { NextResponse } from "next/server";
import { runWalkforwardEvaluation } from "@/lib/research/walkforward";

export async function GET() {
  try {
    const report = await runWalkforwardEvaluation();
    return NextResponse.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
