import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { can } from '@/lib/permissions';
import type { ModuleId } from '@/lib/constants';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Everything this customer is, in one request.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── The problem this exists to solve ─────────────────────────────────────
 *
 *  The CRM's Companies tab was a table with a create, an edit and a delete.
 *  Opening a customer told you their industry and their address. Whether they
 *  had three projects running, an invoice sixty days overdue and two open
 *  support tickets - the things anyone speaking to that customer actually
 *  needs - lived in three other modules, each requiring you to know it was
 *  there and to filter for the company by hand.
 *
 *  Every one of those relationships already existed in the schema:
 *  `contacts.company_id`, `deals.company_id`, `projects.client_company_id`,
 *  `invoices.company_id`, `calendar_events.project_id`, and tickets through
 *  `contacts`. Nothing read across them. That is the difference between a
 *  suite of applications that share a database and an operating system where
 *  each module is worth more because the others exist.
 *
 *  ── Why one endpoint rather than the module endpoints ────────────────────
 *
 *  Same reasoning as the project workspace's `overview`: eight round trips
 *  before anything renders, arriving in eight different orders, with the
 *  totals disagreeing while they land. It also lets the *server* decide which
 *  sections a role may see, so a support agent's response simply has no
 *  `invoices` key rather than carrying figures the client hides.
 *
 *  ── The permission model ─────────────────────────────────────────────────
 *
 *  `crm.view` opens the record. Each cross-module section is then gated on
 *  that module's own `view` - Finance data requires `finance.view`, tickets
 *  require `support.view` - because reaching a customer through the CRM must
 *  not become a way to read modules the sidebar does not offer you. RLS still
 *  scopes every query to the tenant underneath.
 */

type Params = { params: Promise<{ id: string }> };

const CONTACT_SELECT = 'id, first_name, last_name, email, phone, job_title, is_active';

const DEAL_SELECT =
  'id, name, stage, value, probability, expected_close, closed_at, ' +
  'owner:organization_members!deals_owner_id_fkey(' +
  'id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

const INVOICE_SELECT =
  'id, invoice_number, status, issue_date, due_date, total, amount_paid, currency';

const TICKET_SELECT =
  'id, ticket_number, subject, status, priority, created_at, resolved_at, due_at';

const ACTIVITY_SELECT =
  'id, activity_type, subject, body, due_at, remind_at, completed_at, created_at, member_id, ' +
  'member:organization_members!crm_activities_member_id_fkey(' +
  'id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

/** Flatten an embedded member to the `{ firstName, lastName, avatar }` screens read. */
function actor(row: any) {
  const p = row?.member?.profiles ?? row?.owner?.profiles ?? null;
  if (!p) return null;
  const parts = String(p.full_name ?? '').trim().split(/\s+/);
  return {
    fullName: p.full_name ?? '',
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
    avatar: p.avatar_url ?? '',
  };
}

