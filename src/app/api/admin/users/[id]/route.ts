import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';

type Params = { params: Promise<{ id: string }> };

export async function GET(_r: Request, { params }: Params) {
  const ctx = await authorize('admin', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const { data, error: e } = await ctx.supabase.from('v_org_directory').select('*')
    .eq('organization_id', ctx.org.organizationId).eq('member_id', id).maybeSingle();
  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success(data);
}

/**
 * Change a member's role, department or status.
 *
 * The last-owner trigger rejects demoting or deactivating the only owner, so
 * an organization can never be left unadministrable. pgError passes its
 * message through unchanged.
 */
export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('admin', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = await req.json();
    const update: Record<string, any> = {};
    for (const k of ['role','department_id','manager_id','employee_number','employment_type','hired_on','is_active']) {
      if (k in b) update[k] = b[k] === '' ? null : b[k];
    }
    if (!Object.keys(update).length) return error('Nothing to update', 422, 'VALIDATION_ERROR');

    const { data, error: e } = await ctx.supabase.from('organization_members').update(update)
      .eq('organization_id', ctx.org.organizationId).eq('id', id).select('*').maybeSingle();
    if (e) return pgError(e);
    if (!data) return error('Not found', 404, 'NOT_FOUND');
    return success(data);
  } catch (e: any) { return error(e.message || 'Update failed', 500); }
}

/** Deactivate rather than delete: the audit trail must keep pointing at a real row. */
export async function DELETE(_r: Request, { params }: Params) {
  const ctx = await authorize('admin', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  if (id === ctx.org.memberId) {
    return error('You cannot remove yourself from the organization.', 409, 'SELF_REMOVAL');
  }
  const { data, error: e } = await ctx.supabase.from('organization_members')
    .update({ is_active: false })
    .eq('organization_id', ctx.org.organizationId).eq('id', id).select('id').maybeSingle();
  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success({ deactivated: true });
}
