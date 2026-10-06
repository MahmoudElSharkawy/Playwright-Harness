/** @deprecated Remove this wrapper and call the business assertions directly.
 * Compatibility only: arguments remain accepted, but no source marker is emitted.
 * Case-level execution evidence and independent review replace runtime source keys.
 */
export async function sourceExpectation(test, key, assertion) {
  if (typeof assertion !== 'function') throw new Error('Invalid assertion callback.');
  return assertion();
}
