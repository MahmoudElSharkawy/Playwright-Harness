#!/usr/bin/env node
/**
 * generate-tracker.mjs — render the plan-tracker HTML report from the
 * plan-tracker skill's committed data (registry + append-only history).
 *
 * Reads:   .claude/skills/plan-tracker/data/plan-<planId>.json (structural registry:
 *              branches, suites, cases with verdict/note, manual rulings, filed bugs
 *              — discovered automatically; create yours from _registry-template.json)
 *          .claude/skills/plan-tracker/data/history.jsonl      (append-only dated
 *              status events; later lines win — the progress source of truth)
 *          .claude/skills/plan-tracker/assets/tracker-template.html
 *          test/ado-suite-<id>/_verify-state.json               (--sync only: live
 *              pipeline state, diffed into a new history event)
 * Writes:  reports/tracker/plan-<planId>-tracker.html           (gitignored output)
 *          reports/tracker/archive/plan-<planId>-tracker-<ts>.html (--archive only)
 *          data/history.jsonl                                   (--sync only: one
 *              appended event when the live state differs from the folded history)
 *
 * Usage:   node scripts/generate-tracker.mjs [options]
 *
 * Options:
 *   --plan <id>       pick data/plan-<id>.json when the data folder holds more than
 *                     one registry (a single registry is discovered automatically)
 *   --sync            before rendering, diff test/ado-suite-*\/_verify-state.json
 *                     against the folded history and append the differences as one
 *                     dated event. Mapping: passed→done · fixme/blocked→blocked ·
 *                     failed→blocked at the 3-round cap, else doing ·
 *                     pending-confirmation→doing · no-state→ignored. Skipped: cases
 *                     under a manual (non-automatable) ruling, and cases whose last
 *                     history event is NEWER than the verify-state file (a team
 *                     ruling must never be overridden by stale pipeline state).
 *                     Review with --dry-run first after hand-edited rulings.
 *   --archive         also write a timestamped copy under reports/tracker/archive/
 *   --out <path>      output HTML path (default reports/tracker/plan-<planId>-tracker.html)
 *   --dry-run         print the summary and the would-be sync event, write nothing
 *   --json            machine-readable summary on stdout
 *
 * Exit codes: 0 ok · 1 usage · 2 input unreadable · 3 malformed data
 */

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_DIR = join(ROOT, '.claude', 'skills', 'plan-tracker');
const DATA_DIR = join(SKILL_DIR, 'data');
const HISTORY_PATH = join(DATA_DIR, 'history.jsonl');
const TEMPLATE_PATH = join(SKILL_DIR, 'assets', 'tracker-template.html');
const SUITES_DIR = join(ROOT, 'test');

const STATUSES = new Set(['todo', 'doing', 'done', 'blocked']);
const ROUND_CAP = 3; // mirrors harness-metrics.mjs — failed at the cap is terminal, i.e. blocked

const fail = (code, msg) => {
  console.error(`[generate-tracker] ERROR: ${msg}`);
  process.exit(code);
};
const warn = (msg) => console.warn(`[generate-tracker] ${msg}`);

// ---------- CLI ----------

const args = process.argv.slice(2);
const opts = { sync: false, archive: false, dryRun: false, json: false, out: null, plan: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--sync') { opts.sync = true; continue; }
  if (a === '--archive') { opts.archive = true; continue; }
  if (a === '--dry-run') { opts.dryRun = true; continue; }
  if (a === '--json') { opts.json = true; continue; }
  if (a === '--plan') {
    const v = args[i + 1];
    if (v === undefined || !/^\d+$/.test(v)) fail(1, 'option --plan needs a numeric plan id — see the header of scripts/generate-tracker.mjs for usage');
    opts.plan = v;
    i++;
    continue;
  }
  if (a === '--out') {
    const v = args[i + 1];
    if (v === undefined || v.startsWith('--')) fail(1, 'option --out needs a value — see the header of scripts/generate-tracker.mjs for usage');
    opts.out = resolve(ROOT, v);
    i++;
    continue;
  }
  fail(1, `unknown option: ${a} — see the header of scripts/generate-tracker.mjs for usage`);
}

// ---------- locate the plan registry ----------

