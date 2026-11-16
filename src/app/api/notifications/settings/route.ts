import { pushConfiguration } from '@/lib/notifications/config';
import { authenticate, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { defaultPreferences, preferencesSchema } from '@/lib/notifications/model';

export async function GET() {
  const ctx = await authenticate(); if (ctx instanceof Response) return ctx;
  const { data, error: failure } = await ctx.supabase.from('organization_members').select('notification_prefs').eq('id', ctx.org.memberId).single();
  if (failure) return pgError(failure);
  const parsed = preferencesSchema.safeParse({ timezone: ctx.org.timezone, ...data.notification_prefs });
  const configuration = pushConfiguration();
  const ready = configuration.ready && !!(process.env.DIRECT_URL || process.env.DATABASE_URL) && (process.env.NOTIFICATION_DISPATCH_SECRET?.length ?? 0) >= 32;
  return success({ pushReady: ready, preferences: parsed.success ? parsed.data : defaultPreferences, publicKey: (process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) ?? null });
}
export async function PUT(req: Request) {
  const ctx = await authenticate(); if (ctx instanceof Response) return ctx;
  const parsed = preferencesSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error('Invalid notification preferences', 422);
  const { data, error: failure } = await ctx.supabase.rpc('notification_preferences', { p_org: ctx.org.organizationId, p_prefs: parsed.data });
  return failure ? pgError(failure) : success(data);
}
