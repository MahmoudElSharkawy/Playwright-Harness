import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, realpathSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, readlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname, relative, isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {packageRoot} from '../scripts/lib/consumer-paths.mjs';
import {adoptProject} from '../scripts/lib/adoption.mjs';
import {createSkillLink, discoveryEntry, removeSkillLink} from '../scripts/lib/skill-roots.mjs';
import {runCheck, READY, UNAVAILABLE, WAITING, OPTIONAL} from '../scripts/lib/check.mjs';

function project(t) {
 const base=realpathSync(tmpdir()),root=mkdtempSync(join(base,'pom-check-'));
 t.after(()=>{const rel=relative(base,realpathSync(root));assert(!isAbsolute(rel)&&rel.startsWith('pom-check-'));rmSync(root,{recursive:true,force:true});});return root;
}
function put(root,path,text){const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);}
const check=(root,options={})=>runCheck({projectRoot:root,packageRoot,...options});
const status=(result,prefix)=>result.features.find(item=>item.name.startsWith(prefix));
const git=(root,...args)=>spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});
// Snapshot consumer bytes and link destinations without following package links.
function snapshot(root) {
 const entries=[];
 const visit=dir=>{for(const entry of readdirSync(dir,{withFileTypes:true})) {
  const path=join(dir,entry.name),rel=relative(root,path);
  if(entry.isSymbolicLink()) {
   let target;
   try {target=readlinkSync(path);} catch(error) {if(error.code!=='ENOENT')throw error;target={unresolved:error.code};}
   entries.push([rel,'link',target]);
  }
  else if(entry.isDirectory()){entries.push([rel,'directory']);visit(path);}
  else entries.push([rel,'file',readFileSync(path).toString('base64')]);
 }};
 visit(root);return entries;
}
/** An adopted project whose default environment selects one API and one database target. */
function configured(t) {
 const root=project(t);adoptProject({projectRoot:root,environment:'qa',mode:'test'});
 const config=JSON.parse(readFileSync(join(root,'.harness/project.json'),'utf8'));
 Object.assign(config.environments.qa,{apiTargets:['api'],databaseTargets:['db']});
 put(root,'.harness/project.json',JSON.stringify(config));
 put(root,'.harness/targets.json',JSON.stringify({api:{api:{baseUrl:'https://api.example.test',credentialRef:'env:SYN_API_TOKEN'}},databases:{db:{engine:'sqlserver',connectionRef:'env:SYN_DB',server:'db.example.test',database:'Synthetic'}}}));
 return root;
}

test('an unadopted project reports what is missing without failing',t=>{
 const result=check(project(t));
 assert.deepEqual(result.errors,[]);
 assert.equal(status(result,'skills').status,UNAVAILABLE);assert.equal(status(result,'API and database').status,WAITING);
 assert.equal(status(result,'Azure DevOps').status,OPTIONAL);assert.equal(status(result,'CI pipeline').status,OPTIONAL);
 assert.match(result.notes.join(' '),/does not install the harness from \.harness\/vendor/);
 assert.equal(status(result,'Work-item links'),undefined);
});

