import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { OPENING_STATUSES, WORK_MODES, EMPLOYMENT_TYPES } from '@/lib/hr';

const SELECT =
  '*, department:departments(id, name), ' +
  'hiring_manager:organization_members!job_openings_hiring_manager_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), ' +
  'recruiter:organization_members!job_openings_recruiter_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

type Params = { params: Promise<{ id: string }> };

/** One opening and its whole pipeline: the board the hiring manager works. */
export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('job_openings').select(SELECT)
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  const opening = data as any;

  const { data: applications } = await ctx.supabase
    .from('job_applications')
    .select(
      '*, candidate:candidates(id, full_name, email, phone, headline, source, location, resume_file_id), ' +
      'interviews(id, kind, starts_at, ends_at, status)',
    )
    .eq('opening_id', id)
    .order('updated_at', { ascending: false });

  return success({ ...opening, applications: applications ?? [] });
}

export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());
    const update: Record<string, any> = {};

    for (const k of [
      'title', 'department_id', 'hiring_manager_id', 'recruiter_id',
      'location', 'description', 'requirements', 'target_start_on', 'positions',
    ]) {
      if (k in b) update[k] = b[k] === '' ? null : b[k];
    }

    /* `title` is NOT NULL with a non-empty check; sending it blank would raise
       a constraint the user cannot read. */
    if ('title' in update && !String(update.title ?? '').trim()) {
      return error('A job title is required', 422, 'VALIDATION_ERROR');
    }

    for (const [key, allowed] of [
      ['status', OPENING_STATUSES],
      ['work_mode', WORK_MODES],
      ['employment_type', EMPLOYMENT_TYPES],
    ] as const) {
      if (key in b) {
        if (!(allowed as readonly string[]).includes(String(b[key]))) {
          return error(`\`${key}\` must be one of: ${allowed.join(', ')}.`, 422, 'VALIDATION_ERROR');
        }
        update[key] = b[key];
      }
    }

    if (!Object.keys(update).length) {
      return error('Nothing to update', 422, 'VALIDATION_ERROR');
    }

    const { data, error: e } = await ctx.supabase
      .from('job_openings').update(update)
      .eq('organization_id', ctx.org.organizationId).eq('id', id)
      .select(SELECT).maybeSingle();

    if (e) return pgError(e);
    if (!data) return error('Not found', 404, 'NOT_FOUND');
    return success(data);
  } catch (e: any) {
    return serverError(e, 'Update failed');
  }
}

/**
 * Delete, and the case where it is refused.
 *
 * An opening somebody was hired against is the reason that person's employment
 * record cites an application, so removing it would cascade the pipeline away
 * and leave the citation pointing at nothing. Closing it is what the caller
 * actually wants, and saying so is more useful than a foreign key error.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'delete');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { count } = await ctx.supabase
    .from('job_applications')
    .select('id', { count: 'exact', head: true })
    .eq('opening_id', id).eq('status', 'hired');

  if ((count ?? 0) > 0) {
    return error(
      'Somebody was hired against this opening, so it is part of their employment record. Close it instead.',
      409, 'HAS_HIRES',
    );
  }

  const { error: e } = await ctx.supabase
    .from('job_openings').delete()
    .eq('organization_id', ctx.org.organizationId).eq('id', id);

  if (e) return pgError(e);
  return success({ deleted: true });
}
