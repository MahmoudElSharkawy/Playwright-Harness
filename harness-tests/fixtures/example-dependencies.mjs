import {mkdirSync, readdirSync, symlinkSync} from 'node:fs';
import {join} from 'node:path';

/** Real fixture node_modules permits a harness link without writing through the examples junction. */
export function linkExampleDependencies(root, packageRoot, names) {
  const dependencies = join(packageRoot, 'examples/node_modules');
  mkdirSync(join(root, 'node_modules'), {recursive: true});
  for (const name of names ?? readdirSync(dependencies, {withFileTypes: true}).filter(entry => entry.isDirectory() && entry.name !== 'playwright-pom-harness').map(entry => entry.name)) {
    const destination = join(root, 'node_modules', name); mkdirSync(join(destination, '..'), {recursive: true});
    symlinkSync(join(dependencies, name), destination, process.platform === 'win32' ? 'junction' : 'dir');
  }
  symlinkSync(packageRoot, join(root, 'node_modules/playwright-pom-harness'), process.platform === 'win32' ? 'junction' : 'dir');
}
