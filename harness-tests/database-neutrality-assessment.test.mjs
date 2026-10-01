import test from 'node:test';
import assert from 'node:assert/strict';
import {assessDatabaseNeutrality,neutralityCases} from '../scripts/probes/database-neutrality-assessment.mjs';
const receipt=engine=>({probe:'database-neutrality',engine,cases:neutralityCases.map(name=>({name,status:'PASS',stability:'stable',counts:{required:1},attempts:[{assertions:[],inputs:[],outputs:[],evidence:['observation']}],resources:[],requiredLifecycleComplete:true,selected:[{name:'label',value:'same'}]}))});
test('neutrality assessment refuses empty, missing, duplicate and zero-scope receipts',()=>{
  for(const mutate of [r=>r.cases=[],r=>r.cases.pop(),r=>r.cases[1]=r.cases[0],r=>r.cases[0].counts.required=0,r=>r.cases[0].attempts=[],r=>r.cases[0].attempts[0].evidence=[]]){const a=receipt('sqlserver'),b=receipt('postgresql');mutate(b);assert.equal(assessDatabaseNeutrality(a,b).status,'FAIL');}
});
test('neutrality assessment preserves meaningful status, output, binding and cleanup differences',()=>{
  const a=receipt('sqlserver');assert.equal(assessDatabaseNeutrality(a,receipt('postgresql')).status,'PASS');
  for(const mutate of [r=>r.cases[0].status='FAIL',r=>r.cases[0].selected[0].value='different',r=>r.cases[0].attempts[0].inputs.push({name:'foreign'}),r=>r.cases[0].requiredLifecycleComplete=false]){const b=receipt('postgresql');mutate(b);assert.equal(assessDatabaseNeutrality(a,b).status,'FAIL');}
});
