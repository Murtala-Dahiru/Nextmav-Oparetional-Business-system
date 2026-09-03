import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

const SELECT =
  '*, author:organization_members(id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

type Params = { params: Promise<{ id: string }> };

const HR_ROLES = ['owner', 'administrator', 'hr_staff'];

/**
 * Notes on a case.
 *
 * Two kinds, and the difference is the point: an ordinary note is the case's
 * conversation with the employee, and an internal one is HR talking to HR.
 * `hr_case_notes_select` drops the internal ones for anybody who is neither
 * their author nor HR, so the employee reading their own case sees a coherent
 * thread rather than gaps.
 *
 * The first note by somebody other than the raiser stamps `first_response_at`
 * on the case, by trigger - which is the only honest input to a
 * response-time figure, and the reason the old screen's "Avg Resolution Time:
 * 18 Hours" was a string literal.
 */
export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('hr_case_notes').select(SELECT)
    .eq('organization_id', ctx.org.organizationId).eq('case_id', id)
    .order('created_at', { ascending: true });

  if (e) return pgError(e);
  return success(data ?? []);
}

export async function POST(req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'create');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());

    const body = String(b.body ?? '').trim();
    if (!body) return error('A note needs something in it', 422, 'VALIDATION_ERROR');

    /**
     * Only HR writes internal notes.
     *
     * An employee marking their own note internal would produce a note the
     * case's other participants cannot see, written by somebody who is not
     * running the case - which is not a private margin, it is a message
     * addressed to nobody.
     */
    const isInternal = b.is_internal === true && HR_ROLES.includes(ctx.org.role);

    const { data, error: e } = await ctx.supabase
      .from('hr_case_notes')
      .insert({
        organization_id: ctx.org.organizationId,
        case_id: id,
        author_id: ctx.org.memberId,
        body,
        is_internal: isInternal,
      })
      .select(SELECT)
      .single();

    /* `hr_case_notes_insert` checks `can_see_hr_case()`, so posting into a case
       you may not read is refused by the database rather than here. */
    if (e) return pgError(e);
    return success(data, undefined, 201);
  } catch (e: any) {
    return serverError(e, 'Could not add the note');
  }
}
