// Example skeleton — adapt to your project (ships with the harness package).
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { DBConnectionConfig } from '../utils/DBActions';

/**
 * Destinations are entered once, in `.harness/targets.json` — the file written when
 * the harness is configured, which its exploration runtime reads too — and the
 * config modules take them from here, so specs, pages and services use the same values:
 *
 *   url: appUrl('app'),              // browser target "app": its first origin
 *   appDb: databaseTarget('appDb'),  // database target "appDb": server, port, database
 *
 * An environment variable named after the target overrides a value on one machine or
 * run: APP_URL; APP_DB_SERVER, APP_DB_PORT, APP_DB_NAME.
 *
 * Credentials are secrets and never live in that file: a database target names the
 * variable that holds its {"user","password"} JSON (connectionRef "env:APP_DB");
 * a database without a target uses DB_USER and DB_PASSWORD. Values come only from
 * process.env — the gitignored .env, loaded by dotenv in playwright.config.ts.
 */
interface HarnessTargets {
  databases?: Record<string, { connectionRef: string; server?: string; port?: number; database?: string; encrypt?: boolean; trustServerCertificate?: boolean }>;
  browser?: Record<string, { origins: string[] }>;
}
const targetsFile = path.resolve(__dirname, '../../.harness/targets.json');
const targets: HarnessTargets = existsSync(targetsFile) ? JSON.parse(readFileSync(targetsFile, 'utf8')) : {};
/** Target `appDb` → `APP_DB`. */
const variablePrefix = (id: string): string => id.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();

/** The application's address: `<TARGET>_URL`, else the browser target's first origin. */
export const appUrl = (id: string): string => process.env[`${variablePrefix(id)}_URL`] || targets.browser?.[id]?.origins[0] || '';

/** A database's coordinates from its target, its credentials from the variable the target names. */
export function databaseTarget(id: string): DBConnectionConfig {
  const target = targets.databases?.[id], prefix = variablePrefix(id);
  const credentials = target ? JSON.parse(process.env[target.connectionRef.slice('env:'.length)] || '{}') : { user: process.env.DB_USER, password: process.env.DB_PASSWORD };
  return {
    name: id,
    server: process.env[`${prefix}_SERVER`] || target?.server || '',
    port: Number(process.env[`${prefix}_PORT`] || target?.port) || undefined,
    database: process.env[`${prefix}_NAME`] || target?.database || '',
    user: credentials.user ?? '',
    password: credentials.password ?? '',
    encrypt: target?.encrypt,
    trustServerCertificate: target?.trustServerCertificate,
  };
}
