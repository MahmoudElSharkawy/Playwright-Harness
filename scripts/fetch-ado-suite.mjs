#!/usr/bin/env node
/**
 * fetch-ado-suite.mjs — pull the test cases of an Azure DevOps test plan/suite
 * and materialize them as AgenTeX plain-language specs under test/ado-suite-<suiteId>/.
 *
 * Zero dependencies (Node >= 18, built-in fetch). Auth: AZURE_PAT or
 * AZURE_DEVOPS_EXT_PAT (the latter wins) from .env or the shell. Org/project come
 * from config/project.json (azure block); both can be overridden by flags.
 *
 * Usage:
 *   node scripts/fetch-ado-suite.mjs --plan <planId> --suite <suiteId> [options]
 *   node scripts/fetch-ado-suite.mjs --list-plans
 *   node scripts/fetch-ado-suite.mjs --list-suites <planId>
 *
 * Options:
 *   --org <name>        override azure.org from config/project.json
 *   --project <name>    override azure.project
 *   --org-url <url>     full collection URL (default https://dev.azure.com/your-org)
 *   --env <name>        environment whose portalUrl becomes the specs' Target (default: defaultEnvironment)
 *   --out <dir>         output root for spec folders (default: test)
 *   --force             overwrite specs that carry a "## Refinement log" (default: preserve them)
 *   --dry-run           print what would be written, write nothing
 *   --json              with --list-*: raw JSON output
 *   --self-test         offline parser/renderer checks, no network, no PAT
 *
 * Output (per run):
 *   test/ado-suite-<suiteId>/_suite.json          manifest (plan, suite, cases, spec map)
 *   test/ado-suite-<suiteId>/tc-<id>-<slug>.md    one AgenTeX spec per test case
 *
 * Exit codes: 0 ok · 1 usage/config · 2 auth (401/403) · 3 plan/suite not found · 4 network/API
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

// ---------- tiny helpers ----------

function fail(code, msg) {
  console.error(`[fetch-ado-suite] ERROR: ${msg}`);
  process.exit(code);
}

function loadDotEnv() {
  const p = join(ROOT, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k] !== undefined) continue; // pre-set shell env always wins (dotenv semantics)
    process.env[k] = raw.trim().replace(/^["']|["']$/g, '');
  }
}

function readJsonIfExists(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function slugify(s, max = 50) {
  return String(s).toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, '-') // keep Arabic letters readable
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '') || 'untitled';
}

/** "user login & OTP" -> "UserLoginOtp" — seed for the <Feature>Tests.spec.ts suggestion. */
function pascalCase(s) {
  const words = String(s).replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('') || 'Feature';
}

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘')
    .replace(/&rdquo;/g, '”').replace(/&ldquo;/g, '“')
    .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&hellip;/g, '…')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** HTML fragment -> plain text (block tags become newlines).
 *  Content arrives XML-escaped inside the Steps field (&lt;DIV&gt;…), so decode
 *  first to expose the tags, strip them, then decode once more for HTML-level
 *  entities (&amp;amp; is the double-escaped form of a literal &). */
function htmlToText(html) {
  if (!html) return '';
  let t = decodeEntities(html);
  t = t
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<\/?[A-Za-z][^>]*>/g, ''); // tag-shaped only — literal "a < b, c > d" text survives
  t = decodeEntities(t);
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

// ---------- ADO REST ----------

let AUTH = '';

async function ado(url, { method = 'GET', body } = {}) {
  let res;
  // transient statuses retry with bounded backoff; permanent client errors fail fast
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: AUTH,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      if (attempt === 3) fail(4, `network error calling ${url.split('?')[0]} — ${e.message}`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    if (![408, 425, 429, 500, 502, 503, 504].includes(res.status) || attempt === 3) break;
    const retryAfter = Math.min(Number(res.headers.get('retry-after')) || 0, 60);
    await new Promise((r) => setTimeout(r, retryAfter ? retryAfter * 1000 : 1000 * 2 ** attempt));
  }
  if (res.status === 401 || res.status === 403) {
    fail(2, `HTTP ${res.status} from Azure DevOps. Check AZURE_DEVOPS_EXT_PAT in .env ` +
      `(needs Test Management: Read and Work Items: Read scopes, not expired).`);
  }
  // A PAT that fails auth on *.visualstudio.com / dev.azure.com often gets a 203 + HTML sign-in page.
  if (res.status === 203) {
    fail(2, `HTTP 203 (non-authoritative) — the PAT was not accepted. Regenerate AZURE_DEVOPS_EXT_PAT.`);
  }
  return res;
}

