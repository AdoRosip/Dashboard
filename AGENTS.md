# Repository Guidelines

## Project Structure & Module Organization
`src/app` contains Next.js App Router pages and API routes. `src/components` holds shared UI. `src/lib` contains the core domain logic: ingestion, prediction, odds capture, MVP policy/health, calibration, and research utilities. `src/scripts` contains operational entry points such as `mvp-prepare`, `odds:capture`, `research:readiness`, and data repair scripts. Prisma schema and the local SQLite database live in `prisma/`.

Use the `@/*` TypeScript path alias for imports from `src` (for example `@/lib/mvp/health`).

## Build, Test, and Development Commands
- `npm run dev`: start the Next.js dev server.
- `npm run build`: create a production build.
- `npm run lint`: run Next.js/ESLint checks.
- `npm test`: run the `node:test` safeguard suite in `src/lib/safeguards.test.ts`.
- `npm run mvp:prepare`: run the full MVP refresh, recompute picks, and health gate.
- `npm run research:readiness`: inspect odds-history and capture readiness.
- `npm run audit:data`: audit duplicate fixtures and invalid 1X2 probability sums.
- `npm run db:generate` / `npm run db:push`: regenerate Prisma client and sync schema.

## Coding Style & Naming Conventions
Use TypeScript with strict typing and 2-space indentation consistent with the existing files. Prefer named exports for library modules. Use `PascalCase` for React components, `camelCase` for functions/variables, and kebab-free script names that match `package.json`. Keep MVP-specific code under `src/lib/mvp` and odds-related logic under `src/lib/odds`.

## Testing Guidelines
Add focused tests to `src/lib/safeguards.test.ts` for policy, math, and regression checks. Keep test names behavior-based, for example `test("rejects impossible all-zero 1X2 probabilities", ...)`. Run `npm test` before opening a PR. For data-pipeline work, also run the smallest relevant script such as `npm run research:readiness` or `npm run audit:data`.

## Commit & Pull Request Guidelines
Recent local commit subjects are not reliable conventions. Use short, imperative commit messages instead, such as `Fix scoped MVP odds match gate` or `Add duplicate fixture audit`. Keep one logical change per commit.

PRs should include:
- a brief problem/solution summary
- commands run for verification
- screenshots for UI changes under `src/app`
- notes about schema, env, or data-migration impact

## Security & Configuration Tips
Copy values from `.env.example`; never commit real API keys. `FOOTBALL_DATA_API_KEY` is required for ingest, `ODDS_API_KEY` is optional but needed for odds capture, and the default local database is SQLite via `DATABASE_URL="file:./dev.db"`.
