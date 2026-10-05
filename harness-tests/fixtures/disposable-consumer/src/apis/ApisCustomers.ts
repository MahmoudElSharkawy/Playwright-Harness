import {APIRequestContext, APIResponse} from '@playwright/test';
import * as allure from 'allure-js-commons';
import {ApiActions} from '../utils/ApiActions';
import {expectToBe} from '../utils/Expects';

export class ApisCustomers {
  private readonly apiActions: ApiActions;
  readonly registerCustomer_serviceName = '/accounts';
  readonly loginCustomer_serviceName = '/login';
  readonly deleteCustomer_serviceName = '/accounts';
  readonly lookupCustomer_serviceName = '/accounts/';

  constructor(request: APIRequestContext) {
    this.apiActions = new ApiActions(request);
  }

  ///// Actions
  async registerCustomer(email: string, password: string): Promise<APIResponse> {
    return allure.step('Register a disposable customer', () => this.apiActions.post(this.registerCustomer_serviceName, {data: {email, password}, failOnStatusCode: true}));
  }

  async loginCustomer(email: string, password: string): Promise<APIResponse> {
    return allure.step('Log in to the owned customer account', () => this.apiActions.post(this.loginCustomer_serviceName, {data: {email, password}}));
  }

  async deleteCustomer(email: string, password: string): Promise<APIResponse> {
    return allure.step('Delete the owned customer account', () => this.apiActions.delete(this.deleteCustomer_serviceName, {data: {email, password}, failOnStatusCode: true}));
  }

  async getCustomerId(response: APIResponse): Promise<string> {
    return allure.step('Read the registered customer identifier', async () => {
      const body: {id: string} = await response.json();
      return body.id;
    });
  }

  async lookupCustomer(customerId: string): Promise<APIResponse> {
    return allure.step(`Look up customer identifier: ${customerId}`, () => this.apiActions.get(this.lookupCustomer_serviceName + customerId));
  }

  ///// Validations
  async verifyCustomerRegistered(response: APIResponse, expectedHttpStatus: number, expectedResponseCode: number): Promise<void> {
    await allure.step(`Verify registration with status: ${expectedHttpStatus} and code: ${expectedResponseCode}`, async () => {
      expectToBe('the registration HTTP status', response.status(), expectedHttpStatus);
      expectToBe('the registration response code', (await response.json()).responseCode, expectedResponseCode);
    });
  }

  async verifyCustomerLogin(response: APIResponse, expectedHttpStatus: number, expectedResponseCode: number): Promise<void> {
    await allure.step(`Verify login with status: ${expectedHttpStatus} and code: ${expectedResponseCode}`, async () => {
      expectToBe('the login HTTP status', response.status(), expectedHttpStatus);
      expectToBe('the login response code', (await response.json()).responseCode, expectedResponseCode);
    });
  }

  async verifyCustomerAbsent(response: APIResponse, expectedHttpStatus: number, expectedResponseCode: number): Promise<void> {
    await allure.step(`Verify customer absence with status: ${expectedHttpStatus} and code: ${expectedResponseCode}`, async () => {
      expectToBe('the customer lookup HTTP status', response.status(), expectedHttpStatus);
      expectToBe('the customer lookup response code', (await response.json()).responseCode, expectedResponseCode);
    });
  }
}
