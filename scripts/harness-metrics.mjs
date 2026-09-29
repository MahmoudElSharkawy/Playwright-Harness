#!/usr/bin/env node
/**
 * harness-metrics.mjs — aggregate the harness pipeline's on-disk state into one report.
 *
 * Reads:   test/ado-suite-<id>/_suite.json + _verify-state.json    (pipeline/verify state)
 *          .agentex/page-map/*.md                                  (per-page "Drift ledger" tables)
 *          .claude/skills/framework-review/class-ledger.md         (review finding-class rows)
 * Prints:  automation coverage per suite and in total (passed + fixme over total cases),
 *          fix-round/greens stats, the classification breakdown, the NEEDS-HUMAN QUEUE
 *          (terminal cases awaiting a person: rounds exhausted, blocked, app-defect
 *          awaiting triage, unclassified), and drift-rate flags (elements with >= 3
 *          ledger entries — the framework-review escalation rule).
 *
 * Usage:   node scripts/harness-metrics.mjs [--json]
 *
 * Zero-dependency (Node >= 18). Reporting must never brick a run: malformed files are
 * skipped with a one-line warning, missing state renders an empty section, and the
 * exit code is always 0.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUITES_DIR = join(ROOT, 'test');
const PAGE_MAP_DIR = join(ROOT, '.agentex', 'page-map');
const CLASS_LEDGER = join(ROOT, '.claude', 'skills', 'framework-review', 'class-ledger.md');
const DRIFT_FLAG_AT = 3; // three drift entries for one element = wrong strategy, not unlucky
const ROUND_CAP = 3;     // fix rounds per case, cumulative — cap reached + still failing = terminal
const HUMAN_CLASSES = ['app-defect', 'environment', 'unclassified'];

const warn = (msg) => console.warn(`[harness-metrics] ${msg}`);

function readJsonSafe(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { warn(`skipped malformed ${path}: ${e.message}`); return null; }
}

// ---------- suites (test/ado-suite-*/) ----------

function collectSuites() {
  if (!existsSync(SUITES_DIR)) return [];
  const suites = [];
  for (const entry of readdirSync(SUITES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('ado-suite-')) continue;
    const dir = join(SUITES_DIR, entry.name);
    const manifest = readJsonSafe(join(dir, '_suite.json'));
    const verify = readJsonSafe(join(dir, '_verify-state.json'));
    if (!manifest && !verify) { warn(`skipped ${entry.name}: no readable _suite.json or _verify-state.json`); continue; }

    const verifyCases = (verify && verify.cases) || {};
    const ids = [...new Set([
      ...(Array.isArray(manifest && manifest.cases) ? manifest.cases.map((c) => String(c.id)) : []),
      ...Object.keys(verifyCases),
    ])].sort();

    const cases = {};
    for (const id of ids) {
      const v = verifyCases[id];
      const rounds = Number(v && v.rounds);
      const greens = Number(v && v.greens);
      cases[id] = {
        status: (v && v.status) || 'no-state',          // no verify entry yet = mid-pipeline
        rounds: Number.isFinite(rounds) ? rounds : (v ? 0 : null),
        greens: Number.isFinite(greens) ? greens : 0,
        classification: (v && v.classification) || '',
        note: (v && v.note) || '',
      };
    }
    suites.push({ suite: entry.name, cases });
  }
  return suites.sort((a, b) => a.suite.localeCompare(b.suite));
}

