import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

type Params = { params: Promise<{ id: string }> };

/** Mirrors the `member_status` enum added in 0012. */
const MEMBER_STATUSES = ['active', 'suspended', 'terminated'];

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
    const b = acceptBody(await req.json());
    const update: Record<string, any> = {};

    /**
     * `status` carries the three lifecycle actions — suspend, reactivate,
     * terminate. It is validated here rather than left to the enum cast, which
     * would surface as 22P02 and reach the screen as "one of the filter values
     * is not valid for this field".
     *
     * `is_active` stays writable alongside it: a database trigger keeps the
     * two consistent whichever one is sent, so existing callers that only know
     * about `is_active` continue to work unchanged.
     */
    if (b.status !== undefined && !MEMBER_STATUSES.includes(b.status)) {
      return error(
        `"${b.status}" is not a member status. Expected one of: ${MEMBER_STATUSES.join(', ')}.`,
        422, 'VALIDATION_ERROR',
      );
    }

    // Scoped to this organization, so an id from another tenant is rejected
    // rather than silently attaching someone to a department they cannot see.
    if (b.department_id) {
      const { data: dept } = await ctx.supabase
        .from('departments').select('id')
        .eq('organization_id', ctx.org.organizationId).eq('id', b.department_id).maybeSingle();
      if (!dept) return error('That department does not exist in this organization.', 422, 'DEPARTMENT_NOT_FOUND');
    }
    if (b.manager_id) {
      if (b.manager_id === id) {
        return error('Someone cannot be their own manager.', 422, 'INVALID_MANAGER');
      }
      const { data: mgr } = await ctx.supabase
        .from('organization_members').select('id')
        .eq('organization_id', ctx.org.organizationId).eq('id', b.manager_id).maybeSingle();
      if (!mgr) return error('That manager is not a member of this organization.', 422, 'MANAGER_NOT_FOUND');
    }

    // An empty string from a cleared form field means "unset this", which for
    // a nullable column is null. `role` and `employment_type` are NOT NULL
    // with defaults, so the same treatment would abort the update instead —
    // for those, blank means "leave it alone".
    /**
     * The other half of the client portal link.
     *
     * `projects.client_company_id` says which customer a project is for;
     * this says which customer a *login* speaks for. The portal resolves
     * everything by matching the two, so with this unset a client account
     * signs in successfully and can see nothing — and there was previously no
     * endpoint that could set it at all, which made the portal unreachable in
     * practice however correctly a project was linked.
     *
     * Validated against this organization's companies for the same reason as
     * `department_id`: the foreign key would accept another tenant's company
     * and quietly point a portal at it.
     */
    if (b.client_company_id) {
      const { data: company } = await ctx.supabase
        .from('companies').select('id')
        .eq('organization_id', ctx.org.organizationId).eq('id', b.client_company_id)
        .is('deleted_at', null).maybeSingle();
      if (!company) {
        return error('That company does not exist in this organization.', 422, 'COMPANY_NOT_FOUND');
      }

      /**
       * Only a client account represents a customer.
       *
       * Setting this on an employee would be meaningless at best; at worst it
       * is a misreading of the field as "which client this person handles",
       * which is an account-management relationship and not this column.
       */
      const targetRole = b.role
        ?? (await ctx.supabase.from('organization_members').select('role')
              .eq('organization_id', ctx.org.organizationId).eq('id', id).maybeSingle()).data?.role;

      if (targetRole !== 'client') {
        return error(
          'Only a Client Portal User can be linked to a company. Change the role to Client first.',
          422, 'NOT_A_CLIENT_ROLE',
        );
      }
    }

    const NOT_NULLABLE = new Set(['role', 'employment_type', 'status']);
    for (const k of ['role','department_id','manager_id','employee_number','employment_type','hired_on','is_active','status','client_company_id']) {
      if (!(k in b)) continue;
      if (b[k] === '' || b[k] === null) {
        if (NOT_NULLABLE.has(k)) continue;
        update[k] = null;
      } else {
        update[k] = b[k];
      }
    }
    if (!Object.keys(update).length) return error('Nothing to update', 422, 'VALIDATION_ERROR');

    const { data, error: e } = await ctx.supabase.from('organization_members').update(update)
      .eq('organization_id', ctx.org.organizationId).eq('id', id).select('*').maybeSingle();
    if (e) return pgError(e);
    if (!data) return error('Not found', 404, 'NOT_FOUND');
    return success(data);
  } catch (e: any) { return error(e.message || 'Update failed', 500); }
}

// The administration screen sends PUT for a partial update. Aliasing here
// rather than changing the caller keeps this route consistent with
// hr/leave/[id] and inventory/purchase-orders/[id], which already do the same.
export { PATCH as PUT };

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
