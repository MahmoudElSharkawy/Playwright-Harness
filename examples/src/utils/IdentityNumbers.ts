/**
 * Synthetic-identity helpers (utils family — checksum mechanics stay out of business
 * classes per iron law 4). Some format-constrained identity fields are checksum-valid
 * (e.g. Luhn) without being checked against an external registry by the app under test,
 * and a successful registration burns the value permanently with no cleanup path — so
 * per-run reusability for this kind of field comes from generating a fresh valid value
 * each run (test-data practice 7: format-constrained fields never take a string suffix).
 */

/**
 * Returns a 10-digit Luhn-valid identity number: the given identity-type prefix
 * (e.g. '1' for a citizen National-ID format), the current epoch-seconds folded into
 * the remaining body digits (unique per run — two runs collide only within the same
 * second; a 1-digit prefix repeats a value only after ~3 years), and the computed Luhn
 * check digit. Longer prefixes shrink the unique window — keep the prefix to 1–3 digits.
 */
export function generateLuhnValidIdentityNumber(identityTypePrefix: string): string {
  const bodyLength = 9 - identityTypePrefix.length;
  const runUniqueBody = String(Math.floor(Date.now() / 1000) % 10 ** bodyLength).padStart(bodyLength, '0');
  const partialNumber = identityTypePrefix + runUniqueBody;
  // standard Luhn over the 9 leading digits: doubling starts at the leftmost digit for
  // a 10-digit number (verified against the app's own accepted identity numbers)
  const luhnSum = [...partialNumber].reduce((sum, digit, index) => {
    let value = Number(digit);
    if (index % 2 === 0) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    return sum + value;
  }, 0);
  const checkDigit = (10 - (luhnSum % 10)) % 10;
  return partialNumber + checkDigit;
}