function statsFor(caseList) {
  const s = { total: caseList.length, passed: 0, pendingConfirmation: 0, fixme: 0, failed: 0,
    blocked: 0, noState: 0, coveragePct: null, roundsMean: null, roundsMax: null, classifications: {} };
  const rounds = [];
  for (const c of caseList) {
    if (c.status === 'passed') s.passed += 1;                            // greens >= 2 by contract
    else if (c.status === 'pending-confirmation') s.pendingConfirmation += 1;
    else if (c.status === 'fixme') s.fixme += 1;                         // app defect, assertion kept
    else if (c.status === 'failed') s.failed += 1;
    else if (c.status === 'blocked') s.blocked += 1;
    else s.noState += 1;
    if (c.classification) s.classifications[c.classification] = (s.classifications[c.classification] || 0) + 1;
    if (c.rounds !== null) rounds.push(c.rounds);
  }
  if (rounds.length) {
    s.roundsMean = Math.round((rounds.reduce((a, b) => a + b, 0) / rounds.length) * 10) / 10;
    s.roundsMax = Math.max(...rounds);
  }
  if (s.total) s.coveragePct = Math.round(((s.passed + s.fixme) / s.total) * 1000) / 10;
  return s;
}

function needsHumanQueue(suites) {
  const queue = [];
  for (const { suite, cases } of suites) {
    for (const [tc, c] of Object.entries(cases)) {
      const roundsExhausted = c.status === 'failed' && (c.rounds || 0) >= ROUND_CAP;
      const terminalClass = HUMAN_CLASSES.includes(c.classification) && c.status !== 'passed';
      if (roundsExhausted || c.status === 'blocked' || terminalClass) {
        queue.push({ suite, tc, status: c.status, classification: c.classification || '-',
          rounds: c.rounds === null ? 0 : c.rounds, note: c.note });
      }
    }
  }
  return queue;
}

// ---------- locator drift (.agentex/page-map/*.md "Drift ledger" tables) ----------

const isTableSeparator = (l) => /^\|[\s:|-]+\|?$/.test(l);
const rowCells = (l) => l.split('|').slice(1, -1).map((c) => c.trim());

