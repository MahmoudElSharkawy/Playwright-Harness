import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures/execution-core.mjs';
import {prepareExecutionRows} from '../scripts/lib/integrations/publication.mjs';
test('shared result aggregation retains opaque native keys and any earlier validated failure', t => {
  const f = fixture(t), pass = f.assess(); f.current.assertions[0].status = 'FAIL'; f.current.outcome = 'ASSERTION_FAILURE'; f.current.failureClass = 'ASSERTION'; const fail = f.assess();
  const rows = prepareExecutionRows([fail, pass], [{id: 'case-1', caseId: 'DEMO-T42'}]);
  assert.equal(rows[0].caseId, 'DEMO-T42'); assert.equal(rows[0].status, 'FAIL');
  assert.throws(() => prepareExecutionRows([{...pass}], [{id: 'case-1', caseId: 'DEMO-T42'}]), /validated|assess|assessment/i);
});
