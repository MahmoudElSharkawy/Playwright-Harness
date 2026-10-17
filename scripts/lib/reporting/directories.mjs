import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {consumerRoots, consumerPath} from '../consumer-paths.mjs';
import {requireThat} from '../execution-core/data.mjs';

/** New consumer output only; never replace source, package files or a prior report. */
export function reportDirectory(inputRoots, path) {
  const roots = consumerRoots(inputRoots.projectRoot, inputRoots.packageRoot);
  requireThat(typeof path === 'string' && path.startsWith('reports/') && !/[\\\r\n\0:]/.test(path) && path.split('/').every(part => part && !['.', '..'].includes(part)), 'Report output must be relative consumer reports/ storage.');
  const directory = consumerPath(roots, path); mkdirSync(dirname(directory), {recursive: true, mode: 0o700});
  requireThat(consumerPath(roots, path) === directory, 'Report directory ownership changed.');
  mkdirSync(directory, {mode: 0o700}); return directory;
}

export function reportTimestamp(at = new Date()) {
  return new Date(at).toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-') + 'Z';
}

/** Exclusive mkdir arbitrates same-second writers across processes; other errors retain their meaning. */
export function timestampedReportDirectory(roots, {parent, prefix = '', at = new Date()} = {}) {
  requireThat(typeof parent === 'string' && /^[a-z-]*$/.test(prefix), 'Invalid report location or prefix.');
  const base = `${parent}/${prefix}${reportTimestamp(at)}`;
  for (let collision = 0; collision < 10000; collision++) {
    const directory = base + (collision ? `-${String(collision).padStart(3, '0')}` : '');
    try {return {directory, path: reportDirectory(roots, directory)};}
    catch (error) {if (error.code !== 'EEXIST') throw error;}
  }
  throw new Error('Report timestamp collision limit exceeded.');
}
