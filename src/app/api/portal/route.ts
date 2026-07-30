import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The client portal
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everything an external client sees, in one read.
 *
 * ── The shape of the permission ───────────────────────────────────────────
 *
 * A client is not a limited employee. They are a different kind of user
 * altogether: they have no colleagues in this system, no modules, no chat, no
 * directory, and no ability to change anything about the work. What they have
 * is visibility into their own engagement — the plan, its progress, what has
 * been delivered, what they owe, and a way to ask a question.
 *
 * That is enforced in three places, deliberately:
 *
 *   1. `ROLE_GRANTS.client` in lib/permissions.ts gives them `dashboard`,
 *      `support` and read-only `projects`, and nothing else.
 *   2. The RLS policies added in 0016 scope every table to their own company
 *      through `auth_client_company_id()`.
 *   3. This endpoint, which selects only client-appropriate columns.
 *
 * Layer 2 is the security boundary. Layer 3 exists because a portal that
 * returns internal task counts and budget figures is wrong even when the rows
 * are technically theirs — a status report is not a window into execution.
 *
 * ── Why employees can call it too ─────────────────────────────────────────
 *
 * Staff reach it with `?companyId=` to preview exactly what a given client
 * sees. A portal nobody internal can inspect is a portal that quietly shows
 * the wrong thing for months, and "what does the customer actually see" should
 * not require logging in as them.
 */