function collectDrift() {
  if (!existsSync(PAGE_MAP_DIR)) return null;
  const pages = [];
  for (const name of readdirSync(PAGE_MAP_DIR)) {
    if (!/\.md$/i.test(name) || /^(_template|README)\.md$/i.test(name)) continue;
    let lines;
    try { lines = readFileSync(join(PAGE_MAP_DIR, name), 'utf8').split(/\r?\n/); }
    catch (e) { warn(`skipped ${name}: ${e.message}`); continue; }
    const start = lines.findIndex((l) => /^#{1,6}\s+Drift ledger\b/i.test(l));
    if (start < 0) continue;
    const elements = {};
    let entries = 0;
    for (let i = start + 1; i < lines.length && !/^#/.test(lines[i]); i++) {
      const l = lines[i].trim();
      if (!l.startsWith('|') || isTableSeparator(l)) continue;
      const element = rowCells(l)[1] || '';
      if (!element || /^Element\b/i.test(element)) continue;             // header or placeholder row
      elements[element] = (elements[element] || 0) + 1;
      entries += 1;
    }
    pages.push({ page: name.replace(/\.md$/i, ''), entries, elements });
  }
  const flagged = [];
  for (const p of pages) {
    for (const [element, n] of Object.entries(p.elements)) {
      if (n >= DRIFT_FLAG_AT) flagged.push({ page: p.page, element, entries: n });
    }
  }
  return { pages: pages.sort((a, b) => a.page.localeCompare(b.page)), flagged };
}

// ---------- review findings (framework-review class ledger) ----------

function collectReviewFindings() {
  if (!existsSync(CLASS_LEDGER)) return null;
  let lines;
  try { lines = readFileSync(CLASS_LEDGER, 'utf8').split(/\r?\n/); }
  catch (e) { warn(`skipped class ledger: ${e.message}`); return null; }
  const classes = {};
  let totalRows = 0;
  for (const raw of lines) {
    const l = raw.trim();
    if (!l.startsWith('|') || isTableSeparator(l)) continue;
    const cls = rowCells(l)[1] || '';
    if (!cls || /^Class$/i.test(cls)) continue;                          // header row
    classes[cls] = (classes[cls] || 0) + 1;
    totalRows += 1;
  }
  return { totalRows, classes };
}

// ---------- rendering ----------

function renderTable(headers, rows) {
  const all = [headers, ...rows].map((r) => r.map((c) => String(c === null || c === undefined ? '' : c)));
  const widths = headers.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  return all.map((r) => r.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}

const clip = (s, max = 70) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const byCountDesc = (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]);

function suiteRow(name, s) {
  return [name, s.total, s.passed, s.pendingConfirmation, s.fixme, s.failed, s.blocked, s.noState,
    s.coveragePct === null ? '-' : `${s.coveragePct}%`,
    s.roundsMean === null ? '-' : `${s.roundsMean} / ${s.roundsMax}`];
}

function main() {
  const suites = collectSuites();
  const suiteStats = suites.map((s) => ({ suite: s.suite, ...statsFor(Object.values(s.cases)), cases: s.cases }));
  const totals = statsFor(suites.flatMap((s) => Object.values(s.cases)));
  const queue = needsHumanQueue(suites);
  const drift = collectDrift();
  const findings = collectReviewFindings();

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      suites: suiteStats,
      totals,
      needsHuman: queue,
      drift,
      reviewFindings: findings,
    }, null, 2));
    return;
  }

  const out = [];

  out.push('== SUITES ==');
  if (!suiteStats.length) {
    out.push('no pipeline state found (no test/ado-suite-*/ folder holds _suite.json or _verify-state.json)');
  } else {
    const rows = suiteStats.map((s) => suiteRow(s.suite, s));
    if (suiteStats.length > 1) rows.push(suiteRow('TOTAL', totals));
    out.push(renderTable(
      ['suite', 'cases', 'passed', 'pending', 'fixme', 'failed', 'blocked', 'no-state', 'coverage', 'rounds mean/max'],
      rows));
    out.push('coverage = passed + fixme over total; passed requires greens >= 2 (the rerun-reusability gate)');
  }

  out.push('', '== CLASSIFICATIONS ==');
  const cls = Object.entries(totals.classifications).sort(byCountDesc);
  if (!cls.length) out.push('none recorded');
  else out.push(renderTable(['classification', 'cases'], cls));

  out.push('', `== NEEDS-HUMAN QUEUE == (${queue.length} case(s))`);
  if (!queue.length) {
    out.push('empty — no terminal case is awaiting a human');
  } else {
    out.push(renderTable(['suite', 'tc', 'status', 'classification', 'rounds', 'note'],
      queue.map((q) => [q.suite, q.tc, q.status, q.classification, q.rounds, clip(q.note)])));
  }

  out.push('', '== LOCATOR DRIFT ==');
  if (!drift) {
    out.push('no page map found (.agentex/page-map/)');
  } else if (!drift.pages.length) {
    out.push('no page-map drift ledgers found (.agentex/page-map/)');
  } else {
    out.push(renderTable(['page', 'drift entries'], drift.pages.map((p) => [p.page, p.entries])));
    if (drift.flagged.length) {
      for (const f of drift.flagged) {
        out.push(`FLAG  ${f.page} :: ${f.element} — ${f.entries} drift entries (>= ${DRIFT_FLAG_AT}: raise in the next framework review — that selector strategy is wrong, not unlucky)`);
      }
    } else {
      out.push(`no element at the flag threshold (>= ${DRIFT_FLAG_AT} entries)`);
    }
  }

  out.push('', '== REVIEW FINDINGS ==');
  if (!findings) {
    out.push('no class ledger found (.claude/skills/framework-review/class-ledger.md)');
  } else if (!findings.totalRows) {
    out.push('ledger empty — no findings recorded');
  } else {
    out.push(renderTable(['class', 'findings'], Object.entries(findings.classes).sort(byCountDesc)));
    out.push(`${findings.totalRows} row(s) total — three rows with one class = propose a check-conventions rule`);
  }

  console.log(out.join('\n'));
}

try { main(); } catch (e) { warn(`error: ${e.message}`); }
process.exitCode = 0;
