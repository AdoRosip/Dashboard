import { settleValuePicks } from "../lib/odds/settle";
import { recomputeBettingPerformance } from "../lib/odds/performance";

async function main() {
  const n = await settleValuePicks();
  await recomputeBettingPerformance();
  console.log("Settled picks:", n);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
