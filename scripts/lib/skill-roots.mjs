import {existsSync,lstatSync,realpathSync,mkdirSync,symlinkSync,readdirSync,readlinkSync,readFileSync,statSync,rmdirSync,unlinkSync} from 'node:fs';
import {resolve,relative,isAbsolute,dirname,basename,join} from 'node:path';

export const within=(root,path)=>{const rel=relative(root,path);return rel==='' || (!isAbsolute(rel) && rel!=='..' && !rel.startsWith('../') && !rel.startsWith('..\\'));};
const sameName=(left,right)=>process.platform==='win32'?left.toLowerCase()===right.toLowerCase():left===right;
export function realFuture(path) {
  path=resolve(path);const tail=[];
  while(!existsSync(path)) {
    // Windows can report ENOENT from lstat for a dangling junction; its parent
    // directory still records the entry. Never treat that entry as empty space.
    if(existsSync(dirname(path)) && readdirSync(dirname(path)).some(name=>process.platform==='win32'?name.toLowerCase()===basename(path).toLowerCase():name===basename(path)))throw new Error('unresolvable existing path');
    try { if(lstatSync(path).isSymbolicLink()) throw new Error('dangling link'); } catch(error) {if(error.code!=='ENOENT')throw error;}
    const parent=dirname(path);if(parent===path)throw new Error('unresolvable root');tail.unshift(basename(path));path=parent;
  }
  return join(realpathSync(path),...tail);
}
/** Installation/proof paths only; this is not an execution-context contract. */
export function resolveSkillRoots({packageRoot,projectRoot,runRoot}) {
  for(const path of [packageRoot,projectRoot,runRoot])if(typeof path!=='string' || !isAbsolute(path))throw new Error('explicit absolute roots required');
  packageRoot=realpathSync(packageRoot);projectRoot=realpathSync(projectRoot);runRoot=realFuture(runRoot);
  if(!lstatSync(packageRoot).isDirectory() || !lstatSync(projectRoot).isDirectory())throw new Error('package/project roots must be directories');
  if(packageRoot===projectRoot || runRoot===projectRoot || !within(projectRoot,runRoot) || within(packageRoot,runRoot))throw new Error('run output must be inside the consumer and outside package storage');
  return Object.freeze({packageRoot,projectRoot,runRoot});
}
/** Expose one immutable package skill to native Codex discovery without copying rules. */
export function linkRepresentativeSkill(roots) {
  return linkSkill(roots,'element-locators');
}
export function linkSkill(roots,name,{dryRun=false}={}) {
  if(!/^[a-z][a-z0-9-]*$/.test(name))throw new Error('invalid skill name');
  roots=resolveSkillRoots(roots);
  const source=realpathSync(join(roots.packageRoot,'.agents/skills',name));
  if(!within(roots.packageRoot,source) || !existsSync(join(source,'SKILL.md')))throw new Error('representative skill is missing or escapes package');
  const target=join(roots.projectRoot,'.agents/skills',name);
  const parent=realFuture(dirname(target));
  if(!within(roots.projectRoot,parent) || within(roots.packageRoot,parent))throw new Error('consumer discovery directory escapes project');
  if(existsSync(target)) {
    if(realpathSync(target)!==source)throw new Error('existing consumer skill must not be overwritten');
    return target;
  }
  if(existsSync(parent) && readdirSync(parent).some(entry=>process.platform==='win32'?entry.toLowerCase()===name.toLowerCase():entry===name))throw new Error('existing discovery entry needs review');
  try {lstatSync(target);throw new Error('existing discovery entry needs review');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(dryRun)return target;
  mkdirSync(parent,{recursive:true});
  symlinkSync(source,target,process.platform==='win32'?'junction':'dir');
  return target;
}

/** Classify one discovery entry without following it. A dangling link is still a link, never empty space. */
export function discoveryEntry(path) {
  let found;
  try {found=readdirSync(dirname(path),{withFileTypes:true}).find(entry=>sameName(entry.name,basename(path)));}
  catch(error) {if(['ENOENT','ENOTDIR'].includes(error.code))return {kind:'missing'};throw error;}
  if(!found)return {kind:'missing'};
  let target;
  try {target=readlinkSync(path);} catch(error) {if(!['EINVAL','UNKNOWN'].includes(error.code))throw error;}
  if(target!==undefined) {
    let live=false;
    try {live=statSync(path).isDirectory();} catch(error) {if(error.code!=='ENOENT')throw error;}
    return {kind:'link',target:resolve(dirname(path),target.replace(/^\\\\\?\\/,'')),live};
  }
  return {kind:found.isDirectory()?'directory':'file'};
}
/** A live link to a skill inside some playwright-pom-harness copy: a previous version, a moved project or a sibling clone. */
export function harnessSkillTarget(entry,name) {
  if(entry.kind!=='link' || !entry.live)return false;
  const skill=realpathSync(entry.target);
  if(!sameName(basename(skill),name) || !existsSync(join(skill,'SKILL.md')))return false;
  try {return JSON.parse(readFileSync(join(skill,'..','..','..','package.json'),'utf8')).name==='playwright-pom-harness';} catch {return false;}
}
/** A junction on Windows (absolute by nature); elsewhere a relative symlink, so a moved project keeps working. */
export function createSkillLink(source,path) {
  mkdirSync(dirname(path),{recursive:true});
  if(process.platform==='win32')symlinkSync(source,path,'junction');
  else symlinkSync(relative(dirname(path),source),path,'dir');
}
/** Remove the discovery link itself; its target's content is never touched. */
export function removeSkillLink(path) {
  if(discoveryEntry(path).kind!=='link')throw new Error('Only a discovery link may be removed.');
  if(process.platform==='win32')rmdirSync(path);else unlinkSync(path);
}
