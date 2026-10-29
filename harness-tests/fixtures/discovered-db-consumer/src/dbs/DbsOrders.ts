import * as allure from 'allure-js-commons';
import {DBActions, type DBConnectionConfig} from '../utils/DBActions';
import {expectToBe} from '../utils/Expects';

export class DbsOrders {
  private readonly dbActions: DBActions;
  readonly createDraftOrder_query = 'INSERT INTO m8.DiscoveredOrders (Id,Owner,Status) OUTPUT INSERTED.Id VALUES (@id,@owner,@status)';
  readonly lookupOrder_query = '__REVIEWED_LOOKUP__';
  readonly deleteOrder_query = 'DELETE FROM m8.DiscoveredOrders WHERE Id=@id AND Owner=@owner';

  constructor(config: DBConnectionConfig) {
    this.dbActions = new DBActions(config);
  }

  async close(): Promise<void> {
    await this.dbActions.close();
  }

  ///// Actions

  async createDraftOrder(id: string, owner: string, status: string): Promise<string> {
    return await allure.step(`Create draft order: ${id}`, async () => {
      const result = await this.dbActions.query<{Id: string}>(this.createDraftOrder_query, {id, owner, status});
      return result.rows[0].Id;
    });
  }

  async cleanupOrderIfOwned(candidate: {id: string; owner: string} | undefined): Promise<void> {
    if (!candidate) return;
    await allure.step('Clean up the owned order', async () => {
      const lookup = await this.dbActions.query<{Id: string; Owner: string; Status: string}>(this.lookupOrder_query, {key1: candidate.id});
      if (lookup.rows.length === 0) return;
      expectToBe('the cleanup lookup row count', lookup.rows.length, 1);
      expectToBe('the cleanup order identifier', lookup.rows[0].Id, candidate.id);
      expectToBe('the cleanup order owner', lookup.rows[0].Owner, candidate.owner);
      const deletion = await this.dbActions.query(this.deleteOrder_query, {id: candidate.id, owner: candidate.owner});
      expectToBe('the owned deletion row count', deletion.rowsAffected[0], 1);
      const remaining = await this.dbActions.query(this.lookupOrder_query, {key1: candidate.id});
      expectToBe('the remaining owned order count', remaining.rows.length, 0);
    });
  }

  ///// Validations

  async verifyOrderState(id: string, owner: string, expectedStatus: string, expectedCount: number): Promise<void> {
    await allure.step(`Verify persisted order status: ${expectedStatus}`, async () => {
      const result = await this.dbActions.query<{Id: string; Owner: string; Status: string}>(this.lookupOrder_query, {key1: id});
      expectToBe('the matching order count', result.rows.length, expectedCount);
      expectToBe('the persisted order identifier', result.rows[0].Id, id);
      expectToBe('the persisted order owner', result.rows[0].Owner, owner);
      expectToBe('the persisted order status', result.rows[0].Status, expectedStatus);
    });
  }
}
