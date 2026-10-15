export const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
export const markdownText = value => String(value).replace(/\r?\n/g, ' ').replace(/[\\`*_{}\[\]()<>#+.!|~-]/g, '\\$&');
export const stageLabel = value => ({SOURCE: 'Source review', REFINE: 'Preparation', EXPLORE: 'Exploration', PREPARE: 'Preparation', AUTHOR: 'Automation', REVIEW: 'Review', VERIFY: 'Verification', EXECUTE: 'Execution'}[String(value).split(' · ')[0]] ?? 'Review');
const explanations = new Map([
  ['Two intact scoped green runs and independent approval establish automation readiness.', 'Automation is ready. The test passed verification and review.'],
  ['The native test passed; automation readiness still depends on the complete scoped verification gates.', 'The test passed. Further verification is needed before automation is ready.'],
  ['The native test has missing or skipped assertions; the verification gate is not satisfied.', 'Some required checks were not completed. Review this case before using its result.'],
  ['The native test was skipped; it does not count as a scoped green.', 'This test was skipped.'],
  ['Resolve the recorded cause, then register and independently review any repair before verification.', 'Resolve the cause, review the updated test, then run it again.'],
  ['No native result was recorded for this case.', 'No test result was recorded for this case.'],
  ['No generated test candidate exists for this case.', 'Automation has not been created for this case.'],
  ['Author and register the case in a complete source candidate.', 'Create the automated test for this case.'],
  ['Explore the source and prepare its observed generation handoff.', 'Check the case requirements and application behavior before creating the test.'],
  ['No scoped verification has been recorded for this candidate.', 'The automated test has not been run yet.'],
  ['Run the independently approved candidate through scoped verification.', 'Review and run the automated test.'],
  ['The recorded native receipt is missing, changed, or has a different case scope. Case results are unavailable; review is required.', 'The saved test result is missing or no longer matches this case. Review is required.'],
  ['Reassess the original receipts and candidate integrity; do not infer a pass.', 'Check the original test result and the current test before running it again.']
]);
export const caseReason = value => {
  const text = String(value ?? '');
  return (explanations.get(text) ?? text).replace(/^(\d+) native assertion(?:\(s\)|s)? failed(?: \([^)]+\))?\./, '$1 check(s) failed.')
    .replace(/^The native test failed\./, 'The test failed.').replace(/^Native execution /, 'The test ');
};
