#!/usr/bin/env node
/**
 * check-conventions.mjs — mechanical enforcement of the skill library's grep-able laws.
 *
 * The authoritative rules live in .agents/skills/ (design-conventions §4/§6 and the
 * per-layer playbooks); this script enforces only their mechanically checkable subset.
 * Legacy violations recorded in scripts/conventions-baseline.json report as
 * "legacy (fix-when-touched)" and do not fail the run — new violations do.
 *
 * Usage:
 *   node scripts/check-conventions.mjs                 # scan the framework dirs
 *   node scripts/check-conventions.mjs --files a b c   # scan specific files (hook mode)
 *   node scripts/check-conventions.mjs --changed       # scan files changed vs master (incl. staged + untracked)
 *   node scripts/check-conventions.mjs --json          # machine-readable output
 *   node scripts/check-conventions.mjs --quiet         # suppress the legacy summary line (hook mode)
 *   node scripts/check-conventions.mjs --write-baseline# record current violations as legacy
 *
 * Exit codes: 0 = clean or legacy-only · 1 = NEW violations · 2 = script error
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { resolve, join, relative, basename, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { secretFindings } from './lib/package-validation.mjs';

const CLI_ARGS = process.argv.slice(2);
const rootIndex = CLI_ARGS.indexOf('--root');
// The framework under check is the project the command runs in, unless --root names another.
const ROOT = resolve(rootIndex < 0 ? process.cwd() : CLI_ARGS[rootIndex + 1] || '.');
const BASELINE_PATH = join(ROOT, 'scripts', 'conventions-baseline.json');
/** Layer name -> physical location (design-conventions, 2026-09-01 src/ layout ruling).
 *  Rules reference layers by short name; paths resolve through this map. */
const LAYERS = { tests: 'tests', pages: 'src/pages', apis: 'src/apis', dbs: 'src/dbs', utils: 'src/utils', config: 'src/config' };
const FRAMEWORK_DIRS = Object.values(LAYERS);
const layerOf = (rel) => Object.keys(LAYERS).find((k) => rel.startsWith(LAYERS[k] + '/'));
// (Single-family POM framework — every rule applies uniformly to every spec and class.)

/** Each rule: id, dirs it applies to, severity, matcher over (file, text) -> array of {line, excerpt}. */
const grepRule = (re) => (file, text) => {
  const hits = [];
  text.split(/\r?\n/).forEach((l, i) => {
    if (re.test(l) && !/\/\/\s*conventions-ok/.test(l)) hits.push({ line: i + 1, excerpt: l.trim().slice(0, 90) });
  });
  return hits;
};

