import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';

const text = bytes => bytes.toString('utf8').replace(/\0[\s\S]*$/, '');
/** The package.json inside an npm archive, read in memory without extracting anything to disk. */
export function archiveManifest(path) {
  const tar = gunzipSync(readFileSync(path), {maxOutputLength: 256 * 1024 * 1024});
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = text(header.subarray(0, 100)), prefix = text(header.subarray(345, 500));
    const size = Number.parseInt(text(header.subarray(124, 136)).trim() || '0', 8);
    if (!Number.isSafeInteger(size) || size < 0) break;
    if ((prefix ? `${prefix}/${name}` : name) === 'package/package.json') return JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString('utf8'));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('Not an npm package archive.');
}
export const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
/** The integrity value npm records in a lockfile for a tarball. */
export const integrity = path => `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`;
