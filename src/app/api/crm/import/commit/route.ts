import { after } from 'next/server';
import { authorize } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { loadIndex, planRows, type RowAction } from '@/lib/import/plan';
import { MAX_ROWS } from '@/lib/import/sheet';
import type { Mapping } from '@/lib/import/records';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Step three: do it
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── The rule the whole route is built around ─────────────────────────────
 *
 *  **An import never destroys anything.** Every update fills blanks and only
 *  blanks: where a record already holds a value the spreadsheet is ignored.
 *  That is `mergeInto` below, and it is the difference between a tool people
 *  use on their real CRM and one they are afraid of. A spreadsheet is usually
 *  older, thinner and less trustworthy than what the team has been maintaining
 *  in the product, and "the file wins" would quietly overwrite a phone number
 *  somebody corrected last week.
 *
 *  Nothing is deleted, nothing is merged, and no existing record changes owner.
 *
 *  ── Why it re-plans rather than trusting the client ──────────────────────
 *
 *  The browser sends the rows, the mapping, and one decision per row. It does
 *  not send the shaped records or the matches, because a client that could
 *  name the record to update could name any record in the tenant. The plan is
 *  recomputed here from the rows; the client's decisions only ever *narrow*
 *  it - a row the server planned as a create can be skipped by the user, and a
 *  row can be updated only against the match the server itself found.
 *
 *  ── Why there is no transaction ──────────────────────────────────────────
 *
 *  PostgREST has no multi-statement transaction, and wrapping this in an RPC
 *  would mean writing the whole import in PL/pgSQL - including the duplicate
 *  matching. What happens instead is that failures are counted and reported
 *  per row: an import of three hundred where four rows fail imports two
 *  hundred and ninety-six and names the four. A half-finished import that
 *  says so is better than an all-or-nothing one that loses a morning's work to
 *  a single bad email address.
 */

export const runtime = 'nodejs';

/** Values worth writing: a blank cell is not an instruction to clear a field. */
function present(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return Number.isFinite(value);
  return true;
}

/**
 * The fields of `patch` that `existing` has no value for.
 *
 * Returns an empty object when there is nothing to add, which the caller uses
 * to skip the write entirely - a PATCH that changes nothing still costs a
 * round trip and still writes an audit row saying somebody edited the record.
 */
function mergeInto(existing: Record<string, any>, patch: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!present(value)) continue;
    if (present(existing?.[key])) continue;
    out[key] = value;
  }
  return out;
}

