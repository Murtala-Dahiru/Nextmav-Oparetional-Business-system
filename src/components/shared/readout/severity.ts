/**
 * How bad something is, in the three words the whole product uses.
 *
 * Lives here rather than in either consumer because `primitives.tsx` draws a
 * severity (the rail, the chip) and every module that builds an attention
 * queue produces one. Two modules each defining their own three-value union
 * is how a `'warn'` in one file ends up not matching a `'warning'` in another.
 */
export type Severity = 'critical' | 'warning' | 'info';