/** Try the same resource across api-versions until one answers 200. 404 propagates only after all fail. */
async function adoTry(urls) {
  let last;
  for (const url of urls) {
    const res = await ado(url);
    if (res.ok) return res.json();
    last = res;
    if (res.status !== 404 && res.status !== 400) break;
  }
  const text = (await last.text().catch(() => '')).slice(0, 300);
  if (last.status === 404) fail(3, `not found (HTTP 404). Check the plan/suite ids and project name. ${text}`);
  fail(4, `Azure DevOps API error HTTP ${last.status}: ${text}`);
}

// ---------- steps XML parsing (Microsoft.VSTS.TCM.Steps) ----------

/**
 * The Steps field is an XML document:
 *   <steps><step id="2" type="ActionStep|ValidateStep">
 *     <parameterizedString isformatted="true">ACTION-HTML</parameterizedString>
 *     <parameterizedString isformatted="true">EXPECTED-HTML</parameterizedString>
 *   </step><compref id="5" ref="SHARED_STEP_WORKITEM_ID">…</compref></steps>
 * We parse with regex (structure is flat and machine-written) — no XML dep needed.
 */
function parseStepsXml(xml) {
  const out = [];
  if (!xml) return out;
  // The self-closing branch is tried before the open+close branch at every attrs
  // length, so a self-closing <compref/> (or <step/>) can never swallow following
  // siblings by pairing with a later close tag (regression-checked in --self-test).
  const nodeRe = /<(step|compref)\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/\1\s*>)/g;
  let m;
  while ((m = nodeRe.exec(xml)) !== null) {
    const tag = m[1];
    const attrs = m[2] || '';
    const inner = m[3] || '';
    if (tag === 'compref') {
      const ref = (attrs.match(/ref="(\d+)"/) || [])[1];
      if (ref) out.push({ kind: 'sharedRef', ref: Number(ref) });
      continue;
    }
    const type = (attrs.match(/type="([^"]*)"/) || [, ''])[1];
    // Same self-closing-first shape: an empty <parameterizedString/> keeps its
    // positional slot (action vs expected) instead of shifting the next one into it.
    const params = [...inner.matchAll(/<parameterizedString\b[^>]*?(?:\/\s*>|>([\s\S]*?)<\/parameterizedString\s*>)/g)]
      .map((p) => htmlToText(p[1] || ''));
    out.push({
      kind: 'step',
      type,
      action: params[0] || '',
      expected: params[1] || '',
    });
  }
  return out;
}

// ---------- spec rendering ----------

function renderSpec({ tc, planId, suiteId, suiteName, target, org, project }) {
  const lines = [];
  lines.push(`# Spec: ${tc.title}  (TC ${tc.id})`);
  lines.push('');
  lines.push(`Target: ${target || 'https://example.com  <!-- set portalUrl in environments/<env>.json -->'}`);
  lines.push(`Type: ${tc.tags.length ? tc.tags.join(', ') : 'functional'} — stateful chain`);
  lines.push(`Source: Azure DevOps TC ${tc.id} — plan ${planId}, suite ${suiteId} (${suiteName}) — org ${org}, project ${project}`);
  lines.push(`<!-- GENERATED by scripts/fetch-ado-suite.mjs (raw fetch). The automate-suite REFINE phase`);
  lines.push(`     may restructure steps for executability (scope preserved, changes logged below).`);
  lines.push(`     Refetch keeps files with a "## Refinement log" — overwrite only with --force. -->`);
  lines.push('');
  lines.push('## Acceptance criteria');
  const expected = tc.steps.filter((s) => s.expected).map((s) => `- ${s.expected.replace(/\n+/g, ' ')}`);
  lines.push(...(expected.length ? expected : ['- Every step below completes without error, console errors, or failed network calls.']));
  lines.push('- No console errors or failed network requests at any step.');
  lines.push('');
  lines.push('## Scenario steps  (stateful — run in order, in one session)');
  let n = 0;
  for (const s of tc.steps) {
    n += 1;
    const action = s.action.replace(/\n+/g, ' ').trim() || '(no action text)';
    const exp = s.expected ? ` — Expected: ${s.expected.replace(/\n+/g, ' ').trim()}` : '';
    const shared = s.fromShared ? ` _(from shared steps ${s.fromShared})_` : '';
    lines.push(`${n}. ${action}${exp}${shared}`);
  }
  if (n === 0) lines.push('1. (test case has no steps recorded in Azure DevOps — verify manually)');
  lines.push('');
  lines.push('## Notes');
  lines.push(`- This spec mirrors Azure DevOps test case ${tc.id}; report defects against it.`);
  if (tc.parameters) lines.push(`- Parameterized test case — iterate the data table below once per row.`);
  if (tc.dataTable) {
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(tc.dataTable, null, 2));
    lines.push('```');
  }
  lines.push('');
  return lines.join('\n');
}

