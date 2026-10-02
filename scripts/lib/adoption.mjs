import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync,realpathSync,rmSync} from 'node:fs';
import {join,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {consumerRoots,consumerPath,packageRoot} from './consumer-paths.mjs';
import {discoveryEntry,harnessSkillTarget,createSkillLink,removeSkillLink} from './skill-roots.mjs';
import {identifier,readJson,validateConfiguration} from './project-config.mjs';
import {secretFindings} from './package-validation.mjs';

const digest=bytes=>createHash('sha256').update(bytes.toString('utf8').replaceAll('\r\n','\n')).digest('hex');
const posix=path=>path.replaceAll('\\','/');
const mutable=[
  ['.claude/skills/framework-review/class-ledger.md','.harness/state/review/class-ledger.md','.agents/skills/framework-review/assets/class-ledger-template.md'],
  ['.claude/skills/automate-suite/references/prerequisite-dictionary.md','.harness/knowledge/prerequisites.md','.agents/skills/automate-suite/assets/prerequisite-dictionary-template.md'],
  ['.claude/skills/plan-tracker/data/history.jsonl','.harness/state/tracker/history.jsonl','.agents/skills/plan-tracker/assets/history-template.jsonl'],
];
/** Each host discovers project skills in its own folder; both link to the same installed copy. */
export const DISCOVERY_DIRS=['.agents/skills','.claude/skills'];
export const LINKS_FILE='.harness/links.json';
const BLOCK_START='<!-- playwright-pom-harness -->',BLOCK_END='<!-- /playwright-pom-harness -->';
const instruction=`${BLOCK_START}\nUse the harness skills linked under \`.claude/skills\` and \`.agents/skills\`; resolve linked skills to their real package path for references. To install, update or configure the harness, follow the \`harness-setup\` skill. If the harness skills are missing, run \`npx --no pom-harness setup\`. Keep package content immutable and consumer state under \`.harness\`. Preserve this project's existing instructions and code. Imported team libraries are derive-only.\n\n`+
  `Never commit or push directly to the default branch. Reuse the ongoing feature branch and add commits; otherwise create one named \`automation/<source-id>-<slug>\` for generated suites, \`harness/<topic>\` for harness setup or updates, \`feature/<topic>\` for new framework code, or \`fix/<topic>\` for fixes. Deliver through a pull request, and commit, push or open one only with the user's authorization.\n${BLOCK_END}`;
/** The managed block this version writes; releases record its digest in scripts/managed-digests.json. */
export const INSTRUCTION_BLOCK=instruction;
// Skills link `../ROOTS.md`. Only skill folders are linked, so this pointer leads into the installed copy.
const pointer=href=>`# Package and consumer boundaries\n\nThe harness skills in this folder are links into the installed package. Read [ROOTS.md in the installed harness](${href}).\n`;
export const isPointer=text=>/^# Package and consumer boundaries\n\nThe harness skills in this folder are links into the installed package\. Read \[ROOTS\.md in the installed harness\]\([^)\n]+\)\.\n$/.test(text.replaceAll('\r\n','\n'));
/** The pointer file for one discovery folder, relative to wherever the package is installed. */
export const rootsPointer=(roots,dir)=>pointer(posix(relative(dirname(consumerPath(roots,`${dir}/ROOTS.md`)),join(roots.packageRoot,'.agents/skills/ROOTS.md'))));
/** Redirect for a legacy instruction file that must stay because its folder still holds team data. */
function redirectText(file) {
  const [, , name, ...rest]=file.split('/'),canonical=`${'../'.repeat(rest.length+2)}.agents/skills/${name}/${rest.join('/')}`;
  return rest.join('/')==='SKILL.md'
    ?`---\nname: ${name}\ndescription: Compatibility entrypoint for ${name}; use the canonical skill.\n---\n\n# ${name} — compatibility reference\n\nRead [the canonical content](${canonical}) and its linked references.\nNo separate rules or mutable project state are maintained here.\n`
    :`# ${name} — compatibility reference\n\nRead [the canonical content](${canonical}).\nNo separate rules or mutable project state are maintained here.\n`;
}
export class AdoptionConflict extends Error {
  constructor(conflicts) {super(`Adoption stopped before any change:\n${conflicts.map(item=>`- ${item}`).join('\n')}`);this.conflicts=conflicts;}
}

/** Plan every change before writing: conflicts never silently overwrite consumer work.
 * All conflicts are collected and reported together. A journal, when given, sees each
 * file, folder and link before it changes, so the caller can restore the run.
 */
export function adoptProject({projectRoot,installedRoot=packageRoot,environment,mode,dryRun=false,journal}) {
  const roots=consumerRoots(projectRoot,installedRoot),actions=[],links=[],folders=[],conflicts=[],reports=[],kept=new Set();
  // Legacy state is read only from real .claude/skills folders; a harness link there resolves into the package.
  const legacySkills=new Set();
  const conflict=message=>{conflicts.push(message);};
  const receiptPath=consumerPath(roots,'.harness/installation.json');
  const previous=existsSync(receiptPath)?readJson(receiptPath):{migrated:{}};
  const migrated={...previous.migrated};
  const skills=readdirSync(join(roots.packageRoot,'.agents/skills')).filter(n=>existsSync(join(roots.packageRoot,'.agents/skills',n,'SKILL.md'))).sort();
  if(!skills.length)throw new Error('No canonical skills available.');
  const packageVersion=readFileSync(join(roots.packageRoot,'VERSION'),'utf8').trim();
  const planFile=(file,content,{merge=false}={})=>{
    const target=consumerPath(roots,file),bytes=Buffer.from(content);
    if(existsSync(target)) {
      // Compared newline-normalized: a CRLF checkout of an unchanged file is not a change.
      if(digest(readFileSync(target))===digest(bytes))return;
      if(!merge)return conflict(`Existing consumer content needs review: ${file}`);
      actions.push({kind:'replace',file,target,bytes,before:digest(readFileSync(target))});
    } else actions.push({kind:'create',file,target,bytes});
  };
  const migrateState=(legacy,destination,content)=>{
    const fingerprint=digest(content);
    if(migrated[legacy]?.sha256===fingerprint && migrated[legacy]?.destination===destination && existsSync(consumerPath(roots,destination)))return;
    if(secretFindings(legacy,content.toString('utf8')).length)return conflict(`Legacy state contains credential-like literals; sanitize before migration: ${legacy}`);
    planFile(destination,content);migrated[legacy]={sha256:fingerprint,destination};
  };

  // Known harness-shipped contents of legacy .claude/skills files, as newline-normalized digests.
  const legacyHashes=readJson(join(roots.packageRoot,'scripts/legacy-skill-hashes.json'));
  const redirectHashes=readJson(join(roots.packageRoot,'scripts/redirect-skill-hashes.json'));
  const isRedirect=(file,hash)=>(redirectHashes[file]??[]).includes(hash) || (file.endsWith('.md') && digest(redirectText(file))===hash);
  const knownInstruction=(file,hash)=>legacyHashes[file]===hash || isRedirect(file,hash);
  const destinations=new Map(mutable.map(([legacy,destination])=>[legacy,destination]));
  const dataDestination=file=>destinations.get(file) ?? (/^\.claude\/skills\/plan-tracker\/data\/plan-\d+\.json$/.test(file)?`.harness/state/tracker/${file.split('/').pop()}`:undefined);
  // Without a readable git index every path counts as tracked, so nothing shared is dropped.
  const tracked=paths=>{
    if(!paths.length)return [];
    const result=spawnSync('git',['ls-files','-z','--',...paths],{cwd:roots.projectRoot,encoding:'utf8',windowsHide:true});
    if(result.status!==0)return paths;
    const listed=new Set(result.stdout.split('\0').filter(Boolean));return paths.filter(path=>listed.has(path));
  };

  const linksPath=consumerPath(roots,LINKS_FILE);let listed=[];
  if(existsSync(linksPath)) {
    const record=readJson(linksPath);
    if(record?.version!==1 || !Array.isArray(record.links) || record.links.some(path=>typeof path!=='string' || !/^\.(?:agents|claude)\/skills\/[a-z][a-z0-9-]*$/.test(path)))conflict(`Review ${LINKS_FILE}; it is not a harness link record.`);
    else listed=record.links;
  }
  const planLegacyFolder=(rel,path,source)=>{
    const files=[],nested=[];
    const visit=dir=>{for(const entry of readdirSync(dir,{withFileTypes:true})){const child=join(dir,entry.name);if(entry.isSymbolicLink())nested.push(child);else if(entry.isDirectory())visit(child);else files.push(posix(relative(roots.projectRoot,child)));}};
    visit(path);
    if(nested.length)return conflict(`Review linked files inside the legacy skill folder ${rel} before migration.`);
    const data=[],instructions=[];
    for(const file of files) {
      const hash=digest(readFileSync(join(roots.projectRoot,file)));
      if(dataDestination(file) && !isRedirect(file,hash))data.push(file);
      else if(knownInstruction(file,hash))instructions.push({file,hash});
      else return conflict(`Customized legacy skill needs a manual merge: ${file}`);
    }
    // Data is copied by the migration below. A folder whose tracked team data would only
    // survive as an untracked copy under .harness/state stays, and the user decides.
    const shared=tracked(data.filter(file=>dataDestination(file).startsWith('.harness/state/')));
    if(shared.length) {
      kept.add(rel);
      reports.push(`Kept ${rel}: it holds team data tracked in git (${shared.join(', ')}). Its migrated copy under .harness/state is not tracked, so decide where that data should live, then remove the folder and rerun setup.`);
      for(const {file,hash} of instructions)if(file.endsWith('.md') && !isRedirect(file,hash))planFile(file,redirectText(file),{merge:true});
      return;
    }
    folders.push({rel,path,files});links.push({kind:'create',rel,path,source});
  };
  for(const dir of DISCOVERY_DIRS) {
    const parent=consumerPath(roots,dir); // A discovery folder resolving outside the project or into the package is refused.
    for(const name of skills) {
      const rel=`${dir}/${name}`,path=join(parent,name),source=join(roots.packageRoot,'.agents/skills',name),entry=discoveryEntry(path);
      if(dir==='.claude/skills' && entry.kind==='directory')legacySkills.add(name);
      if(entry.kind==='missing') {links.push({kind:'create',rel,path,source});continue;}
      if(entry.kind==='link') {
        if(entry.live && realpathSync(path)===realpathSync(source))continue;
        // Only a link is ever repaired; listing a path never authorizes replacing content.
        if(harnessSkillTarget(entry,name) || (!entry.live && listed.includes(rel)))links.push({kind:'repair',rel,path,source,previous:entry.target});
        else conflict(`${rel} links to something other than this harness; review or remove it.`);
        continue;
      }
      if(entry.kind==='file') {conflict(`${rel} is a file where the harness links a skill; review it.`);continue;}
      if(dir==='.claude/skills') {planLegacyFolder(rel,path,source);continue;}
      const copy=existsSync(join(path,'SKILL.md')) && digest(readFileSync(join(path,'SKILL.md')))===digest(readFileSync(join(source,'SKILL.md')));
      conflict(copy?`${rel} is a committed copy of the harness skill; run "git rm -r --cached ${rel}", delete the folder, then rerun setup.`:`Customized skill needs a manual merge: ${rel}`);
    }
  }
  for(const rel of listed) {
    const name=rel.split('/').pop();if(skills.includes(name))continue;
    const path=join(roots.projectRoot,rel),entry=discoveryEntry(path);
    if(entry.kind==='missing')continue;
    if(entry.kind==='link' && (!entry.live || harnessSkillTarget(entry,name)))links.push({kind:'remove',rel,path,previous:entry.target});
    else reports.push(`Kept ${rel}: the harness no longer ships this skill, and the entry is not a harness link.`);
  }
  for(const dir of DISCOVERY_DIRS) {
    const file=`${dir}/ROOTS.md`,target=consumerPath(roots,file);
    if(existsSync(target) && !isPointer(readFileSync(target,'utf8'))) {conflict(`Review ${file}; the harness writes a pointer file there.`);continue;}
    planFile(file,rootsPointer(roots,dir),{merge:true});
  }
  const managedLinks=DISCOVERY_DIRS.flatMap(dir=>skills.map(name=>`${dir}/${name}`)).filter(rel=>!kept.has(rel));
  const managedFiles=DISCOVERY_DIRS.map(dir=>`${dir}/ROOTS.md`);
  planFile(LINKS_FILE,JSON.stringify({version:1,links:managedLinks,files:managedFiles},null,2)+'\n',{merge:true});

  // Configuration is optional: environments are added deliberately, with their mode.
  const configPath=consumerPath(roots,'.harness/project.json'),targetPath=consumerPath(roots,'.harness/targets.json');
  if(existsSync(configPath) || environment!==undefined) {
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
  } else if(mode!==undefined)throw new Error('Choose an environment identifier.');

  for(const [legacy,destination,template] of mutable) {
    const target=consumerPath(roots,destination),source=legacySkills.has(legacy.split('/')[2])?consumerPath(roots,legacy):undefined;
    if(source && existsSync(source) && !isRedirect(legacy,digest(readFileSync(source))))migrateState(legacy,destination,readFileSync(source));
    else if(!existsSync(target))planFile(destination,readFileSync(join(roots.packageRoot,template)));
  }
  const legacyTracker=legacySkills.has('plan-tracker')?consumerPath(roots,'.claude/skills/plan-tracker/data'):undefined;
  if(legacyTracker && existsSync(legacyTracker))for(const name of readdirSync(legacyTracker).filter(n=>/^plan-\d+\.json$/.test(n))) {
    const file=consumerPath(roots,`.claude/skills/plan-tracker/data/${name}`),content=readFileSync(file);
    migrateState(`.claude/skills/plan-tracker/data/${name}`,`.harness/state/tracker/${name}`,content);
  }
  const legacyPages=consumerPath(roots,'.agentex/page-map');
  if(existsSync(legacyPages))for(const name of readdirSync(legacyPages).filter(n=>n.endsWith('.md'))) {
    const file=consumerPath(roots,`.agentex/page-map/${name}`),content=readFileSync(file);
    migrateState(`.agentex/page-map/${name}`,`.harness/knowledge/ui/${name}`,content);
  }
  // Instruction blocks compare newline-normalized text, so a CRLF checkout reruns cleanly.
  // A block matching an earlier released text is replaced; an edited block stops adoption.
  const releasedBlocks=readJson(join(roots.packageRoot,'scripts/managed-digests.json')).instructionBlocks;
  for(const file of ['AGENTS.md','CLAUDE.md']) {
    const path=consumerPath(roots,file),existing=existsSync(path)?readFileSync(path,'utf8'):'';
    const eol=existing.includes('\r\n')?'\r\n':'\n',normalized=existing.replaceAll('\r\n','\n'),start=normalized.indexOf(BLOCK_START);
    if(start<0) {planFile(file,existing+(existing?eol+eol:'')+instruction.replaceAll('\n',eol)+eol,{merge:true});continue;}
    const end=normalized.indexOf(BLOCK_END,start);
    if(end<0) {conflict(`Review the incomplete harness instruction block in ${file}.`);continue;}
    const block=normalized.slice(start,end+BLOCK_END.length);
    if(block===instruction)continue;
    if(!releasedBlocks.includes(digest(block))) {conflict(`Review the edited harness instruction block in ${file}.`);continue;}
    planFile(file,(normalized.slice(0,start)+instruction+normalized.slice(end+BLOCK_END.length)).replaceAll('\n',eol),{merge:true});
  }
  const ignorePath=consumerPath(roots,'.gitignore'),ignore=existsSync(ignorePath)?readFileSync(ignorePath,'utf8'):'';
  const ignoreLines=['/.harness/runs/','/.harness/state/','/.harness/knowledge-candidates/','/.harness/installation.json',
    '.env','.env.*','!.env.example','.claude/settings.local.json','*.pfx','*.key',
    'node_modules/','test-results/','playwright-report/','blob-report/','playwright/.cache/','playwright/.auth/',
    'allure-report/','allure-results/','reports/','ctrf/','.playwright-cli/','/executions/','/test/','.agentex/cache/',
    // Links and pointers are machine-specific; no trailing slash, so a Linux symlink matches too.
    ...[...managedLinks,...managedFiles].map(rel=>`/${rel}`)];
  const absent=ignoreLines.filter(line=>!ignore.split(/\r?\n/).includes(line));
  // Git uses the last matching rule: a newly appended broad rule must not
  // override an existing exception for the shareable environment template.
  if(absent.includes('.env.*') && !absent.includes('!.env.example'))absent.splice(absent.indexOf('.env.*')+1,0,'!.env.example');
  if(absent.length)planFile('.gitignore',ignore+(ignore?'\n':'')+absent.join('\n')+'\n',{merge:true});
  for(const resource of ['Queries','apisCollections'])if(!existsSync(consumerPath(roots,`resources/${resource}/README.md`)))planFile(`resources/${resource}/README.md`,readFileSync(join(roots.packageRoot,`resources/${resource}/README.md`)));
  planFile('.harness/installation.json',JSON.stringify({packageVersion,migrated},null,2)+'\n',{merge:true});
  if(conflicts.length)throw new AdoptionConflict(conflicts);

  if(!dryRun) {
    for(const action of actions) {
      const current=consumerPath(roots,action.file);
      if(current!==action.target || (action.kind==='replace' && digest(readFileSync(current))!==action.before))throw new Error('Consumer changed after adoption planning; rerun the plan.');
      journal?.file?.(action.file,action.kind==='replace'?readFileSync(current):null);
      mkdirSync(dirname(current),{recursive:true});writeFileSync(current,action.bytes,{flag:action.kind==='create'?'wx':'w'});
    }
    for(const folder of folders) {
      if(discoveryEntry(folder.path).kind!=='directory')throw new Error('Consumer changed after adoption planning; rerun the plan.');
      journal?.folder?.(folder.rel,folder.path);rmSync(folder.path,{recursive:true});
    }
    for(const link of links) {
      journal?.link?.(link.rel,link.previous??null);
      if(link.kind!=='create')removeSkillLink(link.path);
      if(link.kind!=='remove')createSkillLink(link.source,link.path);
    }
  }
  return {status:dryRun?'PLANNED':'ADOPTED',environment,skills:skills.length,changes:actions.map(({kind,file})=>({kind,file})),
    links:links.map(({kind,rel})=>({kind,path:rel})),removedFolders:folders.map(({rel})=>rel),reports,packageVersion};
}
