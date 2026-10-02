import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, realpathSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, cpSync, symlinkSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join, dirname, relative, isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {packageRoot, consumerRoots} from '../scripts/lib/consumer-paths.mjs';
import {adoptProject} from '../scripts/lib/adoption.mjs';
import {discoveryEntry, createSkillLink} from '../scripts/lib/skill-roots.mjs';
import {openJournal} from '../scripts/lib/setup-journal.mjs';
import {VERSION, POSTINSTALL, locateArchive, setupFromArchive, planInstalled, configureInstalled, restoreLastRun, verifyInstallation, restoreLinks, unlinkHarness, upgradeActions} from '../scripts/lib/setup.mjs';

// Offline: npm and the stage-2 handoff are replaced, and archives are built in memory.
function project(t) {
 const base=realpathSync(tmpdir()),root=mkdtempSync(join(base,'pom-setup-'));
 t.after(()=>{const rel=relative(base,realpathSync(root));assert(!isAbsolute(rel)&&rel.startsWith('pom-setup-'));rmSync(root,{recursive:true,force:true});});return root;
}
function put(root,path,text){const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);}
/** A minimal npm archive: one package/package.json entry in a gzipped ustar stream. */
function archive(file,manifest={name:'playwright-pom-harness',version:VERSION}) {
 const body=Buffer.from(JSON.stringify(manifest)),header=Buffer.alloc(512);
 header.write('package/package.json',0);header.write('0000644\0',100);header.write(`${body.length.toString(8).padStart(11,'0')}\0`,124);header.write('ustar\0',257);
 writeFileSync(file,gzipSync(Buffer.concat([header,body,Buffer.alloc((512-body.length%512)%512),Buffer.alloc(1024)])));return file;
}
const archiveName=`playwright-pom-harness-${VERSION}.tgz`;
// A 3.0.x redirect that legacy projects kept in .claude/skills; its digest is a recognized released file.
const legacyRedirect='---\nname: test-data\ndescription: Compatibility entrypoint for test-data; use the canonical skill.\n---\n\n# test-data — compatibility reference\n\nRead [the canonical content](../../../.agents/skills/test-data/SKILL.md) and its linked references.\nNo separate rules or mutable project state are maintained here.\n';
const npmStub=(status=0)=>{const calls=[],npm=args=>{calls.push(args);return {status,output:status?'npm ERR! synthetic failure':''};};npm.calls=calls;return npm;};
const handoff=({projectRoot,run,starter,download,checksum,warnings,kept})=>configureInstalled({projectRoot,run,skipBrowsers:true,starter,download,carried:{checksum,warnings,kept},packageRoot});
const setup=(root,options={})=>setupFromArchive({projectRoot:root,npm:npmStub(),handoff,packageRoot,...options});

