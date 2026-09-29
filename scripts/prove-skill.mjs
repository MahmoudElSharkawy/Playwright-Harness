#!/usr/bin/env node
// Focused M2 proof tooling. No browser commands, workflow engine or production host adapter.
import {readFileSync,writeFileSync,mkdirSync,cpSync,readdirSync,existsSync,realpathSync} from 'node:fs';
import {resolve,join,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {inventory} from './lib/package-validation.mjs';
import {resolveSkillRoots,linkRepresentativeSkill} from './lib/skill-roots.mjs';
import {parseEvents,assessHost,semanticParity} from './lib/skill-proof-assessment.mjs';

const sourceRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const schema={type:'object',additionalProperties:false,properties:{choices:{type:'array',items:{type:'object',additionalProperties:false,properties:{caseId:{type:'string'},strategy:{type:'string',enum:['id','name','test-attribute','scoped-dynamic','collection','raw-file-input']},locatorName:{type:'string'},private:{type:'boolean'},usesIndex:{type:'boolean'},reason:{type:'string'}},required:['caseId','strategy','locatorName','private','usesIndex','reason']}},referencesRead:{type:'array',items:{type:'string'}}},required:['choices','referencesRead']};
function snapshot(root) {
 const records=[];function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isSymbolicLink())throw new Error('package contains link');if(e.isDirectory())walk(p);else records.push([relative(root,p).replaceAll('\\','/'),createHash('sha256').update(readFileSync(p)).digest('hex')]);}}walk(root);return records.sort((a,b)=>a[0].localeCompare(b[0]));
}
function load(stateFile){const state=JSON.parse(readFileSync(stateFile,'utf8'));state.roots=resolveSkillRoots(state.roots);return state;}
function prepare() {
 const workspace=join(sourceRoot,'.validation/m2',randomUUID());
 const packageRoot=join(workspace,'package'),projectRoot=join(workspace,'consumer'),runRoot=join(projectRoot,'.harness/runs/locator-proof');
 mkdirSync(packageRoot,{recursive:true});mkdirSync(projectRoot);mkdirSync(runRoot,{recursive:true});
 const scope=inventory(sourceRoot);if(scope.unexpected.length)throw new Error('unclassified publication source');
 for(const file of scope.files){const dest=join(packageRoot,file);mkdirSync(dirname(dest),{recursive:true});cpSync(join(sourceRoot,file),dest);}
 const roots=resolveSkillRoots({packageRoot,projectRoot,runRoot});linkRepresentativeSkill(roots);
 writeFileSync(join(projectRoot,'AGENTS.md'),'This is an isolated read-only locator proof. Use the discovered skill. Do not change files, execute a browser, contact test systems, or search outside the provided package and project.\n');
 writeFileSync(join(projectRoot,'CLAUDE.md'),'This is an isolated read-only locator proof. Load the supplied plugin skill. Do not edit files or contact test systems.\n');
 cpSync(join(sourceRoot,'harness-tests/fixtures/locator-proof.json'),join(projectRoot,'locator-cases.json'));
 const git=spawnSync('git',['init','--initial-branch=proof'],{cwd:projectRoot,encoding:'utf8'});if(git.status!==0)throw new Error('consumer Git boundary creation failed');
 writeFileSync(join(runRoot,'output-schema.json'),JSON.stringify(schema));
 const state={roots,before:snapshot(packageRoot),sourceSkillHash:createHash('sha256').update(readFileSync(join(sourceRoot,'.agents/skills/element-locators/SKILL.md'))).digest('hex')};
 const stateFile=join(runRoot,'proof-state.json');writeFileSync(stateFile,JSON.stringify(state,null,2));
 console.log(JSON.stringify({stateFile,packageFiles:state.before.length}));
}
async function discover(state,executable) {
 const child=spawn(executable,['app-server','--stdio'],{cwd:state.roots.projectRoot,stdio:['pipe','pipe','pipe'],windowsHide:true});
 const pending=new Map();let sequence=0;const lines=createInterface({input:child.stdout});
 child.stderr.resume();
 const request=(method,params)=>new Promise((resolve,reject)=>{const id=sequence++;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
 lines.on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}const p=pending.get(m.id);if(!p)return;pending.delete(m.id);if(m.error)p.reject(new Error('native discovery rejected request'));else p.resolve(m.result);});
 child.on('error',()=>{for(const p of pending.values())p.reject(new Error('native host unavailable'));});
 child.on('exit',()=>{for(const p of pending.values())p.reject(new Error('native discovery host exited'));});
 const timer=setTimeout(()=>child.kill(),30000);
 try {
   await request('initialize',{clientInfo:{name:'pom_m2_proof',version:'3.0.2'}});child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
   const result=await request('skills/list',{cwds:[state.roots.projectRoot],forceReload:true});
   writeFileSync(join(state.roots.runRoot,'codex-discovery-raw.json'),JSON.stringify(result,null,2));
   const entries=result.data??[];const found=entries.flatMap(e=>e.skills??[]).filter(s=>['element-locators','playwright-pom-harness:element-locators'].includes(s.name) && s.enabled!==false);
   const errors=entries.flatMap(e=>e.errors??[]);
   writeFileSync(join(state.roots.runRoot,'codex-discovery.json'),JSON.stringify({found,errors},null,2));
   if(found.length!==1 || errors.length)throw new Error('native skill discovery was missing, ambiguous or invalid');
   if(realpathSync(found[0].path)!==realpathSync(join(state.roots.packageRoot,'.agents/skills/element-locators/SKILL.md')))throw new Error('discovered a different skill');
   console.log(JSON.stringify({check:'native-codex-discovery',status:'PASS',matches:found.length}));
 } finally {clearTimeout(timer);lines.close();child.stdin.end();child.kill();}
}
function prompt(host,state) {
 const discovered=host==='codex'?JSON.parse(readFileSync(join(state.roots.runRoot,'codex-discovery.json'),'utf8')).found[0].name:null;
 const invoke=host==='codex'?'$'+discovered:'/playwright-pom-harness:element-locators';
 return `${invoke}\nUse the discovered skill. Explicitly read its canonical SKILL.md file and required references to decide the six cases in locator-cases.json, even if the host already expanded the skill instructions. This is read-only: do not edit files, run browsers, call APIs/databases or use web tools. Return only the requested structured choices and package-relative paths of references you actually read. For each case, use one strategy from the schema, an appropriate locatorName, private=true or false, usesIndex=true or false, and a short reason. Resolve linked skill paths to their real directory when locating references. Do not guess unavailable references; report any inability in the reason. Package/project/run root conventions are part of the proof, not permission to write package content.`;
}
async function runHost(state,host,executable,model) {
 const {packageRoot,projectRoot,runRoot}=state.roots;
 const args=host==='codex'?['exec','--ignore-user-config','--ephemeral','--sandbox','read-only',...(process.platform==='win32'?['-c','windows.sandbox="elevated"']:[]),'-c','web_search="disabled"','-C',projectRoot,'--json','--output-schema',join(runRoot,'output-schema.json'),'-o',join(runRoot,'codex-answer.json'),'-']
 :['--print',...(model?['--model',model]:[]),'--setting-sources','user','--settings',JSON.stringify({disableAllHooks:true}),'--strict-mcp-config','--tools','Read,Glob,Grep,Skill','--allowedTools','Read,Glob,Grep,Skill','--permission-prompts','none','--no-session-persistence','--plugin-dir',packageRoot,'--add-dir',packageRoot,'--output-format','stream-json','--verbose','--json-schema',JSON.stringify(schema)];
 const out=join(runRoot,`${host}-events.jsonl`),err=join(runRoot,`${host}-stderr.txt`);
 if(existsSync(out) || existsSync(join(runRoot,`${host}-process.json`)))throw new Error('prepare a fresh proof instead of overwriting attempt history');
 writeFileSync(out,'');writeFileSync(err,'');
 const child=spawn(executable,args,{cwd:projectRoot,windowsHide:true,stdio:['pipe','pipe','pipe']});
 child.stdout.on('data',chunk=>writeFileSync(out,chunk,{flag:'a'}));child.stderr.on('data',chunk=>writeFileSync(err,chunk,{flag:'a'}));
 child.stdin.end(prompt(host,state));
 let timedOut=false;
 const timeout=setTimeout(()=>{timedOut=true;child.kill();},240000);
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});clearTimeout(timeout);
 const unchanged=JSON.stringify(snapshot(packageRoot))===JSON.stringify(state.before);
 writeFileSync(join(runRoot,`${host}-process.json`),JSON.stringify({exitCode:code,timedOut,packageUnchanged:unchanged,modelOverride:model??null}));
 if(code!==0 || !unchanged)throw new Error('native run failed or package changed; inspect consumer run evidence');
 console.log(JSON.stringify({host,status:'PROCESS_COMPLETED',packageUnchanged:unchanged}));
}
function assess(state) {
 const {runRoot,packageRoot}=state.roots;const reports=[];
 for(const host of ['codex','claude']) {
  const processFile=join(runRoot,`${host}-process.json`);if(!existsSync(processFile)){reports.push({host,status:'UNPERFORMED'});continue;}
  try {
   const processResult=JSON.parse(readFileSync(processFile,'utf8'));
   const events=parseEvents(readFileSync(join(runRoot,`${host}-events.jsonl`),'utf8'));
   const answerFile=join(runRoot,'codex-answer.json');
   const answer=host==='codex'?(existsSync(answerFile)?JSON.parse(readFileSync(answerFile,'utf8')):undefined):events.findLast(e=>e.type==='result')?.structured_output;
   const discovery=host==='codex'?JSON.parse(readFileSync(join(runRoot,'codex-discovery.json'),'utf8')):undefined;
   reports.push(assessHost({host,answer,events,processResult,roots:state.roots,packageUnchanged:JSON.stringify(snapshot(packageRoot))===JSON.stringify(state.before),discovery}));
  } catch {reports.push({host,status:'FAIL',reason:'missing or invalid evidence'});}
 }
 const parity=semanticParity(reports);
 const report={status:parity?'PASS':'INCOMPLETE',semanticParity:parity,hosts:reports};writeFileSync(join(runRoot,'assessment.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!parity)process.exitCode=1;
}
try {
 const [command,stateFile,executable,model]=process.argv.slice(2);
 if(process.argv.length>6 || (model && command!=='claude'))throw new Error('model override is only supported for the Claude proof');
 if(command==='prepare')prepare();else {const state=load(stateFile);if(command==='discover')await discover(state,executable||'codex');else if(['codex','claude'].includes(command))await runHost(state,command,executable||command,model);else if(command==='assess')assess(state);else throw new Error('unknown proof command');}
} catch {console.error('Skill proof did not complete; inspect only the consumer run evidence. No source excerpts emitted.');process.exitCode=2;}
