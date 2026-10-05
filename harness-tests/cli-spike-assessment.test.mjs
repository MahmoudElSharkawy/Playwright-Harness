import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,mkdirSync,realpathSync,rmSync,existsSync,readdirSync,symlinkSync,copyFileSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {realpath} from 'node:fs/promises';
import {classifyReply,assessProbe,assessPlatforms,requiredChecks,pin} from '../scripts/spikes/playwright-cli/assessment.mjs';
import {prepareOutput,resolvePackageRoot,snapshotPackage} from '../scripts/spikes/playwright-cli/output.mjs';

function report(platform) {
  const success=['open','goto','snapshot','click','eval','fill','state-save','state-load','tracing-start','tracing-stop','screenshot','console','requests','close','delete-data'].map(command=>({command,kind:'OK',exitCode:0}));
  const failures=['not-a-command','click','eval','snapshot','goto'].map(command=>({command,kind:'CLI_ERROR',exitCode:1}));
  const events=[...success,...failures,{command:'run-code',kind:'TIMEOUT',exitCode:null}].map((event,index)=>({...event,number:index+1,durationMs:1}));
  return {platform,pin:{...pin,lockSha256:'a'.repeat(64)},events,cleanup:{attemptedNames:5,recordedTrees:5,processTreesStopped:true,authenticationStateRemoved:true,fixtureClosed:true,failures:0,faultInjection:null},checks:requiredChecks.map(name=>({name,status:'PASS',observation:'Synthetic assessor fixture; not integration evidence.'}))};
}

test('native errors, process failures and deadlines cannot become success',()=>{
  for(const [reply,expected] of [
    [{exitCode:0,stdout:'{"result":"value"}'},'OK'],
    [{exitCode:1,stdout:'{"result":"plausible"}'},'PROCESS_FAILURE'],
    [{exitCode:0,stdout:'{"isError":true,"error":"synthetic"}'},'CLI_ERROR'],
    [{exitCode:0,stdout:'{"error":"synthetic"}'},'CLI_ERROR'],
    [{exitCode:null,stdout:'{"result":"value"}',timedOut:true},'TIMEOUT'],
    [{spawnError:'ENOENT'},'PROCESS_FAILURE'],
    [{exitCode:0,stdout:'not JSON'},'INVALID_RESPONSE'],
    [{exitCode:0,stdout:'[]'},'INVALID_RESPONSE'],
    [null,'INVALID_RESPONSE']
  ])assert.equal(classifyReply(reply).kind,expected);
});
test('empty, duplicate and missing mandatory checks are incomplete',()=>{
  for(const value of [null,{}, {checks:'invalid'}, {...report('win32'),checks:[]}, {...report('win32'),checks:report('win32').checks.slice(1)}, {...report('win32'),checks:requiredChecks.map(()=>({name:requiredChecks[0],status:'PASS',observation:'synthetic'}))}])assert.equal(assessProbe(value).status,'INCOMPLETE');
});
test('failed, blocked and unperformed checks keep the viability gate incomplete',()=>{
  for(const status of ['FAIL','BLOCKED','UNPERFORMED']) {const value=report('win32');value.checks[0].status=status;assert.equal(assessProbe(value).status,'INCOMPLETE');}
  const value=report('win32');delete value.checks[0].observation;assert.equal(assessProbe(value).status,'INCOMPLETE');
});
test('explicit exact pins and lock integrity are required',()=>{
  for(const value of [{...report('win32'),pin:undefined},{...report('win32'),pin:{...pin}}, {...report('win32'),pin:{...pin,cli:'latest',lockSha256:'a'.repeat(64)}}, {...report('win32'),pin:{...pin,lockSha256:'invalid'}}])assert.equal(assessProbe(value).status,'INCOMPLETE');
  assert.equal(assessProbe(report('win32')).status,'PASS');
});
test('both actual platforms and the same dependency lock are required',()=>{
  for(const reports of [null,[],[report('win32')],[report('linux'),report('linux')],[report('win32'),{...report('linux'),pin:{...pin,lockSha256:'b'.repeat(64)}}]])assert.equal(assessPlatforms(reports).status,'INCOMPLETE');
  assert.equal(assessPlatforms([report('win32'),report('linux')]).status,'PASS');
});
test('empty or truncated execution cannot pass despite all mandatory PASS strings',()=>{
  for(const events of [undefined,[],report('win32').events.slice(0,3)])assert.equal(assessProbe({...report('win32'),events}).status,'INCOMPLETE');
});
test('history requires consistent sequence, exits, durations and native proof categories',()=>{
  for(const change of [event=>event.number=2,event=>event.kind='invented',event=>event.exitCode=1,event=>event.durationMs=-1,event=>event.durationMs=null]) {
    const value=report('win32');change(value.events[0]);assert.equal(assessProbe(value).status,'INCOMPLETE');
  }
  for(const command of ['open','state-load','tracing-stop','delete-data','run-code','not-a-command']) {
    const value=report('win32');value.events=value.events.filter(event=>event.command!==command).map((event,index)=>({...event,number:index+1}));assert.equal(assessProbe(value).status,'INCOMPLETE');
  }
});
test('failed or missing cleanup facts never retain a clean gate',()=>{
  for(const cleanup of [undefined,{...report('win32').cleanup,processTreesStopped:false},{...report('win32').cleanup,authenticationStateRemoved:false},{...report('win32').cleanup,failures:1},{...report('win32').cleanup,faultInjection:'sentinel-crash'}])assert.equal(assessProbe({...report('win32'),cleanup}).status,'INCOMPLETE');
});
test('resolved dependency graph uses exact versions, integrity and reviewed licenses',()=>{
  const lock=JSON.parse(readFileSync(new URL('../scripts/spikes/playwright-cli/package-lock.json',import.meta.url)));
  const packages=Object.entries(lock.packages).filter(([name])=>name);
  assert.equal(packages.length,3);
  for(const [name,value] of packages) {assert.equal(value.license,'Apache-2.0');assert.match(value.integrity,/^sha512-/);assert.equal(value.version,name.endsWith('/@playwright/cli')?pin.cli:pin.playwright);}
  assert.equal(lock.packages[''].dependencies['@playwright/cli'],pin.cli);
});

