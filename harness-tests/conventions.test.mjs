import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';

const checker=resolve('scripts/check-conventions.mjs');
function fixture(t) {
  const base=realpathSync(tmpdir()), root=mkdtempSync(join(base,'pom-m1-'));
  t.after(()=>{const rel=relative(base,realpathSync(root));assert(!isAbsolute(rel) && !rel.startsWith('..') && rel.startsWith('pom-m1-'));rmSync(root,{recursive:true});});
  const put=(file,text='')=>{const p=join(root,file);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,text);};
  put('src/config/clean.ts','export {};'); put('scripts/conventions-baseline.json','{"entries":[]}');
  return {root,put,run:(...args)=>spawnSync(process.execPath,[checker,'--root',root,'--json',...args],{encoding:'utf8',timeout:15000})};
}
function findings(result) { assert.notEqual(result.status,2,result.stderr);const data=JSON.parse(result.stdout);assert(data.files>0);assert(data.ruleApplications>0);return [...data.fresh,...data.freshWarn]; }
const spec='tests/ExampleTests.spec.ts', page='src/pages/ExamplePage.ts';
test('without --root the checker validates the project folder it runs in', t => {
 const f=fixture(t), run=cwd=>spawnSync(process.execPath,[checker,'--json'],{cwd,encoding:'utf8',timeout:15000});
 const result=run(f.root);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).files,1);
 const base=realpathSync(tmpdir()), empty=mkdtempSync(join(base,'pom-m1-'));t.after(()=>rmSync(empty,{recursive:true}));
 const none=run(empty);assert.equal(none.status,2);assert.match(none.stderr,/run it from the project folder or pass --root/);
});
test('local source identities satisfy traceability without requiring an external TMS', t => {
 const f=fixture(t);f.put('resources/testData/ExampleTestJsonFile.json','{}');
 f.put(spec,'test("case",()=>{allure.testCaseId("local-case");});');
 assert.equal(findings(f.run()).some(hit=>hit.rule==='tms-per-test'),false);
 f.put(spec,'test("case",()=>{allure.feature("Feature");});');
 assert.equal(findings(f.run()).some(hit=>hit.rule==='tms-per-test'),true);
});
const cases=[
 ['no-test-only',spec,'test.only("case", () => {});','test("case", () => {});'],
 ['no-wait-timeout',page,'page.waitForTimeout(500);','page.waitForLoadState();'],
 ['no-try-outside-utils',page,'try { doThing(); } catch {}','doThing();'],
 ['no-expect-in-spec',spec,'import { test, expect } from "@playwright/test";','import { test } from "@playwright/test";'],
 ['no-locator-in-spec',spec,'page.getByRole("button");','await examplePage.submit();'],
 ['no-raw-request-in-spec',spec,'request.patch("/record");','await api.updateRecord();'],
 ['no-id-engine-prefix',page,'page.locator("id=submit");','page.locator("#submit");'],
 ['no-console-log',spec,'console.log("debug");','await test.step("Observe", async()=>{});'],
 ['no-page-on-dialog',page,'page.on("dialog", handler);','page.once("dialog", handler);'],
 ['locator-literal-in-body',page,'///// Actions\npage.locator("#submit");','readonly submit_button: Locator;\n///// Actions\nthis.submit_button.click();'],
 ['timeout-below-default',page,'expectToBeVisible(item, "item", {timeout: 1000});','expectToBeVisible(item, "item");'],
 ['secret-literal','src/config/example.ts','const pass'+'word = "'+'synthetic-fixture-value'+'"; // conventions-ok; process.env.OTHER','const pass'+'word = process.env.TEST_PASSWORD;'],
 ['spec-data-pairing',spec,'export {};','export {};'],
 ['spec-data-source',spec,"import {readFileSync as read} from 'node:fs';\nread('./resources/testData/Common.json', 'utf8');","import {readFileSync as read} from 'node:fs';\nread('./resources/testData/ExampleTestJsonFile.json', 'utf8');"],
 ['business-test-data-dependency','src/apis/ApisExample.ts',"import type {Schema} from '../../tests/ExampleTests.spec';","import type {OperationInput} from './OperationInput';"],
 ['spec-naming','tests/wrong.spec.ts','export {};','export {};'],
 ['tms-per-test',spec,'test("case",()=>{});','test("case",()=>{allure.tms("1001");});'],
 ['feature-per-test',spec,'test("case",()=>{});','test("case",()=>{allure.feature("Example");});'],
 ['tag-vocabulary',spec,'test("case", {tag:["@other"]},()=>{});','test("case", {tag:["@smoke","@regression"]},()=>{});'],
 ['assertion-message',page,'await expect(item).toBeVisible();','await expectToBeVisible(item, "item");'],
 ['locator-suffix-vocabulary',page,'readonly save_buttons: Locator;','readonly save_button: Locator;'],
 ['anatomy-spacing',page,'export class ExamplePage {\n\n\nvalue=1;\n}','export class ExamplePage {\n\nvalue=1;\n}'],
 ['secret-in-title',page,'step(`Login ${username}`, async()=>{});','step("Login", async()=>{});'],
 ['timeout-literal-in-pages',page,'wait({timeout: 60_000});','wait({timeout: SLOW_SURFACE_MS});'],
 ['no-kebab-test-data',null,'',''],
 ['traceability-format-drift',null,'',''],
 ['traceability-table-stale',null,'',''],
 ['verify-state-contract-drift',null,'',''],
];

