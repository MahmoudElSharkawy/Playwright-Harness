import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync,symlinkSync,cpSync,utimesSync,renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,dirname,relative,isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {adoptProject,INSTRUCTION_BLOCK} from '../scripts/lib/adoption.mjs';
import {consumerRoots,consumerPath,packageRoot} from '../scripts/lib/consumer-paths.mjs';
import {loadEnvironment} from '../scripts/lib/project-config.mjs';
import {npmPath} from '../scripts/ci/process.mjs';

function project(t) {
 const base=realpathSync(tmpdir()),root=mkdtempSync(join(base,'pom-adopt-'));
 t.after(()=>{const rel=relative(base,realpathSync(root));assert(!isAbsolute(rel)&&rel.startsWith('pom-adopt-'));rmSync(root,{recursive:true});});return root;
}
function put(root,path,text){const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);}
const adopt=root=>adoptProject({projectRoot:root,environment:'qa',mode:'test'});
const shipped=readdirSync(join(packageRoot,'.agents/skills')).filter(name=>existsSync(join(packageRoot,'.agents/skills',name,'SKILL.md'))).sort();
const registry=ids=>JSON.stringify({planId:7,names:[],branches:[{name:'Synthetic',inScope:true}],suites:[{branch:0,id:10,name:'Synthetic',cases:ids.map(id=>({id,title:`Synthetic case ${id}`,desc:'fixture',verdict:'k',note:''}))}],manual:{},bugs:{}});
test('fresh onboarding requires deliberate profile; preview writes nothing',t=>{
 const root=project(t);assert.throws(()=>adoptProject({projectRoot:root,environment:'qa'}));assert.deepEqual(readdirSync(root),[]);
 const preview=adoptProject({projectRoot:root,environment:'qa',mode:'test',dryRun:true});assert.equal(preview.skills,shipped.length);assert.deepEqual(readdirSync(root),[]);
});
test('adoption links every canonical skill for both hosts, initializes consumer state and is idempotent',t=>{
 const root=project(t),result=adopt(root);assert.equal(result.skills,shipped.length);
 for(const dir of ['.agents/skills','.claude/skills']) {
  for(const name of shipped)assert.equal(realpathSync(join(root,dir,name)),realpathSync(join(packageRoot,'.agents/skills',name)));
  assert.match(readFileSync(join(root,dir,'ROOTS.md'),'utf8'),/Read \[ROOTS\.md in the installed harness\]\(.+\.agents\/skills\/ROOTS\.md\)/);
 }
 assert.equal(JSON.parse(readFileSync(join(root,'.harness/links.json'),'utf8')).links.length,shipped.length*2);
 assert(existsSync(join(root,'.harness/state/tracker/history.jsonl')));const rerun=adopt(root);assert.equal(rerun.changes.length,0);assert.equal(rerun.links.length,0);
 assert.equal(loadEnvironment(consumerRoots(root)).environmentMode,'test');
});
test('existing instructions, host settings, application code and imported libraries survive',t=>{
 const root=project(t),files={'AGENTS.md':'Team rules\n','CLAUDE.md':'Consumer rules\n','.claude/settings.json':'{"permissions":{"deny":["Write"]}}','src/pages/Existing.ts':'existing framework','resources/Queries/team.sql':'immutable imported query','resources/apisCollections/team.json':'{"immutable":true}'};
 for(const [file,text] of Object.entries(files))put(root,file,text);adopt(root);
 for(const [file,text] of Object.entries(files))assert(readFileSync(join(root,file),'utf8').startsWith(text));
 assert.equal(adopt(root).changes.length,0);
});
test('existing configuration retains targets, overrides and formatting',t=>{
 const root=project(t);const config={version:1,defaultEnvironment:'qa',environments:{qa:{environmentMode:'test',apiTargets:['web'],databaseTargets:[],capabilities:{apiMutations:false}}}};
 const original=JSON.stringify(config,null,4)+'\n';put(root,'.harness/project.json',original);put(root,'.harness/targets.json',JSON.stringify({api:{web:{baseUrl:'https://api.example.test',credentialRef:'env:API_TOKEN'}},databases:{}}));
 adopt(root);assert.equal(readFileSync(join(root,'.harness/project.json'),'utf8'),original);assert.equal(loadEnvironment(consumerRoots(root)).capabilities.apiMutations,false);
 assert.throws(()=>adoptProject({projectRoot:root,environment:'qa',mode:'protected'}));
});
test('custom canonical or legacy skills stop before any instruction/configuration changes',t=>{
 for(const base of ['.agents/skills','.claude/skills']) {
  const root=project(t);put(root,`${base}/action-methods/SKILL.md`,'custom rules');
  assert.throws(()=>adopt(root));assert.equal(readFileSync(join(root,base,'action-methods/SKILL.md'),'utf8'),'custom rules');assert(!existsSync(join(root,'AGENTS.md')));assert(!existsSync(join(root,'.harness/project.json')));
 }
});
test('legacy state migrates byte-for-byte; later consumer changes are not overwritten on rerun',t=>{
 const root=project(t),legacy='.claude/skills/plan-tracker/data/history.jsonl';
 put(root,legacy,'{"at":"2026-09-30","set":{"todo":[7]}}\n');put(root,'.claude/skills/plan-tracker/data/plan-7.json','{"planId":7}');
 put(root,'.claude/skills/framework-review/class-ledger.md','Reviewed synthetic finding\n');adopt(root);
 assert.equal(readFileSync(join(root,'.harness/state/tracker/history.jsonl'),'utf8'),readFileSync(join(root,legacy),'utf8'));
 put(root,'.harness/state/tracker/history.jsonl','Newer consumer events\n');assert.equal(adopt(root).changes.length,0);assert.equal(readFileSync(join(root,'.harness/state/tracker/history.jsonl'),'utf8'),'Newer consumer events\n');
});
test('conflicting existing state is preserved and migration stops before writes',t=>{
 const root=project(t);put(root,'.claude/skills/framework-review/class-ledger.md','old');put(root,'.harness/state/review/class-ledger.md','new');
 assert.throws(()=>adopt(root));assert(!existsSync(join(root,'AGENTS.md')));assert.equal(readFileSync(join(root,'.harness/state/review/class-ledger.md'),'utf8'),'new');
});
test('linked state storage cannot write into package or outside consumer',t=>{
 const root=project(t);symlinkSync(packageRoot,join(root,'.harness'),'junction');assert.throws(()=>adopt(root));assert(!existsSync(join(root,'AGENTS.md')));rmSync(join(root,'.harness'));
 const roots=consumerRoots(root);assert.throws(()=>consumerPath(roots,'../outside'));assert.throws(()=>consumerPath(roots,packageRoot));
});
test('tracker uses installed template and writes only consumer output; package output is rejected',t=>{
 const root=project(t);adopt(root);put(root,'.harness/state/tracker/plan-7.json',JSON.stringify({planId:7,names:[],branches:[{name:'Synthetic',inScope:true}],suites:[{branch:0,id:10,name:'Synthetic',cases:[{id:7,title:'Synthetic case',desc:'fixture',verdict:'k',note:''}]}],manual:{},bugs:{}}));
 const script=join(packageRoot,'scripts/generate-tracker.mjs');const run=spawnSync(process.execPath,[script,'--project-root',root,'--json'],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert(existsSync(join(root,'reports/tracker/plan-7-tracker.html')));
 const blocked=spawnSync(process.execPath,[script,'--project-root',root,'--out',join(packageRoot,'forbidden.html')],{encoding:'utf8'});assert.notEqual(blocked.status,0);assert(!existsSync(join(packageRoot,'forbidden.html')));
});
test('metrics and tracker sync read story-scoped verification folders but not look-alikes',t=>{
 const root=project(t);adopt(root);put(root,'.harness/state/tracker/plan-7.json',registry([7,8]));
 put(root,'test/ado-story-300/_suite.json',JSON.stringify({storyId:300,cases:[{id:7}]}));put(root,'test/ado-story-300/_verify-state.json',JSON.stringify({cases:{7:{status:'passed',greens:2}}}));
 put(root,'test/ado-other-300/_verify-state.json',JSON.stringify({cases:{8:{status:'passed',greens:2}}}));
 const metrics=spawnSync(process.execPath,[join(packageRoot,'scripts/harness-metrics.mjs'),'--project-root',root,'--json'],{encoding:'utf8'});assert.equal(metrics.status,0,metrics.stderr);
 assert.deepEqual(JSON.parse(metrics.stdout).suites.map(s=>[s.suite,s.passed]),[['ado-story-300',1]]);
 const sync=spawnSync(process.execPath,[join(packageRoot,'scripts/generate-tracker.mjs'),'--project-root',root,'--sync','--dry-run'],{encoding:'utf8'});assert.equal(sync.status,0,sync.stderr);assert.match(sync.stdout,/"set":\{"done":\[7\]\}/);
});
test('a case shared by suite and story folders counts once and syncs only when the folders agree',t=>{
 const root=project(t);adopt(root);put(root,'.harness/state/tracker/plan-7.json',registry([7,9,11]));
 put(root,'test/ado-story-300/_verify-state.json',JSON.stringify({cases:{7:{status:'passed',greens:2},9:{status:'passed',greens:2},11:{status:'passed',greens:2}}}));
 // The story's suite is fetched for delivery (lists 11) but has verified only 7 and 9 so far.
 put(root,'test/ado-suite-10/_suite.json',JSON.stringify({cases:[{id:7},{id:9},{id:11}]}));put(root,'test/ado-suite-10/_verify-state.json',JSON.stringify({cases:{7:{status:'failed',rounds:1},9:{status:'passed',greens:2}}}));
 const metrics=spawnSync(process.execPath,[join(packageRoot,'scripts/harness-metrics.mjs'),'--project-root',root,'--json'],{encoding:'utf8'});assert.equal(metrics.status,0,metrics.stderr);
 const {totals}=JSON.parse(metrics.stdout);assert.deepEqual([totals.total,totals.passed,totals.failed,totals.noState],[3,2,0,1]);
 assert.match(metrics.stderr,/7 \(ado-story-300, ado-suite-10\)/);assert.doesNotMatch(metrics.stderr,/\b(?:9|11) \(/);
 const sync=spawnSync(process.execPath,[join(packageRoot,'scripts/generate-tracker.mjs'),'--project-root',root,'--sync','--dry-run'],{encoding:'utf8'});assert.equal(sync.status,0,sync.stderr);
 assert.match(sync.stdout,/"set":\{"done":\[9,11\]\}/);assert.match(sync.stderr,/not synced[^\n]*7 \(ado-story-300, ado-suite-10\)/);
});
test('a shared case uses its newest verification for metrics totals and tracker staleness',t=>{
 const root=project(t);adopt(root);put(root,'.harness/state/tracker/plan-7.json',registry([9,13]));put(root,'.harness/state/tracker/history.jsonl','{"at":"2026-02-01","set":{"blocked":[9]}}\n');
 const story='test/ado-story-300/_verify-state.json',suite='test/ado-suite-10/_verify-state.json',at=day=>new Date(`2026-${day}T12:00:00Z`);
 put(root,story,JSON.stringify({cases:{9:{status:'passed',greens:2},13:{status:'failed',rounds:1}}}));put(root,suite,JSON.stringify({cases:{9:{status:'passed',greens:2},13:{status:'failed',rounds:3}}}));
 utimesSync(join(root,story),at('01-01'),at('01-01'));utimesSync(join(root,suite),at('03-01'),at('03-01'));
 const metrics=spawnSync(process.execPath,[join(packageRoot,'scripts/harness-metrics.mjs'),'--project-root',root,'--json'],{encoding:'utf8'});assert.equal(metrics.status,0,metrics.stderr);
 const {totals}=JSON.parse(metrics.stdout);assert.deepEqual([totals.total,totals.failed,totals.roundsMax],[2,1,3]);
 const sync=spawnSync(process.execPath,[join(packageRoot,'scripts/generate-tracker.mjs'),'--project-root',root,'--sync','--dry-run'],{encoding:'utf8'});assert.equal(sync.status,0,sync.stderr);
 assert.match(sync.stdout,/"set":\{"done":\[9\]\}/);assert.match(sync.stderr,/not synced[^\n]*13 \(ado-story-300, ado-suite-10\)/);
});

test('a recognized legacy instruction folder becomes a link; originals need an exact normalized digest',t=>{
 const root=project(t),installed=project(t);
 for(const dir of ['.agents/skills','resources'])cpSync(join(packageRoot,dir),join(installed,dir),{recursive:true});
 put(installed,'VERSION','3.0.3\n');
 for(const file of ['scripts/managed-digests.json'])cpSync(join(packageRoot,file),join(installed,file));
 put(installed,'scripts/redirect-skill-hashes.json','{}');
 const file='.claude/skills/action-methods/SKILL.md',original='Synthetic original convention\n';
 put(root,file,original.replaceAll('\n','\r\n'));
 put(installed,'scripts/legacy-skill-hashes.json',JSON.stringify({[file]:createHash('sha256').update(original).digest('hex')}));
 const result=adoptProject({projectRoot:root,installedRoot:installed,environment:'qa',mode:'test'});
 assert.deepEqual(result.removedFolders,['.claude/skills/action-methods']);
 for(const dir of ['.agents/skills','.claude/skills'])assert.equal(realpathSync(join(root,dir,'action-methods')),realpathSync(join(installed,'.agents/skills/action-methods')));
 // A fresh consumer: in the adopted one this path is now a link, and writing there would reach the package.
 const other=project(t);put(other,'.claude/skills/test-classes/SKILL.md','Unrecognized legacy text\n');
 assert.throws(()=>adoptProject({projectRoot:other,installedRoot:installed}),/Customized legacy skill needs a manual merge: \.claude\/skills\/test-classes\/SKILL\.md/);
 assert.equal(readFileSync(join(other,'.claude/skills/test-classes/SKILL.md'),'utf8'),'Unrecognized legacy text\n');assert(!existsSync(join(other,'AGENTS.md')));
});

test('fresh consumer ignores secrets/auth/reports but permits the example environment file',t=>{
 const root=project(t);put(root,'.gitignore','# Team rule\n/team-cache/\n');adopt(root);
 const git=(...args)=>spawnSync('git',args,{cwd:root,encoding:'utf8'});
 assert.equal(git('init','--initial-branch=fixture').status,0);
 for(const file of ['.env','.env.local','.claude/settings.local.json','playwright/.auth/state.json','reports/result.html','.harness/state/hooks/run.json','team-cache/cache.json'])assert.equal(git('check-ignore','--quiet',file).status,0,file);
 assert.equal(git('check-ignore','--quiet','.env.example').status,1);
 assert(readFileSync(join(root,'.gitignore'),'utf8').startsWith('# Team rule\n/team-cache/\n'));
});

test('dangling discovery entries fail preflight without writes',t=>{
 const root=project(t);mkdirSync(join(root,'.agents/skills'),{recursive:true});
 symlinkSync(join(root,'absent-skill'),join(root,'.agents/skills/action-methods'),'junction');
 assert.throws(()=>adopt(root));assert(!existsSync(join(root,'AGENTS.md')));assert(!existsSync(join(root,'.harness/project.json')));
 mkdirSync(join(root,'absent-skill')); // Make the synthetic junction removable by Windows cleanup.
});

test('hook records stay consumer-specific and a linked ledger leaf cannot overwrite other files',t=>{
 const first=project(t),second=project(t),outside=project(t);adopt(first);adopt(second);
 const script=join(packageRoot,'scripts/hooks/guard.mjs'),payload={session_id:'synthetic-session',tool_input:{command:'npx playwright test tests/Synthetic.spec.ts'},tool_response:'1 failed'};
 const hook=(root,mode)=>spawnSync(process.execPath,[script,mode],{cwd:root,encoding:'utf8',input:JSON.stringify({...payload,cwd:root})});
 assert.equal(hook(first,'post-bash').status,0);assert.equal(hook(first,'pre-bash').status,2);assert.equal(hook(second,'pre-bash').status,0);
 const dir=join(first,'.harness/state/hooks'),leaf=join(dir,readdirSync(dir)[0]),target=join(outside,'untouched.json');
 writeFileSync(target,'unchanged');rmSync(leaf);
 // File symlinks require Windows elevation; directory junction to the file's ancestor
 // exercises the same full resolved-path boundary without special symlink privileges.
 const link=join(first,'.harness/state/hooks/escape');symlinkSync(outside,link,'junction');
 const roots=consumerRoots(first);assert.throws(()=>consumerPath(roots,join(link,'untouched.json')));
 if(process.platform!=='win32') {
   symlinkSync(target,leaf);assert.equal(hook(first,'post-bash').status,0);
   assert.equal(readFileSync(target,'utf8'),'unchanged');
 } else {
   // Hashed ledger names are fixed; a directory junction at that leaf must also fail open.
   symlinkSync(outside,leaf,'junction');assert.equal(hook(first,'post-bash').status,0);
   assert.equal(readFileSync(target,'utf8'),'unchanged');assert.deepEqual(readdirSync(outside),['untouched.json']);
 }
});

test('legacy ADO entrypoints refuse the package as consumer before contacting a service',t=>{
 const root=project(t);put(root,'config/project.json','{"azure":{}}');
 for(const name of ['fetch-ado-suite','fetch-ado-story','publish-ado-results','ado-pr','tag-ado-workitem','relink-ado-story']) {
   const script=join(packageRoot,`scripts/${name}.mjs`);
   const wrong=spawnSync(process.execPath,[script,'--project-root',packageRoot],{encoding:'utf8',cwd:root});
   assert.notEqual(wrong.status,0);assert.match(wrong.stderr,/separate consumer/);
   const run=spawnSync(process.execPath,[script,'--project-root',root],{encoding:'utf8',cwd:packageRoot,env:{...process.env,AZURE_PAT:'',AZURE_DEVOPS_EXT_PAT:'',AZURE_ORG:'',AZURE_URL:'',AZURE_PROJECT:''}});
   assert.notEqual(run.status,0);assert.doesNotMatch(run.stderr,/separate consumer|ENOENT/);
 }
});

// Exercise npm's real cwd and argument forwarding, rather than resolving scripts directly.
function exampleShortcut(name, args, fromRoot) {
 const run=spawnSync(process.execPath,[npmPath(),'--silent',...(fromRoot?['--prefix','examples']:[]),'run',name,'--',...args],{
  cwd:fromRoot?packageRoot:join(packageRoot,'examples'),encoding:'utf8',windowsHide:true,timeout:30000,
  env:{...process.env,AZURE_PAT:'',AZURE_DEVOPS_EXT_PAT:'',AZURE_ORG:'',AZURE_URL:'',AZURE_PROJECT:''}
 });
 assert.ifError(run.error);assert.doesNotMatch(run.stderr,/MODULE_NOT_FOUND|Cannot find module/);
 return run;
}
function shortcutConsumer(t) {
 const root=join(project(t),'consumer with spaces');mkdirSync(root);return root;
}
for(const [name,args,entrypoint] of [
 ['fetch:suite',['--plan','7','--suite','10'],'fetch-ado-suite'],
 ['fetch:story',['--story','200'],'fetch-ado-story'],
 ['publish:results',['--plan','7','--suite','10','--dry-run'],'publish-ado-results']
]) test(`example npm shortcut ${name} reaches guarded configuration from both directories`,t=>{
 const root=shortcutConsumer(t);
 for(const fromRoot of [true,false]) {
  const run=exampleShortcut(name,['--project-root',root,...args],fromRoot);
  assert.equal(run.status,1,run.stderr);
  assert.equal(run.stderr.trim(),`[${entrypoint}] Configure an explicit HTTPS ADO collection URL.`);
  assert.deepEqual(readdirSync(root),[]); // Configuration refusal precedes dispatch or writes.
 }
});
test('example npm shortcut check:conventions scans the explicit consumer from both directories',t=>{
 const root=shortcutConsumer(t);
 put(root,'src/pages/LoginPage.ts',readFileSync(join(packageRoot,'examples/src/pages/LoginPage.ts'),'utf8'));
 for(const fromRoot of [true,false]) {
  const run=exampleShortcut('check:conventions',['--root',root,'--json','--fail-on-warn'],fromRoot);
  assert.equal(run.status,0,run.stderr);const result=JSON.parse(run.stdout);
  assert.equal(result.files,1);assert(result.ruleApplications>0);
  assert.deepEqual(result.fresh,[]);assert.deepEqual(result.freshWarn,[]);
 }
});
test('example npm shortcut harness:metrics reads actual consumer state from both directories',t=>{
 const root=shortcutConsumer(t);
 put(root,'test/ado-suite-10/_verify-state.json',JSON.stringify({cases:{7:{status:'passed',greens:2}}}));
 for(const fromRoot of [true,false]) {
  const run=exampleShortcut('harness:metrics',['--project-root',root,'--json'],fromRoot);
  assert.equal(run.status,0,run.stderr);const result=JSON.parse(run.stdout);
  assert.deepEqual(result.suites.map(s=>[s.suite,s.total,s.passed]),[['ado-suite-10',1,1]]);
  assert.equal(result.totals.total,1);assert.equal(result.totals.passed,1);
 }
});
test('example npm shortcut tracker renders only to the explicit consumer from both directories',t=>{
 const root=shortcutConsumer(t),output='reports/shortcut output.html';
 put(root,'.harness/state/tracker/plan-7.json',registry([7]));put(root,'.harness/state/tracker/history.jsonl','');
 for(const fromRoot of [true,false]) {
  const run=exampleShortcut('tracker',['--project-root',root,'--plan','7','--out',output],fromRoot);
  assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/plan 7 · 1 cases/);
  assert.match(readFileSync(join(root,output),'utf8'),/Synthetic case 7/);
  rmSync(join(root,output)); // Each invocation must create the report itself.
 }
});

test('adding broad environment ignores preserves an existing example exception',t=>{
 for(const ignore of ['!.env.example\n','.env\n!.env.example\n']) {
   const root=project(t);put(root,'.gitignore',ignore);adopt(root);
   const git=(...args)=>spawnSync('git',args,{cwd:root,encoding:'utf8'});
   assert.equal(git('init','--initial-branch=fixture').status,0);
   assert.equal(git('check-ignore','--quiet','.env.example').status,1);
   assert.equal(git('check-ignore','--quiet','.env.local').status,0);
   assert(readFileSync(join(root,'.gitignore'),'utf8').startsWith(ignore));assert.equal(adopt(root).changes.length,0);
 }
});

// A minimal installed package copy for link tests: skills, digest lists, templates and VERSION.
function installedCopy(root) {
 for(const dir of ['.agents/skills','resources'])cpSync(join(packageRoot,dir),join(root,dir),{recursive:true});
 for(const file of ['VERSION','package.json','scripts/legacy-skill-hashes.json','scripts/redirect-skill-hashes.json','scripts/managed-digests.json']) {mkdirSync(dirname(join(root,file)),{recursive:true});cpSync(join(packageRoot,file),join(root,file));}
 return root;
}
const git=(root,...args)=>spawnSync('git',args,{cwd:root,encoding:'utf8'});
// The 3.0.x managed block exactly as released.
const releasedBlock='<!-- playwright-pom-harness -->\nUse the canonical skills discovered under `.agents/skills`. Resolve linked skills to their real package path for references. Keep package content immutable and consumer state under `.harness`. Preserve this project\'s existing instructions and code. Imported team libraries are derive-only.\n<!-- /playwright-pom-harness -->';
// The block that 3.1.0 development builds wrote, before the branch rule; projects set up from them update in place.
const prerelease310Block='<!-- playwright-pom-harness -->\nUse the harness skills linked under `.claude/skills` and `.agents/skills`; resolve linked skills to their real package path for references. To install, update or configure the harness, follow the `harness-setup` skill. If the harness skills are missing, run `npx --no pom-harness setup`. Keep package content immutable and consumer state under `.harness`. Preserve this project\'s existing instructions and code. Imported team libraries are derive-only.\n<!-- /playwright-pom-harness -->';

test('adoption without an environment links skills and creates no configuration',t=>{
 const root=project(t),result=adoptProject({projectRoot:root});
 assert.equal(result.environment,undefined);assert(!existsSync(join(root,'.harness/project.json')));assert(!existsSync(join(root,'.harness/targets.json')));
 assert.equal(realpathSync(join(root,'.claude/skills/test-data')),realpathSync(join(packageRoot,'.agents/skills/test-data')));
 assert.equal(adoptProject({projectRoot:root}).changes.length,0);
 assert.throws(()=>adoptProject({projectRoot:root,mode:'test'}),/environment identifier/);
 adoptProject({projectRoot:root,environment:'qa',mode:'protected'});assert.equal(loadEnvironment(consumerRoots(root)).environmentMode,'protected');
});
test('git sees no harness skill files behind the links, only the link record',t=>{
 const root=project(t);assert.equal(git(root,'init','--initial-branch=fixture').status,0);adopt(root);
 const staged=git(root,'add','-A','--dry-run').stdout;
 assert.deepEqual(staged.split('\n').filter(line=>/\.(?:agents|claude)\/skills\//.test(line)),[]);assert.match(staged,/\.harness\/links\.json/);
});
test('a CRLF checkout of every committed adoption file reruns without changes',t=>{
 const root=project(t);adopt(root);
 // core.autocrlf=true checks out every committed text file with CRLF.
 for(const file of ['AGENTS.md','CLAUDE.md','.gitignore','.harness/links.json','.harness/project.json','.harness/targets.json','resources/Queries/README.md','resources/apisCollections/README.md'])writeFileSync(join(root,file),readFileSync(join(root,file),'utf8').replaceAll('\n','\r\n'));
 assert.deepEqual(adopt(root).changes,[]);
});
test('an earlier released block is replaced in place; an edited block stops adoption',t=>{
 const root=project(t);put(root,'AGENTS.md',`Team rules\r\n\r\n${releasedBlock.replaceAll('\n','\r\n')}\r\n\r\nMore team rules\r\n`);adopt(root);
 const agents=readFileSync(join(root,'AGENTS.md'),'utf8');
 assert(agents.startsWith('Team rules\r\n\r\n<!-- playwright-pom-harness -->\r\n'));assert(agents.endsWith('\r\n\r\nMore team rules\r\n'));
 assert.match(agents,/harness-setup/);assert.doesNotMatch(agents,/discovered under `\.agents\/skills`\. Resolve/);
 const edited=project(t);put(edited,'CLAUDE.md',releasedBlock.replace('derive-only.','derive-only. Team addition.'));
 assert.throws(()=>adopt(edited),/edited harness instruction block in CLAUDE\.md/);assert(!existsSync(join(edited,'AGENTS.md')));
});
test('a pre-release 3.1.0 block is replaced in place by the block with the branch rule',t=>{
 const root=project(t);put(root,'CLAUDE.md',`Team rules\n\n${prerelease310Block}\n`);adopt(root);
 const claude=readFileSync(join(root,'CLAUDE.md'),'utf8');
 assert(claude.startsWith('Team rules\n\n<!-- playwright-pom-harness -->\n'));assert(claude.includes(INSTRUCTION_BLOCK));
 assert.match(claude,/Never commit or push directly to the default branch/);assert.equal(claude.split('<!-- playwright-pom-harness -->').length,2);
 assert.deepEqual(adopt(root).changes,[]);
});
test('links are repaired after a project move and from an old sibling clone; foreign links stop',t=>{
 const base=project(t),first=join(base,'first'),moved=join(base,'moved');mkdirSync(first);
 adoptProject({projectRoot:first,installedRoot:installedCopy(join(first,'node_modules/playwright-pom-harness'))});
 renameSync(first,moved);
 const installed=join(moved,'node_modules/playwright-pom-harness'),result=adoptProject({projectRoot:moved,installedRoot:installed});
 for(const dir of ['.agents/skills','.claude/skills'])for(const name of shipped)assert.equal(realpathSync(join(moved,dir,name)),realpathSync(join(installed,'.agents/skills',name)));
 // Windows junctions are absolute and dangle after a move; POSIX links are relative and survive it.
 assert.equal(result.links.filter(link=>link.kind==='repair').length,process.platform==='win32'?shipped.length*2:0);
 const sibling=installedCopy(join(base,'old-harness')),second=join(base,'second');mkdirSync(join(second,'.agents/skills'),{recursive:true});
 symlinkSync(join(sibling,'.agents/skills/test-data'),join(second,'.agents/skills/test-data'),'junction');
 assert.deepEqual(adoptProject({projectRoot:second}).links.filter(link=>link.kind==='repair').map(link=>link.path),['.agents/skills/test-data']);
 assert.equal(realpathSync(join(second,'.agents/skills/test-data')),realpathSync(join(packageRoot,'.agents/skills/test-data')));
 assert(existsSync(join(sibling,'.agents/skills/test-data/SKILL.md')),'Repair never touches the old target.');
 const third=join(base,'third'),foreign=join(base,'team-skills/test-data');mkdirSync(foreign,{recursive:true});writeFileSync(join(foreign,'SKILL.md'),'team skill');
 mkdirSync(join(third,'.agents/skills'),{recursive:true});symlinkSync(foreign,join(third,'.agents/skills/test-data'),'junction');
 assert.throws(()=>adoptProject({projectRoot:third}),/\.agents\/skills\/test-data links to something other than this harness/);
 assert.equal(readFileSync(join(foreign,'SKILL.md'),'utf8'),'team skill');
});
test('links of skills no longer shipped are removed; non-links at those paths are kept',t=>{
 const root=project(t);adopt(root);
 const record=JSON.parse(readFileSync(join(root,'.harness/links.json'),'utf8'));record.links.push('.agents/skills/retired-skill','.claude/skills/retired-skill');
 writeFileSync(join(root,'.harness/links.json'),JSON.stringify(record));
 const retired=join(root,'retired-target');mkdirSync(retired);symlinkSync(retired,join(root,'.agents/skills/retired-skill'),'junction');rmSync(retired,{recursive:true});
 put(root,'.claude/skills/retired-skill/SKILL.md','team-owned');
 const result=adopt(root);
 assert.deepEqual(result.links.filter(link=>link.kind==='remove').map(link=>link.path),['.agents/skills/retired-skill']);
 assert.equal(readFileSync(join(root,'.claude/skills/retired-skill/SKILL.md'),'utf8'),'team-owned');assert(result.reports.some(report=>report.includes('.claude/skills/retired-skill')));
});
test('a legacy folder holding tracked team data is kept and reported; untracked data folders become links',t=>{
 const root=project(t);assert.equal(git(root,'init','--initial-branch=fixture').status,0);
 put(root,'.claude/skills/plan-tracker/data/history.jsonl','{"at":"2026-09-30","set":{"todo":[7]}}\n');assert.equal(git(root,'add','.claude/skills/plan-tracker').status,0);
 put(root,'.claude/skills/framework-review/class-ledger.md','Untracked synthetic finding\n');
 const result=adopt(root);
 assert.equal(readFileSync(join(root,'.claude/skills/plan-tracker/data/history.jsonl'),'utf8'),readFileSync(join(root,'.harness/state/tracker/history.jsonl'),'utf8'));
 assert(result.reports.some(report=>report.startsWith('Kept .claude/skills/plan-tracker:')));assert(!result.removedFolders.includes('.claude/skills/plan-tracker'));
 assert.deepEqual(result.removedFolders,['.claude/skills/framework-review']);assert.equal(readFileSync(join(root,'.harness/state/review/class-ledger.md'),'utf8'),'Untracked synthetic finding\n');
 assert.equal(realpathSync(join(root,'.claude/skills/framework-review')),realpathSync(join(packageRoot,'.agents/skills/framework-review')));
 assert.equal(adopt(root).changes.length,0);
});
test('a committed copy of a harness skill stops with a git rm hint, and every conflict is reported together',t=>{
 const root=project(t);cpSync(join(packageRoot,'.agents/skills/test-data'),join(root,'.agents/skills/test-data'),{recursive:true});put(root,'.claude/skills/ROOTS.md','Team notes\n');
 assert.throws(()=>adopt(root),error=>error.conflicts?.length===2 && /committed copy of the harness skill; run "git rm -r --cached \.agents\/skills\/test-data"/.test(error.message) && /Review \.claude\/skills\/ROOTS\.md/.test(error.message));
 assert(!existsSync(join(root,'AGENTS.md')));assert.equal(readFileSync(join(root,'.claude/skills/ROOTS.md'),'utf8'),'Team notes\n');
});
test('the journal sees each file and link before it changes',t=>{
 const root=project(t),events=[];put(root,'AGENTS.md','Team rules\n');
 adoptProject({projectRoot:root,environment:'qa',mode:'test',journal:{file:(file,before)=>events.push(['file',file,before?.toString()??null]),link:(path,previous)=>events.push(['link',path,previous]),folder:path=>events.push(['folder',path])}});
 assert.deepEqual(events.find(event=>event[1]==='AGENTS.md'),['file','AGENTS.md','Team rules\n']);
 assert(events.some(event=>event[0]==='file' && event[1]==='.harness/links.json' && event[2]===null));
 assert.equal(events.filter(event=>event[0]==='link').length,shipped.length*2);
});
test('every redirect this repository still keeps is a recognized legacy file',()=>{
 // A source checkout keeps the redirects for its own sessions; the published package never ships them.
 const source=existsSync(join(packageRoot,'.git'));assert.equal(existsSync(join(packageRoot,'.claude/skills')),source);if(!source)return;
 const known=JSON.parse(readFileSync(join(packageRoot,'scripts/redirect-skill-hashes.json'),'utf8'));
 const files=readdirSync(join(packageRoot,'.claude/skills'),{recursive:true,withFileTypes:true}).filter(entry=>entry.isFile()).map(entry=>join(entry.parentPath,entry.name));
 assert(files.length>0);
 for(const file of files) {
  const key=relative(packageRoot,file).replaceAll('\\','/'),hash=createHash('sha256').update(readFileSync(file,'utf8').replaceAll('\r\n','\n')).digest('hex');
  assert((known[key]??[]).includes(hash),`${key} needs its digest in scripts/redirect-skill-hashes.json`);
 }
});