export async function GET(req: Request) {
  const ctx = await authorize('projects', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const isClient = ctx.org.role === 'client';

  /**
   * Which company's portal this is.
   *
   * For a client it is theirs and the parameter is ignored — accepting it
   * would be a straightforward way to read another customer's engagement.
   * RLS would refuse the rows anyway, but the request should not be
   * expressible in the first place.
   */
  let companyId: string | null = null;

  if (isClient) {
    const { data: membership } = await ctx.supabase
      .from('organization_members')
      .select('client_company_id')
      .eq('id', ctx.org.memberId)
      .maybeSingle();

    companyId = membership?.client_company_id ?? null;

    if (!companyId) {
      /**
       * A client login with no company attached.
       *
       * The safe failure — they see nothing — but an opaque empty portal is a
       * support ticket, so it says what is wrong and who fixes it.
       */
      return error(
        'Your account is not linked to a company yet. Ask your account manager to finish setting it up.',
        409, 'CLIENT_NOT_LINKED',
      );
    }
  } else {
    companyId = searchParams.get('companyId') ?? searchParams.get('company_id');
    if (!companyId) {
      return error(
        'Pass ?companyId= to preview a client portal.',
        422, 'VALIDATION_ERROR',
      );
    }
  }

  /**
   * The supplier's branding — which is the one place it genuinely belongs.
   *
   * ── Whose brand is this, exactly ─────────────────────────────────────────
   *
   * Three parties are in play and it is worth naming them: this platform, the
   * *tenant* who bought it, and the tenant's *client* reading this portal. The
   * portal is the client's window onto the tenant's work, so the tenant's logo
   * and colour are what should frame it — a customer looking at their project
   * expects to see the firm they hired, not the software that firm happens to
   * run on.
   *
   * That is the opposite of the sidebar, where the same logo was wrong: there
   * the audience is the tenant's own staff using this product, and the product
   * keeps its own name. Same asset, different audience, different answer.
   *
   * `show_logo_in_portal` is honoured, so a tenant who would rather not brand
   * the portal simply does not.
   */
  const { data: brandRows } = await ctx.supabase
    .from('org_settings')
    .select('value')
    .eq('organization_id', ctx.org.organizationId)
    .eq('key', 'branding')
    .maybeSingle();

  const brandSettings = (brandRows?.value ?? {}) as Record<string, unknown>;

  const { data: orgRow } = await ctx.supabase
    .from('organizations')
    .select('name, logo_url')
    .eq('id', ctx.org.organizationId)
    .maybeSingle();

  const showLogo = brandSettings.show_logo_in_portal !== false;

  const supplier = {
    name: orgRow?.name ?? '',
    logoUrl: showLogo ? (orgRow?.logo_url ?? null) : null,
    primaryColour: String(brandSettings.primary_colour ?? '#10b981'),
    welcome: String(brandSettings.portal_welcome ?? ''),
  };

  const [company, projects, invoices, tickets, announcements] = await Promise.all([
    ctx.supabase
      .from('companies')
      .select('id, name, industry, website')
      .eq('organization_id', ctx.org.organizationId)
      .eq('id', companyId)
      .maybeSingle(),

    ctx.supabase
      .from('v_client_portal_projects')
      .select('*')
      .eq('organization_id', ctx.org.organizationId)
      .eq('client_company_id', companyId)
      .order('end_date', { ascending: true, nullsFirst: false }),

    /**
     * Invoices, drafts excluded.
     *
     * An unsent invoice is an internal working document. Showing a customer a
     * figure before anyone decided to send it is how a portal manufactures a
     * dispute out of nothing. The RLS policy excludes drafts as well, so this
     * filter is documentation rather than the guarantee.
     */
    ctx.supabase
      .from('invoices')
      .select('id, invoice_number, status, issue_date, due_date, total, amount_paid, currency, project_id')
      .eq('organization_id', ctx.org.organizationId)
      .eq('company_id', companyId)
      .neq('status', 'draft')
      .is('deleted_at', null)
      .order('issue_date', { ascending: false })
      .limit(100),

    /**
     * Their support tickets.
     *
     * Matched through the contacts belonging to this company, because a ticket
     * raised by a client carries `contact_id`, not a company. Internal
     * comments on those tickets are excluded by the existing
     * `ticket_comments_select` policy from 0005.
     */
    ctx.supabase
      .from('support_tickets')
      .select('id, ticket_number, subject, status, priority, created_at, resolved_at, contact:contacts(id, first_name, last_name, company_id)')
      .eq('organization_id', ctx.org.organizationId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(100),

    ctx.supabase
      .from('announcements')
      .select('id, title, body, is_pinned, published_at, project_id')
      .eq('organization_id', ctx.org.organizationId)
      .in('audience', ['clients', 'everyone'])
      .is('deleted_at', null)
      .order('is_pinned', { ascending: false })
      .order('published_at', { ascending: false })
      .limit(25),
  ]);

  if (company.error) return pgError(company.error);
  if (!company.data) {
    return error('That client does not exist in this organization.', 404, 'NOT_FOUND');
  }

  const projectRows = projects.data ?? [];

  // The ticket query cannot filter on the contact's company in PostgREST, so
  // the narrowing happens here. Cheap: a client's ticket list is small.
  const ownTickets = (tickets.data ?? []).filter(
    (t: any) => t.contact?.company_id === companyId,
  );

  const invoiceRows = invoices.data ?? [];
  const outstanding = invoiceRows
    .filter((i: any) => !['paid', 'cancelled', 'refunded'].includes(i.status))
    .reduce((sum: number, i: any) => sum + (Number(i.total) - Number(i.amount_paid)), 0);

  return success({
    company: company.data,
    /**
     * Who is delivering the work. Named `supplier` rather than `organization`
     * so it cannot be confused with `company`, which is the *client* reading
     * this — the two are opposite ends of the same relationship and a portal
     * that muddles them shows a customer their own logo above somebody else's
     * projects.
     */
    supplier,
    projects: projectRows,
    invoices: invoiceRows,
    tickets: ownTickets,
    announcements: announcements.data ?? [],
    summary: {
      activeProjects: projectRows.filter((p: any) => !['completed', 'cancelled', 'archived'].includes(p.status)).length,
      totalProjects: projectRows.length,
      // The three-grade verdict from v_project_health, so the portal cannot
      // describe a late project as healthy.
      projectsOffTrack: projectRows.filter((p: any) => p.health === 'off_track').length,
      projectsAtRisk: projectRows.filter((p: any) => p.health === 'at_risk').length,
      openTickets: ownTickets.filter((t: any) => !['resolved', 'closed'].includes(t.status)).length,
      outstandingBalance: Math.round(outstanding * 100) / 100,
      // Currency is taken from the invoices themselves rather than the
      // organization default: a client billed in one currency should never see
      // their balance labelled with another.
      currency: invoiceRows[0]?.currency ?? ctx.org.currency,
    },
    // Told to the client explicitly so the UI never has to infer it from the
    // absence of controls.
    readOnly: true,
  });
}
