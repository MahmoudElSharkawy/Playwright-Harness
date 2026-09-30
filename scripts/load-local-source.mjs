#!/usr/bin/env node
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {projectArgument,consumerPath} from './lib/consumer-paths.mjs';
import {loadLocalSource} from './lib/local-source.mjs';
import {loadEnvironment} from './lib/project-config.mjs';
try {
  const {roots,args}=projectArgument();const options={};
  for(let i=0;i<args.length;i+=2) {
    if(!['--source','--environment','--out'].includes(args[i]) || !args[i+1] || args[i+1].startsWith('--') || Object.hasOwn(options,args[i]))throw new Error('Use --source <file>, optional --environment <name> and --out <consumer-file>.');
    options[args[i]]=args[i+1];
  }
  if(!options['--source'])throw new Error('--source is required.');
  const environment=loadEnvironment(roots,options['--environment']),source=loadLocalSource(roots,options['--source']);
  if(options['--out']) {
    const output=consumerPath(roots,options['--out']);mkdirSync(dirname(output),{recursive:true});
    writeFileSync(output,JSON.stringify(source,null,2)+'\n',{flag:'wx'});
  }
  console.log(JSON.stringify({status:'LOADED',environment:environment.name,environmentMode:environment.environmentMode,scenarios:source.scenarios.length,steps:source.scenarios.reduce((n,s)=>n+s.steps.length,0),expectations:source.scenarios.reduce((n,s)=>n+s.steps.reduce((a,step)=>a+step.expected.length,0),0),executed:false}));
} catch {console.error('Local source not loaded: check configuration, source structure and consumer output path. No source content emitted.');process.exitCode=1;}
