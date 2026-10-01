#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {guardEvents} from '../lib/host-hooks.mjs';

// The legacy guard remains advisory and fail-open. Native permissions are independent.
try {
  const host = process.argv[2], input = JSON.parse(readFileSync(0, 'utf8'));
  let status = 0, stdout = '', stderr = '';
  for (const event of guardEvents(host, input)) {
    try {stdout += execFileSync(process.execPath, [join(import.meta.dirname, 'guard.mjs'), event.mode], {input: JSON.stringify(event.input), encoding: 'utf8', timeout: 15000, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});}
    catch (error) {if (error.status === 2) {status = 2; stderr += error.stderr ?? '';}}
  }
  // PowerShell maps an external exit 2 to shell exit 1. Codex supports an explicit
  // denial at exit 0, so the native decision survives that shell boundary.
  if (host === 'codex' && input.hook_event_name === 'PreToolUse' && status === 2) {
    process.stdout.write(JSON.stringify({hookSpecificOutput: {hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: stderr.trim()}}) + '\n');
    process.exitCode = 0;
  } else {process.stdout.write(stdout); process.stderr.write(stderr); process.exitCode = status;}
} catch {process.exitCode = 0;}
