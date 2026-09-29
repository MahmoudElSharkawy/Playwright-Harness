// Example — ships with the harness package; copy to dbs/DbsUserManagement.ts (drop the examples/ prefix).
// Note: getUserByEmail() is deliberately kept without a spec consumer as the canonical
// demo of the rows-returning action shape (service-classes playbook, practice 6) — in a
// real repo, build such a method only when a test needs it (reuse-before-create gate).
import * as allure from 'allure-js-commons';
import { DBActions, type DBConnectionConfig } from '../utils/DBActions';
import { expectToHaveLength } from '../utils/Expects';

export class DbsUserManagement {
  readonly dbActions: DBActions;

  // Queries — real projects derive these from the team query library
  // resources/Queries/ (2026-08-24 ruling); sample literals become @param placeholders.
  readonly selectUserByEmail_query = 'SELECT Id, Name, Email FROM Users WHERE Email = @email';

  constructor(dbConfig: DBConnectionConfig) {
    this.dbActions = new DBActions(dbConfig);
  }

  /** Closes the underlying connection pool — call from afterAll. */
  async close(): Promise<void> {
    await this.dbActions.close();
  }

  ///// Actions

  async getUserByEmail(email: string): Promise<Record<string, unknown> | undefined> {
    return await allure.step('Retrieve the synthetic user from the database', async () => {
      const { rows } = await this.dbActions.query(this.selectUserByEmail_query, { email });
      return rows[0];
    });
  }

  ///// Validations

  async verifyUserExistsInDb(email: string) {
    await allure.step('Verify the synthetic user exists in the database', async () => {
      const { rows } = await this.dbActions.query(this.selectUserByEmail_query, { email });
      expectToHaveLength('the matching users', rows, 1, 'row');
    });
  }
}
