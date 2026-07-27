import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

type Params = { params: Promise<{ id: string }> };

const SELECT =
  '*, member:organization_members!workspace_page_shares_member_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), department:departments(id, name)';

/**
 * Who a folder or page is shared with.
 *
 * Only somebody who can already open the page can see this — enforced by
 * `page_shares_select`, which asks `page_permission()` the same question the
 * page itself does. A share list is a list of colleagues and is not something
 * to hand out to anyone who knows a page id.
 */
export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('workspace', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('workspace_page_shares').select(SELECT)
    .eq('organization_id', ctx.org.organizationId)
    .eq('page_id', id)
    .order('created_at');

  if (e) return pgError(e);
  return success(data ?? []);
}

/**
 * Share with a person or a department.
 *
 * Upserted rather than inserted: re-sharing with someone who already has
 * access is how a permission gets raised from view to edit, and answering 409
 * to that would make the obvious action fail for a reason nobody would guess.
 *
 * `manage` is required to grant, which the database enforces through
 * `page_shares_write`. This handler checks nothing about permission itself —
 * duplicating the rule here is how the two eventually disagree.
 */
export async function POST(req: Request, { params }: Params) {
  const ctx = await authorize('workspace', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  let b: Record<string, any>;
  try {
    b = acceptBody(await req.json());
  } catch {
    return error('Invalid request body', 422, 'VALIDATION_ERROR');
  }

  const memberId = b.member_id || null;
  const departmentId = b.department_id || null;

  if (!memberId === !departmentId) {
    return error('Share with either a person or a department, not both.', 422, 'VALIDATION_ERROR');
  }
  if (!['view', 'edit', 'manage'].includes(b.permission ?? 'view')) {
    return error('Permission must be view, edit or manage.', 422, 'VALIDATION_ERROR');
  }

  /**
   * Update in place when the subject is already named, insert otherwise.
   *
   * Not an upsert: the uniqueness is enforced by two *partial* indexes
   * (`WHERE member_id IS NOT NULL` and the same for departments), because a
   * share names one subject and leaves the other column NULL — and NULL is not
   * equal to NULL, so a plain composite unique would let the same person be
   * added twice. Postgres will not match `ON CONFLICT (page_id, member_id)` to
   * a partial index unless the statement repeats its predicate, which
   * PostgREST cannot express; the attempt fails with 42P10 and surfaced as a
   * blanket 500 on every re-share.
   */
  const existing = await ctx.supabase
    .from('workspace_page_shares').select('id')
    .eq('organization_id', ctx.org.organizationId)
    .eq('page_id', id)
    .eq(memberId ? 'member_id' : 'department_id', memberId ?? departmentId)
    .maybeSingle();

  const { data, error: e } = existing.data
    ? await ctx.supabase
        .from('workspace_page_shares')
        .update({ permission: b.permission ?? 'view', granted_by: ctx.org.memberId })
        .eq('id', existing.data.id)
        .select(SELECT)
        .single()
    : await ctx.supabase
        .from('workspace_page_shares')
        .insert({
          organization_id: ctx.org.organizationId,
          page_id: id,
          member_id: memberId,
          department_id: departmentId,
          permission: b.permission ?? 'view',
          granted_by: ctx.org.memberId,
        })
        .select(SELECT)
        .single();

  if (e) return pgError(e);
  return success(data, undefined, 201);
}

/** Revoke a share. `?shareId=` rather than a nested route: it is one field. */
export async function DELETE(req: Request, { params }: Params) {
  const ctx = await authorize('workspace', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const shareId = new URL(req.url).searchParams.get('shareId');
  if (!shareId) return error('shareId is required', 422, 'VALIDATION_ERROR');

  const { error: e } = await ctx.supabase
    .from('workspace_page_shares').delete()
    .eq('organization_id', ctx.org.organizationId)
    .eq('page_id', id)
    .eq('id', shareId);

  if (e) return pgError(e);
  return success({ deleted: true });
}
