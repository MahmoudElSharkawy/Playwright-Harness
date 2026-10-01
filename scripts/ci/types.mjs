#!/usr/bin/env node
// Compile an actual external TypeScript consumer of the installed JavaScript APIs.
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, cpSync, symlinkSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {packageRoot} from '../lib/consumer-paths.mjs';
import {realFuture, within} from '../lib/skill-roots.mjs';
import {command} from './process.mjs';

assert.equal(process.argv.length, 3, 'Supply one new external type-check workspace.');
const root = resolve(process.argv[2]); assert(!within(packageRoot, realFuture(root))); mkdirSync(root, {mode: 0o700});
const compiler = join(packageRoot, 'examples/node_modules/typescript/bin/tsc');
const examples = command([compiler, '--project', join(packageRoot, 'examples/tsconfig.json'), '--noEmit'], {cwd: root, log: join(root, 'examples.log')});
assert.equal(examples.status, 'PASS', 'Example type check failed.');
for (const name of ['@playwright/test', 'playwright', 'playwright-core', 'allure-js-commons', '@types/node', 'playwright-pom-harness']) {
  const target = join(root, 'node_modules', name); mkdirSync(dirname(target), {recursive: true});
  symlinkSync(name === 'playwright-pom-harness' ? packageRoot : join(packageRoot, 'examples/node_modules', name), target, process.platform === 'win32' ? 'junction' : 'dir');
}
for (const name of ['RuntimeActions', 'LifecycleActions']) cpSync(join(packageRoot, `harness-tests/fixtures/workflow-consumer/src/utils/${name}.ts`), join(root, `${name}.ts`));
writeFileSync(join(root, 'package.json'), JSON.stringify({name: 'installed-type-proof', private: true, type: 'module'}));
writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({compilerOptions: {target: 'ES2021', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
  allowJs: true, checkJs: false, maxNodeModuleJsDepth: 1, esModuleInterop: true, resolveJsonModule: true, skipLibCheck: true, noEmit: true, types: ['node']}, exclude: ['node_modules']}));
const contract = join(root, 'contract.ts'), source = "import {consumerRoots} from 'playwright-pom-harness/scripts/lib/consumer-paths.mjs';\n";
writeFileSync(contract, source + 'consumerRoots(process.cwd());\n');
const positive = command([compiler, '--project', join(root, 'tsconfig.json')], {cwd: root, log: join(root, 'consumer.log')});
assert.equal(positive.status, 'PASS', 'Installed helper type check failed.');
writeFileSync(contract, source + 'consumerRoots(42);\n');
const negative = command([compiler, '--project', join(root, 'tsconfig.json')], {cwd: root, log: join(root, 'invalid-input.log')});
assert(Number.isInteger(negative.exitCode) && negative.exitCode > 0); assert.equal(negative.diagnostic, null);
assert(/contract\.ts\(2,\d+\): error TS2345/.test(negative.output), 'An invalid argument must fail real inferred typing.');
console.log(JSON.stringify({status: 'PASS', examples: true, helperFiles: 2, validConsumer: true, invalidInputRejected: true, strict: true, maxNodeModuleJsDepth: 1}));
