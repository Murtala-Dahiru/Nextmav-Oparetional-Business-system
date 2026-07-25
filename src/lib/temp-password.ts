import { randomInt } from 'node:crypto';

/**
 * Temporary passwords for provisioned employees.
 *
 * Server-only: `node:crypto` is not available in the browser, and a temporary
 * password must never be generated somewhere the person receiving it could
 * influence.
 *
 * The value exists for the few minutes between an administrator creating the
 * account and the employee replacing it. It is shown once, never stored by
 * this application in any form, and the account carries
 * `force_password_change` until it has been changed.
 */

/**
 * Deliberately missing: O, 0, I, l, 1.
 *
 * These get read aloud, written on paper and retyped, and every one of those
 * pairs is a support ticket. Dropping five characters costs about a quarter of
 * a bit per character and is repaid many times over.
 */
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*?';
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

/** Uniform pick. `randomInt` rejects modulo bias rather than folding it in. */
function pick(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)];
}

/**
 * A 14-character password containing at least one character of each class.
 *
 * Length is chosen over cleverness: at 14 characters from this alphabet the
 * result is far beyond guessing, and it stays short enough to read out over a
 * phone without mistakes.
 *
 * The guaranteed characters are placed first and then the whole string is
 * shuffled, because leaving them in position would mean every password this
 * system issues had an uppercase letter first and a symbol fourth — a pattern
 * worth more to an attacker than the characters are worth to the policy.
 */
export function generateTemporaryPassword(length = 14): string {
  const required = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  const rest = Array.from({ length: Math.max(0, length - required.length) }, () => pick(ALL));
  const chars = [...required, ...rest];

  // Fisher-Yates, with a uniform index at each step.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}
