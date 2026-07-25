/**
 * Query-string filter values.
 *
 * A "show everything" option in a dropdown has to send *something*, and the
 * conventions differ across the modules: the shared data table uses `_all` and
 * drops the parameter, the attendance tab holds `'all'` in state, and a
 * cleared select sends an empty string. Any of those reaching an enum column
 * produces Postgres 22P02, which surfaced to users as
 *
 *     One of the filter values is not valid for this field.
 *
 * — with no indication of which field, which value, or that the answer was
 * simply to pick a different option. Recognising the sentinels in one place
 * means "all" means all, whichever screen asked.
 *
 * Kept deliberately narrow. `null` and `undefined` are matched as the literal
 * strings a URL can carry, not as concepts; a record whose status is genuinely
 * the word "all" is not something this schema can express.
 */
const SENTINELS = new Set(['', 'all', '_all', 'any', 'undefined', 'null']);

/** True when this value should actually be applied as a filter. */
export function isFilterValue(value: string | null | undefined): value is string {
  if (value === null || value === undefined) return false;
  return !SENTINELS.has(value.trim().toLowerCase());
}

/**
 * Reject a value that is not a member of the enum, by name.
 *
 * The database's own complaint names neither the column nor the permitted
 * values, so a stale client or a hand-written URL produced an error nobody
 * could act on. Returns null when acceptable, or the message to send back.
 */
export function invalidEnumMessage(
  field: string,
  value: string,
  allowed: readonly string[],
): string | null {
  if (allowed.includes(value)) return null;
  return `"${value}" is not a valid ${field}. Expected one of: ${allowed.join(', ')}.`;
}
