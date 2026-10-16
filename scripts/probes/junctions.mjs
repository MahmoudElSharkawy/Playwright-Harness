#!/usr/bin/env node
// Inspect only a freshly owned junction; never modify existing discovery entries.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,realpathSync,symlinkSync,readlinkSync,readdirSync,lstatSync,rmSync,rmdirSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {release,version} from 'node:os';
import {discoveryEntry} from '../lib/skill-roots.mjs';

assert.equal(process.argv.length,3,'Provide one existing scratch parent directory.');
const parent=realpathSync(resolve(process.argv[2]));assert(statSync(parent).isDirectory());
const root=mkdtempSync(join(parent,'pom-junction-probe-')),target=join(root,'target'),link=join(root,'link');
const result={platform:process.platform,os:version(),release:release(),node:process.version,uv:process.versions.uv,parent,root};
let linked=false;
try {
  mkdirSync(target);symlinkSync(target,link,process.platform==='win32'?'junction':'dir');linked=true;
  result.liveTarget=readlinkSync(link);rmSync(target,{recursive:true});
  result.enumeratedAsLink=readdirSync(root,{withFileTypes:true}).find(entry=>entry.name==='link').isSymbolicLink();
  for(const [name,inspect] of [['readlink',readlinkSync],['lstat',path=>lstatSync(path).isSymbolicLink()],['discovery',discoveryEntry]]) {
    try {result[name]={status:'PASS',value:inspect(link)};}
    catch(error) {result[name]={status:'FAIL',code:error.code??error.cause?.code,message:error.message};}
  }
} finally {
  try {
    if(linked) {
      // Restore only our known target so affected Windows locations can remove the probe.
      mkdirSync(target,{recursive:true});
      assert.equal(realpathSync.native(resolve(root,readlinkSync(link))).toLowerCase(),realpathSync.native(target).toLowerCase());
      rmdirSync(link);
    }
    rmSync(root,{recursive:true});result.cleanup='PASS';
  } catch(error) {result.cleanup='FAIL';result.cleanupError=error.message;}
  console.log(JSON.stringify(result,null,2));
}
if(result.readlink?.status!=='PASS' || result.discovery?.status!=='PASS' || result.cleanup!=='PASS')process.exitCode=1;
