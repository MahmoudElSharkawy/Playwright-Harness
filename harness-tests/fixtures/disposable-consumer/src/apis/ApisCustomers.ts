import {APIRequestContext, APIResponse} from '@playwright/test';
import * as allure from 'allure-js-commons';
import {ApiActions} from '../utils/ApiActions';
import {expectToBe, expectToBeOneOf} from '../utils/Expects';

// Fixture-only contract: the fake server authenticates lookup/deletion with the
// account's generated credential. This is not a starter API or a general password rule.
export class ApisCustomers {
  private readonly apiActions: ApiActions;
  readonly registerCustomer_serviceName = '/accounts';
  readonly loginCustomer_serviceName = '/login';
  readonly deleteCustomer_serviceName = '/accounts';
  readonly lookupCustomer_serviceName = '/accounts/';
  readonly lookupOwnedCustomer_serviceName = '/accounts';
  readonly prepareCustomerSession_serviceName = '/sessions';

  constructor(request: APIRequestContext) {
    this.apiActions = new ApiActions(request);
  }

  ///// Actions
  async registerCustomer(email: string, password: string): Promise<APIResponse> {
    return allure.step('Register a disposable customer', () => this.apiActions.post(this.registerCustomer_serviceName, {data: {email, password}}));
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

  async lookupOwnedCustomer(email: string, password: string): Promise<APIResponse> {
    return allure.step('Look up the attempted customer account', () => this.apiActions.get(`${this.lookupOwnedCustomer_serviceName}?email=${encodeURIComponent(email)}`, {
      headers: {authorization: `Bearer ${password}`}, timeout: 2_000,
    }));
  }

  async prepareCustomerSession(email: string, password: string): Promise<APIResponse> {
    return allure.step('Prepare the customer session', () => this.apiActions.post(this.prepareCustomerSession_serviceName, {data: {email, password}, failOnStatusCode: true}));
  }

  async cleanupCustomerIfOwned(customer: {email: string; password: string} | undefined): Promise<void> {
    if (!customer) return;
    await allure.step('Clean up the owned customer account', async () => {
      // This synthetic API proves a foreign credential with 403; arbitrary auth errors
      // in another application's lookup must fail cleanup rather than bypass ownership.
      let lookup = await this.lookupOwnedCustomer(customer.email, customer.password);
      if (lookup.status() === 403) return;
      if (lookup.status() === 200) {
        const deletion = await this.apiActions.delete(this.deleteCustomer_serviceName, {data: customer, timeout: 2_000});
        expectToBeOneOf('the cleanup deletion HTTP status', deletion.status(), [200, 404]);
        lookup = await this.lookupOwnedCustomer(customer.email, customer.password);
      }
      expectToBe('the cleanup customer absence HTTP status', lookup.status(), 404);
      expectToBe('the cleanup customer absence response code', (await lookup.json()).responseCode, 404);
    });
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
