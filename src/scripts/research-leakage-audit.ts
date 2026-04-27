import { buildLeakageAuditReport } from "../lib/research/leakage-audit";

void (async () => {
  const report = await buildLeakageAuditReport();
  console.log(JSON.stringify(report, null, 2));
})();
