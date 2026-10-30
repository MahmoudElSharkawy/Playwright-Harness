import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFieldMetadata, validateNativeFields, sameFieldValue} from '../scripts/lib/integrations/native-fields.mjs';

const field = (name, type, more = {}) => ({fieldId: name, name, required: true, operations: ['set'], schema: {type}, ...more});
const problems = (definitions, values, options) => {
  try {validateNativeFields(definitions, values, options); assert.fail('Expected field validation to block the request');}
  catch (error) {assert(Array.isArray(error.fieldProblems), error.message); return error.fieldProblems;}
};

test('native required fields reject omitted and empty values but accept false and zero', () => {
  const definitions = [field('component', 'string')];
  for (const value of [undefined, null, '', '   ', []]) assert(problems(definitions, value === undefined ? {} : {component: value}).some(row => row.code === 'required'));
  assert.equal(validateNativeFields([field('enabled', 'boolean'), field('count', 'number')], {enabled: false, count: 0}).length, 2);
  assert.equal(validateNativeFields([field('component', 'string', {hasDefaultValue: true})], {}).length, 1);
  assert(problems([field('component', 'string', {hasDefaultValue: true})], {component: ''}).some(row => row.code === 'required'));
});

test('native field validation reports invalid types, options, unknown and read-only fields together', () => {
  const definitions = [field('count', 'number'), field('choice', 'option', {allowedValues: [{id: '1', value: 'Portal'}]}), field('locked', 'string', {operations: []})];
  const issues = problems(definitions, {count: '1', choice: {id: '2'}, locked: 'no', extra: 'no'});
  assert(issues.some(row => row.field === 'count' && row.code === 'type'));
  assert(issues.some(row => row.field === 'choice' && row.code === 'allowed-value'));
  assert(issues.some(row => row.field === 'locked' && row.code === 'read-only'));
  assert(issues.some(row => row.field === 'extra' && row.code === 'unavailable'));
  assert(problems([field('choice', 'string', {allowedValues: []})], {choice: 'anything'}).some(row => row.code === 'allowed-value'));
});

test('case updates validate the effective required values without requiring unchanged read-only fields to be set', () => {
  const definitions = [field('component', 'string'), field('locked', 'string', {operations: []})];
  assert.equal(validateNativeFields(definitions, {}, {existing: {component: 'Portal', locked: 'Keep'}, creating: false}).length, 2);
  assert(problems(definitions, {component: ''}, {existing: {component: 'Portal', locked: 'Keep'}, creating: false}).some(row => row.field === 'component' && row.code === 'required'));
  assert(problems([field('component', 'string', {hasDefaultValue: true})], {}, {existing: {}, creating: false}).some(row => row.code === 'required'));
});

test('required retained values must still match current types and choices while expanded native identities remain valid', () => {
  const definitions = [field('choice', 'option', {allowedValues: [{id: '1', value: 'Portal'}]}), field('owner', 'user')];
  assert.equal(validateNativeFields(definitions, {}, {creating: false, existing: {choice: {id: '1', value: 'Portal', self: 'https://example.test/1'}, owner: {accountId: 'account-1', displayName: 'Current owner'}}}).length, 2);
  assert(problems(definitions, {}, {creating: false, existing: {choice: {id: '2'}, owner: 'not-a-user'}}).some(row => row.code === 'allowed-value'));
  assert(problems(definitions, {}, {creating: false, existing: {choice: {id: '1'}, owner: 'not-a-user'}}).some(row => row.code === 'type'));
});

test('unsupported required defaults and known invalid defaults fail before creating a case', () => {
  assert(problems([field('cascade', 'option-with-child', {hasDefaultValue: true})], {}).some(row => row.code === 'unsupported-type'));
  assert(problems([field('cascade', 'option-with-child', {required: false})], {cascade: null}, {creating: false}).some(row => row.code === 'unsupported-type'));
  for (const defaultValue of [null, '', '   ']) assert(problems([field('text', 'string', {hasDefaultValue: true, defaultValue})], {}).some(row => row.code === 'required'));
  assert(problems([field('count', 'number', {hasDefaultValue: true, defaultValue: 'not numeric'})], {}).some(row => row.code === 'type'));
  assert(problems([field('choice', 'option', {hasDefaultValue: true, defaultValue: {id: '2'}, allowedValues: [{id: '1'}]})], {}).some(row => row.code === 'allowed-value'));
  const review = validateNativeFields([field('choice', 'option', {hasDefaultValue: true, defaultValue: {id: '1', value: 'Portal'}, allowedValues: [{id: '1'}]})], {});
  assert.equal(review[0].value.id, '1'); assert.equal(review[0].defaulted, true);
});

test('field metadata rejects duplicate/incomplete definitions and readback compares native IDs', () => {
  assert.throws(() => validateFieldMetadata([field('x', 'string'), field('x', 'string')]), /metadata/);
  assert.throws(() => validateFieldMetadata([{fieldId: 'x', name: 'x'}]), /metadata/);
  assert.equal(validateFieldMetadata([]).length, 0);
  assert(sameFieldValue({id: '12', value: 'Current label'}, {id: '12'}));
  assert(!sameFieldValue({id: '13'}, {id: '12'}));
  assert(!sameFieldValue(['a', 'b'], ['b', 'a']));
  assert(!sameFieldValue({type: 'doc', version: 1, content: []}, {type: 'doc', version: 1, content: [{type: 'paragraph'}]}));
  assert(!sameFieldValue({detail: 'changed'}, {detail: 'approved'}));
});
