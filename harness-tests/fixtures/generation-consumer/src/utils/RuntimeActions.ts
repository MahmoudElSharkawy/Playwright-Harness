import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { createRun } from 'playwright-pom-harness/scripts/lib/execution-core/index.mjs';
import { createApiRuntime, defineApiOperation } from 'playwright-pom-harness/scripts/lib/api/index.mjs';
import { createDatabaseRuntime, defineDatabaseOperation } from 'playwright-pom-harness/scripts/lib/database/index.mjs';
import { consumerRoots } from 'playwright-pom-harness/scripts/lib/consumer-paths.mjs';
import { loadEnvironment } from 'playwright-pom-harness/scripts/lib/project-config.mjs';
import { attachResult } from 'playwright-pom-harness/scripts/lib/reporting/index.mjs';

/** Thin consumer wiring only. Binding, transport, SQL drivers, effects and evidence stay in the shared runtimes. */
export class RuntimeActions {
  /** Keep deterministic services callable from ordinary non-test setup code as well. */
  private async dispatch(action: () => Promise<any>) {
    let inTest = false;
    try { test.info(); inTest = true; } catch { /* No native test context. */ }
    return inTest ? test.step('Execute the configured deterministic operation', action) : action();
  }

  /** Execute one fixed operation and return the centrally assessed result; no host or AgenTeX is loaded. */
  async observe(definition: any, description: string) {
    return this.dispatch(async () => {
      const operation = definition.family === 'api' ? defineApiOperation(definition.operation) : defineDatabaseOperation(definition.operation);
      const roots = consumerRoots(), runId = `generated-${randomUUID()}`;
      const run = createRun({id: runId, startedAt: Date.now(), environment: loadEnvironment(roots), operations: [operation],
        scenarios: [{id: 'generated-case', expectations: operation.definition.checks.map((check: any) => ({id: check.id, description, operationId: operation.id, invocationId: 'observe-call', requiredEvidence: ['response', 'assertion']}))}],
        values: definition.values.map((value: any) => ({...value, producer: {runId, scenarioId: 'generated-case', name: value.name}}))});
      const runtimeRoots = {...roots, runRoot: join(roots.projectRoot, '.harness/runs', runId)};
      const runtime = definition.family === 'api' ? createApiRuntime(run, runtimeRoots) : createDatabaseRuntime(run, runtimeRoots);
      await runtime.execute({operation, invocationId: 'observe-call', inputs: run.inputs.values});
      const result = runtime.finish();
      const delivery = await attachResult(test, result);
      if (delivery.status === 'FAILED') console.warn('Harness result attachments unavailable; execution outcome is unchanged.');
      return result;
    });
  }
}
