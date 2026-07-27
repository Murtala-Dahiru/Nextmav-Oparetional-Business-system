import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Departments.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Why this had to exist ────────────────────────────────────────────────
 *
 *  `departments` has been in the schema since 0001 and every organisation gets
 *  a "General" one from the seeding trigger, but nothing could create a second.
 *  The settings endpoint returned the list read-only, and `head_id` — the
 *  column that says who manages a department — had no writer at all, so
 *  "assign managers" was a column of blanks.
 *
 *  That mattered beyond the admin screen: `auth_visible_member_ids()` widens a
 *  manager's view to their own department, HR and project scoping both resolve
 *  through `department_id`, and workspace folders can now be shared with a
 *  department. All of it was pinned to the single seeded row.
 */

const SELECT = 'id, name, description, parent_id, head_id, created_at';

export async function GET() {
  const ctx = await authorize('admin', 'view');
  if (ctx instanceof Response) return ctx;

  const [deptRes, peopleRes] = await Promise.all([
    ctx.supabase.from('departments').select(SELECT)
      .eq('organization_id', ctx.org.organizationId)
      .is('deleted_at', null).order('name'),
    ctx.supabase.from('v_assignable_members')
      .select('member_id, full_name, department_id')
      .eq('organization_id', ctx.org.organizationId),
  ]);

  if (deptRes.error) return pgError(deptRes.error);

  const people = peopleRes.data ?? [];
  return success((deptRes.data ?? []).map((d: any) => ({
    ...d,
    head_name: people.find((p: any) => p.member_id === d.head_id)?.full_name ?? null,
    member_count: people.filter((p: any) => p.department_id === d.id).length,
  })));
}

export async function POST(req: Request) {
  const ctx = await authorize('admin', 'manage');
  if (ctx instanceof Response) return ctx;

  let b: Record<string, any>;
  try {
    b = acceptBody(await req.json());
  } catch {
    return error('Invalid request body', 422, 'VALIDATION_ERROR');
  }

  const name = String(b.name ?? '').trim();
  if (!name) return error('A department needs a name.', 422, 'VALIDATION_ERROR');

  const { data, error: e } = await ctx.supabase
    .from('departments')
    .insert({
      organization_id: ctx.org.organizationId,
      name,
      description: String(b.description ?? ''),
      parent_id: b.parent_id || null,
      head_id: b.head_id || null,
    })
    .select(SELECT)
    .single();

  if (e) {
    // There is a unique index on (organization_id, name); two departments with
    // the same name would make every picker ambiguous.
    if (e.code === '23505') {
      return error(`There is already a department called "${name}".`, 409, 'DUPLICATE');
    }
    return pgError(e);
  }
  return success(data, undefined, 201);
}

export async function PATCH(req: Request) {
  const ctx = await authorize('admin', 'manage');
  if (ctx instanceof Response) return ctx;

  let b: Record<string, any>;
  try {
    b = acceptBody(await req.json());
  } catch {
    return error('Invalid request body', 422, 'VALIDATION_ERROR');
  }

  if (!b.id) return error('id is required', 422, 'VALIDATION_ERROR');

  const update: Record<string, any> = {};
  if (typeof b.name === 'string') {
    const name = b.name.trim();
    if (!name) return error('A department needs a name.', 422, 'VALIDATION_ERROR');
    update.name = name;
  }
  if (typeof b.description === 'string') update.description = b.description;
  if ('head_id' in b) {
    /**
     * The manager has to be somebody who works here.
     *
     * `head_id` references `organization_members`, so the foreign key already
     * refuses a stranger — but it would happily accept a client account or a
     * deactivated membership, and the result is a department managed by
     * somebody who cannot sign in.
     */
    if (b.head_id) {
      const { data: person } = await ctx.supabase
        .from('organization_members').select('id, role, is_active')
        .eq('organization_id', ctx.org.organizationId).eq('id', b.head_id).maybeSingle();

      if (!person || !person.is_active) {
        return error('That person is not an active member of this organization.', 422, 'VALIDATION_ERROR');
      }
      if (person.role === 'client') {
        return error('A client account cannot manage a department.', 422, 'VALIDATION_ERROR');
      }
    }
    update.head_id = b.head_id || null;
  }
  if ('parent_id' in b) {
    if (b.parent_id === b.id) {
      return error('A department cannot report to itself.', 422, 'VALIDATION_ERROR');
    }
    update.parent_id = b.parent_id || null;
  }

  if (!Object.keys(update).length) return error('Nothing to update', 422, 'VALIDATION_ERROR');

  const { data, error: e } = await ctx.supabase
    .from('departments').update(update)
    .eq('organization_id', ctx.org.organizationId).eq('id', b.id)
    .select(SELECT).maybeSingle();

  if (e) {
    if (e.code === '23505') return error('There is already a department with that name.', 409, 'DUPLICATE');
    return pgError(e);
  }
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success(data);
}

/**
 * Remove a department.
 *
 * Soft, and refused while anybody is still filed under it. `department_id` is
 * `ON DELETE SET NULL` on the membership, so a hard delete would silently
 * un-department every person in it — and a manager's visible-member set,
 * which resolves through exactly that column, would quietly shrink to
 * themselves with nothing to explain why.
 */
export async function DELETE(req: Request) {
  const ctx = await authorize('admin', 'manage');
  if (ctx instanceof Response) return ctx;

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return error('id is required', 422, 'VALIDATION_ERROR');

  const { count } = await ctx.supabase
    .from('organization_members')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', ctx.org.organizationId)
    .eq('department_id', id)
    .eq('is_active', true);

  if ((count ?? 0) > 0) {
    return error(
      `${count} ${count === 1 ? 'person is' : 'people are'} still in this department. Move them first.`,
      409, 'RULE_VIOLATION',
    );
  }

  const { data, error: e } = await ctx.supabase
    .from('departments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .is('deleted_at', null)
    .select('id').maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success({ deleted: true, soft: true });
}
