import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { pgError } from '@/lib/auth-context';

/**
 * Your own profile.
 *
 * Separate from `/api/admin/users/[id]`, which is an administrator acting on
 * someone else's membership. This is a person editing their own details, and
 * the split matters: the fields differ, and so does who is allowed.
 *
 * Not routed through `authorize()`, for two reasons. A profile is not a
 * module, so there is no capability that describes it — everyone may edit
 * their own, including a client with access to almost nothing. And the fields
 * here are the same ones the change-password screen sits beside, which an
 * account holding a temporary password must still be able to reach.
 *
 * Writes go through the caller's own client, so `profiles_update` decides what
 * is permitted. Nothing here can touch another row.
 */

const EDITABLE = ['first_name', 'last_name', 'phone', 'job_title', 'bio', 'timezone', 'avatar_url'] as const;

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return error('Authentication required', 401, 'UNAUTHENTICATED');

  const { data, error: e } = await supabase
    .from('profiles')
    .select('id, email, first_name, last_name, full_name, avatar_url, phone, job_title, bio, timezone, locale, last_seen_at, force_password_change, password_changed_at, created_at')
    .eq('id', user.id)
    .maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Your profile could not be found.', 404, 'NOT_FOUND');
  return success(data);
}

export async function PATCH(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return error('Authentication required', 401, 'UNAUTHENTICATED');

  try {
    const b = acceptBody(await request.json());
    const update: Record<string, unknown> = {};

    for (const k of EDITABLE) {
      if (!(k in b)) continue;
      const v = b[k];
      // Names are required by the schema, so a cleared field means "no
      // change" rather than "make it empty" — which would fail NOT NULL and
      // report as a database error for what is really an empty input.
      if ((k === 'first_name' || k === 'last_name') && !String(v ?? '').trim()) continue;
      update[k] = typeof v === 'string' ? v.trim() || null : v;
    }

    if (!Object.keys(update).length) {
      return error('Nothing to update', 422, 'VALIDATION_ERROR');
    }

    // Email is not editable here. Changing it re-opens confirmation and would
    // desynchronise auth.users from profiles unless done through Supabase's
    // own flow, so it is left out rather than half-supported.
    const { data, error: e } = await supabase
      .from('profiles')
      .update(update)
      .eq('id', user.id)
      .select('id, email, first_name, last_name, full_name, avatar_url, phone, job_title, bio, timezone')
      .maybeSingle();

    if (e) return pgError(e);
    if (!data) return error('Your profile could not be updated.', 404, 'NOT_FOUND');
    return success(data);
  } catch (e: any) {
    return serverError(e, 'Could not update your profile');
  }
}
