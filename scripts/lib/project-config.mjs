import {readFileSync,statSync} from 'node:fs';
import {consumerPath} from './consumer-paths.mjs';

export const capabilityNames=['apiReads','apiMutations','apiExploration','dbSelect','dbDml','dbExploration','ddl','admin','browserReads','browserMutations','browserExploration'];
export const identifier=value=>typeof value==='string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value);
export function object(value,label) {if(!value || typeof value!=='object' || Array.isArray(value))throw new Error(`Invalid ${label}.`);return value;}
export function keys(value,allowed,label) {object(value,label);if(Object.keys(value).some(key=>!allowed.includes(key)))throw new Error(`Unknown field in ${label}.`);}
export function readJson(path) {try {if(statSync(path).size>2*1024*1024)throw new Error();return JSON.parse(readFileSync(path,'utf8'));}catch {throw new Error('Input must be readable JSON, at most 2 MiB.');}}
const secretReference=value=>typeof value==='string' && /^env:[A-Z][A-Z0-9_]*$/.test(value);
export function validateConfiguration(project,targets) {
  keys(project,['version','defaultEnvironment','environments'],'project configuration');
  keys(targets,['api','databases','browser'],'target configuration');
  if(project.version!==1 || !identifier(project.defaultEnvironment))throw new Error('Invalid project version or default environment.');
  object(project.environments,'environments');object(targets.api,'API targets');object(targets.databases,'database targets');
  object(targets.browser??{},'browser targets');
  for(const [name,target] of Object.entries(targets.browser??{})) {
    if(!identifier(name))throw new Error('Invalid browser target identifier.');
    keys(target,['origins','startUrl','users'],'browser target');
    if(!Array.isArray(target.origins) || !target.origins.length || new Set(target.origins).size!==target.origins.length)throw new Error('Browser targets need explicit unique origins.');
    for(const origin of target.origins) {
      let url;try{url=new URL(origin);}catch{throw new Error('Invalid browser origin.');}
      if(!['https:','http:'].includes(url.protocol) || origin!==url.origin)throw new Error('Browser targets require HTTP(S) origins without credentials, paths or wildcards.');
    }
    if(target.startUrl!==undefined) {
      let url;try{url=new URL(target.startUrl);}catch{throw new Error('Invalid browser start URL.');}
      if(!target.origins.includes(url.origin) || url.username || url.password)throw new Error('Browser start URL must belong to an allowed origin.');
    }
    if(target.users!==undefined) {
      object(target.users,'browser users');
      for(const [handle,user] of Object.entries(target.users)) {
        if(!identifier(handle))throw new Error('Invalid browser user handle.');
        keys(user,['usernameRef','passwordRef'],'browser user');
        if(!secretReference(user.usernameRef) || !secretReference(user.passwordRef))throw new Error('Browser users need environment references.');
      }
    }
  }
  for(const [name,target] of Object.entries(targets.api)) {
    if(!identifier(name))throw new Error('Invalid target identifier.');
    keys(target,['baseUrl','credentialRef'],'API target');
    let url;try{url=new URL(target.baseUrl);}catch{throw new Error('API target needs an absolute HTTP(S) base URL.');}
    if(!['https:','http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)throw new Error('API target URL must not contain credentials, query or fragment.');
    if(target.credentialRef!==undefined && !secretReference(target.credentialRef))throw new Error('Use an environment-variable credential reference.');
  }
  for(const [name,target] of Object.entries(targets.databases)) {
    if(!identifier(name))throw new Error('Invalid target identifier.');
    keys(target,['engine','connectionRef','schema','server','port','database','encrypt','trustServerCertificate'],'database target');
    if(!['sqlserver','postgresql'].includes(target.engine) || !secretReference(target.connectionRef))throw new Error('Database targets need a supported engine name and environment-variable connection reference.');
    if(target.schema!==undefined && (typeof target.schema!=='string' || !target.schema.trim()))throw new Error('Invalid database schema scope.');
    for(const field of ['server','database']) if(target[field]!==undefined && (typeof target[field]!=='string' || !target[field].trim() || /[\x00-\x1f]/.test(target[field])))throw new Error('Invalid database destination.');
    if(target.port!==undefined && (!Number.isInteger(target.port) || target.port<1 || target.port>65535))throw new Error('Invalid database port.');
    for(const field of ['encrypt','trustServerCertificate']) if(target[field]!==undefined && typeof target[field]!=='boolean')throw new Error('Invalid database TLS option.');
  }
  for(const [name,environment] of Object.entries(project.environments)) {
    if(!identifier(name))throw new Error('Invalid environment identifier.');
    keys(environment,['environmentMode','apiTargets','databaseTargets','browserTargets','capabilities'],'environment');
    if(!['test','protected','custom'].includes(environment.environmentMode))throw new Error('Choose test, protected or custom explicitly.');
    for(const [field,registry] of [['apiTargets',targets.api],['databaseTargets',targets.databases],['browserTargets',targets.browser??{}]]) {
      const refs=field==='browserTargets' ? environment[field]??[] : environment[field];
      if(!Array.isArray(refs) || refs.some(ref=>!identifier(ref) || !Object.hasOwn(registry,ref)) || new Set(refs).size!==refs.length)throw new Error('Unknown or duplicate environment target reference.');
    }
    if(environment.capabilities!==undefined) {
      keys(environment.capabilities,capabilityNames,'capability overrides');
      if(Object.values(environment.capabilities).some(v=>typeof v!=='boolean'))throw new Error('Capability overrides must be booleans.');
    }
  }
  if(!Object.hasOwn(project.environments,project.defaultEnvironment))throw new Error('Default environment is not configured.');
  return {project:structuredClone(project),targets:structuredClone(targets)};
}
/** Configuration only: no secrets are resolved and no operation is dispatched. */
export function loadEnvironment(roots,name) {
  const config=validateConfiguration(readJson(consumerPath(roots,'.harness/project.json')),readJson(consumerPath(roots,'.harness/targets.json')));
  name=name??config.project.defaultEnvironment;
  if(!identifier(name) || !Object.hasOwn(config.project.environments,name))throw new Error('Unknown environment.');
  const environment=config.project.environments[name];
  return {name,...environment,targets:{api:Object.fromEntries(environment.apiTargets.map(id=>[id,config.targets.api[id]])),databases:Object.fromEntries(environment.databaseTargets.map(id=>[id,config.targets.databases[id]])),...(environment.browserTargets?{browser:Object.fromEntries(environment.browserTargets.map(id=>[id,config.targets.browser[id]]))}:{})}};
}
