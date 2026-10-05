import {test as base} from '@playwright/test';
import {randomBytes} from 'node:crypto';

// Test-only plumbing for the failure-path regression, not a consumer utility.
export const test = base.extend<{cleanup: (action: () => Promise<unknown>) => () => void}>({
  cleanup: async ({}, use) => {
    let dispose: (() => Promise<unknown>) | undefined;
    try {
      await use(action => {
        dispose = action;
        return () => {dispose = undefined;};
      });
    } finally {
      await dispose?.();
    }
  },
});

export function generateCredential(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}
