import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { HR_CASE_STATUSES, HR_CASE_CATEGORIES } from '@/lib/hr';
import { TICKET_PRIORITIES } from '@/lib/constants';

const SELECT =
  '*, raiser:organization_members!hr_cases_raised_by_fkey(id, ' +
  'profiles!organization_members_user_id_fkey(full_name, avatar_url)), ' +
  'subject:organization_members!hr_cases_member_id_fkey(id, ' +
  'profiles!organization_members_user_id_fkey(full_name, avatar_url)), ' +
  'assignee:organization_members!hr_cases_assigned_to_fkey(id, ' +
  'profiles!organization_members_user_id_fkey(full_name, avatar_url))';

type Params = { params: Promise<{ id: string }> };

const HR_ROLES = ['owner', 'administrator', 'hr_staff'];

export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('hr_cases').select(SELECT)
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  const hrCase = data as any;

  const [notes, events, attachments] = await Promise.all([
    /* `hr_case_notes_select` drops the internal ones for anybody who is not
       HR or their author, so the correspondence a person sees here is exactly
       the correspondence they are entitled to. */
    ctx.supabase.from('hr_case_notes')
      .select('*, author:organization_members(id, profiles!organization_members_user_id_fkey(full_name, avatar_url))')
      .eq('case_id', id).order('created_at', { ascending: true }),

    ctx.supabase.from('hr_case_events')
      .select('*, member:organization_members(id, profiles!organization_members_user_id_fkey(full_name))')
      .eq('case_id', id).order('created_at', { ascending: true }),

    ctx.supabase.from('files')
      .select('id, filename, mime_type, size_bytes, created_at, uploaded_by')
      .eq('hr_case_id', id).is('deleted_at', null)
      .order('created_at', { ascending: true }),
  ]);

  return success({
    ...hrCase,
    notes: notes.data ?? [],
    events: events.data ?? [],
    attachments: attachments.data ?? [],
    viewer: {
      isHr: HR_ROLES.includes(ctx.org.role),
      isRaiser: hrCase.raised_by === ctx.org.memberId,
      isAssignee: hrCase.assigned_to === ctx.org.memberId,
    },
  });
}

/**
 * Work a case, or withdraw your own.
 *
 * `hr_cases_update` admits HR, the assignee, and the raiser - and the last of
 * those is deliberately narrow in what they may change. Somebody who raised a
 * question may close it; they may not assign it to a colleague, escalate its
 * priority or write its resolution.
 */
export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());

    const { data: existing } = await ctx.supabase
      .from('hr_cases').select('raised_by, assigned_to, status')
      .eq('organization_id', ctx.org.organizationId).eq('id', id)
      .maybeSingle();

    if (!existing) return error('Not found', 404, 'NOT_FOUND');

    const isHr = HR_ROLES.includes(ctx.org.role);
    const isAssignee = existing.assigned_to === ctx.org.memberId;
    const isRaiser = existing.raised_by === ctx.org.memberId;
    const canWork = isHr || isAssignee;

    const update: Record<string, any> = {};

    if ('status' in b) {
      const status = String(b.status);
      if (!(HR_CASE_STATUSES as readonly string[]).includes(status)) {
        return error(`Status must be one of: ${HR_CASE_STATUSES.join(', ')}.`, 422, 'VALIDATION_ERROR');
      }
      /* Withdrawing your own case is closing it, and that is the whole of a
         raiser's write access to the status. */
      if (!canWork && !(isRaiser && status === 'closed')) {
        return error(
          'You can close your own case. Working it is HR’s.',
          403, 'FORBIDDEN_ACTION',
        );
      }
      update.status = status;
    }

    if (canWork) {
      for (const k of ['assigned_to', 'resolution']) {
        if (k in b) update[k] = b[k] === '' ? (k === 'resolution' ? '' : null) : b[k];
      }
      if ('priority' in b) {
        if (!(TICKET_PRIORITIES as readonly string[]).includes(String(b.priority))) {
          return error(`Priority must be one of: ${TICKET_PRIORITIES.join(', ')}.`, 422, 'VALIDATION_ERROR');
        }
        update.priority = b.priority;
      }
      if ('category' in b) {
        if (!(HR_CASE_CATEGORIES as readonly string[]).includes(String(b.category))) {
          return error(`Category must be one of: ${HR_CASE_CATEGORIES.join(', ')}.`, 422, 'VALIDATION_ERROR');
        }
        update.category = b.category;
      }
      /**
       * Restriction can be tightened by anyone working the case, and loosened
       * only by HR.
       *
       * Unrestricting a grievance makes it readable by the person it is about,
       * which is a decision with consequences and not one an assignee should
       * be able to take on their own.
       */
      if ('is_restricted' in b) {
        if (b.is_restricted === false && !isHr) {
          return error('Only HR can remove the restriction on a case.', 403, 'FORBIDDEN_ACTION');
        }
        update.is_restricted = b.is_restricted === true;
      }
    }

    /* The raiser may still add to their own description while it is open. */
    if ('description' in b && (canWork || isRaiser)) {
      update.description = b.description ?? '';
    }

    if (!Object.keys(update).length) {
      return error('Nothing to update', 422, 'VALIDATION_ERROR');
    }

    const { data, error: e } = await ctx.supabase
      .from('hr_cases').update(update)
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
    .from('hr_cases').delete()
    .eq('organization_id', ctx.org.organizationId).eq('id', id);

  if (e) return pgError(e);
  return success({ deleted: true });
}
