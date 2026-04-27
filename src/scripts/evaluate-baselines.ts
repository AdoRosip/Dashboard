import { evaluateBaselines } from "../lib/research/datasets";

void (async () => {
  const report = await evaluateBaselines({ limit: 5000 });
  console.log(JSON.stringify(report, null, 2));
})();
