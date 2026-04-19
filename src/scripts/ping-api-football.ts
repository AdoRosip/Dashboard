/**
 * One request to RapidAPI API-Football to verify API_FOOTBALL_KEY and burn 1 daily quota.
 * Ingest does not call this API — see comment in `src/lib/api-client.ts`.
 *
 *   API_FOOTBALL_KEY=... npx tsx src/scripts/ping-api-football.ts
 */

import { fetchApiFootball } from "../lib/api-client";

async function main() {
  const data = await fetchApiFootball<{ response?: unknown[] }>("/countries");
  const n = Array.isArray(data.response) ? data.response.length : 0;
  console.log("API-Football OK — /countries returned", n, "rows (key is valid).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
