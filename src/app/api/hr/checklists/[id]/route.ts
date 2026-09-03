import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { CHECKLIST_CATEGORIES } from '@/lib/hr';

const SELECT =
  '*, member:organization_members!employee_checklists_member_id_fkey(id, ' +
  'profiles!organization_members_user_id_fkey(full_name, avatar_url)), ' +
  'items:employee_checklist_items(*, assignee:organization_members!employee_checklist_items_assignee_id_fkey(id, ' +
  'profiles!organization_members_user_id_fkey(full_name, avatar_url)))';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('employee_checklists').select(SELECT)
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success(data);
}

/**
 * Add a step to a live checklist.
 *
 * Which happens more than the template design suggests: half of onboarding is
 * things nobody knew about until the person arrived. The item becomes a to-do
 * on the assignee's own list by trigger, exactly as a templated one does.
 */
export async function POST(req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());

    const title = String(b.title ?? '').trim();
    if (!title) return error('A step needs a title', 422, 'VALIDATION_ERROR');

    const { data: list } = await ctx.supabase
      .from('employee_checklists').select('id, member_id, anchor_date')
      .eq('organization_id', ctx.org.organizationId).eq('id', id)
      .maybeSingle();

    if (!list) return error('Not found', 404, 'NOT_FOUND');

    const { data: last } = await ctx.supabase
      .from('employee_checklist_items').select('sort_order')
      .eq('checklist_id', id).order('sort_order', { ascending: false }).limit(1).maybeSingle();

    const { data, error: e } = await ctx.supabase
      .from('employee_checklist_items')
      .insert({
        organization_id: ctx.org.organizationId,
        checklist_id: id,
        member_id: list.member_id,
        title,
        description: b.description ?? '',
        category: (CHECKLIST_CATEGORIES as readonly string[]).includes(String(b.category))
          ? b.category : 'other',
        /* Unassigned is allowed and means nobody has a to-do for it yet, which
           is honest - the trigger simply does not fire. */
        assignee_id: b.assignee_id || null,
        due_on: b.due_on || null,
        requires_document: b.requires_document === true,
        sort_order: (last?.sort_order ?? -1) + 1,
      })
      .select('*')
      .single();

    if (e) return pgError(e);
    return success(data, undefined, 201);
  } catch (e: any) {
    return serverError(e, 'Could not add the step');
  }
}

/**
 * Cancel or reopen a journey.
 *
 * `completed` is not settable: a checklist completes when its last step is
 * ticked, by `close_finished_checklist()`, and marking it complete over the top
 * of unfinished steps would be a screen claiming work happened that did not.
 */
export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());
    const update: Record<string, any> = {};

    for (const k of ['name', 'anchor_date']) {
      if (k in b && b[k] !== '') update[k] = b[k];
    }

    if ('status' in b) {
      const status = String(b.status);
      if (!['active', 'cancelled'].includes(status)) {
        return error(
          'A checklist is completed by finishing its steps, not by saying so. It can be cancelled or reopened.',
          422, 'VALIDATION_ERROR',
        );
      }
      update.status = status;
      if (status === 'active') update.completed_at = null;
    }

    if (!Object.keys(update).length) {
      return error('Nothing to update', 422, 'VALIDATION_ERROR');
    }

    const { data, error: e } = await ctx.supabase
      .from('employee_checklists').update(update)
      .eq('organization_id', ctx.org.organizationId).eq('id', id)
      .select(SELECT).maybeSingle();

    if (e) return pgError(e);
    if (!data) return error('Not found', 404, 'NOT_FOUND');
    return success(data);
  } catch (e: any) {
    return serverError(e, 'Update failed');
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { error: e } = await ctx.supabase
    .from('employee_checklists').delete()
    .eq('organization_id', ctx.org.organizationId).eq('id', id);

  if (e) return pgError(e);
  return success({ deleted: true });
}
