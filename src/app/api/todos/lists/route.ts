import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

/**
 * A person's own groupings for their to-dos.
 *
 * "Today", "Follow-ups", "Reading". Never shared, never assigned, invisible to
 * everyone else — a list is one person's filing, not a team artefact. If two
 * people need to see the same work, that work is a task on a project, which is
 * a different feature entirely.
 */

/** Colour keys the client resolves to classes. Not CSS values: a stored
 *  `#ff0000` outlives every redesign and looks wrong in dark mode. */
const LIST_COLORS = ['slate', 'emerald', 'blue', 'amber', 'rose', 'violet'];

export async function GET() {
  const ctx = await authorize('mywork', 'view');
  if (ctx instanceof Response) return ctx;

  const { data, error: e } = await ctx.supabase
    .from('todo_lists')
    .select('id, name, color, sort_order, created_at, todos(count)')
    .eq('member_id', ctx.org.memberId)
    .order('sort_order')
    .order('created_at');

  if (e) return pgError(e);
  return success(data ?? []);
}

export async function POST(req: Request) {
  const ctx = await authorize('mywork', 'view');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());

    const name = String(b.name ?? '').trim();
    if (!name) return error('A list needs a name', 422, 'VALIDATION_ERROR');

    const color = String(b.color ?? 'slate');
    if (!LIST_COLORS.includes(color)) {
      return error(
        `"${color}" is not one of the available colours: ${LIST_COLORS.join(', ')}.`,
        422, 'INVALID_COLOR',
      );
    }

    const { data, error: e } = await ctx.supabase
      .from('todo_lists')
      .insert({
        organization_id: ctx.org.organizationId,
        member_id: ctx.org.memberId,
        name,
        color,
        sort_order: Number(b.sort_order) || 0,
      })
      .select('id, name, color, sort_order, created_at')
      .single();

    if (e) {
      // UNIQUE (member_id, name) — two lists called "Today" help nobody.
      if (e.code === '23505') {
        return error('You already have a list with that name.', 409, 'DUPLICATE_LIST');
      }
      return pgError(e);
    }
    return success(data, undefined, 201);
  } catch (e: any) {
    return serverError(e, 'Could not create the list');
  }
}