function receipts(t) {
  const base=realpathSync(tmpdir()),root=mkdtempSync(join(base,'m4-receipt-'));
  t.after(()=>{const rel=relative(base,realpathSync(root));assert.ok(!isAbsolute(rel) && rel.startsWith('m4-receipt-'));rmSync(root,{recursive:true});});
  const paths=[];
  for(const platform of ['win32','linux']) {
    const dir=join(root,platform);mkdirSync(dir);
    mkdirSync(join(dir,'evidence'));mkdirSync(join(dir,'evidence','traces'));
    const evidence={
      'evidence/page.png':Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'),
      'evidence/initial.yml':Buffer.from(`- heading "Public fixture" [level=1] [ref=e1]\n- paragraph: "Synthetic ${platform} unit fixture"\n`),
      'evidence/traces/fixed.trace':Buffer.from(JSON.stringify({type:'frame-snapshot',snapshot:{html:['HTML',{},['BODY',{},'Synthetic unit fixture']]}})+'\n'),
      'evidence/traces/fixed.network':Buffer.from(JSON.stringify({type:'resource-snapshot',snapshot:{request:{method:'GET'},response:{status:200}}})+'\n')
    };
    const artifacts=Object.entries(evidence).map(([path,bytes])=>{writeFileSync(join(dir,path),bytes);return {path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});
    const value={...report(platform),artifacts};
    const path=join(dir,'report.json');writeFileSync(path,JSON.stringify(value));paths.push(path);
  }
  return {root,paths,run:()=>spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/spikes/playwright-cli/assess.mjs',import.meta.url)),...paths],{encoding:'utf8'})};
}
test('offline receipt verification checks each artifact without comparing platform hashes',t=>{
  const fixture=receipts(t);const result=fixture.run();assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout).artifactIntegrity,'PASS');
});
test('a changed or missing artifact cannot retain a passing receipt',t=>{
  const fixture=receipts(t);writeFileSync(join(fixture.root,'win32','evidence/page.png'),'Changed unit fixture');
  assert.equal(fixture.run().status,1);rmSync(join(fixture.root,'win32','evidence/page.png'));assert.equal(fixture.run().status,1);
});
test('receipt artifacts cannot escape their run or use an empty inventory',t=>{
  const fixture=receipts(t);const path=fixture.paths[0];const value=JSON.parse(readFileSync(path,'utf8'));
  value.artifacts[0].path='../linux/evidence/page.png';writeFileSync(path,JSON.stringify(value));assert.equal(fixture.run().status,1);
  value.artifacts=[];writeFileSync(path,JSON.stringify(value));assert.equal(fixture.run().status,1);
});
test('an offline receipt with zero events is rejected even with valid artifacts',t=>{
  const fixture=receipts(t),path=fixture.paths[0];const value=JSON.parse(readFileSync(path,'utf8'));value.events=[];writeFileSync(path,JSON.stringify(value));assert.equal(fixture.run().status,1);
});
test('output rejection happens before intermediate directories are created',async t=>{
  const fixture=receipts(t),packageRoot=join(fixture.root,'installed');mkdirSync(packageRoot);writeFileSync(join(packageRoot,'marker.txt'),'immutable');
  await assert.rejects(prepareOutput(packageRoot,join(packageRoot,'not-created','deeper','run')));
  assert.deepEqual(readdirSync(packageRoot),['marker.txt']);assert.equal(readFileSync(join(packageRoot,'marker.txt'),'utf8'),'immutable');
  const linked=join(fixture.root,'installed-link');symlinkSync(packageRoot,linked,process.platform==='win32'?'junction':'dir');
  try {await assert.rejects(prepareOutput(packageRoot,join(linked,'not-created','run')));assert.ok(!existsSync(join(packageRoot,'not-created')));}finally {rmSync(linked);}
  assert.equal(readFileSync(join(packageRoot,'marker.txt'),'utf8'),'immutable');
});
test('new output outside the spike works and an existing attempt is preserved',async t=>{
  const fixture=receipts(t),packageRoot=join(fixture.root,'installed');mkdirSync(packageRoot);
  const target=join(fixture.root,'ignored','new','run');assert.equal(await prepareOutput(packageRoot,target),target);
  writeFileSync(join(target,'marker.txt'),'prior attempt');await assert.rejects(prepareOutput(packageRoot,target));assert.equal(readFileSync(join(target,'marker.txt'),'utf8'),'prior attempt');
});

