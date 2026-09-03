import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { isFilterValue } from '@/lib/filters';
import { INTERVIEW_KINDS } from '@/lib/hr';

const SELECT =
  '*, application:job_applications(id, stage, status, ' +
  'candidate:candidates(id, full_name, email, headline), ' +
  'opening:job_openings(id, title, reference)), ' +
  'participants:interview_participants(id, is_lead, member:organization_members(id, profiles!organization_members_user_id_fkey(full_name, avatar_url))), ' +
  'feedback:interview_feedback(id, member_id, recommendation, rating, submitted_at)';

/**
 * Interviews.
 *
 * A scheduled conversation with a candidate, which is also a real
 * `calendar_events` row - written by trigger, kept in step by trigger, and
 * deleted with the interview. HR does not get a second calendar; the panel
 * sees the meeting in the week they already look at, and
 * `interview_participants` puts them on it as attendees.
 */
export async function GET(req: Request) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);

  let q = ctx.supabase
    .from('interviews').select(SELECT)
    .eq('organization_id', ctx.org.organizationId);

  const applicationId = searchParams.get('applicationId');
  if (isFilterValue(applicationId)) q = q.eq('application_id', applicationId);
  const status = searchParams.get('status');
  if (isFilterValue(status)) q = q.eq('status', status);

  const from = searchParams.get('from');
  if (from) q = q.gte('starts_at', from);
  const to = searchParams.get('to');
  if (to) q = q.lte('starts_at', to);

  /* Upcoming first when a window was asked for, most recent first otherwise -
     which is what each of the two screens reading this actually wants. */
  const { data, error: e } = await q
    .order('starts_at', { ascending: Boolean(from) })
    .limit(200);

  if (e) return pgError(e);
  return success(data ?? []);
}

export async function POST(req: Request) {
  const ctx = await authorize('hr', 'create');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());

    if (!b.application_id) return error('An application is required', 422, 'VALIDATION_ERROR');
    if (!b.starts_at || !b.ends_at) {
      return error('An interview needs a start and an end', 422, 'VALIDATION_ERROR');
    }
    if (Date.parse(b.ends_at) <= Date.parse(b.starts_at)) {
      return error('An interview cannot end before it starts', 422, 'VALIDATION_ERROR');
    }

    const kind = String(b.kind ?? 'screening');
    if (!(INTERVIEW_KINDS as readonly string[]).includes(kind)) {
      return error(`Kind must be one of: ${INTERVIEW_KINDS.join(', ')}.`, 422, 'VALIDATION_ERROR');
    }

    const { data, error: e } = await ctx.supabase
      .from('interviews')
      .insert({
        organization_id: ctx.org.organizationId,
        application_id: b.application_id,
        kind,
        title: b.title ?? '',
        starts_at: b.starts_at,
        ends_at: b.ends_at,
        location: b.location ?? '',
        meeting_url: b.meeting_url || null,
        agenda: b.agenda ?? '',
        created_by: ctx.org.memberId,
      })
      .select('id')
      .single();

    if (e) return pgError(e);

    /**
     * The panel, inserted after the interview exists.
     *
     * Each row fires `notify_interview_participant()`, which adds them to the
     * calendar event and tells them. Defaulting to the caller when nobody was
     * named: an interview with no interviewer is a meeting nobody is going to,
     * and the person scheduling it is invariably in the room.
     */
    const panel: string[] = Array.isArray(b.participants) && b.participants.length
      ? b.participants.map(String)
      : [ctx.org.memberId];

    const lead = b.lead_id ?? panel[0];

    await ctx.supabase.from('interview_participants').insert(
      [...new Set(panel)].map(memberId => ({
        organization_id: ctx.org.organizationId,
        interview_id: data.id,
        member_id: memberId,
        is_lead: memberId === lead,
      })),
    );

    const { data: full } = await ctx.supabase
      .from('interviews').select(SELECT).eq('id', data.id).maybeSingle();

    return success(full ?? data, undefined, 201);
  } catch (e: any) {
    return serverError(e, 'Could not schedule the interview');
  }
}
