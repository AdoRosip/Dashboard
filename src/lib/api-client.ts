import { FOOTBALL_DATA_BASE, API_FOOTBALL_BASE } from "./constants";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let lastFootballDataCall = 0;
const FD_MIN_INTERVAL = 6500; // ~10 req/min → 6s between calls + buffer

export async function fetchFootballData<T = unknown>(
  path: string,
): Promise<T> {
  const key = process.env.FOOTBALL_DATA_API_KEY;
  if (!key) throw new Error("FOOTBALL_DATA_API_KEY not set");

  const now = Date.now();
  const elapsed = now - lastFootballDataCall;
  if (elapsed < FD_MIN_INTERVAL) {
    await sleep(FD_MIN_INTERVAL - elapsed);
  }
  lastFootballDataCall = Date.now();

  const res = await fetch(`${FOOTBALL_DATA_BASE}${path}`, {
    headers: { "X-Auth-Token": key },
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `football-data.org ${res.status}: ${text.slice(0, 200)}`,
    );
  }

  return res.json() as Promise<T>;
}

let lastApiFootballCall = 0;
const AF_MIN_INTERVAL = 1000;

export async function fetchApiFootball<T = unknown>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error("API_FOOTBALL_KEY not set");

  const now = Date.now();
  const elapsed = now - lastApiFootballCall;
  if (elapsed < AF_MIN_INTERVAL) {
    await sleep(AF_MIN_INTERVAL - elapsed);
  }
  lastApiFootballCall = Date.now();

  const url = new URL(`${API_FOOTBALL_BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const res = await fetch(url.toString(), {
    headers: {
      "x-rapidapi-key": key,
      "x-rapidapi-host": "v3.football.api-sports.io",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`api-football ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

/**
 * @deprecated Use fetchLeagueData() from scrapers/understat.ts instead.
 * The old HTML scraping approach no longer works — Understat now loads
 * data via XHR from /getLeagueData/{league}/{season}.
 */
export async function fetchUnderstat(leagueSlug: string, season: string) {
  const { fetchLeagueData } = await import("./scrapers/understat");
  return fetchLeagueData(leagueSlug, season);
}
