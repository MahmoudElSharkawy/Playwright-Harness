import test from 'node:test';
import assert from 'node:assert/strict';
import {readJiraAdf} from '../scripts/lib/integrations/jira-adf.mjs';

const text = (value, marks) => ({type: 'text', text: value, ...(marks ? {marks} : {})});
const paragraph = (...content) => ({type: 'paragraph', content});
const doc = (...content) => ({type: 'doc', version: 1, content});

test('ADF retains paragraph, list, table and code structure with exact visible link offsets', () => {
  const value = doc(paragraph(text('Read '), text('the specification', [{type: 'link', attrs: {href: 'https://docs.example.test/spec'}}])),
    {type: 'orderedList', attrs: {order: 2}, content: [{type: 'listItem', content: [paragraph(text('Enter name'))]}, {type: 'listItem', content: [paragraph(text('Save'))]}]},
    {type: 'table', content: [{type: 'tableRow', content: [{type: 'tableHeader', content: [paragraph(text('Action'))]}, {type: 'tableHeader', content: [paragraph(text('Expected'))]}]}, {type: 'tableRow', content: [{type: 'tableCell', content: [paragraph(text('Save'))]}, {type: 'tableCell', content: [paragraph(text('Confirmation'))]}]}]},
    {type: 'codeBlock', attrs: {language: 'text'}, content: [text('a < b\nkeep & symbols')]});
  const result = readJiraAdf(value, {location: 'description'});
  assert.match(result.text, /2\. Enter name\n3\. Save/); assert.match(result.text, /Action\tExpected\nSave\tConfirmation/); assert.match(result.text, /a < b\nkeep & symbols/);
  assert.equal(result.links.length, 1); const link = result.links[0];
  assert.equal(result.text.slice(link.textStart, link.textEnd), 'the specification'); assert.equal(link.destination, 'https://docs.example.test/spec'); assert.deepEqual(result.omissions, []);
});

test('unsupported ADF nodes and marks remain explicit omissions rather than invented text', () => {
  const result = readJiraAdf(doc(paragraph(text('Supported text')), {type: 'mediaSingle', content: [{type: 'media', attrs: {id: 'file-1'}}]}, paragraph(text('Marked text', [{type: 'futureMark'}]))));
  assert.match(result.text, /Supported text/); assert.match(result.text, /Marked text/);
  assert(result.omissions.some(row => row.reason === 'unsupported-adf-node' && row.type === 'mediaSingle'));
  assert(result.omissions.some(row => row.reason === 'unsupported-adf-mark' && row.type === 'futureMark'));
  assert(!result.text.includes('file-1'));
});

test('ADF reads plain custom fields without interpreting HTML and rejects malformed roots', () => {
  assert.equal(readJiraAdf('Literal <b>text</b>').text, 'Literal <b>text</b>');
  assert(readJiraAdf({type: 'doc', version: 2, content: []}).omissions.some(row => row.reason === 'unsupported-adf-document'));
  assert(readJiraAdf(doc({type: 'paragraph', content: 'bad'})).omissions.some(row => row.reason === 'malformed-adf-node'));
});

test('ADF traversal is bounded for deeply nested or cyclic input', () => {
  const root = doc(); root.content.push(root);
  assert.throws(() => readJiraAdf(root), /bound|cycle/);
});
