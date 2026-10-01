#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { inventory, readSource, secretFindings, privacyFindings, localLinkFindings, publicationFindings } from './lib/package-validation.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2];
const kinds = ['syntax', 'json', 'links', 'privacy', 'secrets', 'provenance', 'publication'];
function run() {
  if (!kinds.includes(command) || process.argv.length !== 3) throw new Error('usage: node scripts/validate-package.mjs '+kinds.join('|'));
  const scope = inventory(root);
  if (!scope.files.length) throw new Error('zero publication candidates');
  const findings = [];
  let files = 0, records = 0, links = 0, packedFiles, dependencyRecords;
  if (command === 'publication') {
    const npm=process.env.npm_execpath || join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
    if (!existsSync(npm)) throw new Error('run using npm run check:publication');
    const result=spawnSync(process.execPath,[npm,'pack','--dry-run','--json','--ignore-scripts','--cache',process.env.npm_config_cache ?? join(root,'.validation/npm-cache')],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});
    if (result.error || result.status!==0) throw new Error('npm package inspection failed');
    const packed=JSON.parse(result.stdout);
    if (!Array.isArray(packed) || packed.length!==1 || !Array.isArray(packed[0].files)) throw new Error('invalid npm output');
    files=scope.files.length;packedFiles=packed[0].files.length;
    findings.push(...publicationFindings(scope,packed[0].files.map(f=>f.path)));
  }
  else if (command === 'provenance') {
    const status=JSON.parse(readFileSync(join(root,'scripts/provenance.json'),'utf8'));
    files=scope.files.length;
    if (status.originalMaterial !== 'owner-cleared') findings.push({ file:'scripts/provenance.json',rule:'owner-clearance-pending' });
    if (!existsSync(join(root,'LICENSE'))) findings.push({file:'LICENSE',rule:'public-license-not-applied'});
    if (!existsSync(join(root,'THIRD_PARTY_NOTICES.md'))) findings.push({file:'THIRD_PARTY_NOTICES.md',rule:'notices-missing'});
    if (!Array.isArray(status.sources) || !status.sources.length) findings.push({file:'scripts/provenance.json',rule:'source-inventory-empty'});
    const reviewed=new Set(['MIT','Apache-2.0','BSD-2-Clause','BSD-3-Clause','ISC','BlueOak-1.0.0','0BSD','Python-2.0','(MPL-2.0 OR Apache-2.0)']);
    dependencyRecords=0;
    for (const [recordFile,lockFile] of [['scripts/dependency-licenses.json','examples/package-lock.json'],['scripts/cli-dependency-licenses.json','scripts/spikes/playwright-cli/package-lock.json'],['scripts/runtime-dependency-licenses.json','npm-shrinkwrap.json']]) {
      const dependencies=JSON.parse(readFileSync(join(root,recordFile),'utf8'));
      const lock=JSON.parse(readFileSync(join(root,lockFile),'utf8'));
      const locked=Object.entries(lock.packages).filter(([p])=>p);
      dependencyRecords+=dependencies.packages.length;
      if (dependencies.source!==lockFile || !locked.length || locked.length!==dependencies.packages.length || locked.some(([path,p])=>!dependencies.packages.some(d=>d.path===path && d.version===p.version && d.license===p.license && d.resolved===p.resolved && d.integrity===p.integrity && reviewed.has(d.license)))) findings.push({file:recordFile,rule:'dependency-provenance-drift'});
    }
  } else for (const file of scope.files) {
    if (command==='syntax') {
      if (!/\.(mjs|cjs|js)$/.test(file)) continue;
      files++;
      const result=spawnSync(process.execPath,['--check',join(root,file)],{encoding:'utf8',timeout:15000});
      if (result.error || result.status!==0) findings.push({file,rule:'javascript-syntax'}); // never echo source excerpts
      continue;
    }
    if (command==='json' && !/\.(json|jsonl)$/.test(file)) continue;
    if (command==='links' && !file.endsWith('.md')) continue;
    files++;
    const text=readSource(root,file);
    if (command==='json') {
      try {
        if (file.endsWith('.jsonl')) { for (const line of text.split(/\r?\n/).filter(line=>line.trim())) { JSON.parse(line); records++; } }
        else { JSON.parse(text); records++; }
      } catch { findings.push({file,rule:'invalid-json'}); }
    } else if (command==='links') { const check=localLinkFindings(root,file,text);links+=check.links;findings.push(...check.findings); }
    else findings.push(...(command==='privacy'?privacyFindings:secretFindings)(file,text));
  }
  if (!files || (command==='links' && !links) || (command==='json' && !records)) throw new Error('zero effective validation scope');
  const status=findings.length?(command==='provenance'?'BLOCKED':'FAIL'):'PASS';
  console.log(JSON.stringify({check:command,status,files,...(packedFiles===undefined?{}:{packedFiles}),...(dependencyRecords===undefined?{}:{dependencyRecords}),...(command==='json'?{records}:{}),...(command==='links'?{links,anchors:'not checked',remoteLinks:'not checked'}:{}),findings},null,2));
  return findings.length?(command==='provenance'?2:1):0;
}
try { process.exitCode=run(); } catch { console.error(JSON.stringify({check:command??'unknown',status:'ERROR',reason:'invalid input, unreadable candidate or empty scope; no content emitted'}));process.exitCode=2; }