export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('crm', 'view');
  if (ctx instanceof Response) return ctx;

  const { id } = await params;
  const orgId = ctx.org.organizationId;
  const sees = (m: ModuleId) => can(ctx.org.role, m, 'view');
  const none = Promise.resolve({ data: [] as any[], error: null });

  const { data: company, error: companyError } = await ctx.supabase
    .from('companies')
    .select('*, owner:organization_members!companies_owner_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url))')
    .eq('organization_id', orgId).eq('id', id).is('deleted_at', null)
    .maybeSingle();

  if (companyError) return pgError(companyError);
  if (!company) return error('Not found', 404, 'NOT_FOUND');

  /**
   * Contacts first, and awaited on its own.
   *
   * Tickets have no `company_id`: a ticket belongs to a *contact*, who belongs
   * to a company. So the ticket query needs the contact ids, which makes this
   * two waves rather than one - the only sequential step in the endpoint.
   */
  const { data: contacts } = await ctx.supabase
    .from('contacts').select(CONTACT_SELECT)
    .eq('organization_id', orgId).eq('company_id', id).is('deleted_at', null)
    .order('first_name', { ascending: true }).limit(50);

  const contactIds = (contacts ?? []).map((c: any) => c.id);

  const { data: projectRows } = sees('projects')
    ? await ctx.supabase
        .from('projects')
        .select('id, name, status, priority, start_date, end_date, budget')
        .eq('organization_id', orgId).eq('client_company_id', id).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(25)
    : { data: [] as any[] };

  const projectIds = (projectRows ?? []).map((p: any) => p.id);

  const [deals, invoices, tickets, health, meetings, activities, timeline] = await Promise.all([
    ctx.supabase.from('deals').select(DEAL_SELECT)
      .eq('organization_id', orgId).eq('company_id', id).is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(25),

    sees('finance')
      ? ctx.supabase.from('invoices').select(INVOICE_SELECT)
          .eq('organization_id', orgId).eq('company_id', id).is('deleted_at', null)
          .order('issue_date', { ascending: false }).limit(25)
      : none,

    sees('support') && contactIds.length
      ? ctx.supabase.from('support_tickets').select(TICKET_SELECT)
          .eq('organization_id', orgId).in('contact_id', contactIds).is('deleted_at', null)
          .order('created_at', { ascending: false }).limit(25)
      : none,

    // Progress, risk and task counts come from the same view the project board
    // reads, so the client's view of a project and the team's cannot disagree.
    projectIds.length
      ? ctx.supabase.from('v_project_health').select('*')
          .eq('organization_id', orgId).in('project_id', projectIds)
      : none,

    /**
     * Meetings, reached through the customer's projects.
     *
     * `calendar_events` has a `project_id` and no company column, so this is
     * the only honest link between a customer and a meeting. Events on no
     * project are internal and correctly absent.
     */
    sees('calendar') && projectIds.length
      ? ctx.supabase.from('calendar_events')
          .select('id, title, starts_at, ends_at, all_day, location, project_id')
          .eq('organization_id', orgId).in('project_id', projectIds)
          .gte('starts_at', new Date().toISOString())
          .order('starts_at', { ascending: true }).limit(10)
      : none,

    /**
     * The CRM's own timeline: calls, emails, notes logged against the customer.
     *
     * Fifty rather than twenty-five since the follow-up work: this list now
     * carries both halves of the relationship - what has happened *and* what is
     * owed - and the screen splits them. Twenty-five rows of a busy customer's
     * history could contain no open follow-up at all, so "next action" would
     * read as empty on precisely the accounts that have one.
     */
    ctx.supabase.from('crm_activities').select(ACTIVITY_SELECT)
      .eq('organization_id', orgId).eq('company_id', id)
      .order('created_at', { ascending: false }).limit(50),

    // And the platform's record of what was changed, from the activity feed.
    ctx.supabase.from('activity_log')
      .select('id, module, action, title, created_at, member:organization_members!activity_log_member_id_fkey(profiles!organization_members_user_id_fkey(full_name, avatar_url))')
      .eq('organization_id', orgId).eq('entity_id', id)
      .order('created_at', { ascending: false }).limit(20),
  ]);

  const healthById = new Map(
    ((health.data ?? []) as any[]).map(h => [h.project_id, h]),
  );

  const projects = (projectRows ?? []).map((p: any) => {
    const h = healthById.get(p.id);
    return {
      ...p,
      progress_pct: h?.progress_pct ?? 0,
      total_tasks: h?.total_tasks ?? 0,
      completed_tasks: h?.completed_tasks ?? 0,
      overdue_tasks: h?.overdue_tasks ?? 0,
      days_remaining: h?.days_remaining ?? null,
      is_at_risk: h?.is_at_risk ?? false,
    };
  });

  const dealRows = (deals.data ?? []) as any[];
  const invoiceRows = (invoices.data ?? []) as any[];
  const ticketRows = (tickets.data ?? []) as any[];

  const openDeals = dealRows.filter(d => !['closed_won', 'closed_lost'].includes(d.stage));
  const outstanding = invoiceRows
    .filter(i => i.status !== 'paid' && i.status !== 'cancelled')
    .reduce((sum, i) => sum + (Number(i.total ?? 0) - Number(i.amount_paid ?? 0)), 0);
  const today = new Date().toISOString().slice(0, 10);

  /**
   * The figures the header shows.
   *
   * Computed here, from the same rows the panels below render, so the summary
   * and the detail can never disagree - the failure mode that makes a customer
   * screen untrustworthy the first time someone checks the arithmetic.
   */
  const summary = {
    contacts: (contacts ?? []).length,
    openDeals: openDeals.length,
    openDealValue: openDeals.reduce((s, d) => s + Number(d.value ?? 0), 0),
    wonDealValue: dealRows
      .filter(d => d.stage === 'closed_won')
      .reduce((s, d) => s + Number(d.value ?? 0), 0),
    activeProjects: projects.filter((p: any) => ['active', 'planning'].includes(p.status)).length,
    projectsAtRisk: projects.filter((p: any) => p.is_at_risk).length,
    outstandingInvoiced: outstanding,
    overdueInvoices: invoiceRows.filter(
      i => i.status !== 'paid' && i.status !== 'cancelled' && i.due_date && i.due_date < today,
    ).length,
    openTickets: ticketRows.filter(t => !['resolved', 'closed'].includes(t.status)).length,
    currency: ctx.org.currency,
  };

  const payload: Record<string, unknown> = {
    company: { ...company, owner: actor(company) },
    contacts: contacts ?? [],
    deals: dealRows.map(d => ({ ...d, owner: actor(d) })),
    activities: ((activities.data ?? []) as any[]).map(a => ({ ...a, user: actor(a) })),
    timeline: ((timeline.data ?? []) as any[]).map(t => ({ ...t, user: actor(t) })),
    summary,
  };

  // Absent rather than empty: a role without Finance gets no `invoices` key at
  // all, so the screen has nothing to render and nothing to leak.
  if (sees('projects')) payload.projects = projects;
  if (sees('finance')) payload.invoices = invoiceRows;
  if (sees('support')) payload.tickets = ticketRows;
  if (sees('calendar')) payload.meetings = meetings.data ?? [];

  return success(payload);
}