for(const suffix of ['page.png','initial.yml','.trace','.network'])test(`omitting required ${suffix} evidence fails even with intact checks/history`,t=>{
  const fixture=receipts(t),path=fixture.paths[0],value=JSON.parse(readFileSync(path));
  value.artifacts=value.artifacts.filter(artifact=>!artifact.path.endsWith(suffix));
  writeFileSync(path,JSON.stringify(value));assert.equal(fixture.run().status,1);
});

for(const suffix of ['page.png','initial.yml','.trace','.network'])test(`invalid ${suffix} content fails even when its new hash matches`,t=>{
  const fixture=receipts(t),path=fixture.paths[0],value=JSON.parse(readFileSync(path));
  const artifact=value.artifacts.find(artifact=>artifact.path.endsWith(suffix)),bytes=Buffer.from('Unrelated synthetic content');
  writeFileSync(join(fixture.root,'win32',artifact.path),bytes);
  artifact.bytes=bytes.length;artifact.sha256=createHash('sha256').update(bytes).digest('hex');
  writeFileSync(path,JSON.stringify(value));assert.equal(fixture.run().status,1);
});

test('a trace resource image cannot replace the required screenshot',t=>{
  const fixture=receipts(t),path=fixture.paths[0],value=JSON.parse(readFileSync(path));
  const screenshot=value.artifacts.find(artifact=>artifact.path==='evidence/page.png');
  copyFileSync(join(fixture.root,'win32',screenshot.path),join(fixture.root,'win32','evidence/resource.png'));
  screenshot.path='evidence/resource.png';writeFileSync(path,JSON.stringify(value));assert.equal(fixture.run().status,1);
});

test('a screenshot truncated after its header is invalid despite a matching new hash',t=>{
  const fixture=receipts(t),path=fixture.paths[0],value=JSON.parse(readFileSync(path));
  const artifact=value.artifacts.find(artifact=>artifact.path==='evidence/page.png');
  const file=join(fixture.root,'win32',artifact.path),bytes=readFileSync(file).subarray(0,33);writeFileSync(file,bytes);
  artifact.bytes=bytes.length;artifact.sha256=createHash('sha256').update(bytes).digest('hex');
  writeFileSync(path,JSON.stringify(value));assert.equal(fixture.run().status,1);
});