test('work-item link readiness reuses coordinates without requiring credentials or changing Azure DevOps readiness', t => {
 const root=project(t);
 put(root,'.harness/integrations.json',JSON.stringify({version:1,ado:{organizationUrl:'https://dev.azure.com/example-org',project:'Example Project',credentialRef:'SYN_LINK_PAT'}}));
 const ado=status(check(root),'Azure DevOps');
 assert.equal(status(check(root),'Work-item links').status,WAITING);
 assert.match(status(check(root),'Work-item links').detail,/Example%20Project/);
 const config=links=>`export default {reporter:[['allure-playwright',{links:${links}}]]};`;
 put(root,'playwright.config.ts',config("{tms:{urlTemplate:'https://dev.azure.com/your-org/your-project/_workitems/edit/%s'}}"));
 assert.equal(status(check(root),'Work-item links').status,WAITING);
 put(root,'playwright.config.ts',config("{tms:{urlTemplate:'https://dev.azure.com/example-org/Example%20Project/_workitems/edit/%s'}}"));
 assert.deepEqual(status(check(root),'Work-item links'),{name:'Work-item links',status:READY,detail:'literal reporter templates configured'});
 put(root,'playwright.config.ts',config("{issue:{urlTemplate:'https://bugs.example.com/items/%s'}}"));
 assert.match(status(check(root),'Work-item links').detail,/customized/);
 put(root,'playwright.config.ts',config('teamTemplates'));
 assert.equal(status(check(root),'Work-item links').status,'unresolved');assert.deepEqual(check(root).errors,[]);
 assert.deepEqual(status(check(root),'Azure DevOps'),ado);
});
test('linked skills are ready until a link goes missing',t=>{
 const root=project(t);adoptProject({projectRoot:root});
 assert.equal(status(check(root),'skills').status,READY);
 removeSkillLink(join(root,'.claude/skills/test-data'));
 assert.deepEqual(status(check(root),'skills'),{name:'skills (Claude and Codex)',status:UNAVAILABLE,detail:'1 links missing or broken; run setup'});
});
for(const host of ['.agents','.claude'])for(const kind of ['older installation','dangling link','ordinary directory'])test(`${host} ${kind} is unavailable without repairing links`,t=>{
 const root=project(t),previous=project(t),rel=`${host}/skills/test-data`,link=join(root,rel),target=join(previous,'.agents/skills/test-data');
 adoptProject({projectRoot:root});removeSkillLink(link);
 if(kind==='ordinary directory')put(root,`${rel}/SKILL.md`,'Consumer skill\n');
 else {
  if(kind==='older installation') {
   put(previous,'package.json',JSON.stringify({name:'playwright-pom-harness',version:'0.0.1'}));
   put(previous,'.agents/skills/test-data/SKILL.md','Previous harness skill\n');
  }
  createSkillLink(target,link);
 }
 try {
  const before=snapshot(root),result=check(root);
  assert.deepEqual(status(result,'skills'),{name:'skills (Claude and Codex)',status:UNAVAILABLE,detail:'1 links missing or broken; run setup'});
  assert.deepEqual(result.errors,[]);assert.deepEqual(snapshot(root),before);
  assert(!JSON.stringify(result).includes(JSON.stringify(previous).slice(1,-1)),'A foreign installation path surfaced in the report.');
 } finally {
  // Some Windows Node versions cannot remove a dangling junction recursively.
  if(kind==='dangling link')mkdirSync(target,{recursive:true});
 }
});
test('skill links and the installed package are compared by resolved paths',t=>{
 const root=project(t),alias=project(t);adoptProject({projectRoot:root});
 createSkillLink(packageRoot,join(alias,'package'));
 const link=join(root,'.agents/skills/test-data');removeSkillLink(link);
 createSkillLink(join(alias,'package/.agents/skills/test-data'),link);
 const before=snapshot(root),result=check(root,{packageRoot:join(alias,'package')});
 assert.equal(status(result,'skills').status,READY);assert.deepEqual(result.errors,[]);assert.deepEqual(snapshot(root),before);
});
test('malformed and unsafe skill manifests produce controlled errors without changes',t=>{
 const root=project(t),foreign=project(t),privateText='synthetic-private-marker';
 const records=[`{"${privateText}":`,null,{}, {version:2,links:[]}, {version:1}, {version:1,links:{}},
  ...[null,7,{},'../outside',join(foreign,privateText),'.agents/skills/../../outside','.agents\\skills\\test-data','.agents/skills/test-data/SKILL.md','.other/skills/test-data']
   .map(path=>({version:1,links:['.agents/skills/test-data',path]}))];
 for(const record of records) {
  const text=typeof record==='string'?record:JSON.stringify(record);put(root,'.harness/links.json',text);
  const before=snapshot(root),result=check(root),output=JSON.stringify(result);
  assert.equal(status(result,'skills').status,UNAVAILABLE);
  assert.deepEqual(result.errors,['.harness/links.json is invalid; review the harness link record and run setup.']);
  assert(!output.includes(privateText) && !output.includes(JSON.stringify(foreign).slice(1,-1)),'Manifest contents surfaced in the report.');
  assert.deepEqual(snapshot(root),before);
 }
});
test('partial and empty version-1 manifests retain adoption compatibility',t=>{
 const root=project(t);adoptProject({projectRoot:root});
 for(const links of [['.agents/skills/test-data'],[]]) {
  put(root,'.harness/links.json',JSON.stringify({version:1,links}));
  const result=check(root);assert.equal(status(result,'skills').status,READY);assert.deepEqual(result.errors,[]);
 }
});
test('checking an adopted project preserves omitted legacy folders and tracked team data',t=>{
 const root=project(t),folder='.claude/skills/plan-tracker',legacy=`${folder}/data/history.jsonl`,history='{"at":"2026-09-30","set":{"todo":[7]}}\n';
 assert.equal(git(root,'init','--initial-branch=fixture').status,0);
 put(root,legacy,history);assert.equal(git(root,'add',folder).status,0);
 const adoption=adoptProject({projectRoot:root});
 assert(adoption.reports.some(report=>report.startsWith(`Kept ${folder}:`)));
 assert(!JSON.parse(readFileSync(join(root,'.harness/links.json'),'utf8')).links.includes(folder));
 assert.equal(discoveryEntry(join(root,folder)).kind,'directory');
 const before=snapshot(root),result=check(root);
 assert.equal(status(result,'skills').status,READY);assert.deepEqual(result.errors,[]);assert.deepEqual(snapshot(root),before);
 assert.equal(readFileSync(join(root,legacy),'utf8'),history);
 assert.equal(readFileSync(join(root,'.harness/state/tracker/history.jsonl'),'utf8'),history);
});
test('targets wait for secrets by name, check the database JSON shape and never expose values',t=>{
 const root=configured(t);
 assert.equal(status(check(root),'API and database').detail,'missing secrets: SYN_API_TOKEN, SYN_DB');
 put(root,'.env','SYN_API_TOKEN=<synthetic-token>\nSYN_DB=<not-json>\n');
 const malformed=check(root);assert.equal(status(malformed,'API and database').detail,'not {"user","password"} JSON: SYN_DB');
 assert(!JSON.stringify(malformed).includes('synthetic-token') && !JSON.stringify(malformed).includes('not-json'),'A secret value surfaced in the report.');
 put(root,'.env','SYN_API_TOKEN=<synthetic-token>\nSYN_DB={"user":"<user>","password":"<password>"}\n');
 assert.equal(status(check(root),'API and database').status,READY);
});
test('--add-env-keys appends only empty keys for missing secrets',t=>{
 const root=configured(t);put(root,'.env','# team secrets\nSYN_API_TOKEN=<synthetic-token>');
 const result=check(root,{addEnvKeys:true});
 assert.deepEqual(result.envKeysAdded,['SYN_DB']);assert.equal(readFileSync(join(root,'.env'),'utf8'),'# team secrets\nSYN_API_TOKEN=<synthetic-token>\nSYN_DB=\n');
 // An empty key is the user's to fill in; it is never added twice.
 assert.deepEqual(check(root,{addEnvKeys:true}).envKeysAdded,[]);assert.equal(status(check(root),'API and database').detail,'missing secrets: SYN_DB');
});
test('invalid configuration is an error; Azure DevOps waits for its credential by name',t=>{
 const root=configured(t);put(root,'.harness/integrations.json',JSON.stringify({version:1,ado:{organizationUrl:'https://dev.azure.com/example-org',project:'Synthetic',credentialRef:'SYN_ADO_PAT'}}));
 assert.deepEqual(status(check(root),'Azure DevOps'),{name:'Azure DevOps',status:WAITING,detail:'missing secret: SYN_ADO_PAT'});
 assert.deepEqual(check(root,{addEnvKeys:true}).envKeysAdded,['SYN_ADO_PAT','SYN_API_TOKEN','SYN_DB']);
 put(root,'.harness/project.json',JSON.stringify({version:1,defaultEnvironment:'qa',environments:{qa:{environmentMode:'unknown',apiTargets:[],databaseTargets:[]}}}));
 assert.match(check(root).errors.join(' '),/\.harness configuration is invalid/);
});
test('the vendored archive must exist, match the lockfile and stay tracked',t=>{
 const root=project(t),archive='.harness/vendor/playwright-pom-harness-0.0.1.tgz';
 put(root,'package.json',JSON.stringify({name:'synthetic',devDependencies:{'playwright-pom-harness':`file:${archive}`}}));
 assert.match(check(root).errors.join(' '),/is missing; teammates and CI cannot install the harness/);
 put(root,archive,'synthetic archive bytes');
 put(root,'package-lock.json',JSON.stringify({packages:{'node_modules/playwright-pom-harness':{version:'0.0.1',integrity:'sha512-other'}}}));
 assert.match(check(root).errors.join(' '),/differs from the integrity recorded in package-lock\.json/);
 put(root,'package-lock.json',JSON.stringify({packages:{'node_modules/playwright-pom-harness':{version:'0.0.1'}}}));
 assert.equal(git(root,'init','-q').status,0);put(root,'.gitignore','*.tgz\n');
 assert.match(check(root).errors.join(' '),/is git-ignored/);
 put(root,'.gitignore','*.tgz\n!/.harness/vendor/*.tgz\n');
 const untracked=check(root);assert.deepEqual(untracked.errors,[]);assert.match(untracked.notes.join(' '),/is not committed yet/);
});
test('an installation without npm-shrinkwrap.json reports the gap instead of failing',t=>{
 // npm 12 packs without the shrinkwrap; the drift comparison then has nothing to compare against.
 const root=project(t),installed=join(root,'packed-without-lock');put(installed,'package.json',JSON.stringify({name:'playwright-pom-harness',version:'0.0.1'}));
 put(root,'package-lock.json',JSON.stringify({packages:{'':{},'node_modules/synthetic':{version:'1.0.0'}}}));
 const result=runCheck({projectRoot:root,packageRoot:installed});
 assert.deepEqual(result.errors,[]);assert.match(result.notes.join(' '),/no npm-shrinkwrap\.json, so its dependency versions were not compared/);
});
test('a pipeline that runs Playwright tests needs a browser install step',t=>{
 const root=project(t),pipeline='jobs:\n  test:\n    steps:\n      - run: npm ci\n      - run: npx playwright test\n';
 put(root,'.github/workflows/tests.yml',pipeline);
 assert.deepEqual(status(check(root),'CI pipeline'),{name:'CI pipeline',status:UNAVAILABLE,detail:'.github/workflows/tests.yml runs Playwright tests without installing a browser'});
 put(root,'.github/workflows/tests.yml',pipeline.replace('      - run: npx playwright test','      - run: npx playwright install --with-deps chromium\n      - run: npx playwright test'));
 assert.equal(status(check(root),'CI pipeline').status,READY);
});
