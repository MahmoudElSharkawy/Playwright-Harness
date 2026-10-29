import test from 'node:test';
import assert from 'node:assert/strict';
import {dbDiscoveryLines} from '../scripts/lib/reporting/text.mjs';
import {renderDbDiscoveries} from '../scripts/lib/reporting/case-view.mjs';

test('query knowledge reporting exposes reviewed operations and saved paths without case verdicts', () => {
  const summary = {candidates: [{operationId: 'read-order', purpose: 'Read <order>', target: 'orders'}],
    reviewed: [{operationId: 'read-order', target: 'orders'}], libraries: [{path: 'resources/Queries/orders-discovered.md'}], gaps: []};
  const before = structuredClone(summary), text = dbDiscoveryLines(summary).join('\n'), html = renderDbDiscoveries(summary);
  assert.match(text, /reviewed and verified/); assert.match(text, /resources\/Queries\/orders-discovered.md/);
  assert.match(html, /Read &lt;order&gt;/); assert(!html.includes('Read <order>'));
  assert(!Object.hasOwn(summary, 'status')); assert.deepEqual(summary, before);
});

test('missing discovery stays absent while evidence gaps remain separate supporting information', () => {
  assert.deepEqual(dbDiscoveryLines(), []); assert.equal(renderDbDiscoveries(), '');
  const html = renderDbDiscoveries({candidates: [], reviewed: [], libraries: [], gaps: ['db-discovery-evidence-unavailable']});
  assert.match(html, /evidence.*unavailable/i); assert.match(html, /case outcomes remain unchanged/i);
});

test('review labels bind the exact candidate and selected reuse never implies an execution pass', () => {
  const summary = {candidates: [{id: 'new', operationId: 'lookup', target: 'db', purpose: 'Changed query'}],
    reviewed: [{id: 'review', candidateId: 'old', operationId: 'lookup', target: 'db'}],
    reused: [{operationId: 'lookup', target: 'db', purpose: 'Original query', status: 'schema-checked'}], libraries: [], gaps: []};
  const lines = dbDiscoveryLines(summary);
  assert(lines.includes('Changed query (db): unreviewed candidate.'));
  assert(lines.some(line => /Original query.*selected for reuse.*fresh schema checked/.test(line)));
  assert(!lines.some(line => /execution passed|SQL passed/.test(line)));
  summary.reviewed[0].candidateId = 'new';
  assert(dbDiscoveryLines(summary).includes('Changed query (db): reviewed and verified.'));
});
