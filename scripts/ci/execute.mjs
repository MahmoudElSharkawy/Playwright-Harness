#!/usr/bin/env node
// Package once into a new external workspace, then exercise the installed executor.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {command} from './process.mjs';
import {packageRoot} from '../lib/consumer-paths.mjs';
const [directory] = process.argv.slice(2);
assert(process.argv.length === 3, 'Use <new external workspace>.');
const workspace = resolve(directory);
for (const args of [['scripts/ci/installed.mjs', workspace], ['scripts/ci/native.mjs', workspace, 'execute']]) {
  const result = command(args, {cwd: packageRoot, timeout: 3600000});
  process.stdout.write(result.output);
  if (result.status !== 'PASS') {process.exitCode = 1; break;}
}
