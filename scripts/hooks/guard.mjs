#!/usr/bin/env node
/**
 * guard.mjs — Claude Code lifecycle hooks for the playwright-pom harness.
 *
 * Registered in .claude/settings.json. Modes (argv[2]):
 *   session-start  SessionStart : inject the harness activation reminder
 *   pre-bash       PreToolUse   : (1) block direct pushes to master/main
 *                                 (2) block an UNCHANGED `playwright test` rerun
 *                                     after a failure with no intervening edit
 *   post-bash      PostToolUse  : record playwright test failures for (2)
 *   post-edit      PostToolUse  : mark "something changed" + warn-only convention lint
 *
 * Protocol: stdin JSON event. PreToolUse exit 2 + stderr = block with reason.
 * PostToolUse exit 2 + stderr = non-blocking feedback to the model.
 * FAIL-OPEN: any internal error exits 0 silently — the guard must never brick a session.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execSync, execFileSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..', '..');

function readStdin() {
  try { return JSON.parse(readFileSync(0, 'utf8')); } catch { return {}; }
}

function ledgerPath(sessionId) {
  const dir = join(tmpdir(), 'playwright-pom-guard');
  mkdirSync(dir, { recursive: true });
  return join(dir, createHash('sha256').update(String(sessionId || 'unknown')).digest('hex').slice(0, 24) + '.json');
}
function readLedger(sessionId) {
  try { return JSON.parse(readFileSync(ledgerPath(sessionId), 'utf8')); } catch { return {}; }
}
function writeLedger(sessionId, data) {
  try { writeFileSync(ledgerPath(sessionId), JSON.stringify(data)); } catch { /* fail open */ }
}

const commandOf = (input) =>
  String(input?.tool_input?.command ?? input?.tool_input?.cmd ?? '');

/** Normalize a playwright-test command into a stable fingerprint (npx-prefix agnostic). */
function testFingerprint(command) {
  const m = command.match(/playwright\s+test\b[\s\S]*/i);
  if (!m) return null;
  return createHash('sha256').update(m[0].replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);
}

/** True when any push in the command would land on master/main.
 *  push must be git's SUBCOMMAND (so `git stash push` never matches); handles
 *  chained commands, flags, HEAD, and colon refspecs (only the DESTINATION side
 *  of src:dest matters). `git -C <other>` pushes skip the current-branch check. */
function pushTargetsDefault(command) {
  const isDefault = (name) => /^(refs\/heads\/)?(master|main)$/i.test(name);
  const currentIsDefault = () => {
    try {
      const b = execSync('git branch --show-current', { cwd: ROOT, encoding: 'utf8', timeout: 5000 }).trim();
      return b === 'master' || b === 'main';
    } catch { return false; }
  };
  for (const chunk of command.split(/&&|\|\||;|\||\r?\n/)) {
    const seg = chunk.match(/\bgit(?:\.exe)?\s+((?:-{1,2}[^\s=]+(?:=\S+)?\s+|-C\s+\S+\s+)*)push\b(.*)$/i);
    if (!seg) continue;
    const otherRepo = /(^|\s)-C\s/.test(seg[1]);
    const tokens = seg[2].trim().split(/\s+/).filter(Boolean).filter((t) => !t.startsWith('-'));
    const refspecs = tokens.slice(1); // tokens[0] is the remote (when present)
    if (refspecs.length === 0) {      // bare `git push` / `git push origin` → current branch decides
      if (!otherRepo && currentIsDefault()) return true;
      continue;
    }
    for (const r of refspecs) {
      const dest = r.includes(':') ? r.split(':').pop() : r;
      if (dest === 'HEAD' || r === 'HEAD') { if (!otherRepo && currentIsDefault()) return true; continue; }
      if (isDefault(dest)) return true;
    }
  }
  return false;
}

