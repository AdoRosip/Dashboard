import { analyzeOddsCoverage } from "../lib/research/odds-coverage";

void (async () => {
  const report = await analyzeOddsCoverage();
  console.log(JSON.stringify(report, null, 2));
})();
