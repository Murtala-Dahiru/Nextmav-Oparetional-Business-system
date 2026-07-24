import { authorize, pgError } from '@/lib/auth-context';
import { success } from '@/lib/api-response';
import { can } from '@/lib/permissions';
import type { ModuleId } from '@/lib/constants';

/**
 * Cross-module search, for the command palette.
 *
 * Only searches modules the caller can open. Without that check the palette
 * becomes an oblique read of data the sidebar hides — an employee typing a
 * customer name would see CRM records they cannot otherwise reach. RLS would
 * still scope results to the tenant, but the module boundary is a separate
 * rule and has to be applied here.
 */
export async function GET(req: Request) {
  const ctx = await authorize('dashboard', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get('q') ?? searchParams.get('search') ?? '').trim();
  if (raw.length < 2) return success({ query: raw, results: [], total: 0 });

  // Strip PostgREST filter metacharacters rather than escaping them.
  const term = raw.replace(/[,()*]/g, ' ').trim();
  if (!term) return success({ query: raw, results: [], total: 0 });

  const like = `%${term}%`;
  const orgId = ctx.org.organizationId;
  const limit = Math.min(10, Math.max(1, Number(searchParams.get('limit')) || 5));

  const sees = (m: ModuleId) => can(ctx.org.role, m, 'view');
  const none = Promise.resolve({ data: [] as any[] });

  const [leads, companies, projects, tasks, tickets, pages, products] = await Promise.all([
    sees('crm')
      ? ctx.supabase.from('leads').select('id, first_name, last_name, company_name, status')
          .eq('organization_id', orgId).is('deleted_at', null)
          .or(`first_name.ilike.${like},last_name.ilike.${like},company_name.ilike.${like},email.ilike.${like}`)
          .limit(limit)
      : none,
    sees('crm')
      ? ctx.supabase.from('companies').select('id, name, industry, city')
          .eq('organization_id', orgId).is('deleted_at', null)
          .or(`name.ilike.${like},industry.ilike.${like}`).limit(limit)
      : none,
    sees('projects')
      ? ctx.supabase.from('projects').select('id, name, status, priority')
          .eq('organization_id', orgId).is('deleted_at', null)
          .or(`name.ilike.${like},description.ilike.${like}`).limit(limit)
      : none,
    sees('projects')
      ? ctx.supabase.from('tasks').select('id, title, status, priority, project_id')
          .eq('organization_id', orgId).is('deleted_at', null)
          .or(`title.ilike.${like},description.ilike.${like}`).limit(limit)
      : none,
    sees('support')
      ? ctx.supabase.from('support_tickets').select('id, ticket_number, subject, status, priority')
          .eq('organization_id', orgId).is('deleted_at', null)
          .or(`subject.ilike.${like},ticket_number.ilike.${like}`).limit(limit)
      : none,
    sees('workspace')
      ? ctx.supabase.from('workspace_pages').select('id, title, icon')
          .eq('organization_id', orgId).is('deleted_at', null)
          .or(`title.ilike.${like},content.ilike.${like}`).limit(limit)
      : none,
    sees('inventory')
      ? ctx.supabase.from('products').select('id, name, sku, stock, unit')
          .eq('organization_id', orgId).is('deleted_at', null)
          .or(`name.ilike.${like},sku.ilike.${like}`).limit(limit)
      : none,
  ]);

  // Flattened into one ranked list so the palette can render a single
  // keyboard-navigable set rather than seven separate buckets.
  const results = [
    ...(leads.data ?? []).map((r: any) => ({
      type: 'lead', module: 'crm', id: r.id,
      title: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.company_name,
      subtitle: r.company_name, meta: r.status,
    })),
    ...(companies.data ?? []).map((r: any) => ({
      type: 'company', module: 'crm', id: r.id, title: r.name,
      subtitle: [r.industry, r.city].filter(Boolean).join(' · '), meta: null,
    })),
    ...(projects.data ?? []).map((r: any) => ({
      type: 'project', module: 'projects', id: r.id, title: r.name,
      subtitle: null, meta: r.status,
    })),
    ...(tasks.data ?? []).map((r: any) => ({
      type: 'task', module: 'projects', id: r.id, title: r.title,
      subtitle: null, meta: r.status,
    })),
    ...(tickets.data ?? []).map((r: any) => ({
      type: 'ticket', module: 'support', id: r.id, title: r.subject,
      subtitle: r.ticket_number, meta: r.status,
    })),
    ...(pages.data ?? []).map((r: any) => ({
      type: 'page', module: 'workspace', id: r.id, title: r.title,
      subtitle: null, meta: null,
    })),
    ...(products.data ?? []).map((r: any) => ({
      type: 'product', module: 'inventory', id: r.id, title: r.name,
      subtitle: r.sku, meta: `${r.stock} ${r.unit}`,
    })),
  ];

  return success({ query: raw, results, total: results.length });
}
