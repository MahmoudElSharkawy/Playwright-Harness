#!/usr/bin/env node
import {adoptProject} from './lib/adoption.mjs';
try {
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--dry-run'){options.dryRun=true;continue;}
    const key={'--project-root':'projectRoot','--environment':'environment','--mode':'mode'}[args[i]];
    if(!key || !args[i+1] || args[i+1].startsWith('--') || Object.hasOwn(options,key))throw new Error('Invalid adoption arguments.');
    options[key]=args[++i];
  }
  if(!options.projectRoot)throw new Error('--project-root is required.');
  console.log(JSON.stringify(adoptProject(options),null,2));
} catch(error) {console.error(`Adoption stopped: ${error.message}`);process.exitCode=1;}