let REGISTRY_PATH;
if (opts.plan) {
  REGISTRY_PATH = join(DATA_DIR, `plan-${opts.plan}.json`);
} else {
  const found = existsSync(DATA_DIR) ? readdirSync(DATA_DIR).filter((f) => /^plan-\d+\.json$/.test(f)).sort() : [];
  if (found.length === 0) fail(2, `no plan registry in ${DATA_DIR} — create plan-<planId>.json there from _registry-template.json (see the plan-tracker SKILL.md)`);
  if (found.length > 1) fail(1, `multiple plan registries in ${DATA_DIR} (${found.join(', ')}) — pick one with --plan <id>`);
  REGISTRY_PATH = join(DATA_DIR, found[0]);
}

// ---------- load inputs ----------

function readOrFail(path, what) {
  try { return readFileSync(path, 'utf8'); }
  catch (e) { fail(2, `cannot read ${what} at ${path}: ${e.message}`); }
}

let registry;
try { registry = JSON.parse(readOrFail(REGISTRY_PATH, 'plan registry')); }
catch (e) { fail(3, `malformed plan registry: ${e.message}`); }
if (!Array.isArray(registry?.names) || !Array.isArray(registry?.branches) || !Array.isArray(registry?.suites)) {
  fail(3, 'malformed plan registry: expected top-level names[], branches[], suites[]');
}
if (!Number.isInteger(registry?.planId)) fail(3, 'malformed plan registry: expected a numeric top-level planId');
if (!opts.out) opts.out = join(ROOT, 'reports', 'tracker', `plan-${registry.planId}-tracker.html`);
for (const su of registry.suites) {
  if (!Array.isArray(su?.cases)) fail(3, `malformed plan registry: suite ${su && su.id} has no cases array`);
}

const caseIndex = new Map(); // id -> { branch, suiteId, verdict }
for (const su of registry.suites) for (const c of su.cases) caseIndex.set(c.id, { branch: su.branch, suiteId: su.id, verdict: c.verdict });

function parseHistory(text) {
  const events = [];
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].trim();
    if (!line) continue;
    let e;
    try { e = JSON.parse(line); }
    catch (err) { fail(3, `history.jsonl line ${n + 1} is not valid JSON: ${err.message}`); }
    if (typeof e.at !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(e.at)) fail(3, `history.jsonl line ${n + 1}: "at" must be an ISO date (YYYY-MM-DD)`);
    if (e.set !== undefined && (typeof e.set !== 'object' || e.set === null || Array.isArray(e.set))) fail(3, `history.jsonl line ${n + 1}: "set" must be a { status: [caseIds] } object`);
    for (const [st, ids] of Object.entries(e.set ?? {})) {
      if (!STATUSES.has(st)) fail(3, `history.jsonl line ${n + 1}: unknown status "${st}" (allowed: ${[...STATUSES].join('/')})`);
      if (!Array.isArray(ids) || ids.some((id) => !Number.isInteger(id))) fail(3, `history.jsonl line ${n + 1}: "set.${st}" must be an array of numeric case ids`);
    }
    for (const [name, ids] of Object.entries(e.assign ?? {})) {
      if (!Array.isArray(ids) || ids.some((id) => !Number.isInteger(id))) fail(3, `history.jsonl line ${n + 1}: "assign.${name}" must be an array of numeric case ids`);
    }
    events.push({ line: n + 1, ...e });
  }
  return events;
}
const history = parseHistory(readOrFail(HISTORY_PATH, 'history ledger'));

// ---------- fold history into current state ----------

function foldState(events) {
  const state = new Map(); // id -> { s, a }
  const lastEventAt = new Map(); // id -> date of the last event that set its status
  const unknown = new Set();
  for (const id of caseIndex.keys()) state.set(id, { s: 'todo', a: 0 });
  for (const e of events) {
    for (const [st, ids] of Object.entries(e.set ?? {})) {
      for (const id of ids) {
        if (!state.has(id)) { unknown.add(`${id} (line ${e.line})`); continue; }
        state.get(id).s = st;
        lastEventAt.set(id, e.at.slice(0, 10));
      }
    }
    for (const [name, ids] of Object.entries(e.assign ?? {})) {
      const idx = registry.names.indexOf(name) + 1;
      if (!idx) { warn(`history line ${e.line}: assignee "${name}" is not in the registry names — ignored`); continue; }
      for (const id of ids) { if (state.has(id)) state.get(id).a = idx; }
    }
  }
  if (unknown.size) warn(`history references case id(s) not in the registry — update ${REGISTRY_PATH}: ${[...unknown].join(', ')}`);
  return { state, lastEventAt };
}
let { state, lastEventAt } = foldState(history);

