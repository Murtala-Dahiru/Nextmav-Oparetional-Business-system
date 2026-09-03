import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { INTERVIEW_KINDS, INTERVIEW_STATUSES } from '@/lib/hr';

const SELECT =
  '*, application:job_applications(id, stage, status, ' +
  'candidate:candidates(id, full_name, email, headline, resume_file_id), ' +
  'opening:job_openings(id, title, reference)), ' +
  'participants:interview_participants(id, is_lead, member:organization_members(id, profiles!organization_members_user_id_fkey(full_name, avatar_url))), ' +
  'feedback:interview_feedback(*, member:organization_members(id, profiles!organization_members_user_id_fkey(full_name, avatar_url)))';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('interviews').select(SELECT)
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success(data);
}

export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());
    const update: Record<string, any> = {};

    for (const k of ['title', 'location', 'meeting_url', 'agenda', 'starts_at', 'ends_at']) {
      if (k in b) update[k] = b[k] === '' ? (k === 'meeting_url' ? null : '') : b[k];
    }

    if (update.starts_at && update.ends_at
        && Date.parse(update.ends_at) <= Date.parse(update.starts_at)) {
      return error('An interview cannot end before it starts', 422, 'VALIDATION_ERROR');
    }

    if ('kind' in b) {
      if (!(INTERVIEW_KINDS as readonly string[]).includes(String(b.kind))) {
        return error(`Kind must be one of: ${INTERVIEW_KINDS.join(', ')}.`, 422, 'VALIDATION_ERROR');
      }
      update.kind = b.kind;
    }

    if ('status' in b) {
      if (!(INTERVIEW_STATUSES as readonly string[]).includes(String(b.status))) {
        return error(`Status must be one of: ${INTERVIEW_STATUSES.join(', ')}.`, 422, 'VALIDATION_ERROR');
      }
      update.status = b.status;
    }

    if (!Object.keys(update).length && !Array.isArray(b.participants)) {
      return error('Nothing to update', 422, 'VALIDATION_ERROR');
    }

    if (Object.keys(update).length) {
      const { error: e } = await ctx.supabase
        .from('interviews').update(update)
        .eq('organization_id', ctx.org.organizationId).eq('id', id);
      if (e) return pgError(e);
    }

    /**
     * Changing the panel, as a difference rather than a replacement.
     *
     * Deleting every participant and re-inserting would fire the notification
     * trigger for people who were already on the panel and had already been
     * told, which is exactly the spam the brief rules out - and it would drop
     * their calendar attendance for an instant in the process.
     */
    if (Array.isArray(b.participants)) {
      const wanted = new Set<string>(b.participants.map(String));
      const { data: current } = await ctx.supabase
        .from('interview_participants').select('id, member_id')
        .eq('interview_id', id);

      const have = new Set((current ?? []).map((p: any) => p.member_id));

      const added = [...wanted].filter(m => !have.has(m));
      const removed = (current ?? []).filter((p: any) => !wanted.has(p.member_id));

      if (added.length) {
        await ctx.supabase.from('interview_participants').insert(
          added.map(memberId => ({
            organization_id: ctx.org.organizationId,
            interview_id: id,
            member_id: memberId,
          })),
        );
      }
      if (removed.length) {
        await ctx.supabase.from('interview_participants')
          .delete().in('id', removed.map((p: any) => p.id));
      }
    }

    const { data, error: e2 } = await ctx.supabase
      .from('interviews').select(SELECT)
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
 * Removing an interview removes the meeting it put in everyone's week.
 *
 * `unmirror_interview_from_calendar()` does that, on the database side, so it
 * happens whichever path the delete arrives by - including a cascade when the
 * application goes.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'delete');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { error: e } = await ctx.supabase
    .from('interviews').delete()
    .eq('organization_id', ctx.org.organizationId).eq('id', id);

  if (e) return pgError(e);
  return success({ deleted: true });
}
