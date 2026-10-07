import test from 'node:test';
import assert from 'node:assert/strict';
import Module, {createRequire, stripTypeScriptTypes} from 'node:module';
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {packageRoot} from '../scripts/lib/consumer-paths.mjs';
import {createAllureStepView} from '../examples/src/utils/allure-step-titles.cjs';

test('locator views preserve native events, parent identity and completed metadata', () => {
  const allureStep = createAllureStepView();
  const parent = {category: 'test.step', title: 'Business action', steps: []};
  const child = {category: 'pw:api', title: 'Click', parent, params: {locator: "locator('#submit')"}, steps: []};
  const parentView = allureStep(parent), childView = allureStep(child);
  assert.equal(childView.title, "Click locator('#submit')"); assert.equal(childView.parent, parentView);
  assert.equal(child.title, 'Click'); assert.equal(child.parent, parent);
  child.duration = 12; child.error = {message: 'Synthetic failure'}; child.attachments = [{name: 'Synthetic attachment'}];
  assert.equal(allureStep(child), childView); assert.equal(childView.duration, 12);
  assert.equal(childView.error, child.error); assert.equal(childView.attachments, child.attachments);
  for (const step of [
    {category: 'pw:api', title: "Click locator('#submit')", params: child.params},
    {category: 'expect', title: 'Expect the total to be 3'},
    {category: 'test.step', title: 'Business action', params: child.params},
    {category: 'pw:api', title: 'Navigate', subtitle: 'https://example.test/'},
    {category: 'expect', title: 'Expect field →', params: {locator: ''}},
  ]) {
    assert.equal(allureStep(step).title, step.title);
  }
});

test('all locator assertion wrappers retain their selector after the arrow in Allure', async () => {
  const sourcePath = join(packageRoot, 'examples/src/utils/Expects.ts'), require = createRequire(sourcePath);
  require('@playwright/test');
  const native = require(join(packageRoot, 'examples/node_modules/playwright/lib/matchers/expect.js'));
  const previous = native.expectConfig(), Reporter = require('allure-playwright').default, reporter = new Reporter({}), allureStep = createAllureStepView();
  const recorded = [], nativeSteps = [];
  reporter.allureResultsUuids.set('synthetic', 'test-uuid');
  reporter.allureRuntime = {startStep: (testUuid, parentUuid, step) => {recorded.push(step); return step.uuid;}};
  native.setExpectConfig({...previous, testInfo: {
    _deadline: () => ({deadline: Infinity, timeout: 5000}),
    _addStep: data => {
      nativeSteps.push(data);
      reporter.onStepBegin({id: 'synthetic'}, {}, allureStep({...data, startTime: new Date(0), steps: [], attachments: [], annotations: []}));
      return {...data, complete() {}};
    },
  }});
  const source = readFileSync(sourcePath, 'utf8'), exported = [...source.matchAll(/export (?:async )?function (\w+)/g)].map(match => match[1]);
  const compiled = stripTypeScriptTypes(source).replace(/import\s*\{[^}]+\}\s*from\s*['"]@playwright\/test['"];?/, "const {expect}=require('@playwright/test');")
    .replace(/\bexport /g, '') + '\nmodule.exports={' + exported.join(',') + '};';
  const memoryModule = new Module(sourcePath); memoryModule.filename = sourcePath; memoryModule.paths = Module._nodeModulePaths(dirname(sourcePath));
  memoryModule._compile(compiled, sourcePath);
  const wrappers = memoryModule.exports, locator = {_apiName: 'Locator', _selector: '#field', toString: () => "locator('#field')",
    _expect: async (expression, options) => ({matches: !options.isNot, received: {value: 'synthetic'}, log: []}), count: async () => 3};
  try {
    for (const [name, ...args] of [
      ['expectToHaveText', 'synthetic'], ['expectToContainText', 'synthetic'], ['expectToHaveValue', 'synthetic'],
      ['expectToHaveCount', 3], ['expectNotToHaveCount', 4], ['expectToHaveAttribute', 'data-id', 'synthetic'], ['expectToHaveCSS', 'color', 'synthetic'],
      ['expectToBeVisible'], ['expectToBeHidden'], ['expectToBeEnabled'], ['expectToBeDisabled'], ['expectNotToBeChecked'], ['expectNotToBeEditable'],
      ['expectToContainSecretText', 'synthetic-private'], ['expectToHaveSecretValue', 'synthetic-private'],
    ]) {
      await wrappers[name]('the field', locator, ...args);
      assert(recorded.at(-1).name.endsWith(" → locator('#field')"), name);
      assert(nativeSteps.at(-1).title.endsWith(' →'), name);
      if (name.includes('Secret')) assert(!recorded.at(-1).name.includes('synthetic-private'));
    }
    const reference = {...locator, _selector: '#reference', toString: () => "locator('#reference')"};
    await wrappers.expectToHaveMatchingCount('the rows', locator, reference);
    assert.equal(recorded.at(-1).name, "Expect the rows to show as many item(s) as the reference set → locator('#field') (reference: locator('#reference'))");
    wrappers.expectToBe('the total', 3, 3);
    assert.equal(recorded.at(-1).name, 'Expect the total to be 3');
  } finally {native.setExpectConfig(previous);}
});
