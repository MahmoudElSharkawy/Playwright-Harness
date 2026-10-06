import {test} from '@playwright/test';
import * as allure from 'allure-js-commons';
import {ApisCustomers} from '../src/apis/ApisCustomers';
import * as fs from 'node:fs';

let testData: typeof import('../resources/testData/CustomerLookupTestJsonFile.json');
let apisCustomers: ApisCustomers;
let customerToClean: {email: string; password: string} | undefined;

const timestamp = new Date().toISOString().replace(/[-T:.]/g, '').slice(0, 17);

test.describe('Customer lookup', () => {
  test('reports the owned deleted customer as absent', {tag: ['@regression']}, async () => {
    await allure.feature('Customer lookup');
    await allure.testCaseId('deletedCustomer');
    const email = testData.deletedCustomer.email + timestamp + testData.deletedCustomer.domain;
    const password = testData.deletedCustomer.password + timestamp;
    customerToClean = {email, password};
    const registration = await apisCustomers.registerCustomer(email, password);
    await apisCustomers.verifyCustomerRegistered(registration, testData.deletedCustomer.expected.registrationHttp, testData.deletedCustomer.expected.registrationCode);
    const customerId = await apisCustomers.getCustomerId(registration);
    await apisCustomers.deleteCustomer(email, password);
    const response = await apisCustomers.lookupCustomer(customerId);
    await apisCustomers.verifyCustomerAbsent(response, testData.deletedCustomer.expected.httpStatus, testData.deletedCustomer.expected.absentApi);
  });

  test.beforeAll(() => {
    testData = JSON.parse(fs.readFileSync('./resources/testData/CustomerLookupTestJsonFile.json', 'utf8'));
  });

  test.beforeEach(() => {
    customerToClean = undefined;
  });

  test.beforeEach(({request}) => {
    apisCustomers = new ApisCustomers(request);
  });

  test.afterEach('Clean up the test customer', async () => {
    await apisCustomers?.cleanupCustomerIfOwned(customerToClean);
  });
});
