import { DEFAULT_UPCOMING_DAYS } from "../lib/constants";
import { prisma } from "../lib/db";
import { recomputeValuePicksForUpcoming } from "../lib/odds/value-picks-service";

function readDaysArg(): number {
  const rawArg = process.argv.find((arg) => arg.startsWith("--days="));
  const raw = rawArg ? rawArg.slice("--days=".length) : process.env.AHEAD_DAYS;
  const parsed = raw == null ? DEFAULT_UPCOMING_DAYS : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_UPCOMING_DAYS;
}

async function main(): Promise<void> {
  const days = readDaysArg();
  const activePicks = await recomputeValuePicksForUpcoming(days);
  console.log(JSON.stringify({ days, activePicks }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
