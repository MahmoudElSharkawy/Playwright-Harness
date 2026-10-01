import {readdirSync, readFileSync, readlinkSync, realpathSync} from 'node:fs';
import {join, relative, isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';

/** Hash the actual installed copy, including executable dependencies and shim links. */
export function snapshotInstalledPackage(root) {
  root = realpathSync(root); const files = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const path = join(directory, entry.name), name = relative(root, path).replaceAll('\\', '/');
      if (entry.isSymbolicLink()) {
        const target = realpathSync(path), suffix = relative(root, target);
        if (isAbsolute(suffix) || suffix === '..' || suffix.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Installed dependency link escapes package.');
        files.push([name, 'link', readlinkSync(path)]);
      } else if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push([name, 'file', createHash('sha256').update(readFileSync(path)).digest('hex')]);
      else throw new Error('Unsupported installed package entry.');
    }
  }
  walk(root); if (!files.length) throw new Error('Empty installed package.');
  return files.sort((a, b) => a[0].localeCompare(b[0]));
}
