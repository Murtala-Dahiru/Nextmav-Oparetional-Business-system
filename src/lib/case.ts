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
 * Accept a body in either shape.
 *
 * Forms in this codebase send a mixture: fields written before the migration
 * use camelCase, newer ones use snake_case. Merging the converted form over
 * the original means both are understood and an explicitly snake_cased key
 * always wins, so a caller can be precise when it matters.
 */
export function acceptBody<T extends Record<string, any>>(body: T): Record<string, any> {
  if (!isPlainObject(body)) return body as Record<string, any>;
  return { ...(toSnake(body) as Record<string, any>), ...body };
}
