const GATES = new Map([
  ['No generated candidate.', ['No test candidate has been registered.', 'Author and register the candidate before review and verification.']],
  ['Generation has not started.', ['Generation has not been prepared for this source.', 'Complete exploration and prepare a validated generation handoff.']],
  ['Begin from a validated handoff.', ['A validated generation handoff is unavailable.', 'Complete observed execution and prepare generation first.']],
  ['Resolve indeterminate execution and lifecycle obligations before generation.', ['Exploration contains unresolved outcomes or incomplete cleanup obligations.', 'Resolve the recorded exploration and lifecycle blockers before preparing generation.']],
  ['Generation needs observed execution.', ['No observed execution was supplied.', 'Explore the source cases and provide their recorded execution evidence.']],
  ['Run snapshot differs from assessed inputs.', ['Saved exploration inputs differ from their recorded fingerprint.', 'Reassess the original exploration snapshot and evidence before preparing generation.']],
  ['An intact independent approval is required.', ['Independent approval is missing, rejected, or its evidence has changed.', 'Obtain independent approval of this exact candidate revision.']],
  ['Consumer files changed; register and review a repair before verification.', ['Consumer files changed after candidate registration.', 'Register and independently review the updated candidate before verification.']],
  ['Three cumulative repair rounds maximum; classify a repair before continuing.', ['The repair classification is missing or the three-round repair budget is exhausted.', 'Check the recorded repair count; classify an available repair or request an owner decision at the limit.']],
  ['Native test collection failed.', ['The native runner could not collect the scoped tests.', 'Check the configured test files, project and native runner before resuming.']],
  ['Native verification did not complete cleanly.', ['The scoped native verification did not finish cleanly.', 'Inspect the recorded native outcome and repair or resolve its cause before a new reviewed run.']],
  ['Native test failed or retried.', ['A scoped native test failed or retried.', 'Investigate its recorded failure and preserve the original failed attempt.']],
  ['Case assertions were missing, failed or skipped.', ['A case had missing, failed or skipped assertions.', 'Inspect assertion counts and failed checks; preserve source expectations when repairing.']],
  ['Execution changed files or exceeded its deadline.', ['Verification changed frozen files or exceeded its deadline.', 'Inspect the recorded run, resolve the changed files or timeout, and review a new candidate.']],
  ['Repair/review the failed or interrupted candidate before another verification; no retry-to-green.', ['The current candidate has a failed or interrupted verification.', 'Repair and independently review the candidate before another verification.']],
  ['Two independent green runs are already recorded.', ['This candidate already has two recorded scoped green runs.', 'Read the existing generation status and report rather than rerun verification.']]
]);
const MAPPING = {
  MAPPING_STEPS: 'The candidate mapping does not cover every source step exactly once.',
  MAPPING_KEYS: 'The candidate mapping is missing or duplicates source expectations.',
  MAPPING_REFERENCES: 'The candidate mapping lacks valid business action or validation references.'
};
export const GENERATION_STAGES = Object.freeze(['SOURCE', 'REFINE', 'EXPLORE', 'PREPARE', 'AUTHOR', 'CANDIDATE', 'REVISE', 'REVIEW', 'VERIFY', 'STATUS', 'REPORT', 'PREPARATION', 'COLLECTION', 'EXECUTION', 'ASSERTION_COVERAGE', 'COMMAND']);

/** Only known gate text is public; native errors and input values remain protected. */
export function generationBlocker(error, stage = 'PREPARE') {
  stage = GENERATION_STAGES.includes(stage) ? stage : 'COMMAND';
  const known = GATES.get(error?.message);
  if (error?.code === 'MODULE_NOT_FOUND') return {stage, reason: 'A required generation or native-runner module is unavailable in the consumer.', nextAction: 'Restore the configured, pinned consumer dependencies before resuming the named stage.'};
  return {stage, reason: MAPPING[error?.code] ?? known?.[0] ?? 'The named generation stage could not complete. Reason unavailable; investigation is needed.',
    nextAction: MAPPING[error?.code] ? 'Correct the candidate mapping against the frozen source and register it again.' : known?.[1] ?? 'Inspect the recorded stage and protected diagnostics, then resolve the prerequisite before resuming.'};
}
