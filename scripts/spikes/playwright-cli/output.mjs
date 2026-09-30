// M4-only output preflight. Validate before creating even intermediate directories.
import {mkdir,realpath,readFile,readdir} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute,sep,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

function within(root,path) {const rel=relative(root,path);return !isAbsolute(rel) && rel!=='..' && !rel.startsWith(`..${sep}`);}

export async function resolvePackageRoot(spikeRoot) {
  const spike=await realpath(spikeRoot),candidate=resolve(spike,'../../..');
  if(relative(candidate,spike).replaceAll('\\','/')!=='scripts/spikes/playwright-cli')return spike; // Standalone container package.
  const manifest=JSON.parse(await readFile(join(candidate,'package.json'),'utf8'));
  if(manifest.name!=='playwright-pom-harness')throw new Error('unrecognized enclosing harness package');
  return candidate;
}

async function allowedDevelopmentOutput(root,path) {
  if(!within(join(root,'.validation','m4'),path))return false;
  const args=['-c',`safe.directory=${root.replaceAll('\\','/')}`,'-C',root];
  const checkout=spawnSync('git',[...args,'rev-parse','--show-toplevel'],{encoding:'utf8',windowsHide:true,timeout:10000});
  if(checkout.status!==0 || await realpath(checkout.stdout.trim())!==root)return false;
  const ignored=spawnSync('git',[...args,'check-ignore','--quiet','--',path],{windowsHide:true,timeout:10000});
  return ignored.status===0;
}

export async function prepareOutput(packageRoot,argument) {
  const root=await realpath(packageRoot),output=resolve(argument);
  let ancestor=dirname(output),existing;
  for(;;) {
    try {existing=await realpath(ancestor);break;}
    catch(error) {if(error.code!=='ENOENT' || dirname(ancestor)===ancestor)throw error;ancestor=dirname(ancestor);}
  }
  const physical=resolve(existing,relative(ancestor,output));
  // Check both spelling and resolved ancestry, including junctions/symlinks.
  for(const path of new Set([output,physical]))if(within(root,path) && !await allowedDevelopmentOutput(root,path))throw new Error('output must be outside package content or in ignored checkout .validation/m4 storage');
  await mkdir(dirname(output),{recursive:true,mode:0o700});
  await mkdir(output,{mode:0o700}); // Refuse to replace an earlier attempt.
  return output;
}

export async function snapshotPackage(packageRoot,spikeRoot) {
  const paths=new Set();
  async function walk(directory) {
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      const path=join(directory,entry.name);
      if(entry.isDirectory())await walk(path);else if(entry.isFile())paths.add(path);
    }
  }
  await walk(spikeRoot); // Include the installed, pinned native dependencies.
  if(packageRoot!==spikeRoot) {
    const {inventory}=await import(pathToFileURL(join(packageRoot,'scripts/lib/package-validation.mjs')).href);
    for(const path of inventory(packageRoot).files)paths.add(join(packageRoot,path));
  }
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  const rows=await Promise.all([...paths].sort().map(async path=>`${relative(packageRoot,path)}:${sha(await readFile(path))}`));
  return {files:paths.size,digest:sha(rows.join('\n'))};
}
