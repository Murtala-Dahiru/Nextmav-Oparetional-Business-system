import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { CHECKLIST_CATEGORIES } from '@/lib/hr';

const SELECT =
  '*, assignee:organization_members!employee_checklist_items_assignee_id_fkey(id, ' +
  'profiles!organization_members_user_id_fkey(full_name, avatar_url)), ' +
  'document:files(id, filename, mime_type, size_bytes)';

type Params = { params: Promise<{ id: string }> };

/**
 * Tick a step, or change one.
 *
 * Two audiences with different rights, and the policy already separates them:
 * `employee_checklist_items_update` admits the assignee - who may tick their
 * own step and nothing else - and HR, who may edit anything about it. The
 * checks below are the readable errors; the database is the boundary.
 *
 * Ticking here also ticks the person's to-do in My Work, by trigger, and
 * ticking it there ticks this. The two rows are one obligation.
 */
export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());

    const { data: item } = await ctx.supabase
      .from('employee_checklist_items')
      .select('id, assignee_id, requires_document, document_file_id, is_done')
      .eq('organization_id', ctx.org.organizationId).eq('id', id)
      .maybeSingle();

    if (!item) return error('Not found', 404, 'NOT_FOUND');

    const isHr = ['owner', 'administrator', 'hr_staff'].includes(ctx.org.role);
    const isAssignee = item.assignee_id === ctx.org.memberId;

    const update: Record<string, any> = {};

    if ('is_done' in b) {
      const done = b.is_done === true;

      /**
       * A step that requires a document cannot be ticked without one.
       *
       * This is the only place the requirement bites, and it has to: the whole
       * point of "signed contract on file" is the file, and a checklist that
       * lets it be ticked empty is a checklist that certifies nothing.
       */
      if (done && item.requires_document && !(b.document_file_id ?? item.document_file_id)) {
        return error(
          'This step needs a document attached before it can be completed.',
          422, 'DOCUMENT_REQUIRED',
        );
      }
      update.is_done = done;
    }

    if ('document_file_id' in b) update.document_file_id = b.document_file_id || null;

    /* Everything past this point is HR editing the step rather than the
       assignee completing it. */
    if (!isHr) {
      const editing = Object.keys(b).some(k =>
        !['is_done', 'document_file_id'].includes(k));
      if (editing) {
        return error(
          'You can complete this step and attach its document. Changing it is HR’s.',
          403, 'FORBIDDEN_ACTION',
        );
      }
      if (!isAssignee) {
        return error('This step is not assigned to you.', 403, 'FORBIDDEN_ACTION');
      }
    } else {
      for (const k of ['title', 'description', 'due_on', 'assignee_id']) {
        if (k in b) update[k] = b[k] === '' ? null : b[k];
      }
      if ('description' in update && update.description === null) update.description = '';
      if ('title' in update && !String(update.title ?? '').trim()) {
        return error('A step needs a title', 422, 'VALIDATION_ERROR');
      }
      if ('category' in b) {
        if (!(CHECKLIST_CATEGORIES as readonly string[]).includes(String(b.category))) {
          return error(`Category must be one of: ${CHECKLIST_CATEGORIES.join(', ')}.`, 422, 'VALIDATION_ERROR');
        }
        update.category = b.category;
      }
      if ('requires_document' in b) update.requires_document = b.requires_document === true;
      if ('sort_order' in b) update.sort_order = Number(b.sort_order) || 0;
    }

    if (!Object.keys(update).length) {
      return error('Nothing to update', 422, 'VALIDATION_ERROR');
    }

    const { data, error: e } = await ctx.supabase
      .from('employee_checklist_items').update(update)
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

  /**
   * The to-do goes with it.
   *
   * `employee_checklist_items.todo_id` is `ON DELETE SET NULL` in the other
   * direction - somebody clearing their own list must not delete the company's
   * record - but removing the step should not leave an orphaned personal
   * reminder for work that no longer exists.
   */
  const { data: item } = await ctx.supabase
    .from('employee_checklist_items').select('todo_id')
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .maybeSingle();

  const { error: e } = await ctx.supabase
    .from('employee_checklist_items').delete()
    .eq('organization_id', ctx.org.organizationId).eq('id', id);

  if (e) return pgError(e);

  if (item?.todo_id) {
    /* Best effort: the to-do belongs to somebody else, and `todos` admits only
       its owner. It carries a source chip that will simply stop resolving,
       which the personal list already handles. */
    await ctx.supabase.from('todos').delete().eq('id', item.todo_id);
  }

  return success({ deleted: true });
}
