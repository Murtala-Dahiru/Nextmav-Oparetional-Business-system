import type { RequestContext } from '@/lib/auth-context';
import {
  ExistingIndex, buildCandidate, normaliseCompany, type Candidate, type Mapping, type Match,
  type ExistingCompany, type ExistingPerson,
} from '@/lib/import/records';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  What this import would do, worked out before it does any of it
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Shared by the preview and the commit, and that sharing is the point: the two
 * must reach the same conclusion about every row, or the screen that says "274
 * ready, 8 duplicates" is describing a different import from the one that
 * runs. Preview renders this; commit executes it.
 */

/** How many existing records the duplicate check is allowed to load. */
const INDEX_LIMIT = 5000;

export type RowAction = 'create' | 'update' | 'skip';

export interface PlannedRow {
  row: number;
  candidate: Candidate;
  companyMatch: Match | null;
  /** An earlier row of this same file that creates this company. */
  companyFromRow: number | null;
  personMatch: Match | null;
  /** What will happen unless the user says otherwise. */
  action: RowAction;
  /** Why that is the default, in the words the review screen shows. */
  note: string;
}

export interface Plan {
  rows: PlannedRow[];
  summary: {
    total: number;
    create: number;
    update: number;
    skip: number;
    duplicates: number;
    linked: number;
    needsAttention: number;
    companiesCreated: number;
    /** False when the workspace holds more records than the index could load. */
    exhaustive: boolean;
  };
}

/**
 * Load the workspace's existing companies and people.
 *
 * Bounded, and the bound is reported. A workspace with more than five thousand
 * companies would need a query per row to check duplicates exactly, and the
 * screen would take a minute to draw - so the index is capped and the review
 * screen says "checked against the first 5,000 records" rather than implying a
 * completeness it does not have. Silently checking a subset and calling it a
 * duplicate check is the failure this whole feature exists to avoid.
 */
export async function loadIndex(ctx: RequestContext) {
  const orgId = ctx.org.organizationId;

  const [companiesRes, contactsRes, leadsRes] = await Promise.all([
    ctx.supabase.from('companies').select('id, name, website, email')
      .eq('organization_id', orgId).is('deleted_at', null).limit(INDEX_LIMIT),
    ctx.supabase.from('contacts')
      .select('id, first_name, last_name, email, phone, company:companies(name)')
      .eq('organization_id', orgId).is('deleted_at', null).limit(INDEX_LIMIT),
    ctx.supabase.from('leads')
      .select('id, first_name, last_name, email, phone, company_name')
      .eq('organization_id', orgId).is('deleted_at', null).limit(INDEX_LIMIT),
  ]);

  const companies: ExistingCompany[] = ((companiesRes.data ?? []) as any[]).map(c => ({
    id: c.id, name: c.name, website: c.website, email: c.email,
  }));

  const people: ExistingPerson[] = [
    ...((contactsRes.data ?? []) as any[]).map(c => ({
      id: c.id, kind: 'contact' as const,
      firstName: c.first_name ?? '', lastName: c.last_name ?? '',
      email: c.email, phone: c.phone,
      companyName: (Array.isArray(c.company) ? c.company[0]?.name : c.company?.name) ?? null,
    })),
    ...((leadsRes.data ?? []) as any[]).map(l => ({
      id: l.id, kind: 'lead' as const,
      firstName: l.first_name ?? '', lastName: l.last_name ?? '',
      email: l.email, phone: l.phone, companyName: l.company_name,
    })),
  ];

  const exhaustive =
    companies.length < INDEX_LIMIT
    && (contactsRes.data ?? []).length < INDEX_LIMIT
    && (leadsRes.data ?? []).length < INDEX_LIMIT;

  return { index: new ExistingIndex(companies, people), exhaustive };
}

/**
 * Decide what each row would do.
 *
 * ── The defaults, and why they lean the way they do ──────────────────────
 *
 *   · A row with an error is skipped. There is nothing to write.
 *   · An exact match on a person - the same email address - updates. Two
 *     records for one email is a duplicate by anybody's definition, and the
 *     update only ever fills blanks (see `mergeInto` in the commit route), so
 *     the worst case is that nothing changes.
 *   · A *possible* match is skipped and flagged. This is the conservative half
 *     of the design: a name that looks alike is not evidence, and the cost of
 *     being wrong is somebody else's data.
 *   · Everything else is created.
 *
 * The user can change any of them, per row, before anything runs.
 */
