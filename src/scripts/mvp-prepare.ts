import { runMvpPreparation } from "../lib/mvp/prepare";

async function main() {
  const result = await runMvpPreparation();
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
