#!/usr/bin/env node
// Fixed M4 experiment using the public native CLI. This is not an executor API.
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,readdir,rm,chmod} from 'node:fs/promises';
import {dirname,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {startFixture} from './fixture.mjs';
import {classifyReply,assessProbe,requiredChecks,pin} from './assessment.mjs';
import {prepareOutput,resolvePackageRoot,snapshotPackage} from './output.mjs';
import {nativeEnvironment,verifyNativeProfile} from './profile.mjs';
import {verifyRequiredEvidence} from './evidence.mjs';

const spikeRoot=dirname(fileURLToPath(import.meta.url));
const packageRoot=await resolvePackageRoot(spikeRoot);
const cli=join(spikeRoot,'node_modules/@playwright/cli/playwright-cli.js');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const outputArgument=process.argv[2];
if(!outputArgument || process.argv.length!==3 || !['win32','linux'].includes(process.platform))throw new Error('usage: node probe.mjs <new ignored output directory>; Windows or Linux required');
const fault=process.env.M4_PROBE_FAULT??null;
if(fault!==null && !['sentinel-crash','cleanup-failure'].includes(fault))throw new Error('unsupported fixed M4 fault probe');
let env;
try {env=await nativeEnvironment();}catch {console.error(JSON.stringify({status:'BLOCKED',reason:'M4 requires neutral native configuration: no Playwright overrides or existing global CLI config; values are not read or logged'}));process.exit(2);}
const runRoot=await prepareOutput(packageRoot,outputArgument);

async function processCall(executable,args,{deadline=30000,cwd=runRoot,env=process.env}={}) {
  return await new Promise(resolve=>{
    let stdout='',stderr='',timedOut=false,spawnError;
    const child=spawn(executable,args,{cwd,env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const timer=setTimeout(()=>{timedOut=true;child.kill();},deadline);
    child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
    child.once('error',error=>{spawnError=error.code;});
    child.once('close',(exitCode,signal)=>{clearTimeout(timer);resolve({stdout,stderr,exitCode,signal,timedOut,spawnError});});
  });
}

// Synthetic state and native raw diagnostic output remain in a private, ignored run.
if(process.platform==='win32') {
  const identity=await processCall('whoami',[]);
  assert.equal(identity.exitCode,0,'cannot resolve runtime storage owner');
  const acl=await processCall('icacls',[runRoot,'/inheritance:r','/grant:r',`${identity.stdout.trim()}:(OI)(CI)F`]);
  assert.equal(acl.exitCode,0,'cannot restrict runtime storage');
} else await chmod(runRoot,0o700);

await mkdir(join(runRoot,'private'),{mode:0o700});
await mkdir(join(runRoot,'evidence'),{mode:0o700});
await mkdir(join(runRoot,'raw'),{mode:0o700});
const report={platform:process.platform,node:process.version,pin:{...pin,lockSha256:sha(await readFile(join(spikeRoot,'package-lock.json')))},checks:[],events:[],artifacts:[],attachment:'disabled; borrowed resources are outside this owned-only spike'};
const nonce=randomBytes(6).toString('hex');
const sessions={a:`m4_${nonce}_a`,b:`m4_${nonce}_b`,restore:`m4_${nonce}_restore`,deadline:`m4_${nonce}_deadline`,crash:`m4_${nonce}_crash`};
const owned=new Map();
let finalizing=false,injectedCleanupFailure=false;
const config=join(runRoot,'cli.json');
await writeFile(config,JSON.stringify({browser:{browserName:'chromium',isolated:true,launchOptions:{headless:true,channel:'chrome-for-testing',...(process.platform==='linux'?{chromiumSandbox:false}:{})}},timeouts:{action:1200,navigation:1800},outputDir:join(runRoot,'evidence')}));
try {report.profile=await verifyNativeProfile(spikeRoot,config,runRoot,env);}catch {console.error(JSON.stringify({status:'BLOCKED',reason:'Pinned native profile preflight failed before browser launch; no raw configuration emitted'}));process.exit(2);}
report.checks.push({name:'native-profile',status:'PASS',observation:'Pinned native resolver verified owned isolated headless Chromium, neutral native configuration and protected evidence output before launch.'});
console.log(JSON.stringify(report.checks.at(-1)));
const fixture=await startFixture();

async function inventory(directory) {
  const result=[];
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const path=join(directory,entry.name);
    if(entry.isDirectory())result.push(...await inventory(path));
    else if(entry.isFile())result.push(path);
  }
  return result.sort();
}
async function packageDigest() {
  return await snapshotPackage(packageRoot,spikeRoot);
}
const beforePackage=await packageDigest();

async function invoke(session,args,deadline=30000) {
  if(args[0]==='open')await verifyNativeProfile(spikeRoot,config,runRoot,env);
  const number=report.events.length+1;
  const started=performance.now();
  const reply=await processCall(process.execPath,[cli,'--json',`-s=${session}`,...args],{env,deadline});
  await writeFile(join(runRoot,'raw',`${number}.json`),JSON.stringify(reply),{mode:0o600});
  const assessed=classifyReply(reply);
  report.events.push({number,command:args[0],exitCode:reply.exitCode,kind:assessed.kind,durationMs:Math.round(performance.now()-started)});
  return {...reply,...assessed};
}
function expectOk(reply,label) {assert.equal(reply.kind,'OK',label);return reply.payload;}
function expectError(reply,label) {assert.ok(['CLI_ERROR','PROCESS_FAILURE'].includes(reply.kind),label);}
async function check(name,action) {
  try {const observation=await action();report.checks.push({name,status:'PASS',observation});}
  catch(error) {await writeFile(join(runRoot,'raw',`failure-${name}.json`),JSON.stringify({message:error.message,stack:error.stack}),{mode:0o600});report.checks.push({name,status:'FAIL',observation:`Probe assertion failed: ${error.code??error.name}. Consult protected raw output.`});}
  console.log(JSON.stringify(report.checks.at(-1)));
}
async function processes() {
  if(process.platform==='win32') {
    const reply=await processCall('powershell.exe',['-NoProfile','-NonInteractive','-Command','Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,@{Name="Identity";Expression={$_.CreationDate.ToFileTimeUtc().ToString()}} | ConvertTo-Json -Compress']);
    assert.equal(reply.exitCode,0,'cannot inspect owned process identities');
    return JSON.parse(reply.stdout).map(p=>({pid:p.ProcessId,parent:p.ParentProcessId,identity:p.Identity}));
  }
  const result=[];
  for(const name of await readdir('/proc'))if(/^\d+$/.test(name)) {
    try {
      const value=await readFile(`/proc/${name}/stat`,'utf8');
      const fields=value.slice(value.lastIndexOf(')')+2).split(' ');
      if(fields[0]!=='Z')result.push({pid:Number(name),parent:Number(fields[1]),identity:fields[19]});
    } catch(error) {if(!['ENOENT','ESRCH'].includes(error.code))throw error;}
  }
  return result;
}
async function rememberTree(session,pid) {
  assert.ok(Number.isSafeInteger(pid) && pid>0,'missing native daemon identity');
  const all=await processes();
  const tree=all.filter(p=>p.pid===pid);
  assert.equal(tree.length,1,'daemon identity unavailable');
  for(let i=0;i<tree.length;i++)tree.push(...all.filter(p=>p.parent===tree[i].pid && !tree.some(q=>q.pid===p.pid)));
  owned.set(session,{pid,tree});
}
async function terminateKnown(record) {
  const active=await processes();
  for(const item of [...record.tree].reverse())if(active.some(p=>p.pid===item.pid && p.identity===item.identity)) {
    try {process.kill(item.pid,'SIGKILL');}catch(error) {if(error.code!=='ESRCH')throw error;}
  }
}
async function refreshTree(record) {
  const all=await processes();
  const active=record.tree.filter(item=>all.some(p=>p.pid===item.pid && p.identity===item.identity));
  for(let i=0;i<active.length;i++)active.push(...all.filter(p=>p.parent===active[i].pid && !active.some(q=>q.pid===p.pid)));
  for(const item of active)if(!record.tree.some(p=>p.pid===item.pid && p.identity===item.identity))record.tree.push(item);
}
async function treeGone(record) {
  for(let i=0;i<20;i++) {
    const active=await processes();
    if(!record.tree.some(item=>active.some(p=>p.pid===item.pid && p.identity===item.identity)))return true;
    await delay(100);
  }
  return false;
}
async function closeOwned(session) {
  const record=owned.get(session);
  const failures=[];
  try {if(record)await refreshTree(record);}catch(error) {failures.push(error);}
  try {
    if(finalizing && fault==='cleanup-failure' && session===sessions.restore && !injectedCleanupFailure) {injectedCleanupFailure=true;throw new Error('Injected close-stage failure');}
    expectOk(await invoke(session,['close']),'native owned close failed');
  } catch(error) {failures.push(error);}
  try {
    if(record && !await treeGone(record))await terminateKnown(record);
    if(record)assert.ok(await treeGone(record),'owned process survived scoped cleanup');
  } catch(error) {failures.push(error);}
  try {expectOk(await invoke(session,['delete-data']),'native owned data cleanup failed');}catch(error) {failures.push(error);}
  assert.equal(failures.length,0,'owned cleanup stage failure');
}
async function snap(session,filename) {
  expectOk(await invoke(session,['snapshot',`--filename=${join(runRoot,'evidence',filename)}`]),'native snapshot failed');
  return await readFile(join(runRoot,'evidence',filename),'utf8');
}
function ref(snapshot,label) {
  const line=snapshot.split('\n').find(line=>line.includes(label));
  const value=line?.match(/\[ref=([^\]]+)\]/)?.[1];
  assert.ok(value,`no current snapshot reference for ${label}`);return value;
}
async function observe(session,expression) {
  const result=expectOk(await invoke(session,['eval',expression]),'native observation failed').result;
  assert.equal(typeof result,'string','pinned eval result must be serialized JSON');
  return JSON.parse(result);
}
const statePath=join(runRoot,'private','synthetic-state.json');

try {
  await check('version-pin',async()=>{
    const reply=await processCall(process.execPath,[cli,'--version'],{env});
    assert.equal(reply.exitCode,0);assert.equal(reply.stdout.trim(),pin.cli);
    assert.equal(JSON.parse(await readFile(join(spikeRoot,'node_modules/@playwright/cli/package.json'),'utf8')).version,pin.cli);
    assert.equal(JSON.parse(await readFile(join(spikeRoot,'node_modules/playwright/package.json'),'utf8')).version,pin.playwright);
    assert.equal(JSON.parse(await readFile(join(spikeRoot,'node_modules/playwright-core/package.json'),'utf8')).version,pin.playwright);
    return `CLI ${pin.cli}; Playwright ${pin.playwright}; resolved lock SHA-256 recorded.`;
  });
  await check('named-session-isolation',async()=>{
    const a=expectOk(await invoke(sessions.a,['open',`${fixture.origin}/?a=one&b=two`,`--config=${config}`]),'open A failed');await rememberTree(sessions.a,a.pid);
    const b=expectOk(await invoke(sessions.b,['open',`${fixture.origin}/dashboard`,`--config=${config}`]),'open sentinel failed');await rememberTree(sessions.b,b.pid);
    assert.equal(await observe(sessions.a,'document.querySelector("#query").textContent'),'?a=one&b=two');
    assert.equal(await observe(sessions.b,'document.querySelector("h1").textContent'),'Sign in required');
    assert.notEqual(a.pid,b.pid);
    return 'Two distinct named daemons; URL with & and paths with spaces preserved; sentinel remains unauthenticated.';
  });
  await check('snapshot-current-reference',async()=>{
    const initial=await snap(sessions.a,'initial.yml');
    const increment=ref(initial,'button "Increment counter"');
    expectOk(await invoke(sessions.a,['click',increment]),'fresh reference click failed');
    assert.equal(await observe(sessions.a,'document.querySelector("#count").textContent'),'1');
    expectOk(await invoke(sessions.a,['eval','document.querySelector("#increment").outerHTML="<button id=increment type=button>Replacement</button>"']),'DOM replacement failed');
    expectError(await invoke(sessions.a,['click',increment]),'stale reference unexpectedly accepted');
    const refreshed=await snap(sessions.a,'refreshed.yml');
    expectOk(await invoke(sessions.a,['click',ref(refreshed,'button "Replacement"')]),'refreshed reference failed');
    return 'Current snapshot references drive actions; removed-element reference fails; fresh snapshot reference works.';
  });
  await check('evidence-capture',async()=>{
    expectOk(await invoke(sessions.a,['goto',`${fixture.origin}/`]),'public reset failed');
    expectOk(await invoke(sessions.a,['tracing-start']),'trace start failed');
    expectOk(await invoke(sessions.a,['goto',`${fixture.origin}/?trace=synthetic`]),'trace navigation failed');
    expectOk(await invoke(sessions.a,['click',ref(await snap(sessions.a,'trace-page.yml'),'button "Increment counter"')]),'trace action failed');
    expectOk(await invoke(sessions.a,['screenshot',`--filename=${join(runRoot,'evidence','page.png')}`]),'screenshot failed');
    expectOk(await invoke(sessions.a,['console']),'console capture failed');
    expectOk(await invoke(sessions.a,['requests']),'request capture failed');
    expectOk(await invoke(sessions.a,['tracing-stop']),'trace stop failed');
    const files=await inventory(join(runRoot,'evidence'));
    verifyRequiredEvidence(new Map(await Promise.all(files.map(async file=>[relative(runRoot,file).replaceAll('\\','/'),await readFile(file)]))));
    for(const file of files) {const bytes=await readFile(file);assert.ok(bytes.length>0,'empty evidence');report.artifacts.push({path:relative(runRoot,file).replaceAll('\\','/'),bytes:bytes.length,sha256:sha(bytes)});}
    return 'Native PNG, snapshots, trace/DOM and network resources are nonempty; relative locations and integrity hashes recorded.';
  });
  await check('state-restore-actual-session',async()=>{
    const login=await snap(sessions.a,'login.yml');
    expectOk(await invoke(sessions.a,['fill',ref(login,'textbox "Account label"'),'Synthetic M4 account']),'fill failed');
    expectOk(await invoke(sessions.a,['click',ref(login,'button "Sign in"')]),'login failed');
    assert.equal(await observe(sessions.a,'document.querySelector("h1").textContent'),'Authenticated fixture');
    expectOk(await invoke(sessions.a,['state-save',statePath]),'state save failed');
    await chmod(statePath,0o600);
    const state=JSON.parse(await readFile(statePath,'utf8'));
    assert.ok(state.cookies.some(cookie=>cookie.name==='m4-session' && cookie.httpOnly));
    assert.ok(state.origins.some(origin=>origin.localStorage.some(item=>item.name==='m4-label')));
    await closeOwned(sessions.a);
    const restored=expectOk(await invoke(sessions.restore,['open','about:blank',`--config=${config}`]),'restore session open failed');await rememberTree(sessions.restore,restored.pid);
    expectOk(await invoke(sessions.restore,['state-load',statePath]),'state load failed');
    expectOk(await invoke(sessions.restore,['goto',`${fixture.origin}/dashboard`]),'restored navigation failed');
    assert.equal(await observe(sessions.restore,'document.querySelector("h1").textContent'),'Authenticated fixture');
    assert.equal(await observe(sessions.restore,'document.querySelector("#label").textContent'),'Synthetic M4 account');
    assert.equal(fixture.counts.logins,1,'restore performed another login');
    expectOk(await invoke(sessions.b,['goto',`${fixture.origin}/dashboard`]),'sentinel navigation failed');
    assert.equal(await observe(sessions.b,'document.querySelector("h1").textContent'),'Sign in required');
    assert.equal(await observe(sessions.b,'localStorage.getItem("m4-label")'),null);
    return 'Saved HttpOnly cookie and local storage restored into a newly opened named session; authenticated page verified without another login; sentinel isolated.';
  });
  await check('native-error-exit',async()=>{
    for(const args of [['not-a-command'],['click','#absent'],['eval','() => { throw new Error("Synthetic observation failure"); }']])expectError(await invoke(sessions.b,args),'native error misclassified');
    expectError(await invoke(sessions.a,['snapshot']),'closed session accepted a command');
    return 'Unknown command, missing target, evaluation error and closed-session error retained as failures, including nonzero exits.';
  });
  await check('native-timeout',async()=>{
    const reply=await invoke(sessions.b,['goto',`${fixture.origin}/slow`]);
    expectError(reply,'native navigation timeout was lost');assert.match(reply.payload?.error??reply.stderr,/Timeout|timeout/);
    expectOk(await invoke(sessions.b,['goto',`${fixture.origin}/dashboard`]),'post-timeout navigation failed');
    return 'Configured native navigation timeout fails explicitly; subsequent nonmutating navigation succeeds without erasing failure.';
  });
  await check('outer-deadline',async()=>{
    const opened=expectOk(await invoke(sessions.deadline,['open','about:blank',`--config=${config}`]),'deadline session open failed');await rememberTree(sessions.deadline,opened.pid);
    const code=`async page => { await page.goto(${JSON.stringify(fixture.origin+'/deadline-entered')}); await page.waitForTimeout(10000); }`;
    const reply=await invoke(sessions.deadline,['run-code',code],1800);
    assert.equal(reply.kind,'TIMEOUT');assert.ok(fixture.counts.deadlineEntered>0,'deadline expired before dispatch');
    const record=owned.get(sessions.deadline);
    await refreshTree(record);await terminateKnown(record);assert.ok(await treeGone(record),'deadline process tree still running');
    await closeOwned(sessions.deadline);
    return 'External process deadline expires after confirmed dispatch; only the owned child/daemon/browser tree is stopped.';
  });
  await check('daemon-crash',async()=>{
    const opened=expectOk(await invoke(sessions.crash,['open',`${fixture.origin}/`,`--config=${config}`]),'crash session open failed');await rememberTree(sessions.crash,opened.pid);
    await refreshTree(owned.get(sessions.crash));
    process.kill(opened.pid,'SIGKILL');await delay(200);
    expectError(await invoke(sessions.crash,['snapshot']),'crashed daemon reported success');
    await closeOwned(sessions.crash);
    const reopened=expectOk(await invoke(sessions.crash,['open',`${fixture.origin}/`,`--config=${config}`]),'explicit crash reopen failed');await rememberTree(sessions.crash,reopened.pid);
    assert.ok((await snap(sessions.crash,'after-crash.yml')).includes('Public fixture'));
    await closeOwned(sessions.crash);
    return 'Killed owned daemon produces an explicit command failure; scoped process cleanup and explicit fresh reopen both verified.';
  });
  await check('stale-authentication',async()=>{
    expectOk(await invoke(sessions.restore,['goto',`${fixture.origin}/expire`]),'fixture expiration failed');
    expectOk(await invoke(sessions.restore,['goto',`${fixture.origin}/dashboard`]),'expired navigation failed');
    assert.equal(await observe(sessions.restore,'document.querySelector("h1").textContent'),'Sign in required');
    assert.equal(fixture.counts.logins,1);
    return 'Server-revoked saved authentication yields the unauthenticated page; no hidden refresh/login or success claim.';
  });
} finally {
  finalizing=true;
  await check('owned-cleanup',async()=>{
    // Capture the sentinel observation before disposing it. Never use global close/kill.
    const errors=[];
    try {
      if(fault==='sentinel-crash') {
        const record=owned.get(sessions.b);
        if(record) {await refreshTree(record);process.kill(record.pid,'SIGKILL');await delay(200);}
      }
    } catch(error) {errors.push(error);}
    let sentinelAlive;
    try {sentinelAlive=await observe(sessions.b,'document.querySelector("h1").textContent');}catch(error) {errors.push(error);}
    for(const session of Object.values(sessions))try {await closeOwned(session);}catch(error) {errors.push(error);}
    let stopped=true;
    for(const record of owned.values())try {
      if(!await treeGone(record))await terminateKnown(record);
      if(!await treeGone(record))stopped=false;
    } catch(error) {stopped=false;errors.push(error);}
    let authRemoved=false,fixtureClosed=false;
    try {await rm(statePath,{force:true});authRemoved=true;}catch(error) {errors.push(error);}
    try {await fixture.close();fixtureClosed=true;}catch(error) {errors.push(error);}
    try {expectOk(await invoke(sessions.b,['close']),'second owned close not idempotent');}catch(error) {errors.push(error);}
    report.cleanup={attemptedNames:Object.values(sessions).length,recordedTrees:owned.size,processTreesStopped:stopped,authenticationStateRemoved:authRemoved,fixtureClosed,failures:errors.length,faultInjection:fault};
    assert.equal(sentinelAlive,'Sign in required','sentinel affected by other session cleanup');
    assert.equal(errors.length,0,'native cleanup failure');
    assert.ok(stopped,'process leak');
    return `All ${owned.size} owned session trees stopped; sentinel survived other cleanup; repeated close succeeds; temporary authentication state deleted.`;
  });
  await check('package-immutable',async()=>{const after=await packageDigest();assert.deepEqual(after,beforePackage);return `${after.files} package/dependency files hashed before and after; no writes into installed content.`;});
  for(const name of requiredChecks)if(!report.checks.some(check=>check.name===name))report.checks.push({name,status:'UNPERFORMED',observation:'Earlier probe initialization failed.'});
  report.assessment=assessProbe(report);
  await writeFile(join(runRoot,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({platform:report.platform,...report.assessment,commands:report.events.length,artifacts:report.artifacts.length}));
  process.exitCode=report.assessment.status==='PASS'?0:1;
}
