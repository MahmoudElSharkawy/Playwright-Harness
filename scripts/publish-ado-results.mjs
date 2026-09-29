#!/usr/bin/env node
/**
 * publish-ado-results.mjs — push automate-suite outcomes back to Azure DevOps.
 *
 * Two write modes (both verified by re-reading after every write, both support --dry-run):
 *
 *   1. Outcomes → test points (default):
 *      node scripts/publish-ado-results.mjs --suite <suiteId> [--plan <id>]
 *      Reads test/ado-suite-<suiteId>/_suite.json + _verify-state.json, creates one
 *      Test Run against the plan, sets each covered point Passed/Failed/Blocked with
 *      the classification note, completes the run.
 *
 *   2. Automation marking → work items:
 *      node scripts/publish-ado-results.mjs --suite <suiteId> --mark-automated [--value "Automated"]
 *      Sets the project's custom picklist Custom.Automation (plus the standard
 *      Microsoft.VSTS.TCM.* automation fields) on each case whose script WORKS:
 *      VERIFY-passed, or failing on a classified app defect (the assertion is valid
 *      and correctly detects a real bug — team ruling 2026-08-22). Script-defect and
 *      environment failures are never marked. Run this AFTER the automation PR is
 *      merged to master (repo rule). --value "Not Automated" reverses it.
 *
 * _verify-state.json contract (written by the automate-suite VERIFY phase):
 *   { "cases": { "<tcId>": { "status": "passed|failed|blocked|fixme|pending-confirmation",
 *                            "rounds": n, "greens": n,
 *                            "classification": "app-defect|script-defect|environment|unclassified",
 *                            "note": "..." } } }
 *   "greens" counts consecutive runs in which the case executed and passed since its
 *   last behavior edit; "pending-confirmation" = passed its latest run at greens 1
 *   (deliberately unmapped in OUTCOME_MAP below — skipped, never published); the
 *   VERIFY phase records "passed" only when greens >= 2 (rerun-reusability gate,
 *   team ruling 2026-08-24). This script keys off "status"/"classification" only and
 *   ignores unknown fields, so legacy files without "greens" still publish.
 *
 * Auth: AZURE_PAT / AZURE_DEVOPS_EXT_PAT from .env (never printed). Scopes needed:
 * Test Management R&W (outcomes) and Work Items R&W (marking).
 * Exit codes: 0 ok · 1 usage/config · 2 auth · 3 missing suite/state data · 4 API error.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = resolve(import.meta.dirname, '..');

function fail(code, msg) {
  console.error(`[publish-ado-results] ERROR: ${msg}`);
  process.exit(code);
}
function loadDotEnv() {
  const p = join(ROOT, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

let AUTH = '';
async function ado(url, { method = 'GET', body, contentType = 'application/json' } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: AUTH, 'Content-Type': contentType, Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    fail(4, `network error calling ${url.split('?')[0]} — ${e.message}`);
  }
  if (res.status === 401 || res.status === 403 || res.status === 203) {
    fail(2, `HTTP ${res.status} — PAT rejected or missing scope. Outcomes need "Test Management: Read & Write"; --mark-automated needs "Work Items: Read & Write".`);
  }
  return res;
}
async function adoJson(url, opts) {
  const res = await ado(url, opts);
  if (!res.ok) fail(4, `HTTP ${res.status} on ${url.split('?')[0]} — ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const OUTCOME_MAP = { passed: 'Passed', failed: 'Failed', blocked: 'Blocked', fixme: 'Failed' };

async function main() {
  const args = process.argv.slice(2);
  const opt = (n) => {
    const i = args.indexOf(n);
    if (i < 0) return undefined;
    const v = args[i + 1];
    return v === undefined || v.startsWith('--') ? undefined : v;
  };
  const has = (n) => args.includes(n);
  const dry = has('--dry-run');

  loadDotEnv();
  const cfg = readJson(join(ROOT, 'config', 'project.json'));
  const az = cfg.azure || {};
  const org = az.org, project = encodeURIComponent(az.project || '');
  const pat = process.env.AZURE_DEVOPS_EXT_PAT || process.env.AZURE_PAT;
  if (!org || !project) fail(1, 'azure.org/project missing in config/project.json');
  if (!pat) fail(1, 'no PAT — set AZURE_PAT in .env');
  AUTH = 'Basic ' + Buffer.from(':' + pat).toString('base64');
  const base = `https://dev.azure.com/${org}/${project}/_apis`;

  const suiteId = opt('--suite');
  if (!suiteId) fail(1, 'usage: node scripts/publish-ado-results.mjs --suite <suiteId> [--plan <id>] [--mark-automated [--value "Automated"]] [--dry-run]');

  const suiteDir = join(ROOT, 'test', `ado-suite-${suiteId}`);
  const manifestPath = join(suiteDir, '_suite.json');
  if (!existsSync(manifestPath)) fail(3, `${manifestPath} not found — run the FETCH phase first.`);
  const manifest = readJson(manifestPath);
  const planId = opt('--plan') || manifest.planId;
  if (!planId) fail(1, 'no plan id — pass --plan <id> (the manifest carries none).');

  const statePath = join(suiteDir, '_verify-state.json');
  const state = existsSync(statePath) ? readJson(statePath) : null;

  // ---------- mode 2: mark automation fields on work items ----------
  if (has('--mark-automated')) {
    const value = opt('--value') || 'Automated';
    const specFiles = manifest.resolvedSpecFiles || (manifest.suggestedSpecFile ? [manifest.suggestedSpecFile] : []);
    // map tms id -> generated test title: index-based pairing so test.fixme/skip and
    // multiline test( signatures pair correctly; a tms pairs with the NEAREST test() above it
    const titleByTc = new Map();
    for (const rel of specFiles) {
      const p = join(ROOT, rel);
      if (!existsSync(p)) continue;
      const text = readFileSync(p, 'utf8');
      const titles = [...text.matchAll(/\btest(?:\.(?:fixme|skip|fail|only))?\s*\(\s*(['"`])([\s\S]*?)\1/g)]
        .map((m) => ({ index: m.index, title: m[2] }));
      for (const t of text.matchAll(/allure\.tms\s*\(\s*['"`](\d+)['"`]/g)) {
        const owner = titles.filter((x) => x.index < t.index).at(-1);
        if (owner) titleByTc.set(Number(t[1]), { title: owner.title, file: rel });
        else console.error(`[warn] ${rel}: allure.tms('${t[1]}') appears before any test() — no title paired`);
      }
    }
    // current field values (one batched read) so a reversal only touches cases that ARE marked
    const currentByTc = new Map();
    if (value !== 'Automated') {
      for (let i = 0; i < manifest.cases.length; i += 200) {
        const res = await ado(`${base}/wit/workitemsbatch?api-version=7.1`, {
          method: 'POST',
          body: { ids: manifest.cases.slice(i, i + 200).map((c) => c.id), fields: ['System.Id', 'Custom.Automation'], errorPolicy: 'omit' },
        });
        if (res.ok) for (const wi of (await res.json()).value) currentByTc.set(wi.id, wi.fields['Custom.Automation']);
      }
    }
    // Team ruling (2026-08-22): "Automated" = a WORKING script exists — VERIFY passed,
    // OR failing on a classified app defect (the valid assertion correctly detects a
    // real bug). Script-defect and environment failures are NOT automated.
    const hasWorkingScript = (v) =>
      v?.status === 'passed' ||
      (['fixme', 'failed'].includes(v?.status) && /app.?defect/i.test(v?.classification || ''));
    const eligible = manifest.cases.filter((c) => {
      if (has('--all')) return true;
      if (value === 'Automated') return hasWorkingScript(state?.cases?.[c.id]);
      return currentByTc.get(c.id) === 'Automated'; // reversal: only cases currently marked
    });
    if (!eligible.length) fail(3, value === 'Automated'
      ? 'no eligible cases (default marks cases whose script works: VERIFY-passed or app-defect classified; use --all to override).'
      : 'no eligible cases (reversal targets only cases currently marked Automated; use --all to override).');

    let okCount = 0;
    for (const c of eligible) {
      const gen = titleByTc.get(c.id);
      const patch = [{ op: 'add', path: '/fields/Custom.Automation', value }];
      if (value === 'Automated' && gen) {
        // ADO rule: AutomationStatus only accepts "Automated" while AutomatedTestId is
        // non-empty, so the id (a stable sha1-derived GUID) must ride the same patch.
        const h = createHash('sha1').update(`${gen.file}::${gen.title}`).digest('hex');
        const testId = [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20, 32)].join('-');
        patch.push(
          { op: 'add', path: '/fields/Microsoft.VSTS.TCM.AutomationStatus', value: 'Automated' },
          { op: 'add', path: '/fields/Microsoft.VSTS.TCM.AutomatedTestName', value: gen.title },
          { op: 'add', path: '/fields/Microsoft.VSTS.TCM.AutomatedTestStorage', value: gen.file },
          { op: 'add', path: '/fields/Microsoft.VSTS.TCM.AutomatedTestType', value: 'Playwright' },
          { op: 'add', path: '/fields/Microsoft.VSTS.TCM.AutomatedTestId', value: testId },
        );
      } else if (value === 'Automated') {
        console.error(`[warn] TC ${c.id}: no generated test paired — marking Custom.Automation only (AutomationStatus="Automated" needs a test pointer, which ADO rejects without AutomatedTestId).`);
      } else {
        // reversal clears the stale pointers too (add '' — 'remove' errors on absent fields)
        patch.push(
          { op: 'add', path: '/fields/Microsoft.VSTS.TCM.AutomationStatus', value: 'Not Automated' },
          { op: 'add', path: '/fields/Microsoft.VSTS.TCM.AutomatedTestName', value: '' },
          { op: 'add', path: '/fields/Microsoft.VSTS.TCM.AutomatedTestStorage', value: '' },
          { op: 'add', path: '/fields/Microsoft.VSTS.TCM.AutomatedTestType', value: '' },
          { op: 'add', path: '/fields/Microsoft.VSTS.TCM.AutomatedTestId', value: '' },
        );
      }
      if (dry) {
        console.log(`[dry-run] TC ${c.id}: Custom.Automation="${value}"${gen ? ` test="${gen.title}"` : ''}`);
        okCount += 1; // a dry-run "write" counts as ok — exit 0 means the plan is sound
        continue;
      }
      const res = await ado(`${base}/wit/workitems/${c.id}?api-version=7.1`, {
        method: 'PATCH', body: patch, contentType: 'application/json-patch+json',
      });
      if (!res.ok) {
        console.error(`[failed]  TC ${c.id}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
        continue;
      }
      const after = (await res.json()).fields['Custom.Automation'];
      if (after !== value) console.error(`[warn] TC ${c.id}: wrote "${value}" but field reads "${after}" — check the picklist's allowed values.`);
      else { console.log(`[marked]  TC ${c.id} Custom.Automation="${value}"${gen ? ` (${gen.title})` : ''}`); okCount += 1; }
    }
    console.log(`\nDone: ${okCount}/${eligible.length} case(s) marked.`);
    if (okCount < eligible.length) process.exit(4);
    return;
  }

  // ---------- mode 1: outcomes -> test points via one test run ----------
  if (!state?.cases || !Object.keys(state.cases).length) {
    fail(3, `${statePath} missing or empty — VERIFY must run before publishing outcomes.`);
  }

  const pts = await adoJson(`${base}/test/Plans/${planId}/suites/${suiteId}/points?api-version=5.0`);
  const pointByTc = new Map((pts.value || []).map((p) => [Number(p.testCase?.id), p.id]));

  const rows = [];
  for (const [tcId, v] of Object.entries(state.cases)) {
    const pointId = pointByTc.get(Number(tcId));
    const outcome = OUTCOME_MAP[v.status];
    if (!pointId) { console.error(`[skip] TC ${tcId}: no test point in plan ${planId} / suite ${suiteId}`); continue; }
    if (!outcome) { console.error(`[skip] TC ${tcId}: status "${v.status}" does not map to an ADO outcome`); continue; }
    rows.push({ tcId: Number(tcId), pointId, outcome, comment: [v.classification, v.note].filter(Boolean).join(' — ') || `automate-suite VERIFY: ${v.status}` });
  }
  if (!rows.length) fail(3, 'nothing to publish — no verify-state entries matched suite test points.');

  console.log(`Publishing ${rows.length} outcome(s) to plan ${planId} / suite ${suiteId} ("${manifest.suiteName}"):`);
  for (const r of rows) console.log(`  TC ${r.tcId} → ${r.outcome}  (point ${r.pointId})`);
  if (dry) return console.log('[dry-run] no writes performed.');

  const run = await adoJson(`${base}/test/runs?api-version=5.0`, {
    method: 'POST',
    body: {
      name: `automate-suite ${manifest.suiteName} (suite ${suiteId}) — ${new Date().toISOString()}`,
      plan: { id: String(planId) },
      pointIds: rows.map((r) => r.pointId),
      automated: false,
      comment: 'Published by scripts/publish-ado-results.mjs from _verify-state.json',
    },
  });
  const results = await adoJson(`${base}/test/runs/${run.id}/results?api-version=5.0`);
  const resultByPoint = new Map((results.value || []).map((r) => [Number(r.testPoint?.id), r.id]));
  const patchBody = rows
    .filter((r) => resultByPoint.has(r.pointId))
    .map((r) => ({ id: resultByPoint.get(r.pointId), outcome: r.outcome, state: 'Completed', comment: r.comment.slice(0, 900) }));
  await adoJson(`${base}/test/runs/${run.id}/results?api-version=5.0`, { method: 'PATCH', body: patchBody });
  await adoJson(`${base}/test/runs/${run.id}?api-version=5.0`, { method: 'PATCH', body: { state: 'Completed' } });

  // verify: re-read points and report any mismatch honestly
  const after = await adoJson(`${base}/test/Plans/${planId}/suites/${suiteId}/points?api-version=5.0`);
  const outcomeByTc = new Map((after.value || []).map((p) => [Number(p.testCase?.id), p.outcome]));
  let mismatches = 0;
  for (const r of rows) {
    const got = outcomeByTc.get(r.tcId);
    if (got !== r.outcome) { console.error(`[verify-mismatch] TC ${r.tcId}: expected ${r.outcome}, point reads ${got}`); mismatches += 1; }
  }
  console.log(`\nDone: run ${run.id} completed, ${patchBody.length} result(s) set${mismatches ? `, ${mismatches} VERIFY MISMATCH(ES) — inspect in ADO` : ', all point outcomes verified'}.`);
  if (mismatches) process.exit(4);
}

main().catch((e) => fail(4, e.stack || String(e)));
