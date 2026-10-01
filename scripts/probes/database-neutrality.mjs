#!/usr/bin/env node
// Fixed validation orchestration for two disposable instances; not a runtime scheduler.
import {spawn} from 'node:child_process';
import {assessDatabaseNeutrality} from './database-neutrality-assessment.mjs';

const flags=process.argv.slice(2);if(flags.length>1||flags.length&&flags[0]!=='--linux-client')throw new Error('Only --linux-client is supported.');
async function probe(engine,args) {
  const child=spawn(process.execPath,[`scripts/probes/${engine}.mjs`,...args,...flags],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',overflow=false;child.stdout.on('data',chunk=>{if(stdout.length+chunk.length<=4*1024*1024)stdout+=chunk;else overflow=true;});child.stderr.on('data',()=>{});
  const status=await new Promise(resolve=>{child.once('error',()=>resolve(1));child.once('exit',code=>resolve(code??1));});
  if(status!==0||overflow)throw new Error('LIVE_PROBE_FAILED');
  const receipts=stdout.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
  if(!receipts.some(item=>item.probe===engine&&item.status==='PASS'&&item.liveDatabase===true)||!receipts.some(item=>item.probe===`${engine}-cleanup`&&item.status==='PASS'))throw new Error('LIVE_RECEIPT_INCOMPLETE');
  const normalized=receipts.filter(item=>item.probe==='database-neutrality');if(normalized.length!==1)throw new Error('SEMANTIC_RECEIPT_INCOMPLETE');
  return normalized[0];
}
try {
  const sqlserver=await probe('sqlserver',['--neutrality']),postgresql=await probe('postgresql',[]),result=assessDatabaseNeutrality(sqlserver,postgresql);
  console.log(JSON.stringify({probe:'database-neutrality-comparison',platform:flags.length?'linux':process.platform,...result}));if(result.status!=='PASS')process.exitCode=1;
} catch {console.log(JSON.stringify({probe:'database-neutrality-comparison',status:'FAIL',reason:'Both live proofs and complete matching semantics are required.'}));process.exitCode=1;}