const manualIds = new Set(Object.keys(registry.manual ?? {}).map(Number));
const bugFiled = new Set(Object.values(registry.bugs ?? {}).flatMap((b) => b.cases ?? []));
const oosBranches = new Set(registry.branches.flatMap((b, i) => (b.inScope ? [] : [i])));

// ---------- --sync: diff live pipeline state into a new event ----------

const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function collectVerifyState() {
  const found = new Map(); // caseId(number) -> { status, rounds, suite, fileDate }
  if (!existsSync(SUITES_DIR)) return found;
  for (const entry of readdirSync(SUITES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('ado-suite-')) continue;
    const path = join(SUITES_DIR, entry.name, '_verify-state.json');
    if (!existsSync(path)) continue;
    let verify;
    try { verify = JSON.parse(readFileSync(path, 'utf8')); }
    catch (e) { warn(`skipped malformed ${path}: ${e.message}`); continue; }
    const fileDate = localDate(statSync(path).mtime);
    for (const [tc, c] of Object.entries(verify.cases ?? {})) {
      found.set(Number(tc), { status: c.status, rounds: Number(c.rounds) || 0, suite: entry.name, fileDate });
    }
  }
  return found;
}

// verify-state status -> tracker status; null = the pipeline has nothing to report yet
function mapVerify(v) {
  if (v.status === 'passed') return 'done';
  if (v.status === 'fixme' || v.status === 'blocked') return 'blocked';
  if (v.status === 'pending-confirmation') return 'doing';
  if (v.status === 'failed') return v.rounds >= ROUND_CAP ? 'blocked' : 'doing';
  return null;
}

let syncEvent = null;
if (opts.sync) {
  const live = collectVerifyState();
  const set = {};
  const notInRegistry = [];
  const staleSkipped = [];
  for (const [id, v] of live) {
    const mapped = mapVerify(v);
    if (!mapped) continue;
    if (!state.has(id)) { notInRegistry.push(`${id} (${v.suite})`); continue; }
    if (manualIds.has(id)) continue; // non-automatable by ruling — pipeline state never drives these
    if (state.get(id).s === mapped) continue;
    if ((lastEventAt.get(id) ?? '') > v.fileDate) { staleSkipped.push(`${id} (history ${lastEventAt.get(id)} > ${v.suite} ${v.fileDate})`); continue; }
    (set[mapped] = set[mapped] || []).push(id);
  }
  if (notInRegistry.length) warn(`verify-state case(s) not in the registry — update ${REGISTRY_PATH}: ${notInRegistry.join(', ')}`);
  if (staleSkipped.length) warn(`sync skipped case(s) whose history is newer than the verify-state file: ${staleSkipped.join(', ')}`);
  for (const ids of Object.values(set)) ids.sort((a, b) => a - b);
  if (Object.keys(set).length) {
    const counts = Object.entries(set).map(([st, ids]) => `${st} ${ids.length}`).join(' · ');
    syncEvent = {
      at: localDate(new Date()),
      source: 'verify-state sync',
      note: `Synced from test/ado-suite-*/_verify-state.json (passed→done · fixme/blocked→blocked · failed at ${ROUND_CAP}-round cap→blocked · else in-flight→doing): ${counts}.`,
      set,
    };
    if (opts.dryRun) {
      console.log(`DRY RUN — would append to history.jsonl:\n${JSON.stringify(syncEvent)}`);
    } else {
      const raw = readFileSync(HISTORY_PATH, 'utf8');
      appendFileSync(HISTORY_PATH, (raw.length && !raw.endsWith('\n') ? '\n' : '') + JSON.stringify(syncEvent) + '\n');
      console.log(`Appended sync event to history.jsonl (${counts}).`);
    }
    ({ state } = foldState([...history, { line: history.length + 1, ...syncEvent }]));
  } else {
    console.log('Sync: live verify-state matches the folded history — nothing to append.');
  }
}

