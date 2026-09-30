import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync} from 'node:fs';
import {join,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {consumerRoots,consumerPath,packageRoot} from './consumer-paths.mjs';
import {linkSkill} from './skill-roots.mjs';
import {identifier,readJson,validateConfiguration} from './project-config.mjs';
import {secretFindings} from './package-validation.mjs';

const digest=bytes=>createHash('sha256').update(bytes.toString('utf8').replaceAll('\r\n','\n')).digest('hex');
const mutable=[
  ['.claude/skills/framework-review/class-ledger.md','.harness/state/review/class-ledger.md','.agents/skills/framework-review/assets/class-ledger-template.md'],
  ['.claude/skills/automate-suite/references/prerequisite-dictionary.md','.harness/knowledge/prerequisites.md','.agents/skills/automate-suite/assets/prerequisite-dictionary-template.md'],
  ['.claude/skills/plan-tracker/data/history.jsonl','.harness/state/tracker/history.jsonl','.agents/skills/plan-tracker/assets/history-template.jsonl'],
];
const instruction='<!-- playwright-pom-harness -->\nUse the canonical skills discovered under `.agents/skills`. Resolve linked skills to their real package path for references. Keep package content immutable and consumer state under `.harness`. Preserve this project\'s existing instructions and code. Imported team libraries are derive-only.\n<!-- /playwright-pom-harness -->';

/** Plan every change before writing: conflicts never silently overwrite consumer work. */
export function adoptProject({projectRoot,installedRoot=packageRoot,environment,mode,dryRun=false}) {
  const roots=consumerRoots(projectRoot,installedRoot),actions=[];
  const receiptPath=consumerPath(roots,'.harness/installation.json');
  const previous=existsSync(receiptPath)?readJson(receiptPath):{migrated:{}};
  const migrated={...previous.migrated};
  const skills=readdirSync(join(roots.packageRoot,'.agents/skills')).filter(n=>existsSync(join(roots.packageRoot,'.agents/skills',n,'SKILL.md'))).sort();
  if(!skills.length)throw new Error('No canonical skills available.');
  const skillRoots={...roots,runRoot:consumerPath(roots,'.harness/runs')};
  const planFile=(file,content,{merge=false}={})=>{
    const target=consumerPath(roots,file),bytes=Buffer.from(content);
    if(existsSync(target)) {
      if(readFileSync(target).equals(bytes))return;
      if(!merge)throw new Error(`Existing consumer content needs review: ${file}`);
      actions.push({kind:'replace',file,target,bytes,before:digest(readFileSync(target))});
    } else actions.push({kind:'create',file,target,bytes});
  };
  const migrateState=(legacy,destination,content)=>{
    const fingerprint=digest(content);
    if(migrated[legacy]?.sha256===fingerprint && migrated[legacy]?.destination===destination && existsSync(consumerPath(roots,destination)))return;
    if(secretFindings(legacy,content.toString('utf8')).length)throw new Error('Legacy state contains credential-like literals; sanitize before migration.');
    planFile(destination,content);migrated[legacy]={sha256:fingerprint,destination};
  };
  for(const name of skills)linkSkill(skillRoots,name,{dryRun:true});

  // Replace only known, unchanged legacy instruction files; customized rules need a merge.
  const hashes=readJson(join(roots.packageRoot,'scripts/legacy-skill-hashes.json'));
  const mutablePaths=new Set(mutable.map(([file])=>file));
  const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
    const path=join(dir,e.name);if(e.isSymbolicLink())throw new Error('Review linked legacy skill files before migration.');
    return e.isDirectory()?walk(path):[path];
  });
  for(const name of skills) {
    const legacy=consumerPath(roots,`.claude/skills/${name}`);
    if(!existsSync(legacy))continue;
    for(const path of walk(legacy)) {
      const file=relative(roots.projectRoot,path).replaceAll('\\','/');
      if(mutablePaths.has(file) || /\/plan-tracker\/data\/plan-\d+\.json$/.test(file))continue;
      const content=readFileSync(path),replacement=join(roots.packageRoot,file);
      if(existsSync(replacement) && digest(content)===digest(readFileSync(replacement)))continue;
      if(hashes[file]!==digest(content))throw new Error(`Customized legacy skill needs a manual merge: ${file}`);
      if(file.endsWith('.md'))planFile(file,readFileSync(replacement),{merge:true});
      // Retain old immutable assets for compatibility; active scripts use package assets.
    }
  }
  const configPath=consumerPath(roots,'.harness/project.json'),targetPath=consumerPath(roots,'.harness/targets.json');
  const project=existsSync(configPath)?readJson(configPath):{version:1,defaultEnvironment:environment,environments:{}};
  environment=environment??project.defaultEnvironment;
  if(!identifier(environment))throw new Error('Choose an environment identifier.');
  const targets=existsSync(targetPath)?readJson(targetPath):{api:{},databases:{}};
  if(!Object.hasOwn(project.environments,environment)) {
    if(!['test','protected','custom'].includes(mode))throw new Error('Choose test, protected or custom explicitly.');
    project.environments[environment]={environmentMode:mode,apiTargets:[],databaseTargets:[]};
  } else if(mode && project.environments[environment].environmentMode!==mode)throw new Error('Changing an existing environment profile requires a reviewed configuration edit.');
  validateConfiguration(project,targets);
  // Preserve existing formatting unless an environment is actually added.
  if(!existsSync(configPath) || JSON.stringify(readJson(configPath))!==JSON.stringify(project))planFile('.harness/project.json',JSON.stringify(project,null,2)+'\n',{merge:true});
  if(!existsSync(targetPath))planFile('.harness/targets.json',JSON.stringify(targets,null,2)+'\n');

  for(const [legacy,destination,template] of mutable) {
    const source=consumerPath(roots,legacy),target=consumerPath(roots,destination);
    const packaged=join(roots.packageRoot,legacy);
    const isRedirect=legacy.endsWith('.md') && existsSync(source) && existsSync(packaged) && digest(readFileSync(source))===digest(readFileSync(packaged));
    if(existsSync(source) && !isRedirect) {
      const content=readFileSync(source);
      migrateState(legacy,destination,content);
    } else if(!existsSync(target))planFile(destination,readFileSync(join(roots.packageRoot,template)));
  }
  const legacyTracker=consumerPath(roots,'.claude/skills/plan-tracker/data');
  if(existsSync(legacyTracker))for(const name of readdirSync(legacyTracker).filter(n=>/^plan-\d+\.json$/.test(n))) {
    const file=consumerPath(roots,`.claude/skills/plan-tracker/data/${name}`),content=readFileSync(file);
    migrateState(`.claude/skills/plan-tracker/data/${name}`,`.harness/state/tracker/${name}`,content);
  }
  const legacyPages=consumerPath(roots,'.agentex/page-map');
  if(existsSync(legacyPages))for(const name of readdirSync(legacyPages).filter(n=>n.endsWith('.md'))) {
    const file=consumerPath(roots,`.agentex/page-map/${name}`),content=readFileSync(file);
    migrateState(`.agentex/page-map/${name}`,`.harness/knowledge/ui/${name}`,content);
  }
  for(const file of ['AGENTS.md','CLAUDE.md']) {
    const path=consumerPath(roots,file),existing=existsSync(path)?readFileSync(path,'utf8'):'';
    if(existing.includes('<!-- playwright-pom-harness -->')) {
      if(!existing.includes(instruction))throw new Error(`Review the existing harness instruction block in ${file}.`);
    } else planFile(file,existing+(existing?'\n\n':'')+instruction+'\n',{merge:true});
  }
  const ignorePath=consumerPath(roots,'.gitignore'),ignore=existsSync(ignorePath)?readFileSync(ignorePath,'utf8'):'';
  const ignoreLines=['/.harness/runs/','/.harness/state/','/.harness/knowledge-candidates/','/.harness/installation.json',
    '.env','.env.*','!.env.example','.claude/settings.local.json','*.pfx','*.key',
    'node_modules/','test-results/','playwright-report/','blob-report/','playwright/.cache/','playwright/.auth/',
    'allure-report/','allure-results/','reports/','ctrf/','.playwright-cli/','/executions/','/test/','.agentex/cache/'];
  const absent=ignoreLines.filter(line=>!ignore.split(/\r?\n/).includes(line));
  // Git uses the last matching rule: a newly appended broad rule must not
  // override an existing exception for the shareable environment template.
  if(absent.includes('.env.*') && !absent.includes('!.env.example'))absent.splice(absent.indexOf('.env.*')+1,0,'!.env.example');
  if(absent.length)planFile('.gitignore',ignore+(ignore?'\n':'')+absent.join('\n')+'\n',{merge:true});
  for(const resource of ['Queries','apisCollections'])if(!existsSync(consumerPath(roots,`resources/${resource}/README.md`)))planFile(`resources/${resource}/README.md`,readFileSync(join(roots.packageRoot,`resources/${resource}/README.md`)));
  planFile('.harness/installation.json',JSON.stringify({packageVersion:readFileSync(join(roots.packageRoot,'VERSION'),'utf8').trim(),migrated},null,2)+'\n',{merge:true});

  if(!dryRun) {
    for(const action of actions) {
      const current=consumerPath(roots,action.file);
      if(current!==action.target || (action.kind==='replace' && digest(readFileSync(current))!==action.before))throw new Error('Consumer changed after adoption planning; rerun the plan.');
      mkdirSync(dirname(current),{recursive:true});writeFileSync(current,action.bytes,{flag:action.kind==='create'?'wx':'w'});
    }
    for(const name of skills)linkSkill(skillRoots,name);
  }
  return {status:dryRun?'PLANNED':'ADOPTED',environment,skills:skills.length,changes:actions.map(({kind,file})=>({kind,file})),packageVersion:readFileSync(join(roots.packageRoot,'VERSION'),'utf8').trim()};
}
