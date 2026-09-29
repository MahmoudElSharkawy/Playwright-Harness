// Example — ships with the harness package; copy to apis/ApisUserManagement.ts (drop the examples/ prefix).
import { type APIRequestContext, type APIResponse } from '@playwright/test';
import * as allure from 'allure-js-commons';
import { ApiActions } from '../utils/ApiActions';
import { applications } from '../config/applications';
import { expectToBe } from '../utils/Expects';

export class ApisUserManagement {
  readonly request: APIRequestContext;
  readonly apiActions: ApiActions;

  // Endpoints — real projects derive these from the team API-collection library
  // resources/apisCollections/ (2026-08-26 ruling); the base URL comes from config, never a literal here.
  readonly createUser_serviceName = `${applications.app.url}/api/users`;
  readonly deleteUser_serviceName = `${applications.app.url}/api/users/delete`;

  constructor(request: APIRequestContext) {
    this.request = request;
    this.apiActions = new ApiActions(request);
  }

  ///// Actions

  async createUser(name: string, email: string, password: string): Promise<APIResponse> {
    return await allure.step('Create the synthetic user account', async () => {
      return await this.apiActions.post(this.createUser_serviceName, {
        data: { name, email, password },
      });
    });
  }

  async deleteUser(email: string): Promise<APIResponse> {
    return await allure.step('Delete the synthetic user account', async () => {
      return await this.apiActions.delete(this.deleteUser_serviceName, {
        data: { email },
      });
    });
  }

  ///// Validations

  async verifyUserCreatedSuccessfully(createResponse: APIResponse, expectedStatus: number, expectedMessage: string) {
    await allure.step(`Verify User Created Successfully with message: ${expectedMessage}`, async () => {
      expectToBe('the creation response status', createResponse.status(), expectedStatus);
      expectToBe('the creation response message', (await createResponse.json()).message, expectedMessage);
    });
  }
}