test('fixtures cover every registered rule exactly once',()=>{
 const r=spawnSync(process.execPath,[checker,'--list-rules'],{encoding:'utf8'});assert.equal(r.status,0);
 assert.deepEqual(cases.map(c=>c[0]).sort(),Object.values(JSON.parse(r.stdout)).flat().sort());assert.equal(cases.length,28);
});
for(const [rule,file,bad,good] of cases) for(const violating of [true,false]) test(`${rule}: ${violating?'detect':'accept'}`,t=>{
 const f=fixture(t);
 if(file) f.put(rule==='spec-naming' && !violating ? spec:file,violating?bad:good);
 if(rule!=='spec-data-pairing' || !violating) f.put('resources/testData/ExampleTestJsonFile.json','{}');
 if(rule==='no-kebab-test-data') f.put(violating?'resources/test-data/example.json':'resources/testData/example.json','{}');
 if(rule.startsWith('traceability-')) {
   f.put(page,'export class ExamplePage { submit() {} }');
   const layer=violating && rule==='traceability-format-drift'?'pages':'UI';
   const method=violating && rule==='traceability-table-stale'?'missing':'submit';
   f.put('test/ado-suite-100/_traceability.md',`| Layer | Why this layer | Class | Method |\n|---|---|---|---|\n| ${layer} | | ExamplePage | \`${method}\` |`);
 }
 if(rule==='verify-state-contract-drift') {
   f.put(spec,'allure.tms("1001");');
   f.put('test/ado-suite-100/_verify-state.json',JSON.stringify({cases:{1001:violating?{status:'blocked',note:'no test generated'}:{status:'passed'}}}));
 }
 assert.equal(findings(f.run()).some(h=>h.rule===rule),violating);
});
test('zero scope and unrecognized inputs fail closed',t=>{
 const f=fixture(t);rmSync(join(f.root,'src/config/clean.ts'));
 for(const args of [[],['--files'],['--files','README.md'],['--wat'],['--root'],['--changed','--files','a.ts'],['--base-ref','main']]) assert.equal(f.run(...args).status,2);
});
test('scope rejects parent escape and symlink escape',t=>{
 const f=fixture(t), outside=fixture(t);outside.put('outside.ts','export {};');
 assert.equal(f.run('--files',join(outside.root,'outside.ts')).status,2);
 symlinkSync(outside.root,join(f.root,'src/config/linked'),'junction');
 assert.equal(f.run('--files','src/config/linked/outside.ts').status,2);
 // Remove only the link, before fixture cleanup walks the temporary directory.
 rmSync(join(f.root,'src/config/linked'));
});
test('warnings are errors when requested',t=>{
 const f=fixture(t);f.put(page,'await expect(item).toBeVisible();');assert.equal(f.run().status,0);assert.equal(f.run('--fail-on-warn').status,1);
});
test('secret diagnostics never reproduce source and secrets cannot be baselined',t=>{
 const f=fixture(t), marker='generated-fixture-'+Date.now();f.put(page,`const pass${'word'} = "${marker}"; // conventions-ok process.env.OTHER\nconsole.log("${marker}");`);
 const r=f.run();assert(findings(r).some(h=>h.rule==='secret-literal'));assert(!r.stdout.includes(marker));assert.equal(f.run('--write-baseline').status,2);
});
test('baselines are occurrence-specific and partial writes are refused',t=>{
 const f=fixture(t);f.put(page,'page.waitForTimeout(100);');assert.equal(f.run('--write-baseline').status,0);
 assert.equal(f.run().status,0);f.put(page,'page.waitForTimeout(100);\npage.waitForTimeout(200);');assert.equal(f.run().status,1);
 assert.equal(f.run('--files',page,'--write-baseline').status,2);
 f.put('scripts/conventions-baseline.json',JSON.stringify({entries:[{rule:'no-wait-timeout',file:page}]}));assert.equal(f.run().status,2);
});
test('invalid verification artifacts do not disappear',t=>{
 const f=fixture(t);for(const invalid of ['{','null','{}','{"cases":[]}','{"cases":{"1001":null}}']) {
  f.put('test/ado-suite-100/_verify-state.json',invalid);assert(findings(f.run()).some(h=>h.rule==='verify-state-contract-drift'));
 }
});
test('story-scoped verification folders get the suite artifact contract; look-alike folders stay out of scope',t=>{
 const f=fixture(t);f.put(spec,'allure.tms("1001");');
 for(const folder of ['ado-story-x','ado-stories-100','ado-story-100']) f.put(`test/${folder}/_verify-state.json`,'{');
 assert.deepEqual([...new Set(findings(f.run()).filter(h=>h.rule==='verify-state-contract-drift').map(h=>h.file))],['test/ado-story-100/_verify-state.json']);
});
test('malformed baselines never echo input fragments',t=>{
 const f=fixture(t), marker='do-not-echo-this-fixture';f.put('scripts/conventions-baseline.json','{"bad":'+marker+'}');
 const r=f.run();assert.equal(r.status,2);assert(!r.stdout.includes(marker));assert(!r.stderr.includes(marker));
});
test('Git selection includes committed, staged, unstaged and untracked files with spaces',t=>{
 const f=fixture(t);
 const git=(...args)=>{const r=spawnSync('git',['-c','core.hooksPath='+join(f.root,'empty-hooks'),'-c','user.name=Fixture','-c','user.email=fixture@example.test',...args],{cwd:f.root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r;};
 git('init','--initial-branch=main');git('add','.');git('commit','-m','fixture baseline');git('checkout','-b','feature');
 f.put('src/utils/committed file.ts','export {};');git('add','.');git('commit','-m','fixture change');
 f.put('src/config/clean.ts','export const changed=true;');f.put('src/utils/staged file.ts','export {};');git('add','src/utils/staged file.ts');f.put('src/utils/untracked file.ts','export {};');
 const r=f.run('--changed');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).files,4);
 assert.equal(f.run('--changed','--base-ref','missing-reference').status,2);
});
test('changed scope includes touched story verification folders and skips untouched suite folders',t=>{
 const f=fixture(t);
 const git=(...args)=>{const r=spawnSync('git',['-c','core.hooksPath='+join(f.root,'empty-hooks'),'-c','user.name=Fixture','-c','user.email=fixture@example.test',...args],{cwd:f.root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r;};
 f.put('test/ado-suite-100/_verify-state.json','{');git('init','--initial-branch=main');git('add','.');git('commit','-m','fixture baseline');git('checkout','-b','feature');
 f.put('src/config/clean.ts','export const changed=true;');f.put('test/ado-story-200/_verify-state.json','{');
 assert.deepEqual([...new Set(findings(f.run('--changed')).filter(h=>h.rule==='verify-state-contract-drift').map(h=>h.file))],['test/ado-story-200/_verify-state.json']);
});
test('Git failure never becomes successful empty scope',t=>{
 const f=fixture(t);assert.equal(f.run('--changed').status,2);assert.equal(f.run('--changed','--base-ref','main').status,2);
});

test('actual data reads must use the owning pair even when both pairs and shared JSON exist', t => {
 const f=fixture(t);
 for(const feature of ['Example','Other']) {
  f.put(`resources/testData/${feature}TestJsonFile.json`,'{}');
  f.put(`tests/${feature}Tests.spec.ts`,"import * as files from 'node:fs';\nfiles.readFileSync('./resources/testData/Common.json', 'utf8');");
 }
 f.put('resources/testData/Common.json','{}');
 assert.deepEqual(findings(f.run()).filter(hit=>hit.rule==='spec-data-source').map(hit=>hit.file).sort(),['tests/ExampleTests.spec.ts','tests/OtherTests.spec.ts']);
});

test('multiline filesystem aliases are checked, normalized paired reads and binary fixtures are allowed', t => {
 const f=fixture(t);f.put('resources/testData/ExampleTestJsonFile.json','{}');
 f.put(spec,"import {\n readFileSync as load\n} from 'node:fs';\nload('resources/testData/../testData/Other.json', 'utf8');");
 assert(findings(f.run()).some(hit=>hit.rule==='spec-data-source' && hit.line===4));
 f.put(spec,"import files from 'fs';\nfiles.readFileSync('./resources/testData/ExampleTestJsonFile.json', 'utf8');\nfiles.readFileSync('./resources/testData/fixtures/Example/upload.pdf');");
 assert(!findings(f.run()).some(hit=>hit.rule==='spec-data-source'));
});

test('runtime static, dynamic and CommonJS JSON imports violate the spec loading contract', t => {
 const f=fixture(t);f.put('resources/testData/ExampleTestJsonFile.json','{}');
 for(const source of ["import data from '../resources/testData/ExampleTestJsonFile.json';", "await import('../resources/testData/ExampleTestJsonFile.json');", "await import('../resources/testData/ExampleTestJsonFile.json', {with: {type: 'json'}});", "const data = require('../resources/testData/ExampleTestJsonFile.json');", "const shape = typeof import('../resources/testData/ExampleTestJsonFile.json');"]) {
  f.put(spec,source);assert(findings(f.run()).some(hit=>hit.rule==='spec-data-source'));
 }
});

test('spec JSON types can be inferred from their own pair without named interfaces or runtime imports', t => {
 const f=fixture(t);f.put('resources/testData/ExampleTestJsonFile.json','{}');
 for(const source of ["let testData: typeof import('../resources/testData/ExampleTestJsonFile.json');", "import type Data from '../resources/testData/ExampleTestJsonFile.json';"]) {
  f.put(spec,source);assert(!findings(f.run()).some(hit=>hit.rule==='spec-data-source'));
 }
 f.put(spec,"let testData: typeof import('../resources/testData/OtherTestJsonFile.json');");
 assert(findings(f.run()).some(hit=>hit.rule==='spec-data-source'));
 f.put('src/apis/ApisExample.ts',"let testData: typeof import('../../resources/testData/ExampleTestJsonFile.json');");
 assert(findings(f.run()).some(hit=>hit.rule==='business-test-data-dependency'));
});

test('business imports, re-exports and loads cannot reach specs or canonical test-data sources', t => {
 const f=fixture(t);
 f.put(spec,"import * as fs from 'node:fs';\nfs.readFileSync('./resources/private-inputs.json', 'utf8');");
 f.put('resources/testData/ExampleTestJsonFile.json','{}');
 const business='src/apis/ApisExample.ts';
 for(const source of [
  "import type {\n Schema as Input\n} from '../../tests/ExampleTests.spec';",
  "export {Input} from '../../resources/testData/Shapes';",
  "import {readFileSync as load} from 'fs';\nload('./resources/testData/ExampleTestJsonFile.json', 'utf8');",
  "const fs = require('node:fs');\nfs.readFileSync('./resources/testData/ExampleTestJsonFile.json', 'utf8');"
 ]) {f.put(business,source);assert(findings(f.run()).some(hit=>hit.rule==='business-test-data-dependency'));}
 f.put(business,"const input = await import('../../resources/testData/ExampleTestJsonFile.json', {with: {type: 'json'}});");
 assert(findings(f.run()).some(hit=>hit.rule==='business-test-data-dependency'));
});

test('operation types, small parameters, indexed business types and technical sources remain allowed', t => {
 const f=fixture(t);
 f.put('src/apis/ApisExample.ts',"import type {CustomerResponse} from './CustomerResponse';\nimport {ApiActions} from '../utils/ApiActions';\nexport interface RegistrationInput { email: string; credential: string; }\nexport class ApisExample {\n  verifyAbsent(response: APIResponse, expectedHttpStatus: number, expectedResponseCode: number) {}\n  register(input: RegistrationInput) {}\n  verifyCode(expected: CustomerResponse['responseCode']) {}\n}\n");
 assert.deepEqual(findings(f.run()),[]);
});

test('source checks ignore comments, quoted examples, regexes and unresolved dynamic paths', t => {
 const f=fixture(t);f.put('resources/testData/ExampleTestJsonFile.json','{}');
 f.put(spec,"import * as fs from 'node:fs';\n// fs.readFileSync('./resources/testData/Common.json');\nconst example = \"import data from '../resources/testData/Common.json';\";\nconst pattern = /import data from 'Common.json'/;\nfs.readFileSync(testDataPath, 'utf8');");
 assert(!findings(f.run()).some(hit=>hit.rule==='spec-data-source'));
});

test('a business-file hook does not scan unrelated or symlinked specs', t => {
 const f=fixture(t), outside=fixture(t);outside.put('UnrelatedTests.spec.ts','not a dependency');
 mkdirSync(join(f.root,'tests'),{recursive:true});symlinkSync(outside.root,join(f.root,'tests/linked'),'junction');
 f.put('src/dbs/DbsExample.ts',"import * as fs from 'fs';\nfs.readFileSync('./resources/testData/ExampleTestJsonFile.json', 'utf8');");
 const result=f.run('--files','src/dbs/DbsExample.ts');
 assert.equal(result.status,1);assert(findings(result).some(hit=>hit.rule==='business-test-data-dependency'));
 rmSync(join(f.root,'tests/linked'));
});

test('partial dynamic paths and similarly named member methods do not invent literal dependencies', t => {
 const f=fixture(t);f.put('resources/testData/ExampleTestJsonFile.json','{}');
 f.put(spec,"import * as fs from 'node:fs';\nfs.readFileSync('./resources/testData/Common.json' + suffix);\nclient.import('../resources/testData/Common.json');\nclient.require('../resources/testData/Common.json');\nclient.fs.readFileSync('./resources/testData/Common.json');");
 assert(!findings(f.run()).some(hit=>hit.rule==='spec-data-source'));
});

test('arrow-returned regex bodies cannot invent imports or filesystem reads', t => {
 const f=fixture(t);f.put('resources/testData/ExampleTestJsonFile.json','{}');
 f.put(spec,"import * as fs from 'node:fs';\nconst modulePattern = () => /import('Common.json')/;\nconst readPattern = () => /fs.readFileSync('Common.json')/;");
 assert(!findings(f.run()).some(hit=>hit.rule==='spec-data-source'));
});
