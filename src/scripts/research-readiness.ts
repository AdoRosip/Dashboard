import { buildResearchReadinessReport } from "../lib/research/readiness";

void (async () => {
  const report = await buildResearchReadinessReport();
  console.log(JSON.stringify(report, null, 2));
})();