test('the archive is found by version; missing, wrong, ambiguous and explicit-wrong archives stop',t=>{
 const root=project(t);assert.match(setup(root,{dryRun:true}).stops[0],/Cannot find the playwright-pom-harness/);
 archive(join(root,'playwright-pom-harness-0.0.1.tgz'),{name:'playwright-pom-harness',version:'0.0.1'});
 assert.match(setup(root,{dryRun:true}).stops[0],/Cannot find/);
 assert.match(setup(root,{dryRun:true,archive:join(root,'playwright-pom-harness-0.0.1.tgz')}).stops[0],/npx --yes --package/);
 archive(join(root,archiveName));assert.equal(setup(root,{dryRun:true}).status,'PLANNED');
 archive(join(root,`playwright-pom-harness-${VERSION}-copy.tgz`));assert.match(setup(root,{dryRun:true}).stops[0],/Several playwright-pom-harness/);
});
test('only an npx install reads the archive spec npx recorded',t=>{
 // A project installation also records a file: spec; it must never pick that archive for a different project.
 const root=project(t),other=join(root,'other'),installed=join(root,'node_modules/playwright-pom-harness');mkdirSync(other);mkdirSync(installed,{recursive:true});
 archive(join(root,archiveName));put(root,'package.json',JSON.stringify({dependencies:{'playwright-pom-harness':`file:${archiveName}`}}));
 assert.throws(()=>locateArchive(other,undefined,installed),/Cannot find the playwright-pom-harness/);
 const cache=join(root,'cache/_npx/0123abcd'),npxInstalled=join(cache,'node_modules/playwright-pom-harness');mkdirSync(npxInstalled,{recursive:true});
 put(cache,'package.json',JSON.stringify({dependencies:{'playwright-pom-harness':`file:${join(root,archiveName)}`}}));
 assert.equal(locateArchive(other,undefined,npxInstalled),join(root,archiveName));
});
test('a published checksum is verified before anything is written',t=>{
 const root=project(t),file=archive(join(root,archiveName));
 put(root,`${archiveName}.sha256`,`${'0'.repeat(64)}  ${archiveName}\n`);
 assert.match(setup(root,{dryRun:true}).stops[0],/does not match/);
 put(root,`${archiveName}.sha256`,`${createHash('sha256').update(readFileSync(file)).digest('hex')}  ${archiveName}\n`);
 assert.equal(setup(root,{dryRun:true}).checksum,true);
});
test('preconditions stop under a parent package, a workspace or another package manager',t=>{
 const parent=project(t),child=join(parent,'child');mkdirSync(child);archive(join(child,archiveName));put(parent,'package.json','{"name":"parent"}');
 assert.match(setup(child,{dryRun:true}).stops[0],/Pass --project-root \./);
 assert.equal(setup(child,{dryRun:true,explicitRoot:true}).status,'PLANNED');
 put(parent,'package.json','{"name":"parent","workspaces":["child"]}');assert.match(setup(child,{dryRun:true,explicitRoot:true}).stops[0],/workspace/);
 const other=project(t);archive(join(other,archiveName));put(other,'pnpm-lock.yaml','');assert.match(setup(other,{dryRun:true}).stops[0],/npm only/);
});
test('the starter is planned only where no Playwright framework exists',t=>{
 const plan=files=>{const root=project(t);archive(join(root,archiveName));for(const [file,text] of Object.entries(files))put(root,file,text);return setup(root,{dryRun:true}).starter;};
 assert.equal(plan({}),true);assert.equal(plan({'package.json':'{"name":"app","devDependencies":{"vite":"1.0.0"}}'}),true);
 assert.equal(plan({'package.json':'{"name":"app","devDependencies":{"@playwright/test":"1.63.0"}}'}),false);
 assert.equal(plan({'playwright.config.ts':'export default {};'}),false);
});
test('a failed install restores package.json, the lockfile and the archive copy byte for byte',t=>{
 const root=project(t),manifest='{\n  "name": "app",\n  "version": "1.0.0",\n  "dependencies": {"local-change": "1.0.0"}\n}\n',lock='{"lockfileVersion":3,"packages":{}}\n';
 put(root,'package.json',manifest);put(root,'package-lock.json',lock);archive(join(root,archiveName));
 const result=setup(root,{npm:npmStub(1)});
 assert.equal(result.status,'FAILED');assert.match(result.output,/synthetic failure/);
 assert.equal(readFileSync(join(root,'package.json'),'utf8'),manifest);assert.equal(readFileSync(join(root,'package-lock.json'),'utf8'),lock);
 assert(!existsSync(join(root,`.harness/vendor/${archiveName}`)));assert(!existsSync(join(root,'.harness/links.json')));
 const fresh=project(t);archive(join(fresh,archiveName));assert.equal(setup(fresh,{npm:npmStub(1)}).status,'FAILED');assert(!existsSync(join(fresh,'package.json')));
});
test('setup adopts, vendors the archive, chains an existing postinstall and reruns without changes',t=>{
 const root=project(t);put(root,'package.json','{\n  "name": "app",\n  "scripts": {"postinstall": "node prepare.js"},\n  "devDependencies": {"@playwright/test": "1.63.0"}\n}\n');archive(join(root,archiveName));
 const npm=npmStub(),result=setup(root,{npm});
 assert.equal(result.status,'DONE',JSON.stringify(result.stops));assert.deepEqual(npm.calls[0].slice(0,2),['install','--save-dev']);assert(npm.calls[0].includes(`file:.harness/vendor/${archiveName}`));
 assert(existsSync(join(root,`.harness/vendor/${archiveName}`)));assert(!existsSync(join(root,archiveName)),'The downloaded copy moves into the journal.');
 assert.equal(JSON.parse(readFileSync(join(root,'package.json'),'utf8')).scripts.postinstall,`${POSTINSTALL} && node prepare.js`);
 assert.match(readFileSync(join(root,'.gitattributes'),'utf8'),/\/\.harness\/vendor\/\*\.tgz binary/);
 assert.equal(result.starter,undefined);assert(result.readiness.some(item=>item.name.startsWith('skills') && item.status==='ready'));
 const rerun=configureInstalled({projectRoot:root,skipBrowsers:true,packageRoot});assert.deepEqual(rerun.changed,[]);
 assert.equal(JSON.parse(readFileSync(join(root,'package.json'),'utf8')).scripts.postinstall,`${POSTINSTALL} && node prepare.js`);
 // A fresh clone has none of the git-ignored machine state; recreating it is nothing to review or commit.
 for(const path of ['.harness/installation.json','.harness/state','.claude/skills/ROOTS.md','.agents/skills/ROOTS.md'])rmSync(join(root,path),{recursive:true});
 const clone=configureInstalled({projectRoot:root,skipBrowsers:true,packageRoot});
 assert.equal(clone.status,'DONE');assert.deepEqual(clone.changed,[]);assert(existsSync(join(root,'.harness/state/review/class-ledger.md')));
});
test('the installed copy previews a repair or a new environment without writing',t=>{
 const root=project(t);put(root,'package.json','{"name":"app","devDependencies":{"@playwright/test":"1.63.0"}}\n');archive(join(root,archiveName));
 assert.equal(setup(root).status,'DONE');assert.deepEqual(planInstalled({projectRoot:root,packageRoot}).changes,[]);
 const preview=planInstalled({projectRoot:root,environment:'qa',mode:'test',packageRoot});
 assert.equal(preview.status,'PLANNED');assert.deepEqual(preview.changes.sort(),['.harness/project.json','.harness/targets.json']);assert(!existsSync(join(root,'.harness/project.json')));
 assert.match(planInstalled({projectRoot:root,environment:'qa',packageRoot}).stops[0],/Choose test, protected or custom/);
});
test('restore returns a project with a lockfile to its exact pre-setup bytes, uncommitted changes included, and runs npm ci',t=>{
 const root=project(t),manifest='{\n  "name": "app",\n  "devDependencies": {"@playwright/test": "1.63.0", "uncommitted-change": "1.0.0"}\n}\n',lock='{"lockfileVersion":3,"packages":{}}\n';
 put(root,'package.json',manifest);put(root,'package-lock.json',lock);put(root,'AGENTS.md','Team rules\n');archive(join(root,archiveName));
 assert.equal(setup(root).status,'DONE');assert(existsSync(join(root,'.claude/skills/test-data/SKILL.md')));
 const npm=npmStub(),restored=restoreLastRun(root,{npm,packageRoot});
 assert.equal(restored.status,'RESTORED');assert.deepEqual(npm.calls,[['ci','--no-audit','--no-fund']]);
 assert.equal(readFileSync(join(root,'package.json'),'utf8'),manifest);assert.equal(readFileSync(join(root,'package-lock.json'),'utf8'),lock);
 assert.equal(readFileSync(join(root,'AGENTS.md'),'utf8'),'Team rules\n');assert(existsSync(join(root,archiveName)),'The downloaded archive comes back.');
 for(const path of ['.claude','.agents','.harness','.gitignore'])assert(!existsSync(join(root,path)),path);
});
test('restore after a crashed stage 2 brings back a replaced legacy folder and the previous link target',t=>{
 const root=project(t),old=join(project(t),'old-clone'),legacy=join(root,'.claude/skills/test-data'),relinked=join(root,'.agents/skills/test-classes'),manifest='{"name":"app","devDependencies":{"@playwright/test":"1.63.0"}}\n';
 // An old sibling clone the project's link used to point at, and a legacy redirect folder.
 put(old,'package.json','{"name":"playwright-pom-harness","version":"3.0.0"}');put(old,'.agents/skills/test-classes/SKILL.md','old skill\n');
 mkdirSync(dirname(relinked),{recursive:true});createSkillLink(join(old,'.agents/skills/test-classes'),relinked);
 put(legacy,'SKILL.md',legacyRedirect);put(root,'package.json',manifest);archive(join(root,archiveName));
 // The installed copy dies right after adoption, before the rest of stage 2.
 const crashed=({projectRoot,run})=>{adoptProject({projectRoot,installedRoot:packageRoot,journal:openJournal(consumerRoots(projectRoot,packageRoot),run)});return {status:'FAILED',stops:['crashed']};};
 assert.equal(setupFromArchive({projectRoot:root,npm:npmStub(),handoff:crashed,packageRoot}).status,'FAILED');
 assert.equal(discoveryEntry(legacy).kind,'link');assert.equal(realpathSync(relinked),realpathSync(join(packageRoot,'.agents/skills/test-classes')));
 assert.equal(restoreLastRun(root,{npm:npmStub(),packageRoot}).status,'RESTORED');
 assert.equal(discoveryEntry(legacy).kind,'directory');
 assert.deepEqual(readdirSync(legacy),['SKILL.md']);assert.equal(readFileSync(join(legacy,'SKILL.md'),'utf8'),legacyRedirect);
 assert.equal(realpathSync(relinked),realpathSync(join(old,'.agents/skills/test-classes')));
 assert.equal(readFileSync(join(root,'package.json'),'utf8'),manifest);assert.deepEqual(readdirSync(join(root,'.agents/skills')),['test-classes']);
 assert.deepEqual(readdirSync(join(root,'.claude/skills')),['test-data']);assert(!existsSync(join(root,'.harness')));
});
test('restore on a fresh project removes what setup created instead of running npm ci',t=>{
 const root=project(t);archive(join(root,archiveName));
 const result=setup(root);assert.equal(result.status,'DONE');assert(result.starter.includes('playwright.config.ts'));
 const npm=npmStub();assert.equal(restoreLastRun(root,{npm,packageRoot}).status,'RESTORED');
 assert.deepEqual(npm.calls,[]);assert.deepEqual(readdirSync(root),[archiveName]);
});
test('commands refuse to act from a copy that is not the project installation the lockfile records',t=>{
 const root=project(t),installed=join(root,'node_modules/playwright-pom-harness');mkdirSync(installed,{recursive:true});
 assert.throws(()=>verifyInstallation(join(root,'checkout/playwright-pom-harness')),/not installed in a project/);
 put(root,'package-lock.json',JSON.stringify({packages:{'node_modules/playwright-pom-harness':{version:'0.0.1'}}}));
 assert.throws(()=>verifyInstallation(installed),/records playwright-pom-harness 0\.0\.1/);
 put(root,'package-lock.json',JSON.stringify({packages:{'node_modules/playwright-pom-harness':{version:VERSION}}}));
 assert.equal(verifyInstallation(installed),root);
});
test('the postinstall guard exits cleanly when dev dependencies were omitted',t=>{
 const root=project(t),code=POSTINSTALL.match(/^node -e "(.*)"$/)[1];
 const result=spawnSync(process.execPath,['-e',code],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
});
test('installed links are restored after npm ci and removed by unlink; team content is kept',t=>{
 const root=project(t),installed=join(root,'node_modules/playwright-pom-harness');
 for(const dir of ['.agents/skills','resources'])cpSync(join(packageRoot,dir),join(installed,dir),{recursive:true});
 for(const file of ['VERSION','package.json','scripts/legacy-skill-hashes.json','scripts/redirect-skill-hashes.json','scripts/managed-digests.json'])cpSync(join(packageRoot,file),join(installed,file));
 adoptProject({projectRoot:root,installedRoot:installed});
 rmSync(join(root,'.claude/skills/test-data'));rmSync(join(root,'.agents/skills/ROOTS.md'));
 const restored=restoreLinks(root,installed);assert.deepEqual(restored.restored.sort(),['.agents/skills/ROOTS.md','.claude/skills/test-data']);
 rmSync(join(root,'.claude/skills/test-classes'));put(root,'.claude/skills/test-classes/SKILL.md','team skill');
 assert.deepEqual(restoreLinks(root,installed).problems,['.claude/skills/test-classes']);
 const unlinked=unlinkHarness(root,installed);assert.deepEqual(unlinked.kept,['.claude/skills/test-classes']);
 assert(!existsSync(join(root,'.agents/skills/test-data')));assert(!existsSync(join(root,'.agents/skills/ROOTS.md')));
 assert.equal(readFileSync(join(root,'.claude/skills/test-classes/SKILL.md'),'utf8'),'team skill');assert(existsSync(join(installed,'.agents/skills/test-data/SKILL.md')));
});
test('upgrade actions are collected for every version after the previous one',t=>{
 const root=project(t),changelog=join(root,'CHANGELOG.md');
 put(root,'CHANGELOG.md','## Unreleased\n\n### Upgrade actions\n- not yet\n\n## 3.2.0 — Later\n\n### Upgrade actions\n- rerun setup\n\n## 3.1.0 — First\n\n- feature\n\n### Upgrade actions\n- re-verify suites\n- stop using --plugin-dir\n\n## 3.0.17 — Old\n\n### Upgrade actions\n- old action\n');
 assert.deepEqual(upgradeActions('3.0.17','3.2.0',changelog),['3.2.0: rerun setup','3.1.0: re-verify suites','3.1.0: stop using --plugin-dir']);
 assert.deepEqual(upgradeActions('3.1.0','3.1.0',changelog),[]);
});
test('an interrupted stage 2 is reported with its recovery and completes on a rerun',t=>{
 const root=project(t);archive(join(root,archiveName));
 const interrupted=({projectRoot,run})=>{put(projectRoot,'.claude/skills/ROOTS.md','Appeared after the preflight\n');return configureInstalled({projectRoot,run,skipBrowsers:true,starter:true,packageRoot});};
 const result=setupFromArchive({projectRoot:root,npm:npmStub(),handoff:interrupted,packageRoot});
 assert.equal(result.status,'FAILED');assert.match(result.stops.join('\n'),/Review \.claude\/skills\/ROOTS\.md/);assert.match(result.recovery.join('\n'),/setup --restore/);
 rmSync(join(root,'.claude/skills/ROOTS.md'));
 assert.equal(configureInstalled({projectRoot:root,skipBrowsers:true,starter:true,packageRoot}).status,'DONE');
});
test('the starter config reads destinations from .harness/targets.json, with per-machine overrides and credentials from the environment',t=>{
 // Loaded the way specs load it: through Playwright's TypeScript transform, in a CommonJS project.
 const root=project(t),cli=join(packageRoot,'examples/node_modules/@playwright/test/cli.js'),out=join(root,'config.json');
 for(const name of ['targets','databases','applications'])cpSync(join(packageRoot,`examples/src/config/${name}.ts`),join(root,`src/config/${name}.ts`));
 put(root,'package.json','{"type":"commonjs"}');symlinkSync(join(packageRoot,'examples/node_modules'),join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
 // Type-only imports (DBConnectionConfig) are erased, so DBActions is not needed.
 put(root,'config.spec.ts',["import {writeFileSync} from 'node:fs';","import {test} from '@playwright/test';","import {databases} from './src/config/databases';",
  "import {applications} from './src/config/applications';","writeFileSync(process.env.CONFIG_OUT ?? '', JSON.stringify({databases, applications}));","test('loads', () => {});",""].join('\n'));
 const load=environment=>{
  const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^(APP_|OTHER_|DB_)/.test(name)));
  const result=spawnSync(process.execPath,[cli,'test','--list'],{cwd:root,encoding:'utf8',env:{...env,CONFIG_OUT:out,...environment}});
  assert.equal(result.status,0,result.stdout+result.stderr);return JSON.parse(readFileSync(out,'utf8'));
 };
 assert.deepEqual(load({DB_USER:'<shared-user>',DB_PASSWORD:'<shared>'}).databases.appDb,{name:'appDb',server:'',database:'',user:'<shared-user>',password:'<shared>'},'Without targets the shared keys apply.');
 put(root,'.harness/targets.json',JSON.stringify({api:{},databases:{appDb:{engine:'sqlserver',connectionRef:'env:APP_DB',server:'db.example.test',port:1433,database:'App',encrypt:false}},browser:{app:{origins:['https://app.example.test']}}}));
 const configured=load({APP_DB:JSON.stringify({user:'<user>',password:'<synthetic>'}),APP_DB_PORT:'',DB_USER:'<shared-user>'});
 assert.deepEqual(configured.databases.appDb,{name:'appDb',server:'db.example.test',port:1433,database:'App',user:'<user>',password:'<synthetic>',encrypt:false});
 assert.equal(configured.databases.otherDb.user,'<shared-user>');assert.equal(configured.applications.app.url,'https://app.example.test');
 const overridden=load({APP_DB_SERVER:'override.example.test',APP_URL:'https://staging.example.test'});
 assert.equal(overridden.databases.appDb.server,'override.example.test');assert.equal(overridden.databases.appDb.user,'');assert.equal(overridden.applications.app.url,'https://staging.example.test');
});
