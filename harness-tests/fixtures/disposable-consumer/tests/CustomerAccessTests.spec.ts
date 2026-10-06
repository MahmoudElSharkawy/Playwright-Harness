import {test} from '@playwright/test';
import * as allure from 'allure-js-commons';
import {ApisCustomers} from '../src/apis/ApisCustomers';
import * as fs from 'node:fs';

let testData: typeof import('../resources/testData/CustomerAccessTestJsonFile.json');
let apisCustomers: ApisCustomers;
let customerToClean: {email: string; password: string} | undefined;

const timestamp = new Date().toISOString().replace(/[-T:.]/g, '').slice(0, 17);

test.describe('Customer access', () => {
  test('accepts owned credentials', {tag: ['@smoke']}, async () => {
    await allure.feature('Customer access');
    await allure.testCaseId('validLogin');
    const email = testData.validLogin.email + timestamp + testData.validLogin.domain;
    const password = testData.validLogin.password + timestamp;
    customerToClean = {email, password};
    const registration = await apisCustomers.registerCustomer(email, password);
    await apisCustomers.verifyCustomerRegistered(registration, testData.validLogin.expected.registrationHttp, testData.validLogin.expected.registrationCode);
    const login = await apisCustomers.loginCustomer(email, password);
    await apisCustomers.verifyCustomerLogin(login, testData.validLogin.expected.loginHttp, testData.validLogin.expected.loginCode);
  });

  test('rejects the case-specific wrong password', {tag: ['@regression']}, async () => {
    await allure.feature('Customer access');
    await allure.testCaseId('wrongLogin');
    const email = testData.wrongLogin.email + timestamp + testData.wrongLogin.domain;
    const password = testData.wrongLogin.password + timestamp;
    customerToClean = {email, password};
    const registration = await apisCustomers.registerCustomer(email, password);
    await apisCustomers.verifyCustomerRegistered(registration, testData.wrongLogin.expected.registrationHttp, testData.wrongLogin.expected.registrationCode);
    const login = await apisCustomers.loginCustomer(email, testData.wrongLogin.wrongPassword);
    await apisCustomers.verifyCustomerLogin(login, testData.wrongLogin.expected.loginHttp, testData.wrongLogin.expected.loginCode);
  });

  test('rejects an invalid fresh customer identity', {tag: ['@regression']}, async () => {
    await allure.feature('Customer access');
    await allure.testCaseId('invalidRegistration');
    const email = testData.invalidRegistration.email + timestamp;
    const password = testData.invalidRegistration.password + timestamp;
    customerToClean = {email, password};
    const registration = await apisCustomers.registerCustomer(email, password);
    await apisCustomers.verifyCustomerRegistered(registration, testData.invalidRegistration.expected.registrationHttp, testData.invalidRegistration.expected.registrationCode);
  });

  test('preserves a borrowed customer after rejected registration', {tag: ['@regression']}, async () => {
    await allure.feature('Customer access');
    await allure.testCaseId('borrowedRegistration');
    const registration = await apisCustomers.registerCustomer(testData.borrowedRegistration.email, testData.borrowedRegistration.password);
    await apisCustomers.verifyCustomerRegistered(registration, testData.borrowedRegistration.expected.registrationHttp, testData.borrowedRegistration.expected.registrationCode);
  });

  test.beforeAll(() => {
    testData = JSON.parse(fs.readFileSync('./resources/testData/CustomerAccessTestJsonFile.json', 'utf8'));
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
