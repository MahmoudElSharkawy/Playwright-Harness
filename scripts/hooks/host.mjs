#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {guardEvents} from '../lib/host-hooks.mjs';

// The legacy guard remains advisory and fail-open. Native permissions are independent.
try {
  let status = 0;
  for (const event of guardEvents(process.argv[2], JSON.parse(readFileSync(0, 'utf8')))) {
    try {process.stdout.write(execFileSync(process.execPath, [join(import.meta.dirname, 'guard.mjs'), event.mode], {input: JSON.stringify(event.input), encoding: 'utf8', timeout: 15000, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']}));}
    catch (error) {if (error.status === 2) {status = 2; process.stderr.write(error.stderr ?? '');}}
  }
  process.exitCode = status;
} catch {process.exitCode = 0;}
