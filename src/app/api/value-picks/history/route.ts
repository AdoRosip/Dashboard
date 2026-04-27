import { NextResponse } from "next/server";
import { getCandidateHistory } from "@/lib/odds/candidate-history";

export async function GET() {
  try {
    const history = await getCandidateHistory();
    return NextResponse.json(history);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