export function planRows(
  rows: string[][],
  mapping: Mapping,
  index: ExistingIndex,
  exhaustive: boolean,
  target: 'leads' | 'contacts',
): Plan {
  const planned: PlannedRow[] = [];

  /**
   * Companies this file will create, by the key the matcher uses.
   *
   * ── The bug this exists to prevent ───────────────────────────────────────
   *
   * The index knows what the workspace already holds. It does not know what
   * *this file* is about to add, and a file's rows are not independent: six
   * contacts at Acme is one company and six people. Without this, every row
   * after the first found no match, planned a create, and the import
   * duplicated within itself while its own preview promised it would not.
   *
   * Keyed on `normaliseCompany`, not the raw name, because "Acme Ltd" on one
   * row and "Acme Limited" on the next are the case that made this visible.
   */
  const willCreate = new Map<string, number>();

  rows.forEach((row, i) => {
    const candidate = buildCandidate(row, mapping, i);

    const companyMatch = candidate.company ? index.matchCompany(candidate.company) : null;
    const personMatch = candidate.person
      ? index.matchPerson(candidate.person, candidate.company?.name ?? '')
      : null;

    /**
     * The earlier row of this same file that will create this company.
     *
     * Deliberately not expressed as a duplicate match: the row is not a
     * duplicate of anything: it is the second mention of a company this import
     * is about to create, which is ordinary and needs no decision from anyone.
     * Flagging it would put four hundred rows of a normal contact list into
     * the review queue. It is carried separately so the count is right and the
     * commit knows to attach rather than insert.
     */
    const companyKey = candidate.company ? normaliseCompany(candidate.company.name) : '';
    const companyFromRow = !companyMatch && companyKey && willCreate.has(companyKey)
      ? willCreate.get(companyKey)!
      : null;

    const blocked = candidate.problems.some(p => p.severity === 'error');

    let action: RowAction;
    let note: string;

    if (blocked) {
      action = 'skip';
      note = 'Nothing to import';
    } else if (personMatch?.strength === 'exact') {
      action = 'update';
      note = `Matches ${personMatch.label} on ${personMatch.on}`;
    } else if (personMatch?.strength === 'possible') {
      action = 'skip';
      note = `Might be ${personMatch.label} - ${personMatch.on}`;
    } else if (!candidate.person && companyMatch?.strength === 'exact') {
      action = 'update';
      note = `Matches ${companyMatch.label} on ${companyMatch.on}`;
    } else if (!candidate.person && companyMatch?.strength === 'possible') {
      action = 'skip';
      note = `Might be ${companyMatch.label} - ${companyMatch.on}`;
    } else {
      action = 'create';
      const noun = target === 'leads' ? 'New lead' : 'New contact';

      /**
       * A company that already exists is not a duplicate of this row.
       *
       * The person is new; the company they work at is one the CRM already
       * has, and the row will attach to it rather than create a second. Saying
       * "New lead" and nothing else hid the single most useful fact on the
       * screen - that the import is about to join these people to customers
       * the team already knows.
       */
      note = candidate.person
        ? companyMatch
          ? `${noun} at ${companyMatch.label}, which you already have`
          : companyFromRow !== null
            ? `${noun}, joining the company created on row ${companyFromRow + 2}`
            : noun
        : 'New company';
    }

    if (candidate.company && !companyMatch && companyFromRow === null && action !== 'skip') {
      willCreate.set(companyKey, i);
    }

    planned.push({ row: i, candidate, companyMatch, companyFromRow, personMatch, action, note });
  });

  return {
    rows: planned,
    summary: {
      total: planned.length,
      create: planned.filter(p => p.action === 'create').length,
      update: planned.filter(p => p.action === 'update').length,
      skip: planned.filter(p => p.action === 'skip').length,
      /**
       * A duplicate is a *person* the CRM already has.
       *
       * A matching company is not: the row's person is new and will be
       * attached to the customer that already exists, which is the correct
       * outcome rather than a problem to review. Counting those as duplicates
       * put a warning on every row of a file listing four new people at one
       * existing customer.
       */
      duplicates: planned.filter(p => p.personMatch).length,
      /** Rows that will join a customer the CRM already holds. */
      linked: planned.filter(p => p.companyMatch && !p.personMatch).length,
      needsAttention: planned.filter(p => p.candidate.problems.length > 0).length,
      companiesCreated: willCreate.size,
      exhaustive,
    },
  };
}