export async function POST(req: Request) {
  const ctx = await authorize('crm', 'create');
  if (ctx instanceof Response) return ctx;

  const { supabase, org } = ctx;
  const orgId = org.organizationId;

  let rows: string[][];
  let mapping: Mapping;
  let target: 'leads' | 'contacts';
  let decisions: Record<string, RowAction>;

  try {
    const body = await req.json();
    rows = body?.rows;
    mapping = (body?.mapping ?? {}) as Mapping;
    target = body?.target === 'contacts' ? 'contacts' : 'leads';
    decisions = (body?.decisions ?? {}) as Record<string, RowAction>;

    if (!Array.isArray(rows) || !rows.length) {
      return error('There are no rows to import.', 422, 'VALIDATION_ERROR');
    }
    if (rows.length > MAX_ROWS) {
      return error(`Only ${MAX_ROWS} rows can be imported at once.`, 422, 'VALIDATION_ERROR');
    }
    if (!Object.keys(mapping).length) {
      return error('Choose what at least one column means before importing.', 422, 'VALIDATION_ERROR');
    }
  } catch {
    return error('That import could not be read.', 422, 'VALIDATION_ERROR');
  }

  try {
    const { index, exhaustive } = await loadIndex(ctx);
    const plan = planRows(rows, mapping, index, exhaustive, target);

    const result = {
      companiesCreated: 0,
      companiesUpdated: 0,
      peopleCreated: 0,
      peopleUpdated: 0,
      skipped: 0,
      failed: [] as { row: number; message: string }[],
    };

    for (const planned of plan.rows) {
      /**
       * The user's decision, bounded by the server's.
       *
       * `update` is only honoured where the server itself found a match, so a
       * client cannot ask to update a record the plan never proposed.
       */
      const asked = decisions[String(planned.row)];
      let action: RowAction = asked ?? planned.action;
      if (planned.candidate.problems.some(p => p.severity === 'error')) action = 'skip';

      if (action === 'skip') { result.skipped++; continue; }

      const { company, person } = planned.candidate;

      /**
       * Re-matched against the index as it is *now*, not as it was.
       *
       * The plan is computed for every row before the first write, so it
       * cannot know about records this same import has since created. Six
       * contacts at one company would each find no match, each insert a
       * company, and the import would duplicate within itself while its own
       * preview promised two records.
       *
       * `??` rather than a replacement: a match the plan found is the one the
       * user reviewed and it stays. This only ever fills in a match that did
       * not exist when the plan was drawn.
       */
      const companyMatch = company ? (planned.companyMatch ?? index.matchCompany(company)) : null;
      const personMatch = person
        ? (planned.personMatch ?? index.matchPerson(person, company?.name ?? ''))
        : null;

      /**
       * A match that only appeared during this run updates rather than
       * duplicates, unless the user explicitly asked for a new record. They
       * were shown a create and are entitled to get one; what they are not
       * entitled to is the *default* silently producing two rows for one email.
       */
      if (action === 'create' && !asked && personMatch?.strength === 'exact') {
        action = 'update';
      }
      if (action === 'update' && !personMatch && !companyMatch) action = 'create';

      try {
        /* ── The company ─────────────────────────────────────────────────── */

        let companyId: string | null = null;

        if (company && company.name) {
          const match = companyMatch;

          /**
           * ── Why a company attaches on *any* match, and a person does not ──
           *
           * The conservative rule elsewhere in this feature - a possible match
           * is offered, never acted on - exists because merging two different
           * people destroys data. Attaching a new lead to an existing company
           * destroys nothing: the company row is only ever filled in where it
           * was blank, and a lead pointing at the right customer is the whole
           * reason the import creates companies at all.
           *
           * Treating a possible company match as a create is what produced the
           * opposite: a file listing "Acme Ltd" and "Acme Limited" on two rows
           * created both, and a workspace that already held one of them got a
           * second. Two Acmes is precisely the duplicate this screen promised
           * to prevent.
           */
          if (match) {
            companyId = match.id;

            const { data: existing } = await supabase.from('companies')
              .select('*').eq('organization_id', orgId).eq('id', match.id).maybeSingle();

            const patch = mergeInto(existing ?? {}, {
              website: company.website,
              industry: company.industry,
              email: company.email,
              phone: company.phone,
              city: company.city,
              country: company.country,
              employee_count: company.employeeCount,
              annual_revenue: company.annualRevenue,
            });

            if (Object.keys(patch).length) {
              const { error: e } = await supabase.from('companies').update(patch)
                .eq('organization_id', orgId).eq('id', match.id);
              if (e) throw new Error(e.message);
              result.companiesUpdated++;
            }
          } else {
            const { data, error: e } = await supabase.from('companies').insert({
              organization_id: orgId,
              name: company.name,
              website: company.website || null,
              industry: company.industry || null,
              email: company.email || null,
              phone: company.phone || null,
              city: company.city || null,
              country: company.country || null,
              employee_count: company.employeeCount,
              annual_revenue: company.annualRevenue,
              notes: '',
              owner_id: org.memberId,
            }).select('id, name, website, email').single();

            if (e) throw new Error(e.message);
            companyId = data.id;
            result.companiesCreated++;

            /**
             * Told to the index straight away.
             *
             * Six rows for six people at one company must produce one company,
             * and without this every row after the first would create another -
             * an import that duplicates within itself while promising not to.
             */
            index.remember({
              id: data.id, name: data.name, website: data.website, email: data.email,
            });
          }
        }

        /* ── The person ──────────────────────────────────────────────────── */

        if (person) {
          const match = personMatch;
          const isLead = target === 'leads';
          const table = isLead ? 'leads' : 'contacts';

          const createPerson = async () => {
            const payload: Record<string, unknown> = isLead
              ? {
                organization_id: orgId,
                first_name: person.firstName,
                last_name: person.lastName,
                email: person.email || null,
                phone: person.phone || null,
                company_name: company?.name || null,
                job_title: person.jobTitle || null,
                source: person.source || 'import',
                status: person.status,
                score: person.score ?? 0,
                estimated_value: person.estimatedValue ?? 0,
                notes: person.notes || '',
                owner_id: org.memberId,
              }
              : {
                organization_id: orgId,
                first_name: person.firstName,
                last_name: person.lastName,
                email: person.email || null,
                phone: person.phone || null,
                job_title: person.jobTitle || null,
                company_id: companyId,
                source: person.source || 'import',
                is_active: true,
                notes: person.notes || '',
                owner_id: org.memberId,
              };

            const { data, error: e } = await supabase.from(table).insert(payload)
              .select('id, first_name, last_name, email, phone').single();
            if (e) throw new Error(e.message);

            result.peopleCreated++;
            index.remember(undefined, {
              id: data.id,
              kind: isLead ? 'lead' : 'contact',
              firstName: data.first_name ?? '',
              lastName: data.last_name ?? '',
              email: data.email,
              phone: data.phone,
              companyName: company?.name ?? null,
            });
          };

          if (match && action === 'update') {
            const { data: existing } = await supabase.from(table)
              .select('*').eq('organization_id', orgId).eq('id', match.id).maybeSingle();

            /**
             * A match found among leads cannot be updated as a contact, and
             * vice versa - the ids come from two tables. Where the kinds
             * disagree the row is created instead, which is right: importing a
             * contact for somebody who exists as a lead is a real thing to do.
             */
            if (!existing) {
              await createPerson();
            } else {
              const patch = mergeInto(existing, isLead
                ? {
                  first_name: person.firstName,
                  last_name: person.lastName,
                  email: person.email,
                  phone: person.phone,
                  company_name: company?.name,
                  job_title: person.jobTitle,
                  estimated_value: person.estimatedValue,
                  score: person.score,
                  notes: person.notes,
                }
                : {
                  first_name: person.firstName,
                  last_name: person.lastName,
                  email: person.email,
                  phone: person.phone,
                  job_title: person.jobTitle,
                  company_id: companyId,
                  notes: person.notes,
                });

              if (Object.keys(patch).length) {
                const { error: e } = await supabase.from(table).update(patch)
                  .eq('organization_id', orgId).eq('id', match.id);
                if (e) throw new Error(e.message);
                result.peopleUpdated++;
              }
            }
          } else {
            await createPerson();
          }
        }
      } catch (e: any) {
        /**
         * One row's failure is one row's failure.
         *
         * The most common cause is a unique constraint the spreadsheet could
         * not know about, and stopping the whole import for it would waste the
         * two hundred rows that were fine. The row number is the one in the
         * file, counting the header, because that is the row the user will
         * open the spreadsheet and look at.
         */
        result.failed.push({
          row: planned.row + 2,
          message: (e?.message ?? 'Could not be saved').slice(0, 200),
        });
      }
    }

    /**
     * The import, written into the platform's own history.
     *
     * `activity_log` is where every other module records what it did, and the
     * feed on the overview already renders it - so an import appears beside
     * the invoices and the tasks rather than in a table built for one feature.
     * This is why 0028 adds no import-batch table.
     */
    after(async () => {
      try {
        await supabase.from('activity_log').insert({
          organization_id: orgId,
          member_id: org.memberId,
          module: 'crm',
          action: 'create',
          title: `Imported ${result.peopleCreated + result.companiesCreated} CRM records`,
          description:
            `${result.peopleCreated} ${target === 'leads' ? 'leads' : 'contacts'} created, `
            + `${result.companiesCreated} companies created, `
            + `${result.peopleUpdated + result.companiesUpdated} updated, `
            + `${result.skipped} skipped.`,
          entity_type: 'import',
          metadata: {
            target,
            created: result.peopleCreated,
            updated: result.peopleUpdated,
            skipped: result.skipped,
            failed: result.failed.length,
          },
        });
      } catch {
        // A feed entry is never worth failing an import that already ran.
      }
    });

    return success(result);
  } catch (e: any) {
    return serverError(e, 'That import could not be completed.');
  }
}

