import { authenticate } from '@/lib/auth-context';
import { safeDestination, categoryOf } from '@/lib/notifications/model';
import { cookies } from 'next/headers';
export async function GET(req: Request) {
  const url = new URL(req.url);
  const org = url.searchParams.get('organizationId') ?? '';
  const ctx = await authenticate({ organizationId: org });
  if (ctx instanceof Response) {
    const login = new URL('/login', url); login.searchParams.set('next', url.pathname + url.search);
    return Response.redirect(login, 303);
  }
  const { data } = await ctx.supabase.from('notifications').select('*').eq('id', url.searchParams.get('id')).eq('recipient_id', ctx.org.memberId).eq('organization_id', org).maybeSingle();
  if (!data) return Response.redirect(new URL('/dashboard', url), 303);
  const { data: visible } = await ctx.supabase.rpc('notification_record_visible', { p_org: org, p_type: data.type, p_entity: data.entity_type, p_id: data.entity_id });
  if (!visible) return Response.redirect(new URL('/dashboard', url), 303);
  (await cookies()).set('nm-organization', org, { httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', path: '/' });
  await ctx.supabase.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', data.id).eq('recipient_id', ctx.org.memberId);
  const category = categoryOf(data.type, data.entity_type);
  const moduleId = category === 'commercial' || category === 'sign' ? 'crm' : category === 'system' ? 'dashboard' : category;
  const fallback = `/dashboard?module=${moduleId}${data.entity_type === 'agreement' ? `&agreement=${data.entity_id}` : ''}`;
  return Response.redirect(new URL(safeDestination(data.link || fallback), url), 303);
}