const RULES = [
  { id: 'no-test-only', dirs: ['tests'], severity: 'fail',
    why: 'test.only silently skips the suite (test-classes §12)',
    check: grepRule(/\btest\.only\s*\(/) },
  { id: 'no-wait-timeout', dirs: ['tests', 'pages', 'apis', 'dbs'], severity: 'fail',
    why: 'hard waits banned — web-first assertions auto-wait (validation-methods §4)',
    check: grepRule(/waitForTimeout\s*\(/) },
  { id: 'no-try-outside-utils', dirs: ['tests', 'pages', 'apis', 'dbs'], severity: 'fail',
    why: 'try/catch, loops, conditionals live in utils/ only (iron law 3)',
    check: grepRule(/\btry\s*\{/) },
  { id: 'no-expect-in-spec', dirs: ['tests'], severity: 'fail',
    why: 'specs never import expect — validations are verify* business methods (test-classes §2)',
    check: grepRule(/import\s*\{[^}]*\bexpect\b[^}]*\}\s*from\s*['"]@playwright\/test/) },
  { id: 'no-locator-in-spec', dirs: ['tests'], severity: 'fail',
    why: 'specs orchestrate, never locate — locators belong in page classes (iron law 1)',
    check: grepRule(/\bpage\.locator\s*\(|\bpage\.getBy[A-Z]\w*\s*\(/) },
  { id: 'no-raw-request-in-spec', dirs: ['tests'], severity: 'fail',
    why: 'specs never call the network — Apis<Domain> classes own endpoints (iron law 1)',
    check: grepRule(/\brequest\.(get|post|put|patch|delete|head|options|fetch)\s*\(/) },
  { id: 'no-id-engine-prefix', dirs: ['pages'], severity: 'fail',
    why: 'id selectors use CSS "#", never the id= engine prefix (element-locators §3)',
    check: grepRule(/locator\s*\(\s*['"`]id=/) },
  { id: 'no-console-log', dirs: ['tests'], severity: 'fail',
    why: 'no console.log in specs — the report is the output channel (test-classes §11)',
    check: grepRule(/\bconsole\.log\s*\(/) },
  { id: 'no-page-on-dialog', dirs: ['pages'], severity: 'fail',
    why: 'native dialogs via page.once inside the acting step, never page.on (action-methods §13)',
    check: grepRule(/\bpage\.on\s*\(\s*['"`]dialog/) },
  { id: 'locator-literal-in-body', dirs: ['pages'], severity: 'warn',
    why: 'selector literals live in named locator fields or dynamic locator methods, never inline in action/validation bodies (element-locators §2/§6, design-conventions §3 anatomy) — pre-existing sites are baselined fix-when-touched',
    check: (file, text) => { // scan only below the first ///// Actions|Validations banner — fields, constructor, and dynamic locator methods all sit above the banners per §3 anatomy (some pages are validation-only)
      const banner = text.search(/\/{5,}\s*(Actions|Validations)/);
      if (banner === -1) return [];
      const bannerLine = text.slice(0, banner).split('\n').length; // 1-based line of the banner
      const lines = text.split(/\r?\n/);
      const hits = [];
      for (let i = bannerLine; i < lines.length; i++) { // strictly after the banner line
        const l = lines[i];
        if (/\/\/\s*conventions-ok/.test(l)) continue;
        if (/\.locator\s*\(\s*['"`]/.test(l)) hits.push({ line: i + 1, excerpt: l.trim().slice(0, 90) });
      }
      return hits;
    } },
  { id: 'timeout-below-default', dirs: ['pages'], severity: 'warn',
    why: 'assertion budgets come from expect.timeout in playwright.config.ts (30s, 2026-09-08 timeout ruling) — an inline timeout at or below the default is redundant; inline only when a surface needs MORE, as documentation',
    check: (file, text) => {
      // Lockstep constant: mirrors EXPECT_DEFAULT_MS in src/config/timeouts.ts (the linter cannot import the TS module).
      const EXPECT_DEFAULT_MS = 30_000;
      const hits = [];
      text.split(/\r?\n/).forEach((l, i) => {
        if (/\/\/\s*conventions-ok/.test(l)) return;
        if (!/\bexpect[A-Z]\w*\s*\(/.test(l)) return; // Expects-facade calls only; polls/waits own their budgets
        const m = l.match(/timeout:\s*(\d[\d_]*)/);
        if (m && Number(m[1].replace(/_/g, '')) <= EXPECT_DEFAULT_MS) {
          hits.push({ line: i + 1, excerpt: l.trim().slice(0, 90) });
        }
      });
      return hits;
    } },
  { id: 'secret-literal', dirs: Object.keys(LAYERS), severity: 'fail',
    why: 'secrets come only from process.env — a secret-shaped literal never lands in a committed file (test-data §6)',
    check: (file, text) => [...new Set(secretFindings(file, text).map(hit => hit.line))]
      .map(line => ({ line, excerpt: '[redacted]' })) },
  { id: 'spec-data-pairing', dirs: ['tests'], severity: 'fail',
    why: 'every <Feature>Tests.spec.ts pairs with resources/testData/<Feature>TestJsonFile.json (test-data §1)',
    check: (file, _text) => {
      const m = basename(file).match(/^(.*)Tests\.spec\.ts$/);
      if (!m) return [];
      const pair = join(ROOT, 'resources', 'testData', `${m[1]}TestJsonFile.json`);
      return existsSync(pair) ? [] : [{ line: 1, excerpt: `missing resources/testData/${m[1]}TestJsonFile.json` }];
    } },
  { id: 'spec-naming', dirs: ['tests'], severity: 'warn',
    why: 'spec files are <Feature>Tests.spec.ts (test-classes §1)',
    check: (file) => {
      return /Tests\.spec\.ts$/.test(file) ? [] : [{ line: 1, excerpt: basename(file) }];
    } },
  { id: 'tms-per-test', dirs: ['tests'], severity: 'warn',
    why: 'every test carries its external allure.tms id or local allure.testCaseId (test-methods §3)',
    check: (file, text) => {
      const tests = (text.match(/^\s*test\s*\(/gm) || []).length;
      const tms = (text.match(/allure\.(?:tms|testCaseId)\s*\(/g) || []).length;
      return tms < tests ? [{ line: 1, excerpt: `${tests} test(s) but only ${tms} source identity call(s)` }] : [];
    } },
  { id: 'feature-per-test', dirs: ['tests'], severity: 'warn',
    why: 'every test opens with allure.feature matching the describe title (test-methods §3)',
    check: (file, text) => {
      const tests = (text.match(/^\s*test\s*\(/gm) || []).length;
      const feats = (text.match(/allure\.feature\s*\(/g) || []).length;
      return feats < tests ? [{ line: 1, excerpt: `${tests} test(s) but only ${feats} allure.feature call(s)` }] : [];
    } },
  { id: 'tag-vocabulary', dirs: ['tests'], severity: 'warn',
    why: 'tags come from the closed set @smoke / @regression (design-conventions Decision records, 2026-08-21)',
    check: (file, text) => { // whole-text scan — tag arrays are often multiline
      const allowed = /^@(smoke|regression)$/;
      const hits = [];
      for (const m of text.matchAll(/tag:\s*\[([\s\S]*?)\]/g)) {
        for (const tag of m[1].matchAll(/@\w+/g)) {
          if (!allowed.test(tag[0])) {
            hits.push({ line: text.slice(0, m.index).split('\n').length, excerpt: tag[0] });
          }
        }
      }
      return hits;
    } },
  { id: 'assertion-message', dirs: ['pages', 'apis', 'dbs'], severity: 'warn',
    why: 'value-carrying assertions go through the src/utils/Expects wrappers — "Expect <subject> to <verb> <value>" titles the Allure step (validation-methods §13, 2026-09-08 ruling)',
    check: (file, text) => { // whole-text: expect(...) chains span lines; balancer because args nest calls
      const NEEDS_MSG = /^(toBe|toEqual|toStrictEqual|toBeTruthy|toBeFalsy|toBeNull|toBeUndefined|toBeDefined|toBeNaN|toBeGreaterThan|toBeGreaterThanOrEqual|toBeLessThan|toBeLessThanOrEqual|toBeCloseTo|toContain|toContainEqual|toHaveLength|toMatch|toMatchObject|toHaveProperty|toHaveText|toContainText|toHaveValue|toHaveValues|toHaveAttribute|toHaveClass|toContainClass|toHaveCount|toHaveURL|toHaveTitle|toHaveId|toHaveCSS|toHaveAccessibleName|toHaveAccessibleDescription|toHaveRole|toBeVisible|toBeHidden|toBeEnabled|toBeDisabled|toBeChecked|toBeEditable|toBeEmpty|toBeAttached|toBeFocused|toBeInViewport)$/;
      const lines = text.split(/\r?\n/);
      const hits = [];
      const balance = (from) => { // index just past the matching close-paren, skipping strings
        let i = from, depth = 1, str = null;
        while (i < text.length && depth > 0) {
          const c = text[i];
          if (str) { if (c === '\\') i++; else if (c === str) str = null; }
          else if (c === "'" || c === '"' || c === '`') str = c;
          else if ('([{'.includes(c)) depth++;
          else if (')]}'.includes(c)) depth--;
          i++;
        }
        return i;
      };
      const push = (index, note) => {
        const line = text.slice(0, index).split('\n').length;
        if (/\/\/\s*conventions-ok/.test(lines[line - 1] ?? '')) return;
        hits.push({ line, excerpt: (lines[line - 1] ?? '').trim().slice(0, 90) + (note ? `  ${note}` : '') });
      };
      for (const m of text.matchAll(/\bexpect(?:\.soft)?\s*\(/g)) { // expect.poll never matches this shape
        const end = balance(m.index + m[0].length);
        const chain = /^\s*(?:\.\s*not\s*)?\.\s*(\w+)\s*\(/.exec(text.slice(end, end + 200));
        if (!chain || !NEEDS_MSG.test(chain[1])) continue; // toHaveScreenshot/toPass and non-matcher chains stay native
        push(m.index);
      }
      for (const m of text.matchAll(/\bexpect\.poll\s*\(/g)) { // polls keep failure-sentence messages — but must have one
        const end = balance(m.index + m[0].length);
        if (/\bmessage\s*:/.test(text.slice(m.index, end))) continue;
        push(m.index, '(expect.poll without a message option)');
      }
      return hits;
    } },
  // ---- wave-2 rules (2026-09-13) — the class-ledger PROPOSALS that reached 3+ entries ----
  { id: 'locator-suffix-vocabulary', dirs: ['pages'], severity: 'fail',
    why: 'locator fields and dynamic locator methods end in a suffix from the closed §2 vocabulary (element-locators §1) — an invented suffix (e.g. _buttons, _option) is a review reject; legacy capitalized forms are baselined fix-when-touched',
    check: (file, text) => {
      const VOCAB = new Set(['button', 'input', 'link', 'header', 'txt', 'img', 'icon', 'checkbox', 'radio', 'dropdown', 'list', 'table', 'row', 'cell', 'form', 'msg', 'tab', 'card', 'modal', 'section']);
      const hits = [];
      text.split(/\r?\n/).forEach((l, i) => {
        if (/\/\/\s*conventions-ok/.test(l)) return;
        // fields: `(private )?readonly name_suffix: Locator` · methods: `(private )?name_suffix(...): Locator`
        const m = l.match(/^\s*(?:private\s+)?(?:readonly\s+)?([A-Za-z0-9]+)_([A-Za-z0-9]+)\s*(?::\s*Locator\b|\([^)]*\)\s*:\s*Locator\b)/);
        if (m && !VOCAB.has(m[2])) hits.push({ line: i + 1, excerpt: l.trim().slice(0, 90) });
      });
      return hits;
    } },
  { id: 'anatomy-spacing', dirs: ['pages', 'apis', 'dbs'], severity: 'fail',
    why: 'exactly one blank line between members — a double blank line inside a class body is an insertion-seam defect (design-conventions §3 anatomy, iron law 12)',
    check: (file, text) => {
      const lines = text.split(/\r?\n/);
      const hits = [];
      let blanks = 0, inClass = false;
      lines.forEach((l, i) => {
        if (/^export\s+class\s+/.test(l)) inClass = true;
        if (!inClass) return;
        if (/^\s*$/.test(l)) { blanks++; if (blanks === 2) hits.push({ line: i + 1, excerpt: '(two consecutive blank lines inside the class body)' }); }
        else blanks = 0;
      });
      return hits;
    } },
  { id: 'secret-in-title', dirs: ['pages', 'apis', 'dbs'], severity: 'warn',
    why: 'credentials and account identifiers never surface in an Allure step title (iron law 7; action-methods §3) — this title interpolates a credential-named identifier; keep the title value-free (call-site provenance is reviewer judgment)',
    check: grepRule(/\bstep\s*\(\s*`[^`]*\$\{[^}]*\b(tenant|user(?:name)?|password|iqama|email|otp|captcha|token|secret)\b[^}]*\}[^`]*`/i) },
  { id: 'timeout-literal-in-pages', dirs: ['pages'], severity: 'warn',
    why: 'timeouts above the default come from the named tiers in src/config/timeouts.ts (SLOW_SURFACE_MS …), never a numeric literal (2026-09-08 timeout policy; ledger class timeout-literal-in-pages)',
    check: (file, text) => {
      const EXPECT_DEFAULT_MS = 30_000; // lockstep with src/config/timeouts.ts
      const hits = [];
      text.split(/\r?\n/).forEach((l, i) => {
        if (/\/\/\s*conventions-ok/.test(l)) return;
        const m = l.match(/timeout:\s*(\d[\d_]*)\b/);
        if (m && Number(m[1].replace(/_/g, '')) > EXPECT_DEFAULT_MS) hits.push({ line: i + 1, excerpt: l.trim().slice(0, 90) });
      });
      return hits;
    } },
];

/** Repo-level rules — not per file. */
function repoRules() {
  const findings = [];
  if (existsSync(join(ROOT, 'resources', 'test-data'))) {
    findings.push({ rule: 'no-kebab-test-data', severity: 'fail', file: 'resources/test-data', line: 1,
      why: 'the data folder is resources/testData (camelCase), never test-data (test-data §1)', excerpt: 'folder exists' });
  }
  return findings;
}

/**
 * Delivery-artifact rules over test/ado-{suite,story}-* (the class-ledger PROPOSALS for the
 * traceability / verify-state contracts). Scoped to the suites whose artifacts are in the
 * diff (--changed / --files) or all suites on a full scan. Mechanisable halves only — the
 * semantic staleness of a table stays reviewer judgment.
 */
function artifactRules(suiteDirs) {
  const findings = [];
  const CLASS_DIRS = ['src/pages', 'src/apis', 'src/dbs', 'src/utils'];
  const classText = new Map(); // ClassName -> file text (lazy)
  const loadClass = (name) => {
    if (classText.has(name)) return classText.get(name);
    let txt = null;
    for (const d of CLASS_DIRS) { const p = join(ROOT, d, `${name}.ts`); if (existsSync(p)) { txt = readFileSync(p, 'utf8'); break; } }
    classText.set(name, txt);
    return txt;
  };
  const tmsIndex = new Map(); // caseId -> spec file (lazy, built once)
  const buildTms = () => {
    if (tmsIndex.size) return;
    const dir = join(ROOT, 'tests');
    if (!existsSync(dir)) return;
    // specs live one suite-folder deep since the spec-folder convention — walk recursively
    for (const f of readdirSync(dir, { recursive: true })) {
      const relSpec = String(f).replaceAll('\\', '/');
      if (!/\.spec\.ts$/.test(relSpec)) continue;
      const txt = readFileSync(join(dir, relSpec), 'utf8');
      for (const m of txt.matchAll(/allure\.tms\(\s*['"](\d+)['"]\s*\)/g)) tmsIndex.set(m[1], `tests/${relSpec}`);
    }
  };
  for (const suiteDir of suiteDirs) {
    const rel = relative(ROOT, suiteDir).replaceAll('\\', '/');
    // ---- traceability tables ----
    const tracePath = join(suiteDir, '_traceability.md');
    if (existsSync(tracePath)) {
      const lines = readFileSync(tracePath, 'utf8').split(/\r?\n/);
      let header = null; // column indexes of the current pipe table
      lines.forEach((l, i) => {
        if (!/^\|/.test(l)) { header = null; return; }
        const cells = l.split('|').slice(1, -1).map((c) => c.trim());
        if (/^\|\s*-{2,}/.test(l)) return; // separator row
        if (/\bMethod\b/i.test(l) && /\bLayer\b/i.test(l)) {
          header = { layer: cells.findIndex((c) => /^Layer/i.test(c)), why: cells.findIndex((c) => /^Why this layer/i.test(c)), method: cells.findIndex((c) => /^Method$/i.test(c)), cls: cells.findIndex((c) => /^Class$/i.test(c)) };
          return;
        }
        if (!header) return;
        const layer = (cells[header.layer] ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
        const why = header.why >= 0 ? (cells[header.why] ?? '').trim() : '';
        // traceability-format-drift: reasons only on rows whose layer includes API or DB;
        // layer tokens are UI/API/DB (compound rows API+UI+DB or "API / DB" are the settled
        // form); a "—" layer marks a skipped/not-automated step whose reason column carries
        // the NEEDS-* rationale by the 2026-08-27 ruling's skipped-case convention
        const tokens = layer ? layer.split(/[+\/]/).map((s) => s.trim()) : [];
        const isApiDb = tokens.some((tk) => /^(API|DB)$/i.test(tk));
        const isSkippedRow = /^(—|-)$/.test(layer);
        if (layer && !isSkippedRow && !tokens.every((tk) => /^(UI|API|DB)$/i.test(tk))) {
          findings.push({ rule: 'traceability-format-drift', severity: 'fail', file: `${rel}/_traceability.md`, line: i + 1, why: 'the Layer column uses the closed tokens UI / API / DB (combined with + or /), never folder names (2026-08-27 traceability ruling)', excerpt: `Layer "${layer}"` });
        }
        if (!isApiDb && !isSkippedRow && why && !/^(—|-|)$/.test(why) && !/^\(/.test(why)) {
          // a parenthesised note on a UI row ("(arrange — no lower-layer path …)") is the
          // sanctioned GUI-only-precondition annotation, not a reason code
          findings.push({ rule: 'traceability-format-drift', severity: 'fail', file: `${rel}/_traceability.md`, line: i + 1, why: '"Why this layer" is filled ONLY on API/DB rows (2026-08-27 traceability ruling)', excerpt: `${layer} row carries a reason: ${why.slice(0, 60)}` });
        }
        if (isApiDb && /\breroute\b/.test(why) && !/reroute[^—-]*[—-]\s*\S/.test(why)) {
          findings.push({ rule: 'traceability-format-drift', severity: 'warn', file: `${rel}/_traceability.md`, line: i + 1, why: 'a `reroute` code must name the replaced observable after a dash (2026-08-27 traceability ruling)', excerpt: why.slice(0, 80) });
        }
        // traceability-table-stale: every backticked METHOD (lowerCamel, called with parens somewhere)
        // must exist on the named class; backticked field/config names (`<domain>Db`) are not methods
        const cls = (cells[header.cls] ?? '').replace(/`/g, '').trim();
        if (!cls || /[^A-Za-z0-9]/.test(cls) || !/^[A-Z]/.test(cls)) return; // multi-class / prose cells stay reviewer judgment
        const txt = loadClass(cls);
        if (txt === null) {
          findings.push({ rule: 'traceability-table-stale', severity: 'fail', file: `${rel}/_traceability.md`, line: i + 1, why: 'the Class column names a class file that does not exist under src/ (2026-08-27 traceability ruling)', excerpt: `class ${cls}` });
          return;
        }
        for (const m of (cells[header.method] ?? '').matchAll(/`([a-z][A-Za-z0-9]*)`/g)) {
          const name = m[1];
          if (new RegExp(`\\b${name}\\s*\\(`).test(txt)) continue;                 // a method — resolves
          if (new RegExp(`\\b${name}\\b`).test(txt)) continue;                    // a field/enum/config member — not a method claim
          findings.push({ rule: 'traceability-table-stale', severity: 'fail', file: `${rel}/_traceability.md`, line: i + 1, why: 'a Method-column identifier resolves nowhere on its named class — the table describes code that does not exist (2026-08-27 traceability ruling)', excerpt: `${cls}.${name}` });
        }
      });
    }
    // ---- verify-state vs specs ----
    const vsPath = join(suiteDir, '_verify-state.json');
    if (existsSync(vsPath)) {
      buildTms();
      let vs;
      try {
        vs = JSON.parse(readFileSync(vsPath, 'utf8'));
        if (!vs || !vs.cases || typeof vs.cases !== 'object' || Array.isArray(vs.cases)
          || Object.values(vs.cases).some(c => !c || typeof c !== 'object' || Array.isArray(c))) throw new Error('invalid cases');
      } catch {
        findings.push({rule:'verify-state-contract-drift', severity:'fail', file:`${rel}/_verify-state.json`, line:1,
          why:'verify-state must parse and contain a cases object of case records', excerpt:'invalid record'});
        continue;
      }
      for (const [id, c] of Object.entries(vs.cases ?? {})) {
        const spec = tmsIndex.get(id);
        const note = String(c.note ?? '');
        if ((c.status === 'blocked' || c.status === 'skipped') && spec && /no test generated|out of scope|not automated/i.test(note)) {
          findings.push({ rule: 'verify-state-contract-drift', severity: 'fail', file: `${rel}/_verify-state.json`, line: 1, why: 'a case recorded as blocked/skipped with a "no test" note has a spec carrying its allure.tms — the record contradicts the shipped code', excerpt: `${id}: ${c.status} but ${spec} carries tms('${id}')` });
        }
        if ((c.status === 'passed' || c.status === 'fixme') && !spec) {
          findings.push({ rule: 'verify-state-contract-drift', severity: 'warn', file: `${rel}/_verify-state.json`, line: 1, why: 'a case recorded as passed/fixme has no spec carrying its allure.tms — either the test moved or the record is stale', excerpt: `${id}: ${c.status} with no tms('${id}') in tests/` });
        }
      }
    }
  }
  return findings;
}

function suiteDirsInScope(mode) {
  const base = join(ROOT, 'test');
  if (!existsSync(base)) return [];
  const all = readdirSync(base).filter((d) => /^ado-(?:suite|story)-\d+$/.test(d)).map((d) => join(base, d));
  if (mode !== 'changed') return all;
  const touched = new Set(changedPaths().map((f) => (f.match(/^test\/(ado-(?:suite|story)-\d+)\//) || [])[1]).filter(Boolean));
  return all.filter((d) => touched.has(basename(d)));
}

// ---------- file selection ----------

function listFrameworkFiles() {
  const files = [];
  for (const dir of FRAMEWORK_DIRS) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs, { recursive: true })) {
      const candidate = join(abs, String(f));
      if (/\.(ts|js|mjs|json)$/.test(String(f)) && statSync(candidate).isFile()) files.push(candidate);
    }
  }
  return files;
}

let changedPathCache;
function changedPaths() {
  if (changedPathCache) return changedPathCache;
  const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
  const baseIndex = CLI_ARGS.indexOf('--base-ref');
  let base = baseIndex < 0 ? null : CLI_ARGS[baseIndex + 1];
  if (!base) {
    for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
      try { git(['rev-parse', '--verify', candidate]); base = candidate; break; } catch { /* try next explicit conventional base */ }
    }
  }
  if (!base || base.startsWith('-')) throw new Error('--changed needs a valid --base-ref or an existing main/master reference');
  // A failed Git query is an error, never an empty successful scope.
  const outputs = [git(['diff', '--name-only', '-z', `${base}...HEAD`]), git(['diff', '--name-only', '-z']),
    git(['diff', '--name-only', '-z', '--cached']), git(['ls-files', '-z', '--others', '--exclude-standard'])];
  changedPathCache = [...new Set(outputs.flatMap((out) => out.split('\0').filter(Boolean)))];
  return changedPathCache;
}
function changedFiles() {
  return changedPaths().filter((f) => layerOf(f)).map((f) => join(ROOT, f))
    .filter((f) => existsSync(f) && statSync(f).isFile() && /\.(ts|js|mjs|json)$/.test(f));
}

// ---------- main ----------

function main() {
  const args = CLI_ARGS;
  const has = (n) => args.includes(n);
  const single = new Set(['--changed','--json','--quiet','--write-baseline','--fail-on-warn','--list-rules']);
  const seen = new Set();
  for (let i=0;i<args.length;i++) {
    const arg=args[i];
    if (seen.has(arg)) throw new Error('duplicate option');
    seen.add(arg);
    if (single.has(arg)) continue;
    if (arg==='--root' || arg==='--base-ref') {
      if (!args[i+1] || args[i+1].startsWith('--')) throw new Error(`${arg} requires a value`);
      i++; continue;
    }
    if (arg==='--files') { while(args[i+1] && !args[i+1].startsWith('--')) i++; continue; }
    throw new Error('unrecognized argument');
  }
  if (has('--changed') && has('--files')) throw new Error('--changed and --files are mutually exclusive');
  if (has('--base-ref') && !has('--changed')) throw new Error('--base-ref requires --changed');
  if (has('--list-rules')) {
    console.log(JSON.stringify({layer: RULES.map(r=>r.id), repository:['no-kebab-test-data'],
      artifact:['traceability-format-drift','traceability-table-stale','verify-state-contract-drift']},null,2));
    return 0;
  }
  for (const option of ['--root', '--base-ref']) {
    const index = args.indexOf(option);
    if (index >= 0 && (!args[index + 1] || args[index + 1].startsWith('--'))) throw new Error(`${option} requires a value`);
  }
  if (!existsSync(ROOT) || !statSync(ROOT).isDirectory()) throw new Error('--root must name an existing framework directory');
  const fileArgIdx = args.indexOf('--files');
  let files;
  if (fileArgIdx >= 0) {
    const end = args.findIndex((a, i) => i > fileArgIdx && a.startsWith('--'));
    files = args.slice(fileArgIdx + 1, end < 0 ? undefined : end).map((f) => resolve(ROOT, f));
    for (const file of files) {
      const rel = relative(ROOT, file).replaceAll('\\', '/');
      if (isAbsolute(rel) || rel.startsWith('../') || !layerOf(rel) || !/\.(ts|js|mjs|json)$/.test(file) || !existsSync(file) || !statSync(file).isFile()) {
        throw new Error('--files requires existing files in recognized layers under --root');
      }
    }
  } else if (has('--changed')) {
    files = changedFiles();
  } else {
    files = listFrameworkFiles();
  }

  files = [...new Set(files)];
  if (files.length === 0) throw Object.assign(new Error('zero matching framework files; run it from the project folder or pass --root <project> (for this package: --root examples). This is not a passing validation.'), {fixedMessage: true});
  const realRoot = realpathSync(ROOT);
  for (const file of files) {
    const rel=relative(realRoot,realpathSync(file)).replaceAll('\\','/');
    if (isAbsolute(rel) || rel==='..' || rel.startsWith('../')) throw new Error('file resolves outside framework root');
  }
  let ruleApplications = 0;
  const findings = [...(fileArgIdx >= 0 ? [] : repoRules())];
  // delivery-artifact rules: suites touched by the diff (--changed / hook), or all on a full scan
  if (fileArgIdx < 0) findings.push(...artifactRules(suiteDirsInScope(has('--changed') ? 'changed' : 'all')));
  for (const file of files) {
    const rel = relative(ROOT, file).replaceAll('\\', '/');
    const dir = layerOf(rel);
    let text;
    text = readFileSync(file, 'utf8');
    for (const rule of RULES) {
      if (!rule.dirs.includes(dir)) continue;
      ruleApplications++;
      for (const hit of rule.check(rel, text)) {
        findings.push({ rule: rule.id, severity: rule.severity, file: rel, line: hit.line, why: rule.why, excerpt: hit.excerpt });
      }
    }
  }

  const baseline = existsSync(BASELINE_PATH)
    ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).entries || []
    : [];
  if (!Array.isArray(baseline) || baseline.some(b=>!b.rule || !b.file || !Number.isInteger(b.line) || !b.fingerprint)) {
    throw new Error('baseline entries require rule, file, line and fingerprint; review legacy broad entries manually');
  }
  for (const f of findings) {
    f.fingerprint=createHash('sha256').update(`${f.rule}|${f.file}|${f.line}|${f.excerpt}`).digest('hex');
    f.legacy = f.rule !== 'secret-literal' && baseline.some(b=>b.rule===f.rule && b.file===f.file && b.line===f.line && b.fingerprint===f.fingerprint);
    f.excerpt='[source omitted; inspect the location locally]';
  }

  if (has('--write-baseline')) {
    if (fileArgIdx >= 0 || has('--changed')) {
      console.error('[check-conventions] --write-baseline requires a FULL scan — a partial scan would silently drop existing legacy entries.');
      return 2;
    }
    if (findings.some(f=>f.rule==='secret-literal')) throw new Error('secrets cannot be baselined');
    const entries = findings.map(({rule,file,line,fingerprint})=>({rule,file,line,fingerprint}));
    writeFileSync(BASELINE_PATH, JSON.stringify({
      comment: 'Known legacy violations — fix-when-touched (design-conventions policy). New entries require a team decision; never add one to silence a new violation.',
      recordedAt: new Date().toISOString(),
      entries,
    }, null, 2));
    console.log(`baseline written: ${entries.length} legacy entrie(s) -> scripts/conventions-baseline.json`);
    return 0;
  }

  const fresh = findings.filter((f) => !f.legacy && f.severity === 'fail');
  const freshWarn = findings.filter((f) => !f.legacy && f.severity === 'warn');
  const legacy = findings.filter((f) => f.legacy);

  if (has('--json')) {
    console.log(JSON.stringify({ files: files.length, ruleApplications, registeredLayerRules: RULES.length, fresh, freshWarn, legacyCount: legacy.length }, null, 2));
  } else {
    for (const f of fresh) console.log(`FAIL  ${f.file}:${f.line}  [${f.rule}]  ${f.excerpt}\n      ${f.why}`);
    for (const f of freshWarn) console.log(`WARN  ${f.file}:${f.line}  [${f.rule}]  ${f.excerpt}\n      ${f.why}`);
    if (legacy.length && !has('--quiet')) console.log(`legacy (fix-when-touched): ${legacy.length} known violation(s) — see scripts/conventions-baseline.json`);
    console.log(`\nchecked ${files.length} file(s), ${ruleApplications} rule applications: ${fresh.length} new FAIL, ${freshWarn.length} new WARN, ${legacy.length} legacy`);
  }
  return fresh.length || (has('--fail-on-warn') && freshWarn.length) ? 1 : 0;
}

try { process.exitCode=main(); } catch (error) {
  // Only fixed, source-free messages are shown; anything else could echo project content.
  console.error(error?.fixedMessage ? `[check-conventions] error: ${error.message}` : '[check-conventions] error: validation did not complete. Check arguments, nonzero scope, Git reference, file access and baseline format. Source omitted.');
  process.exitCode=2;
}
