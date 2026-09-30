import {realpathSync,lstatSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {realFuture,within} from './skill-roots.mjs';

export const packageRoot=realpathSync(resolve(dirname(fileURLToPath(import.meta.url)),'../..'));
export function consumerRoots(projectRoot=process.cwd(),installedRoot=packageRoot) {
  projectRoot=realpathSync(projectRoot);installedRoot=realpathSync(installedRoot);
  if(!lstatSync(projectRoot).isDirectory() || projectRoot===installedRoot || within(installedRoot,projectRoot))throw new Error('Use a separate consumer project, outside the installed package.');
  return Object.freeze({projectRoot,packageRoot:installedRoot});
}
/** Reject both lexical and resolved escapes; linked package content is never writable. */
export function consumerPath(roots,path) {
  const absolute=resolve(roots.projectRoot,path),actual=realFuture(absolute);
  if(!within(roots.projectRoot,absolute) || !within(roots.projectRoot,actual) || within(roots.packageRoot,actual) || actual===roots.projectRoot)throw new Error('Path must stay in consumer storage, outside the package.');
  return actual;
}
export function projectArgument(args=process.argv.slice(2)) {
  const index=args.indexOf('--project-root');
  if(index<0)return {roots:consumerRoots(),args};
  const value=args[index+1];if(!value || value.startsWith('--'))throw new Error('--project-root needs a directory');
  return {roots:consumerRoots(value),args:args.filter((_,i)=>i!==index && i!==index+1)};
}
