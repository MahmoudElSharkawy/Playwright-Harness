import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,relative,isAbsolute} from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {nativeEnvironment,assertNativeProfile} from '../scripts/spikes/playwright-cli/profile.mjs';

function fixture(t) {
  const base=realpathSync(tmpdir()),root=mkdtempSync(join(base,'m4-profile-')),home=join(root,'synthetic-home');mkdirSync(home);
  t.after(()=>{const rel=relative(base,realpathSync(root));assert.ok(!isAbsolute(rel) && rel.startsWith('m4-profile-'));rmSync(root,{recursive:true});});
  const config=join(root,'cli.json');
  writeFileSync(config,JSON.stringify({browser:{browserName:'chromium',isolated:true,launchOptions:{headless:true,channel:'chrome-for-testing'}},timeouts:{action:1200,navigation:1800},outputDir:join(root,'evidence')}));
  return {root,home,config};
}

test('native environment is frozen, minimal and preserves browser installation selection',async t=>{
  const f=fixture(t),env=await nativeEnvironment({Path:'synthetic-path',PLAYWRIGHT_BROWSERS_PATH:'synthetic-browsers',UNRELATED_SETTING:'not-forwarded',NODE_OPTIONS:'--inspect'},f.home);
  assert.deepEqual(env,{Path:'synthetic-path',PLAYWRIGHT_BROWSERS_PATH:'synthetic-browsers',CI:'1',NO_UPDATE_NOTIFIER:'1'});assert.ok(Object.isFrozen(env));
});

for(const key of ['PLAYWRIGHT_MCP_CDP_ENDPOINT','PLAYWRIGHT_MCP_EXTENSION','PLAYWRIGHT_MCP_HEADLESS','PLAYWRIGHT_MCP_OUTPUT_DIR','PLAYWRIGHT_MCP_STORAGE_STATE','PLAYWRIGHT_CLI_SESSION','PWTEST_CLI_GLOBAL_CONFIG','playwright_mcp_cdp_endpoint'])test(`preflight rejects inherited ${key} without disclosing values`,async t=>{
  const f=fixture(t),value='synthetic-private-setting';
  await assert.rejects(nativeEnvironment({[key]:value},f.home),error=>!error.message.includes(value) && /without native Playwright overrides/.test(error.message));
});

test('existing native global config is rejected without parsing or changing it',async t=>{
  const f=fixture(t);mkdirSync(join(f.home,'.playwright'));
  writeFileSync(join(f.home,'.playwright','cli.config.json'),'Invalid JSON: this synthetic user config must never be parsed');
  await assert.rejects(nativeEnvironment({},f.home),/without native global configuration/);
});

test('probe refuses inherited CDP before creating run output or invoking a browser',t=>{
  const f=fixture(t),output=join(f.root,'never-created');
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/spikes/playwright-cli/probe.mjs',import.meta.url)),output],{encoding:'utf8',env:{...process.env,PLAYWRIGHT_MCP_CDP_ENDPOINT:'http://127.0.0.1:9222'},timeout:15000});
  assert.equal(result.status,2);assert.equal(JSON.parse(result.stderr).status,'BLOCKED');assert.equal(result.stdout,'');assert.ok(!existsSync(output));assert.ok(!result.stderr.includes('9222'));
});

test('the exact pinned native resolver confirms the profile and exposes hostile overrides',async t=>{
  const f=fixture(t),require=createRequire(import.meta.url);
  const {tools}=require('../scripts/spikes/playwright-cli/node_modules/playwright-core/lib/coreBundle.js');
  const clean=await nativeEnvironment({},f.home);
  // The native test-only home override isolates this offline test from real user configuration.
  const env={...clean,PWTEST_CLI_GLOBAL_CONFIG:f.home};
  const resolve=extra=>tools.resolveCLIConfigForCLI(join(f.root,'daemon'),'synthetic-test',{config:f.config},{...env,...extra});
  assert.equal(assertNativeProfile(await resolve({}),f.config,f.root).attachment,'disabled');
  for(const extra of [{PLAYWRIGHT_MCP_CDP_ENDPOINT:'http://127.0.0.1:9222'},{PLAYWRIGHT_MCP_EXTENSION:'true'},{PLAYWRIGHT_MCP_HEADLESS:'false'},{PLAYWRIGHT_MCP_OUTPUT_DIR:join(f.root,'elsewhere')},{PLAYWRIGHT_MCP_ISOLATED:'false'}]) {
    const resolved=await resolve(extra);assert.throws(()=>assertNativeProfile(resolved,f.config,f.root));
  }
  mkdirSync(join(f.home,'.playwright'));
  writeFileSync(join(f.home,'.playwright','cli.config.json'),JSON.stringify({browser:{cdpEndpoint:'http://127.0.0.1:9222',contextOptions:{storageState:'synthetic-unused-state.json'}}}));
  await assert.rejects(nativeEnvironment({},f.home),/without native global configuration/);
  const inherited=await resolve({});assert.throws(()=>assertNativeProfile(inherited,f.config,f.root));
});
