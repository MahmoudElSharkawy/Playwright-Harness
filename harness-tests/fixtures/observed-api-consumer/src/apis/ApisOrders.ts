import {type APIRequestContext, type APIResponse} from '@playwright/test';
import * as allure from 'allure-js-commons';
import {ApiActions} from '../utils/ApiActions';
import {expectToBe} from '../utils/Expects';

export class ApisOrders {
  private readonly apiActions: ApiActions;
  readonly createDraftOrder_serviceName = '/api/orders';
  readonly lookupOrder_serviceName = '/api/orders/';
  readonly deleteOrder_serviceName = '/api/orders/';

  constructor(request: APIRequestContext) {
    this.apiActions = new ApiActions(request);
  }

  ///// Actions

  async createDraftOrder(id: string, owner: string, label: string): Promise<APIResponse> {
    return await allure.step(`Create draft order: ${id}`, async () => {
      return await this.apiActions.post(this.createDraftOrder_serviceName, {data: {id, owner, label}, failOnStatusCode: true});
    });
  }

  async getOrderId(response: APIResponse): Promise<string> {
    return await allure.step('Read the created order identifier', async () => {
      const order: {id: string} = await response.json();
      return order.id;
    });
  }

  async cleanupOrderIfOwned(candidate: {id: string; owner: string} | undefined): Promise<void> {
    if (!candidate) return;
    await allure.step('Clean up the owned order', async () => {
      const path = this.lookupOrder_serviceName + encodeURIComponent(candidate.id);
      let lookup = await this.apiActions.get(path, {timeout: 2_000});
      if (lookup.status() === 404) return;
      expectToBe('the order ownership lookup HTTP status', lookup.status(), 200);
      const order: {id: string; owner: string} = await lookup.json();
      expectToBe('the cleanup order identifier', order.id, candidate.id);
      expectToBe('the cleanup order owner', order.owner, candidate.owner);
      const deletion = await this.apiActions.delete(this.deleteOrder_serviceName + encodeURIComponent(candidate.id), {headers: {'if-match': candidate.owner}, timeout: 2_000});
      expectToBe('the owned order deletion HTTP status', deletion.status(), 204);
      lookup = await this.apiActions.get(path, {timeout: 2_000});
      expectToBe('the cleanup order absence HTTP status', lookup.status(), 404);
    });
  }

  ///// Validations

  async verifyDraftCreated(response: APIResponse, expectedHttpStatus: number, expectedOrderStatus: string): Promise<void> {
    await allure.step(`Verify draft creation with HTTP status ${expectedHttpStatus} and order status ${expectedOrderStatus}`, async () => {
      expectToBe('the draft creation HTTP status', response.status(), expectedHttpStatus);
      expectToBe('the created order status', (await response.json()).status, expectedOrderStatus);
    });
  }
}