// ---------- summary (mirrors the page's refreshTotals/SCOPE_SPLIT) ----------

function summarize() {
  const s = { cases: caseIndex.size, scope: { automatable: 0, outOfScope: 0, cleanup: 0, manual: 0 },
    inScopeTotal: 0, passing: 0, bugFiled: 0, blocked: 0, doing: 0, todo: 0, awaitingReview: 0 };
  for (const [id, { branch, verdict }] of caseIndex) {
    const st = state.get(id).s;
    // structural split (fixed, status-independent)
    if (oosBranches.has(branch)) s.scope.outOfScope += 1;
    else if (manualIds.has(id)) s.scope.manual += 1;
    else if (verdict !== 'k') s.scope.cleanup += 1;
    else s.scope.automatable += 1;
    // work composition (status-dependent, in-scope branches only)
    if (manualIds.has(id)) continue;
    if (bugFiled.has(id)) { s.bugFiled += 1; s.inScopeTotal += 1; continue; }
    if (oosBranches.has(branch)) continue;
    if (st === 'done') { if (verdict === 'k') { s.passing += 1; s.inScopeTotal += 1; } }
    else if (verdict !== 'k') s.awaitingReview += 1;
    else {
      s.inScopeTotal += 1;
      if (st === 'doing') s.doing += 1;
      else if (st === 'blocked') s.blocked += 1;
      else s.todo += 1;
    }
  }
  s.automated = s.passing + s.bugFiled;
  s.automatedPct = s.inScopeTotal ? Math.round((s.automated / s.inScopeTotal) * 100) : 0;
  s.passingPct = s.automated ? Math.round((s.passing / s.automated) * 100) : 0;
  return s;
}
const summary = summarize();

// ---------- render ----------

const template = readOrFail(TEMPLATE_PATH, 'tracker template');
for (const token of ['/*__TRACKER_DATA__*/null', '__PLAN_ID__', '__GENERATED_AT__']) {
  if (!template.includes(token)) fail(3, `template is missing the ${token} token — regenerate the template`);
}

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stampLocal = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
const stampFile = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

const embed = {
  generatedAt: now.toISOString(),
  planId: registry.planId,
  names: registry.names,
  branches: registry.branches,
  suites: registry.suites,
  manual: registry.manual ?? {},
  bugs: registry.bugs ?? {},
  state: Object.fromEntries([...state].map(([id, st]) => [id, st])),
};

const html = template
  .replace('/*__TRACKER_DATA__*/null', () => JSON.stringify(embed).replace(/</g, '\\u003c'))
  .replaceAll('__PLAN_ID__', () => String(registry.planId))
  .replace('__GENERATED_AT__', () => stampLocal);

if (opts.dryRun) {
  console.log(`Dry run — nothing written (target: ${opts.out}).`);
} else {
  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, html);
  console.log(`Wrote ${opts.out}`);
  if (opts.archive) {
    const archiveDir = join(dirname(opts.out), 'archive');
    mkdirSync(archiveDir, { recursive: true });
    const archivePath = join(archiveDir, `${basename(opts.out, '.html')}-${stampFile}.html`);
    writeFileSync(archivePath, html);
    console.log(`Archived ${archivePath}`);
  }
}

if (opts.json) {
  console.log(JSON.stringify({ generatedAt: embed.generatedAt, out: opts.out, historyEvents: history.length + (syncEvent && !opts.dryRun ? 1 : 0), syncEvent, summary }, null, 2));
} else {
  const sc = summary.scope;
  console.log([
    `plan ${registry.planId} · ${summary.cases} cases — automatable ${sc.automatable} · out-of-scope ${sc.outOfScope} · cleanup(d/f/t) ${sc.cleanup} · manual ${sc.manual}`,
    `in-scope ${summary.inScopeTotal}: automated ${summary.automated} (${summary.automatedPct}%) = ${summary.passing} passing + ${summary.bugFiled} bug-filed · blocked ${summary.blocked} · doing ${summary.doing} · todo ${summary.todo}`,
    `passing ${summary.passing}/${summary.automated} of automated (${summary.passingPct}%) · awaiting-review ${summary.awaitingReview} · history events ${history.length + (syncEvent && !opts.dryRun ? 1 : 0)}`,
  ].join('\n'));
}
