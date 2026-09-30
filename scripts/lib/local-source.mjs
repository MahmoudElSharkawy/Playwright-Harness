import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {createHash} from 'node:crypto';
import {consumerPath} from './consumer-paths.mjs';
import {identifier,keys} from './project-config.mjs';
import {secretFindings} from './package-validation.mjs';

const nonempty=value=>typeof value==='string' && value.trim().length>0;
export function validateLocalSource(input) {
  keys(input,['version','id','title','scenarios'],'local source');
  if(input.version!==1 || !identifier(input.id) || !nonempty(input.title))throw new Error('Local source needs version 1, an identifier and title.');
  if(!Array.isArray(input.scenarios) || !input.scenarios.length || input.scenarios.length>500)throw new Error('Local source needs 1–500 scenarios.');
  const ids=new Set();
  for(const scenario of input.scenarios) {
    keys(scenario,['id','title','steps','externalReferences'],'scenario');
    if(!identifier(scenario.id) || ids.has(scenario.id) || !nonempty(scenario.title))throw new Error('Scenario identifiers must be unique and titles nonempty.');
    ids.add(scenario.id);
    if(!Array.isArray(scenario.steps) || !scenario.steps.length || scenario.steps.length>1000)throw new Error('Scenario needs 1–1000 steps.');
    for(const step of scenario.steps) {
      keys(step,['action','expected'],'step');
      if(!nonempty(step.action) || !Array.isArray(step.expected) || step.expected.some(v=>!nonempty(v)))throw new Error('Each step needs an action and an expected-results array.');
    }
    if(!scenario.steps.some(step=>step.expected.length))throw new Error('A scenario without an expectation is incomplete.');
    if(scenario.externalReferences!==undefined) {
      if(!Array.isArray(scenario.externalReferences))throw new Error('External references must be an array.');
      for(const ref of scenario.externalReferences) {
        keys(ref,['system','id'],'external reference');
        if(!nonempty(ref.system) || !nonempty(ref.id))throw new Error('External references need system and id.');
      }
    }
  }
  if(secretFindings('local-source.json',JSON.stringify(input,null,2)).length)throw new Error('Local source contains a credential-like literal; use secret references.');
  return structuredClone(input);
}
/** Load source text and optional external identities; never contact an external system. */
export function loadLocalSource(roots,path) {
  const file=consumerPath(roots,path);
  const bytes=readFileSync(file);
  if(bytes.length>2*1024*1024)throw new Error('Local source exceeds 2 MiB.');
  let parsed;try {parsed=JSON.parse(bytes.toString('utf8'));}catch {throw new Error('Local source must be readable JSON.');}
  const input=validateLocalSource(parsed);
  return {...input,source:{kind:'local',path:relative(roots.projectRoot,file).replaceAll('\\','/'),sha256:createHash('sha256').update(bytes).digest('hex')}};
}
