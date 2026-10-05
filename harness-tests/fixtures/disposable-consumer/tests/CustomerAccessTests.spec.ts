import {test, generateCredential} from '../src/utils/Lifecycle';
import * as allure from 'allure-js-commons';
import {ApisCustomers} from '../src/apis/ApisCustomers';
import * as fs from 'node:fs';

let testData: typeof import('../resources/testData/CustomerAccessTestJsonFile.json');
let apisCustomers: ApisCustomers;
const timestamp = new Date().toISOString().replace(/[-T:.]/g, '').slice(0, 17);

test.describe('Customer access', () => {
  test('accepts owned credentials', {tag: ['@smoke']}, async ({cleanup}) => {
    allure.feature('Customer access');
    allure.testCaseId('validLogin');
    const email = testData.validLogin.email + timestamp + testData.validLogin.domain;
    const password = generateCredential(testData.validLogin.credentialBytes);
    const registration = await apisCustomers.registerCustomer(email, password);
    cleanup(() => apisCustomers.deleteCustomer(email, password));
    await apisCustomers.verifyCustomerRegistered(registration, testData.validLogin.expected.registrationHttp, testData.validLogin.expected.registrationCode);
    const login = await apisCustomers.loginCustomer(email, password);
    await apisCustomers.verifyCustomerLogin(login, testData.validLogin.expected.loginHttp, testData.validLogin.expected.loginCode);
  });

  test('rejects the case-specific wrong password', {tag: ['@regression']}, async ({cleanup}) => {
    allure.feature('Customer access');
    allure.testCaseId('wrongLogin');
    const email = testData.wrongLogin.email + timestamp + testData.wrongLogin.domain;
    const password = generateCredential(testData.wrongLogin.credentialBytes);
    const registration = await apisCustomers.registerCustomer(email, password);
    cleanup(() => apisCustomers.deleteCustomer(email, password));
    await apisCustomers.verifyCustomerRegistered(registration, testData.wrongLogin.expected.registrationHttp, testData.wrongLogin.expected.registrationCode);
    const login = await apisCustomers.loginCustomer(email, testData.wrongLogin.wrongPassword);
    await apisCustomers.verifyCustomerLogin(login, testData.wrongLogin.expected.loginHttp, testData.wrongLogin.expected.loginCode);
  });

  test.beforeAll(() => {
    testData = JSON.parse(fs.readFileSync('./resources/testData/CustomerAccessTestJsonFile.json', 'utf8'));
  });

  test.beforeEach(({request}) => {
    apisCustomers = new ApisCustomers(request);
  });
});
