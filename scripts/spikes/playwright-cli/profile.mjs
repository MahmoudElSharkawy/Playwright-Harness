// Version-specific M4 preflight, not a browser executor or a configuration API.
import assert from 'node:assert/strict';
import {lstat,readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pin} from './assessment.mjs';

const systemKeys=new Set(['PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','TMPDIR','HOME','USERPROFILE','HOMEDRIVE','HOMEPATH','LOCALAPPDATA','APPDATA','XDG_CACHE_HOME','XDG_RUNTIME_DIR','LANG','LANGUAGE','LC_ALL','TZ','PLAYWRIGHT_BROWSERS_PATH']);

export async function nativeEnvironment(source=process.env,homeDirectory=homedir()) {
  if(Object.keys(source).some(key=>/^(PLAYWRIGHT_MCP_|PLAYWRIGHT_CLI_|PWTEST_)/i.test(key)))throw new Error('M4 requires a shell without native Playwright overrides; values are not logged');
  // Check existence only: never read an existing user's native config or auth state.
  try {await lstat(join(homeDirectory,'.playwright','cli.config.json'));}
  catch(error) {if(error.code==='ENOENT')return Object.freeze({...Object.fromEntries(Object.entries(source).filter(([key])=>systemKeys.has(key.toUpperCase()))),CI:'1',NO_UPDATE_NOTIFIER:'1'});throw error;}
  throw new Error('M4 requires an account without native global configuration; existing configuration is untouched');
}

export function assertNativeProfile(value,config,runRoot) {
  const browser=value?.browser,launch=browser?.launchOptions;
  assert.equal(browser?.browserName,'chromium');assert.equal(browser.isolated,true);
  assert.equal(launch?.channel,'chrome-for-testing');assert.equal(launch.headless,true);
  for(const field of ['cdpEndpoint','remoteEndpoint','userDataDir','initPage','initScript'])assert.ok(!browser[field],'unexpected native browser override');
  assert.ok(!launch.executablePath && !launch.proxy && !value.extension && !value.sharedBrowserContext,'unexpected native profile override');
  assert.ok(!browser.contextOptions?.storageState && !browser.contextOptions?.proxy,'unexpected native context override');
  assert.equal(value.configFile,config);assert.equal(resolve(value.outputDir),join(runRoot,'evidence'));
  assert.equal(value.timeouts?.action,1200);assert.equal(value.timeouts?.navigation,1800);
  return {attachment:'disabled',isolated:true,headless:true,browser:'chromium',channel:'chrome-for-testing',output:'run/evidence',nativeConfiguration:'neutral'};
}

export async function verifyNativeProfile(spikeRoot,config,runRoot,env) {
  await nativeEnvironment(env); // Recheck global-config absence immediately before each open.
  for(const name of ['@playwright/cli','playwright','playwright-core']) {
    const installed=JSON.parse(await readFile(join(spikeRoot,'node_modules',name,'package.json'),'utf8'));
    assert.equal(installed.version,name==='@playwright/cli'?pin.cli:pin.playwright,'unexpected installed CLI graph');
  }
  // This private native resolver belongs to the exact pinned build. Any pin change
  // must repeat this spike; browser operations themselves still use the public CLI.
  const require=createRequire(import.meta.url);
  const {tools}=require(join(spikeRoot,'node_modules/playwright-core/lib/coreBundle.js'));
  const resolved=await tools.resolveCLIConfigForCLI(join(runRoot,'private'),'m4-profile-preflight',{config},env);
  return assertNativeProfile(resolved,config,runRoot);
}
