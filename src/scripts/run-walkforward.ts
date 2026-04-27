import { runWalkforwardEvaluation } from "../lib/research/walkforward";

void (async () => {
  const report = await runWalkforwardEvaluation();
  console.log(JSON.stringify(report, null, 2));
})();
