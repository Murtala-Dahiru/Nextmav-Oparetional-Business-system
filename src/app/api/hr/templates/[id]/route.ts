import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { CHECKLIST_OWNERS, CHECKLIST_CATEGORIES } from '@/lib/hr';

const SELECT = '*, items:checklist_template_items(*), department:departments(id, name)';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('checklist_templates').select(SELECT)
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success(data);
}

/**
 * Edit a template, items and all.
 *
 * `items` is a full replacement rather than a patch, because a checklist is an
 * ordered list and a partial update of one is a sequence of moves nobody wants
 * to express over HTTP. Replacing them cannot affect anybody's live checklist:
 * `start_employee_checklist()` copies the items at the moment a journey begins,
 * so a template edited in March does not silently rewrite what somebody was
 * asked to do in January.
 */
export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());
    const update: Record<string, any> = {};

    for (const k of ['name', 'description', 'department_id', 'employment_type']) {
      if (k in b) update[k] = b[k] === '' ? null : b[k];
    }
    if ('description' in update && update.description === null) update.description = '';
    if ('name' in update && !String(update.name ?? '').trim()) {
      return error('A template needs a name', 422, 'VALIDATION_ERROR');
    }
    if ('is_default' in b) update.is_default = b.is_default === true;
    if ('is_active' in b) update.is_active = b.is_active === true;

    if (Object.keys(update).length) {
      const { error: e } = await ctx.supabase
        .from('checklist_templates').update(update)
        .eq('organization_id', ctx.org.organizationId).eq('id', id);
      if (e) return pgError(e);
    }

    if (Array.isArray(b.items)) {
      const { error: de } = await ctx.supabase
        .from('checklist_template_items').delete().eq('template_id', id);
      if (de) return pgError(de);

      const rows = b.items.map((it: any, i: number) => ({
        organization_id: ctx.org.organizationId,
        template_id: id,
        title: String(it.title ?? '').trim(),
        description: it.description ?? '',
        category: (CHECKLIST_CATEGORIES as readonly string[]).includes(String(it.category))
          ? it.category : 'other',
        owner: (CHECKLIST_OWNERS as readonly string[]).includes(String(it.owner))
          ? it.owner : 'hr',
        due_offset_days: Number.isFinite(Number(it.due_offset_days)) ? Number(it.due_offset_days) : 0,
        requires_document: it.requires_document === true,
        sort_order: i,
      })).filter((r: any) => r.title);

      if (rows.length) {
        const { error: ie } = await ctx.supabase.from('checklist_template_items').insert(rows);
        if (ie) return pgError(ie);
      }
    }

    const { data, error: e2 } = await ctx.supabase
      .from('checklist_templates').select(SELECT)
      .eq('organization_id', ctx.org.organizationId).eq('id', id)
      .maybeSingle();

    if (e2) return pgError(e2);
    if (!data) return error('Not found', 404, 'NOT_FOUND');
    return success(data);
  } catch (e: any) {
    return serverError(e, 'Update failed');
  }
}

/**
 * Deleting a template leaves every checklist made from it intact.
 *
 * `employee_checklists.template_id` is `ON DELETE SET NULL`, deliberately: a
 * live onboarding is somebody's actual list of obligations and must not vanish
 * because HR tidied up the templates behind it.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { error: e } = await ctx.supabase
    .from('checklist_templates').delete()
    .eq('organization_id', ctx.org.organizationId).eq('id', id);

  if (e) return pgError(e);
  return success({ deleted: true });
}
