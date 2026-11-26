import assert from 'node:assert/strict';
import { test, type APIRequestContext, type Locator } from '@playwright/test';
import sql from 'mssql';
import { LoginPage } from './src/pages/LoginPage';
import { ApiActions } from './src/utils/ApiActions';
import { DBActions } from './src/utils/DBActions';
import { expectToBe, expectToHaveMatchingCount, expectToHaveSecretValue } from './src/utils/Expects';
import { UiActions } from './src/utils/UiActions';

const marker = 'private-fixture-value';

test('page actions and assertions log their terminal outcomes', async ({ page }) => {
  await page.setContent(
    '<input data-qa="login-username"><input data-qa="login-password"><button data-qa="login-button">Log in</button><input id="empty">',
  );
  const ui = new UiActions();
  await new LoginPage(page).login(marker, marker);
  assert.equal(await page.locator('[data-qa="login-password"]').inputValue(), marker);
  await assert.rejects(ui.fill(page.locator('#missing'), marker, { timeout: 200 }), { name: 'TimeoutError' });
  await ui.retryUntilSucceeded(async () => {}, async () => false, 2);

  assert.equal(expectToBe('the synchronous result', 1, 1), undefined);
  assert.throws(() => expectToBe('the synchronous mismatch', 1, 2), /the synchronous mismatch/);

  let attempts = 0;
  const changing = { count: async () => ++attempts === 1 ? 0 : 1 } as Locator;
  await expectToHaveMatchingCount('the retrying rows', changing, page.locator('button'));
  assert(attempts > 1);
  await assert.rejects(expectToHaveSecretValue('the empty field', page.locator('#empty'), marker, { timeout: 200 }),
    /the confidential expected value/);
  await ui.pressSequentially(page.locator('#empty'), marker);
  assert.equal(await page.locator('#empty').inputValue(), marker);
  await assert.rejects(ui.pressSequentially(page.locator('#missing'), marker, { timeout: 200 }), { name: 'TimeoutError' });
});

test('API summaries handle returned statuses, failures and reporting warnings', async () => {
  const statuses = [401, 404];
  const request = {
    fetch: async () => {
      const status = statuses.shift();
      return {
        status: () => status,
        statusText: () => marker,
        headers: () => ({ 'x-fixture': marker }),
        text: async () => marker,
      };
    },
  } as unknown as APIRequestContext;
  const api = new ApiActions(request, { bearerTokenProvider: async () => marker });
  const url = 'https://example.test/resource?fixture=' + marker;
  assert.equal((await api.post(url, { data: { fixture: marker } })).status(), 404);

  const failure = new Error(marker);
  const failing = new ApiActions({ fetch: async () => { throw failure; } } as unknown as APIRequestContext);
  const info = test.info();
  const attach = info.attach;
  info.attach = async () => { throw new Error(marker); };
  try {
    await assert.rejects(failing.get(url), error => error === failure);
  } finally {
    info.attach = attach;
  }
});

test('DB summaries keep connection failures single and query output private', async () => {
  const config = { server: 'example.test', database: 'test', user: marker, password: marker };
  const prototype = sql.ConnectionPool.prototype;
  const { connect, request } = prototype;
  const failure = new Error(marker);
  let unavailable = false;
  prototype.connect = (async function (this: sql.ConnectionPool) {
    if (unavailable) throw failure;
    return this;
  }) as typeof connect;
  const row = { item: marker };
  prototype.request = (() => ({
    input: () => {},
    query: async () => ({ recordset: [row], recordsets: [[row]], rowsAffected: [1] }),
  })) as unknown as typeof request;
  try {
    assert.deepEqual((await new DBActions(config).query('select @value', { value: marker })).rows, [row]);
    unavailable = true;
    await assert.rejects(new DBActions(config).query('select 1'), error => error === failure);
  } finally {
    prototype.connect = connect;
    prototype.request = request;
  }
});
