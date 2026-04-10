import { NextResponse } from "next/server";
import { runCalibrationForFinishedFixtures } from "@/lib/calibration";

export async function POST() {
  try {
    await runCalibrationForFinishedFixtures();
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
