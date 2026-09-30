// M4-only output preflight. Validate before creating even intermediate directories.
import {mkdir,realpath} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';

export async function prepareOutput(packageRoot,argument) {
  const root=await realpath(packageRoot),output=resolve(argument);
  let ancestor=dirname(output),existing;
  for(;;) {
    try {existing=await realpath(ancestor);break;}
    catch(error) {if(error.code!=='ENOENT' || dirname(ancestor)===ancestor)throw error;ancestor=dirname(ancestor);}
  }
  const rel=relative(root,existing);
  if(!isAbsolute(rel) && rel!=='..' && !rel.startsWith(`..${sep}`))throw new Error('output must be outside installed spike content');
  await mkdir(dirname(output),{recursive:true,mode:0o700});
  await mkdir(output,{mode:0o700}); // Refuse to replace an earlier attempt.
  return output;
}
