// M2's six-case proof only. This is not a runtime result contract or host adapter.
import {readFileSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';

const rules=new Map([
  ['stable-id',['id','button']], ['name-attribute',['name','input']],
  ['test-attribute',['test-attribute','input']], ['dynamic-card',['scoped-dynamic','button']],
  ['collection',['collection','list']], ['upload',['raw-file-input','input']],
]);
const references=['.claude/skills/pom-architecture/references/design-conventions.md','.agents/skills/element-locators/references/playbook.md'];
const skill='.agents/skills/element-locators/SKILL.md';
const textContent=value=>typeof value==='string'?value:Array.isArray(value)?value.map(v=>v.type==='text'?v.text:'').join('\n'):'';
const normalize=text=>text.replaceAll('\r','').split('\n').map(line=>line.replace(/^\s*\d+[→\t]/,'').trimEnd()).join('\n').trim();
const samePath=(a,b)=>{try{return realpathSync(a)===realpathSync(b);}catch{return false;}};

export function parseEvents(text) {
  const lines=text.trim().split(/\r?\n/).filter(Boolean);
  if(!lines.length)throw new Error('empty host events');
  return lines.map(line=>JSON.parse(line));
}

/** Require a successful native tool result containing the actual reference, not a self-report. */
function observedRead(host,events,path,projectRoot,content) {
  if(host==='codex')return events.some(event=>{
    const item=event.item;
    if(event.type!=='item.completed' || item?.type!=='command_execution' || item.exit_code!==0 || item.status!=='completed')return false;
    if(!/\b(?:Get-Content|cat)\b/.test(item.command))return false;
    // Native Windows event commands can escape each backslash a second time.
    const slashPath=value=>value.replace(/[\\/]+/g,'/');
    const command=slashPath(item.command);
    const relativePath=path.startsWith(projectRoot)?path.slice(projectRoot.length+1):null;
    const pathNamed=command.includes(slashPath(path)) || (relativePath && command.includes(slashPath(relativePath)));
    return pathNamed && normalize(item.aggregated_output??'').includes(normalize(content));
  });
  const reads=events.flatMap(e=>e.type==='assistant'?e.message?.content??[]:[]).filter(b=>b.type==='tool_use' && b.name==='Read' && typeof b.input?.file_path==='string' && samePath(resolve(projectRoot,b.input.file_path),path));
  return reads.some(read=>events.some(e=>e.type==='user' && (e.message?.content??[]).some(result=>result.type==='tool_result' && result.tool_use_id===read.id && result.is_error!==true && normalize(textContent(result.content)).includes(normalize(content)))));
}

export function assessHost({host,answer,events,processResult,roots,packageUnchanged,discovery}) {
  const choices=Array.isArray(answer?.choices)?answer.choices:[];
  const declared=Array.isArray(answer?.referencesRead)?answer.referencesRead:[];
  const requirements={
    processSuccess:processResult?.exitCode===0 && processResult?.timedOut!==true,
    packageUnchanged:processResult?.packageUnchanged===true && packageUnchanged===true,
    allCases:choices.length===rules.size && new Set(choices.map(c=>c?.caseId)).size===rules.size,
    ruleDecisions:choices.length>0 && choices.every(c=>{
      const rule=rules.get(c?.caseId);
      return rule && c.strategy===rule[0] && c.private===true && c.usesIndex===false && typeof c.reason==='string' && c.reason.trim().length>0 && new RegExp('^[a-z][A-Za-z0-9]*_'+rule[1]+'$').test(c.locatorName);
    }),
    referencesDeclared:references.every(file=>declared.includes(file)),
    referenceReads:references.every(file=>observedRead(host,events,join(roots.packageRoot,file),roots.projectRoot,readFileSync(join(roots.packageRoot,file),'utf8'))),
    fixtureRead:observedRead(host,events,join(roots.projectRoot,'locator-cases.json'),roots.projectRoot,readFileSync(join(roots.projectRoot,'locator-cases.json'),'utf8')),
    canonicalSkillRead:observedRead(host,events,join(roots.packageRoot,skill),roots.projectRoot,readFileSync(join(roots.packageRoot,skill),'utf8')),
  };
  const skillPath=join(roots.packageRoot,skill);
  if(host==='codex') {
    requirements.nativeDiscovery=discovery?.found?.length===1 && discovery.errors?.length===0 && discovery.found[0].enabled!==false && samePath(discovery.found[0].path,skillPath);
    requirements.completedTurn=events.some(e=>e.type==='turn.completed') && !events.some(e=>e.type==='turn.failed');
  } else {
    const init=events.find(e=>e.type==='system' && e.subtype==='init');
    const plugins=init?.plugins?.filter(p=>p.name==='playwright-pom-harness')??[];
    requirements.nativePlugin=plugins.length===1 && samePath(plugins[0].path,roots.packageRoot) && init.skills?.includes('playwright-pom-harness:element-locators');
    const result=events.findLast(e=>e.type==='result');
    requirements.completedTurn=result?.is_error===false && result?.structured_output!==undefined;
  }
  const semantic=choices.map(c=>({caseId:c?.caseId,strategy:c?.strategy,private:c?.private,usesIndex:c?.usesIndex})).sort((a,b)=>String(a.caseId).localeCompare(String(b.caseId)));
  return {host,status:Object.values(requirements).every(v=>v===true)?'PASS':'FAIL',cases:choices.length,requirements,semantic};
}

export function semanticParity(hosts) {
  return hosts.length===2 && new Set(hosts.map(h=>h.host)).size===2 && hosts.every(h=>h.status==='PASS') && JSON.stringify(hosts[0].semantic)===JSON.stringify(hosts[1].semantic);
}
