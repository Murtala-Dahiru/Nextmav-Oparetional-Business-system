import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { isFilterValue } from '@/lib/filters';
import { JOURNEY_KINDS } from '@/lib/hr';

const SELECT =
  '*, member:organization_members!employee_checklists_member_id_fkey(id, ' +
  'profiles!organization_members_user_id_fkey(full_name, avatar_url), ' +
  'department:departments!organization_members_department_id_fkey(id, name)), ' +
  'items:employee_checklist_items(id, title, description, category, due_on, is_done, ' +
  'completed_at, requires_document, document_file_id, sort_order, todo_id, assignee_id, ' +
  'assignee:organization_members!employee_checklist_items_assignee_id_fkey(id, ' +
  'profiles!organization_members_user_id_fkey(full_name, avatar_url)))';

/**
 * Somebody's onboarding or offboarding, and the steps it involves.
 *
 * `employee_checklists_select` shows you your own, your people's if you manage
 * them, and everybody's if you are HR. The items carry an extra audience -
 * whoever is assigned a step - because the IT manager issuing a laptop is not
 * in the new starter's reporting line and still has to see the task.
 */
export async function GET(req: Request) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);

  let q = ctx.supabase
    .from('employee_checklists').select(SELECT)
    .eq('organization_id', ctx.org.organizationId);

  const memberId = searchParams.get('memberId');
  if (isFilterValue(memberId)) q = q.eq('member_id', memberId);
  const kind = searchParams.get('kind');
  if (isFilterValue(kind)) q = q.eq('kind', kind);
  const status = searchParams.get('status');
  if (isFilterValue(status)) q = q.eq('status', status);
  else if (searchParams.get('include') !== 'all') q = q.eq('status', 'active');

  const { data, error: e } = await q.order('anchor_date', { ascending: false }).limit(200);
  if (e) return pgError(e);

  /**
   * Progress, counted here.
   *
   * The board draws "4 of 11" on every card and the detail draws the same
   * fraction; computing it in two places is how they come to disagree the
   * first time one of them filters the items it is counting.
   */
  return success((data ?? []).map((c: any) => {
    const items = c.items ?? [];
    const done = items.filter((i: any) => i.is_done).length;
    const today = new Date().toISOString().slice(0, 10);
    return {
      ...c,
      progress: {
        total: items.length,
        done,
        percent: items.length ? Math.round((done / items.length) * 100) : 0,
        overdue: items.filter((i: any) => !i.is_done && i.due_on && i.due_on < today).length,
      },
    };
  }));
}

/**
 * Start a journey.
 *
 * Through `start_employee_checklist()`, which resolves each template step's
 * owner role to a real person, turns the signed day offsets into dates against
 * the anchor, and creates the items - each of which becomes a to-do in that
 * person's My Work by trigger.
 *
 * A checklist with no template is legitimate and produces an empty list HR then
 * fills in by hand, which is how the first one at a company gets written.
 */
export async function POST(req: Request) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());

    if (!b.member_id) return error('An employee is required', 422, 'VALIDATION_ERROR');

    const kind = String(b.kind ?? 'onboarding');
    if (!(JOURNEY_KINDS as readonly string[]).includes(kind)) {
      return error(`Kind must be one of: ${JOURNEY_KINDS.join(', ')}.`, 422, 'VALIDATION_ERROR');
    }

    const { data, error: e } = await ctx.supabase.rpc('start_employee_checklist', {
      p_member: b.member_id,
      p_kind: kind,
      p_template: b.template_id || null,
      p_anchor: b.anchor_date || null,
      p_name: b.name || null,
    });

    if (e) return pgError(e);

    const { data: full } = await ctx.supabase
      .from('employee_checklists').select(SELECT).eq('id', (data as any).id).maybeSingle();

    return success(full ?? data, undefined, 201);
  } catch (e: any) {
    return serverError(e, 'Could not start the checklist');
  }
}
