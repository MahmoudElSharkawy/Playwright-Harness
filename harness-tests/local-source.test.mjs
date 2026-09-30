import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,relative,isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {validateConfiguration,loadEnvironment} from '../scripts/lib/project-config.mjs';
import {validateLocalSource,loadLocalSource} from '../scripts/lib/local-source.mjs';
import {adoptProject} from '../scripts/lib/adoption.mjs';
import {consumerRoots,packageRoot} from '../scripts/lib/consumer-paths.mjs';

const source=()=>({version:1,id:'local-demo',title:'Synthetic local suite',scenarios:[{id:'case-1',title:'A synthetic observation',steps:[{action:'Observe the synthetic page',expected:['Exact text remains unchanged','A second expectation']}],externalReferences:[{system:'team-tracker',id:'external-7'}]}]});
const config=mode=>({version:1,defaultEnvironment:'production-name',environments:{'production-name':{environmentMode:mode,apiTargets:[],databaseTargets:[]}}});
test('all three modes are explicit and independent of environment naming',()=>{
 for(const mode of ['test','protected','custom'])assert.equal(validateConfiguration(config(mode),{api:{},databases:{}}).project.environments['production-name'].environmentMode,mode);
 assert.throws(()=>validateConfiguration(config(undefined),{api:{},databases:{}}));
});
test('unknown targets, duplicate targets and unsupported configuration fields fail',()=>{
 for(const patch of [{apiTargets:['unknown']},{capabilities:{arbitraryShell:true}},{capabilities:{apiMutations:'yes'}}]) {
  const c=config('test');Object.assign(c.environments['production-name'],patch);assert.throws(()=>validateConfiguration(c,{api:{},databases:{}}));
 }
 const c=config('test');c.environments['production-name'].apiTargets=['web','web'];assert.throws(()=>validateConfiguration(c,{api:{web:{baseUrl:'https://api.example.test'}},databases:{}}));
});
test('destinations and credential references stay separate from profile selection',()=>{
 const c=config('protected');c.environments['production-name'].databaseTargets=['data'];
 const targets={api:{web:{baseUrl:'https://api.example.test/v1',credentialRef:'env:API_TOKEN'}},databases:{data:{engine:'sqlserver',connectionRef:'env:DB_CONNECTION',schema:'dbo'}}};
 assert.equal(validateConfiguration(c,targets).targets.databases.data.connectionRef,'env:DB_CONNECTION');
 for(const baseUrl of ['file:///tmp/target','https://'+'name:value@'+'example.test','https://api.example.test?secret=value'])assert.throws(()=>validateConfiguration(c,{...targets,api:{web:{baseUrl}}}));
 targets.databases.data.connectionRef='literal connection';assert.throws(()=>validateConfiguration(c,targets));
});
test('local source preserves every scenario, step, expectation and optional external identity',()=>{
 const input=source(),output=validateLocalSource(input);assert.deepEqual(output,input);output.scenarios[0].steps[0].expected[0]='Changed';assert.notDeepEqual(output,input);
 const noExternal=source();delete noExternal.scenarios[0].externalReferences;assert.deepEqual(validateLocalSource(noExternal),noExternal);
});
test('zero scope, duplicate identities, absent expectations and malformed fields fail',()=>{
 for(const change of [s=>s.scenarios=[],s=>s.scenarios.push(s.scenarios[0]),s=>s.scenarios[0].steps=[],s=>s.scenarios[0].steps[0].expected=[],s=>s.scenarios[0].steps[0].action='',s=>s.scenarios[0].unknown='x']) {const s=source();change(s);assert.throws(()=>validateLocalSource(s));}
});
test('local loading works without ADO, records source provenance and never overwrites output',t=>{
 const base=realpathSync(tmpdir()),root=mkdtempSync(join(base,'pom-local-'));t.after(()=>{const rel=relative(base,realpathSync(root));assert(!isAbsolute(rel)&&rel.startsWith('pom-local-'));rmSync(root,{recursive:true});});
 adoptProject({projectRoot:root,environment:'qa',mode:'test'});writeFileSync(join(root,'suite.json'),JSON.stringify(source()));
 const roots=consumerRoots(root),loaded=loadLocalSource(roots,'suite.json');assert.equal(loaded.source.kind,'local');assert.match(loaded.source.sha256,/^[a-f0-9]{64}$/);assert.throws(()=>loadEnvironment(roots,'unknown'));
 const args=[join(packageRoot,'scripts/load-local-source.mjs'),'--project-root',root,'--source','suite.json','--out','.harness/runs/source.json'];
 const run=spawnSync(process.execPath,args,{encoding:'utf8',env:{...process.env,AZURE_PAT:'',AZURE_DEVOPS_EXT_PAT:''}});assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(run.stdout),{status:'LOADED',environment:'qa',environmentMode:'test',scenarios:1,steps:1,expectations:2,executed:false});
 const before=readFileSync(join(root,'.harness/runs/source.json'),'utf8');assert.notEqual(spawnSync(process.execPath,args,{encoding:'utf8'}).status,0);assert.equal(readFileSync(join(root,'.harness/runs/source.json'),'utf8'),before);
});

test('source fingerprint matches parsed bytes and invalid/sensitive inputs are not echoed',t=>{
 const base=realpathSync(tmpdir()),root=mkdtempSync(join(base,'pom-local-'));
 t.after(()=>{const rel=relative(base,realpathSync(root));assert(!isAbsolute(rel)&&rel.startsWith('pom-local-'));rmSync(root,{recursive:true});});
 adoptProject({projectRoot:root,environment:'qa',mode:'test'});
 const file=join(root,'suite.json'),bytes=JSON.stringify(source(),null,3)+'\n';writeFileSync(file,bytes);
 assert.equal(loadLocalSource(consumerRoots(root),'suite.json').source.sha256,createHash('sha256').update(bytes).digest('hex'));
 const sensitive=source();sensitive.scenarios[0].steps[0].action=['Pwd','=', 'synthetic-value',';'].join('');
 for(const text of ['broken-json-private-marker',JSON.stringify(sensitive),' '.repeat(2*1024*1024+1)]) {
   writeFileSync(file,text);const result=spawnSync(process.execPath,[join(packageRoot,'scripts/load-local-source.mjs'),'--project-root',root,'--source','suite.json'],{encoding:'utf8'});
   assert.notEqual(result.status,0);assert.equal(result.stdout,'');assert.doesNotMatch(result.stderr,/private-marker|synthetic-value/);
 }
});
