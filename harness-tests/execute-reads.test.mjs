import test from 'node:test';
import assert from 'node:assert/strict';
import {renderedRead} from '../scripts/lib/execute/reads.mjs';
import {compareRead, coverageAllows} from '../scripts/lib/execute/verdicts.mjs';

function document() {
  const doc = {location: {origin: 'http://fixture.test', href: 'http://fixture.test/'}};
  doc.defaultView = {top: {document: doc}, getComputedStyle: element => ({display: ['span', 'slot', 'select', 'input'].includes(element.localName) ? 'inline' : 'block', visibility: 'visible', opacity: '1', ...element.style})};
  return doc;
}
const text = nodeValue => ({nodeType: 3, nodeValue});
function element(doc, localName, children = [], props = {}) {
  const node = {ownerDocument: doc, nodeType: 1, localName, childNodes: children, style: {}, attributes: {}, getClientRects: () => [1], getRootNode: () => doc,
    hasAttribute(name) {return Object.hasOwn(this.attributes, name);}, getAttribute(name) {return this.attributes[name] ?? null;}, matches: () => false, ...props};
  for (const child of children) {child.parentElement = node; child.ownerDocument = doc;}
  return node;
}

test('V3: visibility overrides remain rendered and scoped editable text is distinct from page echoes', () => {
  const doc = document(), restored = element(doc, 'span', [text('Visible child')], {style: {visibility: 'visible'}});
  const hidden = element(doc, 'div', [text('Hidden parent'), restored], {style: {visibility: 'hidden'}});
  const editable = element(doc, 'div', [text('Saved note')], {isContentEditable: true});
  const root = element(doc, 'body', [hidden, editable]);
  assert.equal(renderedRead(root, 'page').value, 'Visible child');
  assert.equal(renderedRead(hidden, 'text').value, 'Visible child');
  assert.equal(renderedRead(editable, 'text').value, 'Saved note');
  assert.equal(renderedRead(root, 'text').value, 'Visible child Saved note');
  const button = element(doc, 'button', [text('Confirm')]); editable.childNodes.push(button); button.parentElement = editable;
  assert.equal(renderedRead(root, 'count', 'button').value, 1);
  assert.equal(renderedRead(root, 'page').coverage.complete, true);
});

test('V3: rendered reads exclude hidden text, option lists and editable echoes without inventing inline spaces', () => {
  const doc = document(), select = element(doc, 'select', [], {value: 'US', selectedOptions: [{label: 'United States', value: 'US'}]});
  const inline = element(doc, 'div', [text('Hello'), element(doc, 'span', [text('World')])]);
  const hidden = element(doc, 'div', [element(doc, 'span', [text('Secret hidden text')])], {style: {opacity: '0'}});
  const root = element(doc, 'div', [inline, hidden, select, element(doc, 'input', [], {value: 'typed echo'})]);
  assert.equal(renderedRead(inline, 'text').value, 'HelloWorld');
  assert.equal(renderedRead(hidden.childNodes[0], 'text').value, '');
  assert.equal(renderedRead(root, 'page').value, 'HelloWorld United States');
  assert.equal(renderedRead(select, 'text').value, 'United States'); assert.equal(renderedRead(select, 'value').value, 'US');
});

test('V3: shadow and assigned slot content appears once; fallback and light children are replaced', () => {
  const doc = document(), assigned = element(doc, 'span', [text('Assigned')]);
  const slot = element(doc, 'slot', [text('Fallback')], {assignedNodes: () => [assigned]}); assigned.assignedSlot = slot;
  const shadow = {nodeType: 11, childNodes: [slot, assigned]};
  const host = element(doc, 'div', [assigned, text('Hidden light')], {shadowRoot: shadow}); shadow.host = host;
  assert.equal(renderedRead(host, 'page').value, 'Assigned');
});

test('V3: readable inherited-origin frames work and inaccessible frames leave explicit coverage gaps', () => {
  const doc = document(), inner = document(); inner.location.origin = 'null'; inner.defaultView.top = doc.defaultView.top;
  const child = element(inner, 'button', [text('Save')]); inner.body = element(inner, 'body', [child]);
  const frame = element(doc, 'iframe', [], {contentDocument: inner}), blocked = element(doc, 'iframe', [], {contentDocument: null});
  assert.equal(renderedRead(child, 'text').value, 'Save');
  const read = renderedRead(element(doc, 'div', [frame, blocked]), 'page');
  assert.equal(read.value, 'Save'); assert.equal(read.coverage.complete, false);
  for (const [predicate, passed, allowed] of [['present', true, true], ['absent', false, true], ['absent', true, false], ['equals', true, false], ['count', true, false]]) assert.equal(coverageAllows({predicate}, {value: read.value, coverage: read.coverage}, passed), allowed);
});

test('V3 V6: unavailable text never supplies positive null-string evidence', () => {
  const read = {kind: 'text', value: null, coverage: {complete: false, gaps: ['cross-origin-frame']}};
  for (const predicate of ['present', 'absent']) assert.equal(coverageAllows({predicate}, read, compareRead({predicate}, read, 'null')), false);
});

test('V3: accessible names do not become displayed text and long reads are preserved', () => {
  const doc = document(), icon = element(doc, 'button', [], {attributes: {'aria-label': 'Save'}}), long = 'x'.repeat(100 * 1024);
  assert.equal(renderedRead(icon, 'text').value, ''); assert.equal(renderedRead(element(doc, 'div', [text(long)]), 'text').value, long);
});
