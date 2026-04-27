import { backfillOddsObservationHistoryFromSnapshots } from "../lib/odds";

void (async () => {
  const created = await backfillOddsObservationHistoryFromSnapshots();
  console.log(JSON.stringify({ created }, null, 2));
})();
