// Example skeleton — adapt to your project (ships with the harness package).
import type { DBConnectionConfig } from '../utils/DBActions';

/**
 * All databases available to tests — one named entry per DB; specs pick what they need:
 *
 *   const appDb = new DBActions(databases.appDb);
 *
 * Every value — coordinates and credentials — comes from environment variables:
 * the gitignored .env at the repo root is the single source of truth, shared with
 * the AgenTeX catalogs in integration/*_db.json (loaded by dotenv in
 * playwright.config.ts; copy .env.example to .env and configure all required
 * coordinates and secret references for your target). Credentials are secrets: never
 * commit a literal credential anywhere.
 */
export const databases = {
  appDb: {
    name: 'AppDb',
    server: process.env.APP_DB_SERVER ?? '',
    port: Number(process.env.APP_DB_PORT) || undefined,
    database: process.env.APP_DB_NAME ?? '',
    user: process.env.DB_USER ?? '',
    password: process.env.DB_PASSWORD ?? '',
  },
  otherDb: {
    name: 'OtherDb',
    server: process.env.OTHER_DB_SERVER ?? '',
    port: Number(process.env.OTHER_DB_PORT) || undefined,
    database: process.env.OTHER_DB_NAME ?? '',
    user: process.env.DB_USER ?? '',
    password: process.env.DB_PASSWORD ?? '',
  },
} satisfies Record<string, DBConnectionConfig>;
