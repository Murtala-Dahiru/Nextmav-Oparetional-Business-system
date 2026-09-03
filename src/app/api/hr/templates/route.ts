import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { isFilterValue } from '@/lib/filters';
import { JOURNEY_KINDS, CHECKLIST_OWNERS, CHECKLIST_CATEGORIES } from '@/lib/hr';
import { STARTER_TEMPLATES } from '@/lib/hr-templates';

const SELECT =
  '*, items:checklist_template_items(*), department:departments(id, name)';

/**
 * Onboarding and offboarding templates - what this company does when somebody
 * joins or leaves.
 *
 * Readable by everybody with the module, because "what happens in my first
 * week" is a reasonable thing for a new starter to look at. Writable by HR.
 */
export async function GET(req: Request) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);

  let q = ctx.supabase
    .from('checklist_templates').select(SELECT)
    .eq('organization_id', ctx.org.organizationId);

  const kind = searchParams.get('kind');
  if (isFilterValue(kind)) q = q.eq('kind', kind);
  if (searchParams.get('include') !== 'all') q = q.eq('is_active', true);

  const { data, error: e } = await q.order('name');
  if (e) return pgError(e);

  return success({
    templates: data ?? [],
    /**
     * The starter sets, offered rather than installed.
     *
     * This migration chain ships no template rows: an invented "Welcome to the
     * team!" step sitting in every tenant's database is fabricated data wearing
     * a helpful hat, and the screen would then be showing a process nobody at
     * that company agreed to. Offering them here - as content the caller can
     * look at and choose - is a different thing, because somebody chose it.
     */
    starters: STARTER_TEMPLATES.map(t => ({
      key: t.key, kind: t.kind, name: t.name,
      description: t.description, itemCount: t.items.length,
    })),
  });
}

export async function POST(req: Request) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());

    /**
     * Two shapes, one endpoint: a template written by hand, or one of the
     * starters copied in. The starter path writes exactly the same rows - it is
     * a prefilled form, not a second kind of template - so an organisation can
     * edit or delete what it created without anything behaving differently.
     */
    const starter = b.starter
      ? STARTER_TEMPLATES.find(t => t.key === String(b.starter))
      : null;

    if (b.starter && !starter) {
      return error(`There is no starter template called "${b.starter}".`, 422, 'UNKNOWN_STARTER');
    }

    const kind = String(b.kind ?? starter?.kind ?? '');
    if (!(JOURNEY_KINDS as readonly string[]).includes(kind)) {
      return error(`Kind must be one of: ${JOURNEY_KINDS.join(', ')}.`, 422, 'VALIDATION_ERROR');
    }

    const name = String(b.name ?? starter?.name ?? '').trim();
    if (!name) return error('A template needs a name', 422, 'VALIDATION_ERROR');

    const { data: tpl, error: e } = await ctx.supabase
      .from('checklist_templates')
      .insert({
        organization_id: ctx.org.organizationId,
        kind,
        name,
        description: b.description ?? starter?.description ?? '',
        department_id: b.department_id || null,
        employment_type: b.employment_type || null,
        is_default: b.is_default === true,
        created_by: ctx.org.memberId,
      })
      .select('id')
      .single();

    if (e) return pgError(e);

    const items = Array.isArray(b.items) && b.items.length ? b.items : starter?.items ?? [];

    if (items.length) {
      const rows = items.map((it: any, i: number) => ({
        organization_id: ctx.org.organizationId,
        template_id: tpl.id,
        title: String(it.title ?? '').trim(),
        description: it.description ?? '',
        category: (CHECKLIST_CATEGORIES as readonly string[]).includes(String(it.category))
          ? it.category : 'other',
        owner: (CHECKLIST_OWNERS as readonly string[]).includes(String(it.owner))
          ? it.owner : 'hr',
        due_offset_days: Number.isFinite(Number(it.due_offset_days ?? it.dueOffsetDays))
          ? Number(it.due_offset_days ?? it.dueOffsetDays) : 0,
        requires_document: it.requires_document === true || it.requiresDocument === true,
        sort_order: Number.isFinite(Number(it.sort_order)) ? Number(it.sort_order) : i,
      })).filter((r: any) => r.title);

      if (rows.length) {
        const { error: ie } = await ctx.supabase.from('checklist_template_items').insert(rows);
        if (ie) return pgError(ie);
      }
    }

    const { data: full } = await ctx.supabase
      .from('checklist_templates').select(SELECT).eq('id', tpl.id).maybeSingle();

    return success(full ?? tpl, undefined, 201);
  } catch (e: any) {
    return serverError(e, 'Could not create the template');
  }
}
