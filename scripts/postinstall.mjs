// Restores this project's harness skill links after npm install, from the committed record.
// Started by the project's guarded postinstall entry; it never fails the install.
import {restoreLinks} from './lib/setup.mjs';

try {
  const result = restoreLinks(process.cwd());
  if (result.problems?.length) console.warn(`[pom-harness] Kept, needs review: ${result.problems.join(', ')}. Run "npx --no pom-harness setup".`);
} catch {
  console.warn('[pom-harness] Skill links were not restored; run "npx --no pom-harness setup".');
}
