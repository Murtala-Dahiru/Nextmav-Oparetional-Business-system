/** Segment belongs to the existing profile JSON, not a new company column. */
export function companyListScope<T extends { eq: (column: string, value: string) => T }>(query: T, _context: unknown, url: URL): T {
  const segment = url.searchParams.get('segment')?.trim();
  return segment ? query.eq('crm_profile->>segment', segment) : query;
}
