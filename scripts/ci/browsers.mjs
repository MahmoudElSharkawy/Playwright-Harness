#!/usr/bin/env node
// Install the pinned native CLI's Chromium for this package copy, wherever npm placed the CLI.
import {spawnSync} from 'node:child_process';
import {packageRoot} from '../lib/consumer-paths.mjs';
import {nativeCliInstallation} from '../lib/browser/native-cli.mjs';

const extra = process.argv.slice(2);
if (extra.some(argument => argument !== '--with-deps')) throw new Error('Only --with-deps is supported.');
const result = spawnSync(process.execPath, [nativeCliInstallation(packageRoot).installer, 'install', ...extra, 'chromium'], {stdio: 'inherit', windowsHide: true});
process.exitCode = result.status ?? 1;
