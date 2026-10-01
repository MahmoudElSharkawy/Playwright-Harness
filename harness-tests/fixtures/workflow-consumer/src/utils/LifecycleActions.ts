import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { consumerRoots } from 'playwright-pom-harness/scripts/lib/consumer-paths.mjs';
import { loadEnvironment } from 'playwright-pom-harness/scripts/lib/project-config.mjs';
import { attachResult } from 'playwright-pom-harness/scripts/lib/reporting/index.mjs';
import { executeHostCases } from 'playwright-pom-harness/harness-tests/fixtures/host-execution.mjs';
import { lifecycleCases, recordGeneratedExecution } from 'playwright-pom-harness/harness-tests/fixtures/workflow.mjs';

/** Test-only reuse of the reviewed M11 callbacks. Normal consumers do not depend on proof fixtures. */
export class LifecycleActions {
  /** Execute a known lifecycle case during an identified native verification, recording fresh evidence
   * and returning its assessed result. Attachment delivery failure does not alter the execution verdict. */
  async execute(caseId: string) {
    return test.step('Execute the configured sequential lifecycle', async () => {
      const roots = consumerRoots(), item = lifecycleCases.find(value => value.id === caseId);
      if (!item || !process.env.HARNESS_GENERATION_INVOCATION) throw new Error('Unknown lifecycle proof case or invocation.');
      const projectRoot = join(roots.projectRoot, '.harness/workflow/executions', process.env.HARNESS_GENERATION_INVOCATION, caseId);
      mkdirSync(projectRoot, {recursive: true});
      const [execution] = await executeHostCases(projectRoot, loadEnvironment(roots).targets.databases, {only: [item.execution]});
      recordGeneratedExecution(roots, caseId, execution);
      const delivery = await attachResult(test, execution.result);
      if (delivery.status === 'FAILED') console.warn('Harness result attachments unavailable; execution outcome is unchanged.');
      return execution.result;
    });
  }
}