// ---------- offline self-test (no network, no PAT) ----------

function selfTest() {
  const sampleXml =
    '<steps id="0" last="7">' +
    '<step id="2" type="ActionStep">' +
    '<parameterizedString isformatted="true">&lt;DIV&gt;&lt;P&gt;Open the portal &amp;amp; wait for load&lt;/P&gt;&lt;/DIV&gt;</parameterizedString>' +
    '<parameterizedString isformatted="true"/>' +
    '</step>' +
    '<compref id="4" ref="9999"/>' +
    '<step id="6" type="ValidateStep">' +
    '<parameterizedString isformatted="true">Click &lt;B&gt;Login&lt;/B&gt;</parameterizedString>' +
    '<parameterizedString isformatted="true">Dashboard header is visible&lt;BR/&gt;No console errors</parameterizedString>' +
    '</step></steps>';
  const steps = parseStepsXml(sampleXml);
  const checks = [
    ['3 nodes parsed', steps.length === 3],
    ['action decoded', steps[0].action === 'Open the portal & wait for load'],
    ['actionstep empty expected', steps[0].expected === ''],
    ['shared ref captured', steps[1].kind === 'sharedRef' && steps[1].ref === 9999],
    ['validate action', steps[2].action === 'Click Login'],
    ['validate expected multiline', steps[2].expected === 'Dashboard header is visible\nNo console errors'],
  ];
  const spec = renderSpec({
    tc: { id: 101, title: 'Self test case', tags: ['smoke'], steps: steps.filter((s) => s.kind === 'step'), parameters: null, dataTable: null },
    planId: 1, suiteId: 2, suiteName: 'Self Suite', target: 'https://example.test', org: 'org', project: 'proj',
  });
  checks.push(['spec has title', spec.includes('# Spec: Self test case  (TC 101)')]);
  checks.push(['spec has stateful marker', spec.includes('stateful — run in order, in one session')]);
  checks.push(['pascalCase', pascalCase('user login & OTP') === 'UserLoginOtp']);
  checks.push(['pascalCase arabic falls back', pascalCase('تسجيل الدخول') === 'Feature']);
  // regression: self-closing tags must not swallow siblings or shift param slots
  const tricky = parseStepsXml(
    '<steps id="0" last="8">' +
    '<compref id="2" ref="100"/>' +
    '<step id="4" type="ActionStep"><parameterizedString isformatted="true">Middle step</parameterizedString><parameterizedString isformatted="true"/></step>' +
    '<compref id="6" ref="200"><ignored/></compref>' +
    '<step id="8" type="ValidateStep"><parameterizedString isformatted="true"/><parameterizedString isformatted="true">Expected only</parameterizedString></step>' +
    '</steps>');
  checks.push(['self-closing compref keeps siblings', tricky.length === 4]);
  checks.push(['middle step survives', tricky[1] && tricky[1].action === 'Middle step']);
  checks.push(['children-form compref parsed', tricky[2] && tricky[2].kind === 'sharedRef' && tricky[2].ref === 200]);
  checks.push(['empty first param keeps its slot', tricky[3] && tricky[3].action === '' && tricky[3].expected === 'Expected only']);
  // regression: literal comparison text must not be stripped as a "tag"
  checks.push(['literal < > text survives', htmlToText('verify amount &lt; 500 and count &gt; 3') === 'verify amount < 500 and count > 3']);
  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) failed += 1;
  }
  if (failed) fail(4, `self-test: ${failed} check(s) failed`);
  console.log('self-test: all checks passed');
}

