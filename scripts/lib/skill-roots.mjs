import {existsSync,lstatSync,realpathSync,mkdirSync,symlinkSync,readdirSync} from 'node:fs';
import {resolve,relative,isAbsolute,dirname,basename,join} from 'node:path';

export const within=(root,path)=>{const rel=relative(root,path);return rel==='' || (!isAbsolute(rel) && rel!=='..' && !rel.startsWith('../') && !rel.startsWith('..\\'));};
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
