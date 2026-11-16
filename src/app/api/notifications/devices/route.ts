import { z } from 'zod';
import { authenticate, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { cookies } from 'next/headers';

const subscription = z.object({ endpoint: z.url().max(4096), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }), label: z.string().min(1).max(80).default('Browser') });
export async function GET() {
  const ctx = await authenticate(); if (ctx instanceof Response) return ctx;
  const { data, error: failure } = await ctx.supabase.from('notification_devices').select('id,label,enabled,created_at,last_accepted_at,retired_at').eq('member_id', ctx.org.memberId).order('created_at', { ascending: false });
  return failure ? pgError(failure) : success(data);
}
export async function POST(req: Request) {
  const ctx = await authenticate(); if (ctx instanceof Response) return ctx;
  const parsed = subscription.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error('Invalid push subscription', 422);
  if (!(process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)) return error('Push is not configured on this deployment', 503);
  const { endpoint, keys, label } = parsed.data;
  const { data, error: failure } = await ctx.supabase.rpc('notification_save_device', { p_org: ctx.org.organizationId, p_endpoint: endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth, p_label: label });
  if (!failure) (await cookies()).set('nm-push-device', String(data), { httpOnly: true, sameSite: 'lax', secure: new URL(req.url).protocol === 'https:', path: '/' });
  return failure ? pgError(failure) : success({ id: data }, undefined, 201);
}
export async function DELETE(req: Request) {
  const ctx = await authenticate(); if (ctx instanceof Response) return ctx;
  const id = z.uuid().safeParse(new URL(req.url).searchParams.get('id'));
  if (!id.success) return error('Valid device ID required', 422);
  const { error: failure } = await ctx.supabase.from('notification_devices').delete().eq('id', id.data).eq('member_id', ctx.org.memberId);
  return failure ? pgError(failure) : success({ removed: true });
}
export async function PATCH(req: Request) {
  const ctx = await authenticate(); if (ctx instanceof Response) return ctx;
  const body = z.object({ id: z.uuid(), enabled: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return error('Device and enabled state required', 422);
  const { error: failure } = await ctx.supabase.from('notification_devices').update({ enabled: body.data.enabled }).eq('id', body.data.id).eq('member_id', ctx.org.memberId);
  return failure ? pgError(failure) : success({ updated: true });
}
