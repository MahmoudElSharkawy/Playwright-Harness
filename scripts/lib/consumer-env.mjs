import {existsSync, readFileSync} from 'node:fs';
import {consumerPath} from './consumer-paths.mjs';

/** The shell environment, with names it lacks filled from the consumer's ignored .env.
 * Shell values win (an empty shell value still counts as set); the first duplicate line wins.
 * Nothing is written back to process.env, and values are never logged or persisted.
 */
export function consumerEnvironment(roots, shellEnvironment = process.env) {
  const environment = {...shellEnvironment}, dotEnv = consumerPath(roots, '.env');
  if (existsSync(dotEnv)) {
    const bytes = readFileSync(dotEnv); if (bytes.length > 65536) throw new Error('Consumer .env exceeds 64 KiB.');
    for (const line of bytes.toString('utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (match && environment[match[1]] === undefined) environment[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return environment;
}
