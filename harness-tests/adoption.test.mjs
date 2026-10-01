import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync,symlinkSync,cpSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,dirname,relative,isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {adoptProject} from '../scripts/lib/adoption.mjs';
import {consumerRoots,consumerPath,packageRoot} from '../scripts/lib/consumer-paths.mjs';
import {loadEnvironment} from '../scripts/lib/project-config.mjs';

function project(t) {
 const base=realpathSync(tmpdir()),root=mkdtempSync(join(base,'pom-adopt-'));
 t.after(()=>{const rel=relative(base,realpathSync(root));assert(!isAbsolute(rel)&&rel.startsWith('pom-adopt-'));rmSync(root,{recursive:true});});return root;
}
function put(root,path,text){const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);}
const adopt=root=>adoptProject({projectRoot:root,environment:'qa',mode:'test'});
test('fresh onboarding requires deliberate profile; preview writes nothing',t=>{
 const root=project(t);assert.throws(()=>adoptProject({projectRoot:root,environment:'qa'}));assert.deepEqual(readdirSync(root),[]);
 const preview=adoptProject({projectRoot:root,environment:'qa',mode:'test',dryRun:true});assert.equal(preview.skills,13);assert.deepEqual(readdirSync(root),[]);
});
test('adoption links 13 canonical skills, initializes consumer state and is idempotent',t=>{
 const root=project(t),result=adopt(root);assert.equal(result.skills,13);
 for(const name of readdirSync(join(root,'.agents/skills')))assert.equal(realpathSync(join(root,'.agents/skills',name)),realpathSync(join(packageRoot,'.agents/skills',name)));
 assert(existsSync(join(root,'.harness/state/tracker/history.jsonl')));assert.equal(adopt(root).changes.length,0);
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
 put(root,'.claude/skills/framework-review/class-ledger.md','Reviewed synthetic finding\n');put(root,'.agentex/page-map/login.md','Reviewed synthetic page\n');adopt(root);
 assert.equal(readFileSync(join(root,'.harness/state/tracker/history.jsonl'),'utf8'),readFileSync(join(root,legacy),'utf8'));
 assert.equal(readFileSync(join(root,'.harness/knowledge/ui/login.md'),'utf8'),'Reviewed synthetic page\n');
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
 const root=project(t);adopt(root);put(root,'.harness/state/tracker/plan-7.json',JSON.stringify({planId:7,names:[],branches:[{name:'Synthetic',inScope:true}],suites:[{branch:0,id:10,name:'Synthetic',cases:[{id:7,title:'Synthetic case',desc:'fixture',verdict:'k',note:''}]}],manual:{},bugs:{}}));
 put(root,'test/ado-story-300/_suite.json',JSON.stringify({storyId:300,cases:[{id:7}]}));put(root,'test/ado-story-300/_verify-state.json',JSON.stringify({cases:{7:{status:'passed',greens:2}}}));
 put(root,'test/ado-other-300/_verify-state.json',JSON.stringify({cases:{8:{status:'passed',greens:2}}}));
 const metrics=spawnSync(process.execPath,[join(packageRoot,'scripts/harness-metrics.mjs'),'--project-root',root,'--json'],{encoding:'utf8'});assert.equal(metrics.status,0,metrics.stderr);
 assert.deepEqual(JSON.parse(metrics.stdout).suites.map(s=>[s.suite,s.passed]),[['ado-story-300',1]]);
 const sync=spawnSync(process.execPath,[join(packageRoot,'scripts/generate-tracker.mjs'),'--project-root',root,'--sync','--dry-run'],{encoding:'utf8'});assert.equal(sync.status,0,sync.stderr);assert.match(sync.stdout,/"set":\{"done":\[7\]\}/);
});

test('recognized legacy instructions become redirects; originals need an exact normalized digest',t=>{
 const root=project(t),installed=project(t);
 for(const dir of ['.agents/skills','.claude/skills','resources'])cpSync(join(packageRoot,dir),join(installed,dir),{recursive:true});
 put(installed,'VERSION','3.0.3\n');
 const file='.claude/skills/action-methods/SKILL.md',original='Synthetic original convention\n';
 put(root,file,original.replaceAll('\n','\r\n'));
 put(installed,'scripts/legacy-skill-hashes.json',JSON.stringify({[file]:createHash('sha256').update(original).digest('hex')}));
 adoptProject({projectRoot:root,installedRoot:installed,environment:'qa',mode:'test'});
 assert.equal(readFileSync(join(root,file),'utf8'),readFileSync(join(installed,file),'utf8'));
 assert.equal(realpathSync(join(root,'.agents/skills/action-methods')),realpathSync(join(installed,'.agents/skills/action-methods')));
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
