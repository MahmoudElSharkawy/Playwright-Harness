import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,relative,isAbsolute} from 'node:path';
import {parseEvents,assessHost,semanticParity} from '../scripts/lib/skill-proof-assessment.mjs';

function fixture(t,host='codex') {
  const base=realpathSync(tmpdir()),root=mkdtempSync(join(base,'pom-proof-'));
  t.after(()=>{const path=relative(base,realpathSync(root));assert(!isAbsolute(path) && path.startsWith('pom-proof-'));rmSync(root,{recursive:true});});
  const roots={packageRoot:join(root,'package'),projectRoot:join(root,'consumer')};
  const skill='.agents/skills/element-locators/SKILL.md';
  const references=['.agents/skills/pom-architecture/references/design-conventions.md','.agents/skills/element-locators/references/playbook.md'];
  const documents=[...references,skill].map(file=>[join(roots.packageRoot,file),`Synthetic ${file}\nSecond line.`]);
  documents.push([join(roots.projectRoot,'locator-cases.json'),'Synthetic six locator cases.']);
  const choices=[['stable-id','id','save_button'],['name-attribute','name','email_input'],['test-attribute','test-attribute','country_input'],['dynamic-card','scoped-dynamic','viewProduct_button'],['collection','collection','cards_list'],['upload','raw-file-input','attachment_input']].map(([caseId,strategy,locatorName])=>({caseId,strategy,locatorName,private:true,usesIndex:false,reason:'Synthetic rule application.'}));
  const answer={choices,referencesRead:references};
  const events=[];
  for(const [path,content] of documents) {
    mkdirSync(dirname(path),{recursive:true});writeFileSync(path,content);
    if(host==='codex')events.push({type:'item.completed',item:{type:'command_execution',command:`Get-Content '${path}'`,exit_code:0,status:'completed',aggregated_output:content}});
    else {
      const id=String(events.length);
      events.push({type:'assistant',message:{content:[{type:'tool_use',name:'Read',id,input:{file_path:path}}]}});
      events.push({type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:content.split('\n').map((line,i)=>`${i+1}→${line}`).join('\n')} ]}});
    }
  }
  if(host==='codex')events.push({type:'turn.completed'});
  else events.push({type:'system',subtype:'init',skills:['playwright-pom-harness:element-locators'],plugins:[{name:'playwright-pom-harness',path:roots.packageRoot}]},{type:'result',is_error:false,structured_output:answer});
  return {host,roots,answer,events,processResult:{exitCode:0,timedOut:false,packageUnchanged:true},packageUnchanged:true,discovery:{found:[{path:join(roots.packageRoot,skill),enabled:true}],errors:[]}};
}

