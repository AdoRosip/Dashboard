import { NextResponse } from "next/server";
import {
  buildFeatureStore,
  getFeatureSourceSnapshotSummary,
  getFeatureSnapshotTrustSummary,
  getFeatureStoreDataset,
} from "@/lib/research/feature-store";

export async function GET() {
  try {
    const [rows, trustSummary, sourceSummary] = await Promise.all([
      getFeatureStoreDataset(),
      getFeatureSnapshotTrustSummary(),
      getFeatureSourceSnapshotSummary(),
    ]);
    return NextResponse.json({ rows, count: rows.length, trustSummary, sourceSummary });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const result = await buildFeatureStore({
      daysAhead: 2,
      historicalDays: 60,
      includeFinished: true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
