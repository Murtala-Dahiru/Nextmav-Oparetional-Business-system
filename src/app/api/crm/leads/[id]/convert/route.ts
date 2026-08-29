import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { normaliseCompany } from '@/lib/import/records';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A lead becomes a customer
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── The columns that were waiting for this ───────────────────────────────
 *
 *  `leads.converted_contact_id` and `leads.converted_at` have been in the
 *  schema since 0003, with a comment saying "set when the lead becomes a
 *  contact, so conversion is traceable". Nothing has ever set either. The lead
 *  status list ends in Won, and winning a lead did nothing but colour a badge:
 *  no contact appeared, no company appeared, no deal appeared, and the person
 *  who had just won the business retyped all three by hand.
 *
 *  That is the single largest hole in the CRM's workflow, and it is one
 *  endpoint wide.
 *
 *  ── What it creates ──────────────────────────────────────────────────────
 *
 *    · A **company**, from `company_name`, reusing an existing one where the
 *      name already matches. `normaliseCompany` is the Import Center's
 *      matcher, shared rather than reimplemented, so "Acme Ltd" here and
 *      "Acme Limited" in the spreadsheet reach the same record.
 *    · A **contact**, carrying the lead's name, email, phone and job title,
 *      attached to that company.
 *    · Optionally a **deal**, when the caller asks for one, valued from the
 *      lead's estimated value and owned by whoever owns the lead.
 *    · The lead itself, stamped and moved to `won`.
 *
 *  ── What it does not do ──────────────────────────────────────────────────
 *
 *  It does not delete the lead. The lead is the record of where the customer
 *  came from - the source, the score, the notes taken before anyone had a
 *  contact record - and deleting it would throw that away at the exact moment
 *  it became interesting. It stays, marked converted, and the Leads table
 *  shows it as such.
 *
 *  It also refuses to convert twice. A second call returns the contact the
 *  first one made rather than a second copy, for the same reason the intake
 *  endpoint answers "already on your list": people press buttons twice.
 */

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const ctx = await authorize('crm', 'create');
  if (ctx instanceof Response) return ctx;

  const { supabase, org } = ctx;
  const orgId = org.organizationId;
  const { id } = await params;

  let wantDeal = false;
  let dealName = '';
  let dealValue: number | null = null;
  let expectedClose: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    wantDeal = body?.createDeal === true;
    dealName = String(body?.dealName ?? '').trim();
    dealValue = body?.dealValue == null ? null : Number(body.dealValue);
    expectedClose = body?.expectedClose ? String(body.expectedClose) : null;
  } catch {
    // A conversion with no body is the ordinary case: contact and company only.
  }

  try {
    const { data: lead, error: leadError } = await supabase.from('leads')
      .select('*').eq('organization_id', orgId).eq('id', id).is('deleted_at', null)
      .maybeSingle();

    if (leadError) return pgError(leadError);
    if (!lead) return error('Not found', 404, 'NOT_FOUND');

    if (lead.converted_contact_id) {
      const { data: existing } = await supabase.from('contacts')
        .select('*, company:companies(id, name)')
        .eq('organization_id', orgId).eq('id', lead.converted_contact_id).maybeSingle();

      return success(
        { contact: existing, company: existing?.company ?? null, deal: null, lead },
        { alreadyConverted: true },
      );
    }

    /* ── The company ─────────────────────────────────────────────────────── */

    let companyId: string | null = null;
    let company: any = null;
    const wanted = String(lead.company_name ?? '').trim();

    if (wanted) {
      /**
       * Matched in the application rather than by a database query.
       *
       * "Acme Ltd" and "Acme Limited" are one customer and no `ilike` finds
       * both. The candidate set is bounded - a workspace's company list - and
       * the comparison is the one the Import Center already uses, so the two
       * paths into the CRM cannot disagree about what counts as the same
       * company.
       */
      const { data: candidates } = await supabase.from('companies')
        .select('id, name').eq('organization_id', orgId).is('deleted_at', null).limit(5000);

      const key = normaliseCompany(wanted);
      const hit = (candidates ?? []).find((c: any) => normaliseCompany(c.name) === key);

      if (hit) {
        companyId = hit.id;
        company = hit;
      } else {
        const { data, error: e } = await supabase.from('companies').insert({
          organization_id: orgId,
          name: wanted,
          notes: '',
          owner_id: lead.owner_id ?? org.memberId,
        }).select('id, name').single();

        if (e) return pgError(e);
        companyId = data.id;
        company = data;
      }
    }

    /* ── The contact ─────────────────────────────────────────────────────── */

    const { data: contact, error: contactError } = await supabase.from('contacts').insert({
      organization_id: orgId,
      first_name: lead.first_name ?? '',
      last_name: lead.last_name ?? '',
      email: lead.email || null,
      phone: lead.phone || null,
      job_title: lead.job_title || null,
      company_id: companyId,
      source: lead.source || 'lead',
      is_active: true,
      notes: lead.notes ?? '',
      owner_id: lead.owner_id ?? org.memberId,
    }).select('*, company:companies(id, name)').single();

    if (contactError) return pgError(contactError);

    /* ── The deal ────────────────────────────────────────────────────────── */

    let deal: any = null;

    if (wantDeal) {
      const name = dealName
        || `${wanted || `${lead.first_name} ${lead.last_name}`.trim() || 'New'} opportunity`;

      const { data, error: e } = await supabase.from('deals').insert({
        organization_id: orgId,
        name,
        company_id: companyId,
        contact_id: contact.id,
        stage: 'qualification',
        value: Number.isFinite(dealValue as number) && (dealValue as number) >= 0
          ? dealValue
          : Number(lead.estimated_value ?? 0),
        /**
         * Probability from the lead's own score, where there is one.
         *
         * Not invented: `leads.score` is a 0-100 field a salesperson has
         * already filled in, and it is the same kind of judgement
         * `deals.probability` holds. Where the score is zero - the default,
         * meaning nobody scored it - the deal takes the ordinary 20.
         */
        probability: Number(lead.score) > 0 ? Math.min(100, Number(lead.score)) : 20,
        expected_close: expectedClose || null,
        notes: '',
        owner_id: lead.owner_id ?? org.memberId,
      }).select('*, company:companies(id, name), contact:contacts(id, first_name, last_name)').single();

      if (e) return pgError(e);
      deal = data;
    }

    /* ── The lead, stamped ───────────────────────────────────────────────── */

    const { data: updated, error: stampError } = await supabase.from('leads').update({
      converted_contact_id: contact.id,
      converted_at: new Date().toISOString(),
      status: 'won',
    }).eq('organization_id', orgId).eq('id', id).select('*').single();

    if (stampError) return pgError(stampError);

    /**
     * The conversion, on the customer's own timeline.
     *
     * A company record whose history begins the day somebody converted a lead
     * should say so - otherwise the first entry on a new customer is whatever
     * happens next week, and where they came from is lost. `crm_activities` is
     * the timeline every CRM screen reads, so this is written there rather
     * than only into the audit log.
     */
    await supabase.from('crm_activities').insert({
      organization_id: orgId,
      activity_type: 'note',
      subject: 'Lead converted',
      body: `${`${lead.first_name} ${lead.last_name}`.trim() || 'This lead'} became a contact`
        + (deal ? ', with a deal opened.' : '.'),
      lead_id: id,
      contact_id: contact.id,
      company_id: companyId,
      deal_id: deal?.id ?? null,
      member_id: org.memberId,
    });

    return success({ contact, company, deal, lead: updated });
  } catch (e: any) {
    return serverError(e, 'That lead could not be converted.');
  }
}