test('both native evidence formats pass the six-case assessment',t=>{
  for(const host of ['codex','claude']) {
    const result=assessHost(fixture(t,host));assert.equal(result.status,'PASS');assert.equal(result.requirements.canonicalSkillRead,true);
  }
});
test('Claude registration and reference reads without canonical skill consumption fail',t=>{
  const data=fixture(t,'claude');
  data.events=data.events.filter(e=>!e.message?.content?.some(b=>b.type==='tool_use' && b.input?.file_path?.endsWith('SKILL.md')));
  const result=assessHost(data);assert.equal(result.status,'FAIL');assert.equal(result.requirements.nativePlugin,true);
  assert.equal(result.requirements.referenceReads,true);assert.equal(result.requirements.canonicalSkillRead,false);
});
test('a correct self-report without native reference reads fails',t=>{
  const data=fixture(t);data.events=data.events.filter(e=>e.type!=='item.completed');
  const result=assessHost(data);assert.equal(result.status,'FAIL');assert.equal(result.requirements.referenceReads,false);
});
test('failed reads and quoted filenames without file contents are not proof',t=>{
  const data=fixture(t);data.events[0].item.exit_code=1;assert.equal(assessHost(data).status,'FAIL');
  data.events[0].item.exit_code=0;data.events[0].item.aggregated_output='Could not read reference';assert.equal(assessHost(data).status,'FAIL');
});
test('native command path escaping does not lose successful file-read evidence',t=>{
  const data=fixture(t);
  for(const e of data.events)if(e.item)e.item.command=e.item.command.replaceAll('\\','\\\\').replaceAll('/','//');
  assert.equal(assessHost(data).status,'PASS');
  data.events[0].item.aggregated_output='Wrong content';assert.equal(assessHost(data).status,'FAIL');
});
test('Claude tool errors or unmatched tool result ids cannot prove a read',t=>{
  const data=fixture(t,'claude');data.events[1].message.content[0].is_error=true;assert.equal(assessHost(data).status,'FAIL');
  data.events[1].message.content[0].is_error=false;data.events[1].message.content[0].tool_use_id='unknown';assert.equal(assessHost(data).status,'FAIL');
});
test('missing, duplicate, unknown and zero cases fail',t=>{
  for(const change of [c=>[],c=>c.slice(1),c=>[c[0],...c.slice(0,5)],c=>[{...c[0],caseId:'unknown'},...c.slice(1)]]) {
    const data=fixture(t);data.answer.choices=change(data.answer.choices);assert.equal(assessHost(data).status,'FAIL');
  }
});
test('wrong strategy, exposure, indexing, suffix or empty rationale fails',t=>{
  for(const change of [{strategy:'name'},{private:false},{usesIndex:true},{locatorName:'save_input'},{reason:''}]) {
    const data=fixture(t);Object.assign(data.answer.choices[0],change);assert.equal(assessHost(data).status,'FAIL');
  }
});
test('failed process, timeout, changed package and failed final turn fail',t=>{
  for(const change of [{exitCode:1},{timedOut:true},{packageUnchanged:false}]) {
    const data=fixture(t);Object.assign(data.processResult,change);assert.equal(assessHost(data).status,'FAIL');
  }
  const data=fixture(t);data.packageUnchanged=false;assert.equal(assessHost(data).status,'FAIL');
  data.packageUnchanged=true;data.events.push({type:'turn.failed'});assert.equal(assessHost(data).status,'FAIL');
});
test('missing or incorrect native discovery and plugin locations fail',t=>{
  const codex=fixture(t);codex.discovery.found[0].path=join(codex.roots.projectRoot,'locator-cases.json');assert.equal(assessHost(codex).status,'FAIL');
  const claude=fixture(t,'claude');claude.events.find(e=>e.subtype==='init').plugins[0].path=claude.roots.projectRoot;assert.equal(assessHost(claude).status,'FAIL');
});
test('Claude API error cannot pass despite a plausible answer',t=>{
  const data=fixture(t,'claude');data.events.find(e=>e.type==='result').is_error=true;assert.equal(assessHost(data).status,'FAIL');
});
test('semantic comparison tolerates wording and field names but not rule differences',t=>{
  const codex=fixture(t),claude=fixture(t,'claude');claude.answer.choices.reverse();claude.answer.choices[0].reason='Different explanation.';claude.answer.choices[0].locatorName='file_input';
  assert.equal(semanticParity([assessHost(codex),assessHost(claude)]),true);
  claude.answer.choices[0].usesIndex=true;assert.equal(semanticParity([assessHost(codex),assessHost(claude)]),false);
  assert.equal(semanticParity([assessHost(codex)]),false);
});
test('malformed or empty event logs fail instead of silently dropping records',()=>{
  assert.throws(()=>parseEvents(''));assert.throws(()=>parseEvents('{}\nnot-json'));assert.deepEqual(parseEvents('{}\n'),[{}]);
});

test('library proof requires every expected native registration on both hosts',t=>{
 for(const host of ['codex','claude']) {
   const data=fixture(t,host);data.expectedSkills=['element-locators','action-methods'];
   assert.equal(assessHost(data).status,'FAIL');
   if(host==='codex')data.discovery.library=data.expectedSkills.map(name=>({name,valid:true}));
   else data.events.find(e=>e.subtype==='init').skills.push('playwright-pom-harness:action-methods');
   assert.equal(assessHost(data).status,'PASS');
   if(host==='codex')data.discovery.library[1].valid=false;
   else data.events.find(e=>e.subtype==='init').skills.push('playwright-pom-harness:action-methods');
   assert.equal(assessHost(data).status,'FAIL');
 }
});