// ---------- main ----------

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const v = args[i + 1];
    return v === undefined || v.startsWith('--') ? undefined : v; // never swallow the next flag
  };
  const has = (name) => args.includes(name);

  if (has('--self-test')) return selfTest();

  loadDotEnv();
  const cfg = readJsonIfExists(join(ROOT, 'config', 'project.json')) || {};
  const az = cfg.azure || {};
  // org may be a bare name ("your-org") or a full collection URL (legacy AZURE_URL style)
  const org = opt('--org') || az.org || process.env.AZURE_ORG || process.env.AZURE_URL;
  const project = opt('--project') || az.project || process.env.AZURE_PROJECT;
  const orgUrl = (opt('--org-url') || az.orgUrl ||
    (/^https?:\/\//i.test(org || '') ? org : org ? `https://dev.azure.com/${org}` : '')
  ).replace(/\/+$/, '');
  // AgenTeX convention: PAT lives in .env as AZURE_PAT; AZURE_DEVOPS_EXT_PAT (az CLI's var) wins if set
  const pat = process.env.AZURE_DEVOPS_EXT_PAT || process.env.AZURE_PAT;

  if (!orgUrl || !project) fail(1, 'missing Azure org/project — fill the azure block in config/project.json or pass --org/--project.');
  if (!pat) fail(1, 'no PAT found — set AZURE_PAT (or AZURE_DEVOPS_EXT_PAT) in .env.');
  AUTH = 'Basic ' + Buffer.from(':' + pat).toString('base64');
  const orgDisplay = org || orgUrl;

  const proj = encodeURIComponent(project);
  const base = `${orgUrl}/${proj}/_apis`;

  // ---- discovery modes ----
  if (has('--list-plans')) {
    const data = await adoTry([`${base}/test/plans?api-version=5.0`]);
    if (has('--json')) return console.log(JSON.stringify(data, null, 2));
    console.log(`Test plans in "${project}" (${data.count}):`);
    for (const p of data.value) console.log(`  ${p.id}\t${p.name}\t(root suite ${p.rootSuite?.id ?? '?'})`);
    return;
  }
  const listSuitesWanted = has('--list-suites');
  if (listSuitesWanted) {
    const lsPlan = opt('--list-suites') || opt('--plan') ||
      (az.testPlanId ? String(az.testPlanId) : undefined) || process.env.AZURE_TEST_PLAN_ID;
    if (!lsPlan) fail(1, 'usage: --list-suites <planId>  (or set azure.testPlanId in config/project.json)');
    const data = await adoTry([`${base}/test/Plans/${lsPlan}/suites?api-version=5.0`]);
    if (has('--json')) return console.log(JSON.stringify(data, null, 2));
    console.log(`Suites in plan ${lsPlan} (${data.count}):`);
    for (const s of data.value) console.log(`  ${s.id}\t${s.suiteType ?? ''}\t${s.name}`);
    return;
  }

  const planId = opt('--plan') || (az.testPlanId ? String(az.testPlanId) : undefined) || process.env.AZURE_TEST_PLAN_ID;
  const suiteId = opt('--suite');
  if (!planId || !suiteId) {
    fail(1, 'usage: node scripts/fetch-ado-suite.mjs --plan <planId> --suite <suiteId>  ' +
      '(--plan may be omitted when azure.testPlanId is set in config/project.json; ' +
      'discovery: --list-plans / --list-suites <planId>)');
  }

  // ---- suite metadata ----
  const suiteInfo = await adoTry([
    `${base}/testplan/Plans/${planId}/suites/${suiteId}?api-version=7.1`,
    `${base}/test/Plans/${planId}/suites/${suiteId}?api-version=5.0`,
  ]);
  const suiteName = suiteInfo.name || `suite-${suiteId}`;

  // ---- case ids in the suite ----
  // modern testplan area first (GA in 7.1), then the long-GA legacy test area
  const caseList = await adoTry([
    `${base}/testplan/Plans/${planId}/Suites/${suiteId}/TestCase?api-version=7.1&excludeFlags=0`,
    `${base}/testplan/Plans/${planId}/Suites/${suiteId}/TestCase?api-version=7.1-preview.3`,
    `${base}/test/Plans/${planId}/suites/${suiteId}/testcases?api-version=5.0`,
  ]);
  const ids = (caseList.value || [])
    .map((e) => Number(e.workItem?.id ?? e.testCase?.id))
    .filter((x) => Number.isFinite(x));
  if (!ids.length) fail(3, `suite ${suiteId} contains no test cases.`);

  // ---- work item details (batched, 200 max per call) ----
  const FIELDS = [
    'System.Id', 'System.Title', 'System.State', 'System.Tags', 'System.AreaPath',
    'Microsoft.VSTS.Common.Priority', 'Microsoft.VSTS.TCM.Steps',
    'Microsoft.VSTS.TCM.Parameters', 'Microsoft.VSTS.TCM.LocalDataSource',
  ];
  const items = [];
  for (let i = 0; i < ids.length; i += 200) {
    const res = await ado(`${base}/wit/workitemsbatch?api-version=7.1`, {
      method: 'POST',
      // errorPolicy omit: one deleted-but-still-listed work item must not sink the batch
      body: { ids: ids.slice(i, i + 200), fields: FIELDS, errorPolicy: 'omit' },
    });
    if (!res.ok) fail(4, `workitemsbatch failed HTTP ${res.status}`);
    items.push(...(await res.json()).value);
  }

  // ---- resolve shared-step references (one extra batch) ----
  const sharedIds = new Set();
  const parsed = new Map(); // id -> steps[]
  for (const wi of items) {
    const steps = parseStepsXml(wi.fields['Microsoft.VSTS.TCM.Steps']);
    parsed.set(wi.id, steps);
    for (const s of steps) if (s.kind === 'sharedRef') sharedIds.add(s.ref);
  }
  const sharedSteps = new Map();
  const sharedList = [...sharedIds];
  for (let i = 0; i < sharedList.length; i += 200) {
    const res = await ado(`${base}/wit/workitemsbatch?api-version=7.1`, {
      method: 'POST',
      body: {
        ids: sharedList.slice(i, i + 200),
        fields: ['System.Id', 'System.Title', 'Microsoft.VSTS.TCM.Steps'],
        errorPolicy: 'omit', // a deleted shared-steps item must not blank every ref
      },
    });
    if (!res.ok) {
      console.error(`[fetch-ado-suite] WARN: shared-steps batch failed HTTP ${res.status} — those refs will appear as unresolved`);
      continue;
    }
    for (const wi of (await res.json()).value) {
      sharedSteps.set(wi.id, {
        title: wi.fields['System.Title'],
        steps: parseStepsXml(wi.fields['Microsoft.VSTS.TCM.Steps']).filter((s) => s.kind === 'step'),
      });
    }
  }
  const inline = (steps) => steps.flatMap((s) => {
    if (s.kind !== 'sharedRef') return [s];
    const sh = sharedSteps.get(s.ref);
    if (!sh) return [{ kind: 'step', type: 'ActionStep', action: `(shared steps ${s.ref} — could not fetch)`, expected: '' }];
    return sh.steps.map((x) => ({ ...x, fromShared: `${s.ref} "${sh.title}"` }));
  });

  // ---- target URL from the requested (or default) environment ----
  const envName = opt('--env') || cfg.defaultEnvironment || 'qc';
  const envCfg = readJsonIfExists(join(ROOT, 'environments', `${envName}.json`)) || {};
  const target = envCfg.portalUrl || '';

  // ---- write specs ----
  const outRoot = resolve(ROOT, opt('--out') || 'test');
  const folder = join(outRoot, `ado-suite-${suiteId}`);
  const dry = has('--dry-run');
  if (!dry) mkdirSync(folder, { recursive: true });

  // A refetch must never wipe pipeline state written by later phases.
  const previous = readJsonIfExists(join(folder, '_suite.json')) || {};
  const carried = {};
  for (const key of ['explore', 'resolvedSpecFiles', 'pr', 'markedAutomated']) {
    if (previous[key] !== undefined) carried[key] = previous[key];
  }

  const manifest = {
    org: orgDisplay, project, orgUrl, planId: Number(planId), suiteId: Number(suiteId), suiteName,
    environment: envName, target, fetchedAt: new Date().toISOString(),
    // suggestions only — the generating session confirms the feature name against
    // existing specs and the repo naming law (tests/<Feature>Tests.spec.ts)
    suggestedFeature: pascalCase(suiteName),
    suggestedSpecFile: `tests/${pascalCase(suiteName)}Tests.spec.ts`,
    suggestedDataFile: `resources/testData/${pascalCase(suiteName)}TestJsonFile.json`,
    ...carried, // pipeline keys survive refetch (explore, resolvedSpecFiles, pr, markedAutomated)
    cases: [],
  };
  if (Object.keys(carried).length && !dry) {
    console.log(`[carried] pipeline state preserved across refetch: ${Object.keys(carried).join(', ')}`);
  }

  for (const wi of items) {
    const f = wi.fields;
    const tc = {
      id: wi.id,
      title: f['System.Title'] || `TC ${wi.id}`,
      state: f['System.State'] || '',
      priority: f['Microsoft.VSTS.Common.Priority'] ?? null,
      tags: (f['System.Tags'] || '').split(';').map((t) => t.trim()).filter(Boolean),
      steps: inline(parsed.get(wi.id) || []),
      parameters: f['Microsoft.VSTS.TCM.Parameters'] || null,
      dataTable: null,
    };
    const lds = f['Microsoft.VSTS.TCM.LocalDataSource'];
    if (lds && /<NewDataSet/i.test(lds)) {
      const rows = [...lds.matchAll(/<Table1>([\s\S]*?)<\/Table1>/g)].map((r) => {
        const row = {};
        for (const c of r[1].matchAll(/<([^>\/\s]+)>([\s\S]*?)<\/\1>/g)) row[c[1]] = htmlToText(c[2]);
        return row;
      });
      if (rows.length) tc.dataTable = rows;
    }

    const file = `tc-${tc.id}-${slugify(tc.title)}.md`;
    const spec = renderSpec({ tc, planId, suiteId, suiteName, target, org: orgDisplay, project });
    const outPath = join(folder, file);
    // A "## Refinement log" marks a spec the REFINE phase has restructured — those
    // survive refetch so refinement work isn't silently lost. --force overwrites.
    const existing = !dry && existsSync(outPath) ? readFileSync(outPath, 'utf8') : '';
    const preserved = existing.includes('## Refinement log') && !has('--force');
    manifest.cases.push({
      id: tc.id, title: tc.title, state: tc.state, priority: tc.priority,
      tags: tc.tags, stepCount: tc.steps.length, specFile: file,
      preservedRefinement: preserved || undefined,
      steps: tc.steps, // raw parsed steps — GENERATE reads these, not the (possibly refined) markdown
      parameters: tc.parameters || undefined,
      dataTable: tc.dataTable || undefined,
    });
    if (dry) {
      console.log(`--- would write ${outPath} ---\n${spec}`);
    } else if (preserved) {
      console.log(`[preserved] ${relative(ROOT, outPath)}  (refined — refetch with --force to overwrite)`);
    } else {
      writeFileSync(outPath, spec, 'utf8');
      console.log(`[written] ${relative(ROOT, outPath)}  (${tc.steps.length} steps)`);
    }
  }

  if (!dry) {
    writeFileSync(join(folder, '_suite.json'), JSON.stringify(manifest, null, 2), 'utf8');
    console.log(`[written] ${relative(ROOT, join(folder, '_suite.json'))}`);
  }
  console.log(`\nDone: ${manifest.cases.length} test case(s) from plan ${planId} / suite ${suiteId} ("${suiteName}").`);
  console.log(`Next: /execute-test ado-suite-${suiteId}/  →  generate ${manifest.suggestedSpecFile}  →  npx playwright test ${manifest.suggestedSpecFile} --project=chromium`);
}

main().catch((e) => fail(4, e.stack || String(e)));
