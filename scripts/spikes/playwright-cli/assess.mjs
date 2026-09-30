#!/usr/bin/env node
// Offline verification of the two fixed M4 probe receipts; never launches a browser.
import {readFile,realpath} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {assessPlatforms} from './assessment.mjs';

async function loadReceipt(path) {
  const report=JSON.parse(await readFile(path,'utf8'));
  const root=await realpath(dirname(path));
  if(!Array.isArray(report.artifacts) || !report.artifacts.length)throw new Error('missing artifact inventory');
  const names=new Set();
  for(const artifact of report.artifacts) {
    if(typeof artifact.path!=='string' || isAbsolute(artifact.path) || artifact.path.includes('\\') || names.has(artifact.path))throw new Error('invalid artifact association');
    const file=await realpath(resolve(root,artifact.path));
    const rel=relative(root,file);
    if(!rel || isAbsolute(rel) || rel==='..' || rel.startsWith(`..${sep}`))throw new Error('artifact escapes run');
    names.add(artifact.path);
    const bytes=await readFile(file);
    if(bytes.length===0 || bytes.length!==artifact.bytes || createHash('sha256').update(bytes).digest('hex')!==artifact.sha256)throw new Error('artifact integrity failure');
  }
  return report;
}

try {
  if(process.argv.length!==4)throw new Error('two platform receipts required');
  const reports=[];
  for(const path of process.argv.slice(2))reports.push(await loadReceipt(path));
  const assessment=assessPlatforms(reports);
  console.log(JSON.stringify({...assessment,artifactIntegrity:'PASS',receipts:reports.map(report=>({platform:report.platform,checks:report.checks.length,commands:report.events.length,artifacts:report.artifacts.length}))},null,2));
  process.exitCode=assessment.status==='PASS'?0:1;
} catch {
  console.error(JSON.stringify({status:'INCOMPLETE',artifactIntegrity:'FAIL',reason:'invalid/missing receipts or artifact integrity; no raw content emitted'}));
  process.exitCode=1;
}
