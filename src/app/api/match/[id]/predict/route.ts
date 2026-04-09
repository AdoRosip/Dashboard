import { NextResponse } from "next/server";
import { predictMatch } from "@/lib/prediction";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const fixtureId = parseInt(id, 10);
  if (isNaN(fixtureId)) {
    return NextResponse.json({ error: "Invalid match ID" }, { status: 400 });
  }

  try {
    const prediction = await predictMatch(fixtureId);
    return NextResponse.json(prediction);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
