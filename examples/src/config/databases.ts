// Example skeleton — adapt to your project (ships with the harness package).
import type { DBConnectionConfig } from '../utils/DBActions';
import { databaseTarget } from './targets';

/**
 * All databases available to tests — one named entry per DB; specs pick what they need:
 *
 *   const appDb = new DBActions(databases.appDb);
 *
 * Coordinates come from the database target of the same name in .harness/targets.json,
 * shared with the harness runtime (see targets.ts for the per-machine overrides).
 * Credentials are secrets and come only from environment variables — the variable the
 * target names, set in the gitignored .env (copy .env.example to .env and fill it in).
 * Never commit a literal credential anywhere.
 */
export const databases = {
  appDb: databaseTarget('appDb'),
  otherDb: databaseTarget('otherDb'),
} satisfies Record<string, DBConnectionConfig>;
