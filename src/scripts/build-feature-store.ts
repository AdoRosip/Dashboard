import { buildFeatureStore } from "../lib/research/feature-store";

void (async () => {
  const result = await buildFeatureStore({
    daysAhead: 2,
    historicalDays: 60,
    includeFinished: true,
  });
  console.log(JSON.stringify(result, null, 2));
})();
