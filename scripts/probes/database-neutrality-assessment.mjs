import {isDeepStrictEqual} from 'node:util';

export const neutralityCases=Object.freeze(['assertion-failure','cleanup-failure','crud-catalog','crud-exploration','crud-helper','crud-inline','mixed-api','no-obligation','partial-setup','persistent','restoration','restoration-conflict']);
/** Assess already-normalized fixed fixture receipts, never arbitrary production verdicts. */
export function assessDatabaseNeutrality(left,right) {
  const valid=(receipt,engine)=>receipt?.probe==='database-neutrality'&&receipt.engine===engine&&Array.isArray(receipt.cases)
    &&isDeepStrictEqual(receipt.cases.map(item=>item.name).sort(),[...neutralityCases].sort())
    &&receipt.cases.every(item=>['PASS','FAIL','BLOCKED','SKIPPED','NEEDS_REVIEW'].includes(item.status)&&['stable','recovered','unstable'].includes(item.stability)
      &&Number.isSafeInteger(item.counts?.required)&&item.counts.required>0&&Array.isArray(item.attempts)&&item.attempts.length>0
      &&item.attempts.every(attempt=>Array.isArray(attempt.assertions)&&Array.isArray(attempt.inputs)&&Array.isArray(attempt.outputs)&&Array.isArray(attempt.evidence)&&attempt.evidence.length>0)
      &&Array.isArray(item.resources)&&typeof item.requiredLifecycleComplete==='boolean'&&Array.isArray(item.selected));
  if(!valid(left,'sqlserver')||!valid(right,'postgresql'))return {status:'FAIL',reason:'INCOMPLETE_FIXTURE_COVERAGE',cases:0};
  const mismatches=neutralityCases.filter(name=>!isDeepStrictEqual(left.cases.find(item=>item.name===name),right.cases.find(item=>item.name===name)));
  return {status:mismatches.length?'FAIL':'PASS',cases:neutralityCases.length,mismatches};
}
