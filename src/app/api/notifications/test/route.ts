import { z } from 'zod';
import { authenticate, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
export async function GET(req: Request) {
  const ctx = await authenticate(); if (ctx instanceof Response) return ctx;
  const id = new URL(req.url).searchParams.get('id');
  if (!id || !/^\d{1,18}$/.test(id)) return error('Invalid notification ID', 422);
  const { data, error: failure } = await ctx.supabase.rpc('notification_test_status', { p_org: ctx.org.organizationId, p_id: id });
  return failure ? pgError(failure) : success(data);
}
export async function POST(req: Request) {
  const ctx = await authenticate(); if (ctx instanceof Response) return ctx;
  const body = z.object({ deviceId: z.uuid() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return error('Device ID required', 422);
  const { data, error: failure } = await ctx.supabase.rpc('notification_test', { p_org: ctx.org.organizationId, p_device: body.data.deviceId });
  return failure ? pgError(failure) : success({ notificationId: data, status: 'queued' });
}