test('network evidence must belong to the recorded native trace',t=>{
  const fixture=receipts(t),path=fixture.paths[0],value=JSON.parse(readFileSync(path));
  const artifact=value.artifacts.find(artifact=>artifact.path.endsWith('.network'));
  copyFileSync(join(fixture.root,'win32',artifact.path),join(fixture.root,'win32','evidence/traces/unrelated.network'));
  artifact.path='evidence/traces/unrelated.network';writeFileSync(path,JSON.stringify(value));assert.equal(fixture.run().status,1);
});

function installedFixture(t) {
  const fixture=receipts(t),packageRoot=join(fixture.root,'installed'),spikeRoot=join(packageRoot,'scripts/spikes/playwright-cli');
  mkdirSync(spikeRoot,{recursive:true});mkdirSync(join(packageRoot,'docs'));
  writeFileSync(join(packageRoot,'package.json'),JSON.stringify({name:'playwright-pom-harness'}));
  writeFileSync(join(spikeRoot,'marker.txt'),'immutable spike');
  writeFileSync(join(packageRoot,'.gitignore'),'/.validation/\n');
  return {...fixture,packageRoot,spikeRoot};
}

test('resolve the enclosing harness boundary and reject sibling source output before writes',async t=>{
  const fixture=installedFixture(t),root=await resolvePackageRoot(fixture.spikeRoot);assert.equal(root,await realpath(fixture.packageRoot));
  for(const path of ['docs/new/deep/run','scripts/other/run','scripts/spikes/playwright-cli/new/run','.agents/skills/new/run','.validation/other/run']) {
    await assert.rejects(prepareOutput(root,join(root,path)));
    assert.ok(!existsSync(join(root,path.split('/').slice(0,-1).join('/'))),'rejection created parent directories');
  }
  const alias=join(fixture.root,'docs-link');symlinkSync(join(root,'docs'),alias,process.platform==='win32'?'junction':'dir');
  try {await assert.rejects(prepareOutput(root,join(alias,'new/run')));assert.ok(!existsSync(join(root,'docs/new')));}finally {rmSync(alias);}
});

test('development output requires an actual checkout and an effective ignore rule',async t=>{
  const fixture=installedFixture(t),root=fixture.packageRoot,target=join(root,'.validation/m4/new/run');
  await assert.rejects(prepareOutput(root,target));assert.ok(!existsSync(join(root,'.validation')));
  assert.equal(spawnSync('git',['init','--quiet',root],{encoding:'utf8'}).status,0);
  writeFileSync(join(root,'.gitignore'),'');
  await assert.rejects(prepareOutput(root,target));assert.ok(!existsSync(join(root,'.validation')));
  writeFileSync(join(root,'.gitignore'),'/.validation/\n');
  assert.equal(await prepareOutput(root,target),target);
  const link=join(root,'.validation/m4/source-link');symlinkSync(join(root,'docs'),link,process.platform==='win32'?'junction':'dir');
  try {await assert.rejects(prepareOutput(root,join(link,'new/run')));assert.ok(!existsSync(join(root,'docs/new')));}finally {rmSync(link);}
});

test('full package snapshot detects sibling source changes and excludes private run storage',async t=>{
  const fixture=installedFixture(t),root=fixture.packageRoot;
  mkdirSync(join(root,'scripts/lib'));
  for (const file of ['package-validation.mjs', 'convention-source.mjs']) {
    copyFileSync(fileURLToPath(new URL('../scripts/lib/' + file, import.meta.url)), join(root, 'scripts/lib', file));
  }
  const before=await snapshotPackage(root,fixture.spikeRoot);
  mkdirSync(join(root,'.validation'));writeFileSync(join(root,'.validation','run.txt'),'ignored synthetic evidence');
  assert.deepEqual(await snapshotPackage(root,fixture.spikeRoot),before);
  writeFileSync(join(root,'docs','changed.md'),'source changed');
  assert.notDeepEqual(await snapshotPackage(root,fixture.spikeRoot),before);
});

test('standalone container package has no in-package development-output exemption',async t=>{
  const fixture=receipts(t),standalone=join(fixture.root,'standalone');mkdirSync(standalone);
  assert.equal(await resolvePackageRoot(standalone),await realpath(standalone));
  await assert.rejects(prepareOutput(standalone,join(standalone,'.validation/m4/new')));
  assert.ok(!existsSync(join(standalone,'.validation')));
  assert.equal(await prepareOutput(standalone,join(fixture.root,'external-run')),join(fixture.root,'external-run'));
});
