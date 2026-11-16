import { authenticate, getContext, pgError } from '@/lib/auth-context';
import { categoryOf, safeDestination } from '@/lib/notifications/model';
import { MODULES } from '@/lib/constants';
import { canAccessModule, defaultModuleFor, isExternalRole } from '@/lib/permissions';
import { cookies } from 'next/headers';

const denied = () => new Response('This notification is unavailable for your account or workspace.', {
  status: 403, headers: { 'Cache-Control': 'private, no-store' },
});

async function resolveNotification(req: Request, confirmation?: { account: string; role: string }) {
  const url = new URL(req.url);
  const active = await authenticate();
  if (active instanceof Response) {
    if (active.status !== 401 || req.method !== 'GET') return active;
    const login = new URL('/login', url);
    login.searchParams.set('next', url.pathname + url.search);
    return Response.redirect(login, 303);
  }
  const org = url.searchParams.get('organizationId') ?? '';
  const id = url.searchParams.get('id') ?? '';
  if (!/^\d+$/.test(id) || !/^[a-f0-9-]{36}$/i.test(org)) return denied();
  const switching = active.org.organizationId !== org;
  const target = switching ? await getContext(org) : active;
  if (!target || target.user.id !== active.user.id || target.user.mustChangePassword) return denied();
  if (confirmation && (confirmation.account !== active.user.id || confirmation.role !== target.org.role)) return denied();

  const { data, error } = await target.supabase.from('notifications').select('*')
    .eq('id', id).eq('recipient_id', target.org.memberId).eq('organization_id', org).maybeSingle();
  if (error) return pgError(error);
  if (!data) return denied();
  const visibility = await target.supabase.rpc('notification_record_visible', {
    p_org: org, p_type: data.type, p_entity: data.entity_type, p_id: data.entity_id,
  });
  if (visibility.error) return pgError(visibility.error);
  if (!visibility.data) return denied();

  const category = categoryOf(data.type, data.entity_type);
  const moduleId = category === 'commercial' || category === 'sign' ? 'crm' : category;
  const fallback = '/dashboard?module=' + (category === 'system' ? defaultModuleFor(target.org.role) : moduleId);
  const destination = new URL(safeDestination(data.link || fallback), url);
  if (data.entity_type === 'leave_request' && data.entity_id) {
    destination.search = new URLSearchParams({ module: 'hr', tab: 'leave', leave: data.entity_id }).toString();
  }
  // Historic notices can carry only a module or tab, even when the row
  // contains the authorized record ID. Preserve message-to-channel links.
  const recordModules: Record<string, string> = {
    expense: 'finance', invoice: 'finance', lead: 'crm', deal: 'crm', commercial: 'crm',
    agreement: 'crm', task: 'projects', project: 'projects', ticket: 'support',
  };
  const recordModule = Object.hasOwn(recordModules, data.entity_type) ? recordModules[data.entity_type] : null;
  if (recordModule && data.entity_id) {
    destination.searchParams.set('module', recordModule);
    destination.searchParams.set(data.entity_type, data.entity_id);
  }
  if (data.entity_type === 'expense' && data.entity_id && !canAccessModule(target.org.role, 'finance') && canAccessModule(target.org.role, 'hr')) {
    destination.pathname = '/settings/notifications/expense/' + data.entity_id;
    destination.search = '';
  }
  const destinationModule = MODULES.find(m => m.id === destination.searchParams.get('module'));
  if (destinationModule && !canAccessModule(target.org.role, destinationModule.id)) return denied();
  if (isExternalRole(target.org.role) && destinationModule?.id === 'projects') {
    destination.searchParams.set('module', 'portal');
  }
  if (switching && !confirmation) {
    const prompt = new URL('/settings/notifications/workspace', url);
    prompt.search = new URLSearchParams({ id, organizationId: org }).toString();
    return Response.redirect(prompt, 303);
  }
  const marked = await target.supabase.from('notifications').update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', id).eq('recipient_id', target.org.memberId).eq('organization_id', org);
  if (marked.error) return pgError(marked.error);
  if (switching) {
    (await cookies()).set('nm-organization', active.user.id + ':' + org, {
      httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', path: '/',
    });
  }
  return Response.redirect(destination, 303);
}

export function GET(req: Request) { return resolveNotification(req); }

export async function POST(req: Request) {
  if (req.headers.get('origin') !== new URL(req.url).origin) return denied();
  const form = await req.formData();
  return resolveNotification(req, { account: String(form.get('account') ?? ''), role: String(form.get('role') ?? '') });
}
