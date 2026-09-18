/**
 * Loads `packages/server/.env` into `process.env` for local development, so a
 * developer can keep `MONGO_URL` and friends in a gitignored file instead of
 * exporting them by hand. Import this first, before anything reads `process.env`.
 *
 * `process.loadEnvFile()` reads `.env` from the current working directory, which
 * is the server package when it is run through `pnpm --filter @civ/server ...`.
 * In production there is no `.env` file — the host supplies the variables — so a
 * missing file is not an error.
 */

try {
  process.loadEnvFile()
} catch {
  // No .env in the working directory; rely on the real environment.
}
