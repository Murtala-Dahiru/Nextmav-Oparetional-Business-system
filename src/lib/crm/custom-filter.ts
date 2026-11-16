import { customValuesSchema } from './customization';

/** A bounded conjunction of exact/array-containment matches; no SQL paths from clients. */
export function parseCustomFilter(raw: string) {
  if (raw.length > 12000) throw new Error('Custom field filter is too large');
  const parsed = customValuesSchema.safeParse(JSON.parse(raw));
  if (!parsed.success || Object.keys(parsed.data).length > 10) throw new Error('Use at most ten valid custom field filters');
  return parsed.data;
}
