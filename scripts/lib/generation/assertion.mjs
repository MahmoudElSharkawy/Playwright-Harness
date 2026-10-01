/** Call inside a business validation. The callback must actually await its assertions.
 * Passing Playwright's test object keeps this module independent of the consumer's installation.
 * Native expect steps prove execution; independent review proves their meaning matches the source.
 */
export async function sourceExpectation(test, key, assertion) {
  if (!/^expect-[a-f0-9]{24}$/.test(key) || typeof assertion !== 'function') throw new Error('Invalid source expectation.');
  return test.step(`harness:expectation:${key}`, assertion);
}
