/**
 * Key-case conversion at the API boundary.
 *
 * Postgres columns are snake_case; the React components were written against
 * the previous ORM and read camelCase. Converting in one place — on the way
 * out in `api-response`, on the way in for writes — keeps both sides idiomatic
 * without touching eleven module components or renaming database columns.
 *
 * Only keys are transformed. Values are passed through untouched, so ISO
 * timestamps, UUIDs and free text are never altered.
 */

const toCamelKey = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const toSnakeKey = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

/**
 * Values that must be returned as-is rather than walked.
 *
 * Dates would otherwise be rebuilt as plain objects and lose their type, and
 * walking a large binary payload is pointless work.
 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    !(v instanceof Date) &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

function convert(value: unknown, keyFn: (k: string) => string): unknown {
  if (Array.isArray(value)) return value.map(v => convert(v, keyFn));
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[keyFn(k)] = convert(v, keyFn);
  }
  return out;
}

/** snake_case → camelCase, recursively. Used on responses. */
export function toCamel<T = unknown>(value: unknown): T {
  return convert(value, toCamelKey) as T;
}

/** camelCase → snake_case, recursively. Used on request bodies. */
export function toSnake<T = unknown>(value: unknown): T {
  return convert(value, toSnakeKey) as T;
}

/**
 * Accept a body in either shape, and return it in database shape.
 *
 * Forms in this codebase send a mixture: fields written before the migration
 * use camelCase, newer ones use snake_case. Both are understood, and an
 * explicitly snake_cased key always wins, so a caller can be precise when it
 * matters.
 *
 * ── Why the original is no longer spread back wholesale ────────────────────
 *
 * The "explicit snake_case wins" rule was implemented by layering every scalar
 * from the original body over the converted one. For a key that snake-casing
 * does not rename (`name`, `status`, `items`) that is a no-op and the rule
 * holds. For a key it *does* rename it was a bug: the output carried both
 * spellings, so `{ clientCompanyId }` became
 * `{ client_company_id, clientCompanyId }`.
 *
 * `prepare` hid this on every create route, because it names the columns it
 * wants and drops the rest. The thirteen `[id]` routes have no `prepare` — the
 * body went straight to `.update()` — so Postgres was handed a column that does
 * not exist and answered
 *
 *     PGRST204  Could not find the 'clientCompanyId' column of 'projects'
 *
 * which is why editing a project failed while creating one worked. Editing a
 * lead, contact, deal, company, task, ticket, invoice, expense, product,
 * supplier, warehouse or calendar event failed the same way, for the same
 * reason, on whichever multi-word field that form happened to send first.
 *
 * So a key is only layered back when snake-casing leaves it unchanged — which
 * is exactly the set of keys the rule was written for, and never introduces an
 * alias for a key that was renamed.
 */
export function acceptBody<T extends Record<string, any>>(body: T): Record<string, any> {
  if (!isPlainObject(body)) return body as Record<string, any>;

  const converted = toSnake(body) as Record<string, any>;
  const out: Record<string, any> = { ...converted };

  /**
   * Objects and arrays keep their converted form regardless.
   *
   * Spreading the whole original was also discarding nested conversion. For a
   * field like `items`, whose name snake-casing leaves alone, the original won
   * — putting back the array whose *inner* keys were still camelCase. A
   * purchase order sent `items: [{ productId, unitCost }]`, the handler
   * filtered on `product_id`, every line was discarded, and the create failed
   * with "Add at least one line item" no matter what was on the form.
   *
   * A caller wanting to be explicit about nested keys can send them
   * snake_cased, which `toSnake` leaves untouched.
   */
  for (const [k, v] of Object.entries(body)) {
    if (isPlainObject(v) || Array.isArray(v)) continue;
    if (toSnakeKey(k) !== k) continue;
    out[k] = v;
  }

  return out;
}
