import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { createRun } from 'playwright-pom-harness/scripts/lib/execution-core/index.mjs';
import { createApiRuntime, defineApiOperation } from 'playwright-pom-harness/scripts/lib/api/index.mjs';
import { createDatabaseRuntime, defineDatabaseOperation } from 'playwright-pom-harness/scripts/lib/database/index.mjs';
import { consumerRoots } from 'playwright-pom-harness/scripts/lib/consumer-paths.mjs';
import { loadEnvironment } from 'playwright-pom-harness/scripts/lib/project-config.mjs';
import { attachResult } from 'playwright-pom-harness/scripts/lib/reporting/index.mjs';
import { recordGeneratedExecution } from 'playwright-pom-harness/harness-tests/fixtures/workflow.mjs';

/** Fixed proof instrumentation around the same deterministic libraries used by ordinary consumers. */
export class RuntimeActions {
  /** Execute a fixed observation during an identified native verification, record its fresh result,
   * and return that assessed result. Attachment delivery failure is reported without changing its verdict. */
  async observe(definition: any, description: string) {
    return test.step('Execute the configured deterministic operation', async () => {
      const operation = definition.family === 'api' ? defineApiOperation(definition.operation) : defineDatabaseOperation(definition.operation);
      const roots = consumerRoots(), runId = `generated-${randomUUID()}`;
      const run = createRun({id: runId, startedAt: Date.now(), environment: loadEnvironment(roots), operations: [operation],
        scenarios: [{id: 'generated-case', expectations: operation.definition.checks.map((check: any) => ({id: check.id, description, operationId: operation.id, invocationId: 'observe-call', requiredEvidence: ['response', 'assertion']}))}],
        values: definition.values.map((value: any) => ({...value, producer: {runId, scenarioId: 'generated-case', name: value.name}}))});
      const runtimeRoots = {...roots, runRoot: join(roots.projectRoot, '.harness/runs', runId)};
      const runtime = definition.family === 'api' ? createApiRuntime(run, runtimeRoots) : createDatabaseRuntime(run, runtimeRoots);
      await runtime.execute({operation, invocationId: 'observe-call', inputs: run.inputs.values});
      const result = runtime.finish();
      recordGeneratedExecution(roots, definition.caseId, {id: definition.caseId, run, roots: runtimeRoots, result,
        observations: JSON.parse(readFileSync(join(runtimeRoots.runRoot, 'observations.json'), 'utf8')), symbols: []});
      const delivery = await attachResult(test, result);
      if (delivery.status === 'FAILED') console.warn('Harness result attachments unavailable; execution outcome is unchanged.');
      return result;
    });
  }
}
