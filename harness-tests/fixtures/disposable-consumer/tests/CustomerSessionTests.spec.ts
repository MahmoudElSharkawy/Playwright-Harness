import {test} from '@playwright/test';
import * as allure from 'allure-js-commons';
import {ApisCustomers} from '../src/apis/ApisCustomers';
import * as fs from 'node:fs';

let testData: typeof import('../resources/testData/CustomerSessionTestJsonFile.json');
let apisCustomers: ApisCustomers;
let customerToClean: {email: string; password: string} | undefined;

const timestamp = new Date().toISOString().replace(/[-T:.]/g, '').slice(0, 17);

test.describe('Customer session', () => {
  test('accepts credentials after session preparation', {tag: ['@regression']}, async () => {
    await allure.feature('Customer session');
    await allure.testCaseId('preparedSession');
    const response = await apisCustomers.loginCustomer(customerToClean!.email, customerToClean!.password);
    await apisCustomers.verifyCustomerLogin(response, testData.preparedSession.expected.httpStatus, testData.preparedSession.expected.responseCode);
  });

  test.beforeAll(() => {
    testData = JSON.parse(fs.readFileSync('./resources/testData/CustomerSessionTestJsonFile.json', 'utf8'));
  });

  test.beforeEach(() => {
    customerToClean = undefined;
  });

  test.beforeEach(async ({request}) => {
    apisCustomers = new ApisCustomers(request);
    const email = testData.preparedSession.email + timestamp + testData.preparedSession.domain;
    const password = testData.preparedSession.password + timestamp;
    customerToClean = {email, password};
    await apisCustomers.registerCustomer(email, password);
    await apisCustomers.prepareCustomerSession(email, password);
  });

  test.afterEach('Clean up the test customer', async () => {
    await apisCustomers?.cleanupCustomerIfOwned(customerToClean);
  });
});
