import { supabaseServer } from '@/lib/supabase/server';
import { getContext, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';

/**
 * The organizations the caller belongs to.
 *
 * Backs the organization switcher, and the onboarding screen shown to a user
 * who has confirmed their email but not yet joined anywhere.
 */
export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return error('Authentication required', 401, 'UNAUTHENTICATED');

  const { data, error: e } = await supabase
    .from('organization_members')
    .select('id, role, department_id, joined_at, organizations(id, name, slug, logo_url)')
    .eq('user_id', user.id)
    .eq('is_active', true);

  if (e) return pgError(e);

  return success(
    (data ?? []).map((m: any) => {
      const org = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations;
      return {
        memberId: m.id,
        role: m.role,
        departmentId: m.department_id,
        joinedAt: m.joined_at,
        id: org?.id,
        name: org?.name,
        slug: org?.slug,
        logoUrl: org?.logo_url,
      };
    }),
  );
}

/**
 * Create an organization, with the caller as its owner.
 *
 * Deliberately available to any authenticated user, not just one with no
 * memberships: a consultancy or a group may genuinely run several. It is the
 * completion step for anyone who signed up while email confirmation was on,
 * since that path returns no session and cannot create the organization inline.
 *
 * Delegates to create_organization(), which writes the organization and the
 * owner membership atomically — done as two calls, one of them eventually
 * fails in between and leaves an organization nobody can administer.
 */
export async function POST(req: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return error('Authentication required', 401, 'UNAUTHENTICATED');

  try {
    const { name, slug } = (await req.json()) ?? {};
    if (!name || !String(name).trim()) {
      return error('Organization name is required', 422, 'VALIDATION_ERROR');
    }

    const { data, error: e } = await supabase.rpc('create_organization', {
      org_name: String(name).trim(),
      org_slug: slug ? String(slug).trim() : null,
    });

    if (e) return pgError(e);

    const org = Array.isArray(data) ? data[0] : data;
    return success(org, undefined, 201);
  } catch (e: any) {
    return error(e.message || 'Could not create the organization', 500);
  }
}

/**
 * Update organization settings.
 *
 * Restricted to admins by RLS; the explicit context check turns a silent
 * empty result into a clear 403. Working-hours fields matter beyond display:
 * they drive how attendance classifies late and early arrivals.
 */
export async function PATCH(req: Request) {
  const ctx = await getContext();
  if (!ctx) return error('Authentication required', 401, 'UNAUTHENTICATED');

  if (!['owner', 'administrator'].includes(ctx.org.role)) {
    return error('Only owners and administrators can change organization settings.', 403, 'FORBIDDEN');
  }

  try {
    const b = await req.json();
    const update: Record<string, any> = {};
    for (const k of [
      'name', 'logo_url', 'website', 'industry', 'timezone',
      'work_start', 'work_end', 'work_days', 'grace_minutes', 'break_minutes', 'currency',
    ]) {
      if (k in b) update[k] = b[k];
    }
    if (!Object.keys(update).length) return error('Nothing to update', 422, 'VALIDATION_ERROR');

    const { data, error: e } = await ctx.supabase
      .from('organizations')
      .update(update)
      .eq('id', ctx.org.organizationId)
      .select('*')
      .maybeSingle();

    if (e) return pgError(e);
    if (!data) return error('Not found', 404, 'NOT_FOUND');
    return success(data);
  } catch (e: any) {
    return error(e.message || 'Update failed', 500);
  }
}