function main() {
  const mode = process.argv[2];
  const input = readStdin();
  const sessionId = input.session_id;

  if (mode === 'session-start') {
    console.log(
      'playwright-pom harness reminders: (1) skill-first rule — route every framework task via the CLAUDE.md ' +
      'intent table before touching files; (2) all changes happen on a purposefully-named feature branch, never ' +
      'on master — the pipeline ends with a PR; (3) run `node scripts/check-conventions.mjs --changed` before committing.');
    return 0;
  }

  if (mode === 'pre-bash') {
    const command = commandOf(input);
    if (!command) return 0;

    // Rule 1: never push to master/main directly.
    if (pushTargetsDefault(command)) {
      console.error(
        'BLOCKED by the harness guard: direct pushes to master/main are forbidden (repo rule in CLAUDE.md). ' +
        'Create a feature branch (e.g. automation/<suite>, harness/<topic>), push that, and open a PR.');
      return 2;
    }

    // Rule 2: identical playwright-test rerun after failure with no intervening edit.
    const fp = testFingerprint(command);
    if (fp) {
      const ledger = readLedger(sessionId);
      if (ledger.lastFailFp === fp && ledger.editsSinceFail === false) {
        console.error(
          'BLOCKED by the harness guard: this exact `playwright test` command already failed and nothing was ' +
          'edited since. Change something (fix the script, adjust data) or classify the failure per the ' +
          'automate-suite VERIFY table (script defect / app defect / environment) instead of rerunning unchanged. ' +
          'To rerun deliberately (e.g. suspected flake), vary the command: add --retries=1 or -g "<title>".');
        return 2;
      }
    }
    return 0;
  }

  if (mode === 'post-bash') {
    const command = commandOf(input);
    const fp = testFingerprint(command);
    if (!fp) return 0;
    // collect only the textual output fields — stringifying the whole response
    // would false-positive on test TITLES containing the word "failed"
    const resp = input.tool_response;
    const responseText = typeof resp === 'string'
      ? resp
      : Object.values(resp ?? {}).filter((v) => typeof v === 'string').join('\n');
    const failed = /^\s*[1-9]\d*\s+failed\b/m.test(responseText) || /^\s*Error: [1-9]\d* test/m.test(responseText);
    const ledger = readLedger(sessionId);
    if (failed) {
      ledger.lastFailFp = fp;
      ledger.editsSinceFail = false;
    } else if (ledger.lastFailFp === fp) {
      delete ledger.lastFailFp;          // same command now passes — clear the breaker
      delete ledger.editsSinceFail;
    }
    writeLedger(sessionId, ledger);
    return 0;
  }

  if (mode === 'post-edit') {
    const filePath = input?.tool_input?.file_path || input?.tool_input?.notebook_path;
    // Only a change that can alter test behavior re-arms reruns — bookkeeping writes
    // (_verify-state.json, _suite.json, reports) must not defeat the circuit breaker.
    const behaviorFile = filePath &&
      /[\\/](tests|pages|apis|dbs|utils|config|resources)[\\/]/.test(filePath) &&
      !/_verify-state\.json$|_suite\.json$/.test(filePath);
    if (behaviorFile) {
      const ledger = readLedger(sessionId);
      if (ledger.lastFailFp && ledger.editsSinceFail === false) {
        ledger.editsSinceFail = true;
        writeLedger(sessionId, ledger);
      }
    }
    // Warn-only convention lint on the edited framework file.
    if (!filePath || !/[\\/](tests|pages|apis|dbs|utils|config)[\\/].*\.(ts|js|mjs)$/.test(filePath)) return 0;
    try {
      const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'check-conventions.mjs'), '--quiet', '--files', filePath],
        { cwd: ROOT, encoding: 'utf8', timeout: 12000 });
      if (/\b[1-9]\d* new WARN/.test(out)) { // fresh warnings exit 0 — relay them anyway
        console.error('convention check (warn-only) for the file you just edited:\n' + out.trim());
        return 2;
      }
      return 0;                          // clean — stay silent
    } catch (e) {
      if (e.status === 1 && e.stdout) {  // new violations → non-blocking feedback to the model
        console.error('convention check (warn-only) for the file you just edited:\n' + String(e.stdout).trim());
        return 2;
      }
      return 0;                          // linter error — fail open
    }
  }

  return 0;
}

try { process.exit(main()); } catch { process.exit(0); }
