import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { CANDIDATE_SOURCES } from '@/lib/hr';

const SELECT =
  '*, referrer:organization_members!candidates_referred_by_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), ' +
  'applications:job_applications(*, opening:job_openings(id, title, reference, status, department:departments(id, name)))';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('candidates').select(SELECT)
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

    for (const k of [
      'full_name', 'email', 'phone', 'headline', 'location',
      'referred_by', 'profile_url', 'resume_file_id', 'notes',
    ]) {
      if (k in b) update[k] = b[k] === '' ? null : b[k];
    }

    if ('full_name' in update && !String(update.full_name ?? '').trim()) {
      return error('A name is required', 422, 'VALIDATION_ERROR');
    }

    if ('source' in b) {
      if (!(CANDIDATE_SOURCES as readonly string[]).includes(String(b.source))) {
        return error(`Source must be one of: ${CANDIDATE_SOURCES.join(', ')}.`, 422, 'VALIDATION_ERROR');
      }
      update.source = b.source;
    }

    /* `hired_member_id` is written by `complete_hire()` and by nothing else.
       Accepting it here would let a caller claim somebody was hired from a
       pipeline they were never in. */
    if (!Object.keys(update).length) {
      return error('Nothing to update', 422, 'VALIDATION_ERROR');
    }

    const { data, error: e } = await ctx.supabase
      .from('candidates').update(update)
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
  const ctx = await authorize('hr', 'delete');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  /* A candidate who became an employee is cited by that employment record. */
  const { data: existing } = await ctx.supabase
    .from('candidates').select('hired_member_id')
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .maybeSingle();

  if (!existing) return error('Not found', 404, 'NOT_FOUND');
  if (existing.hired_member_id) {
    return error(
      'This candidate was hired, so their record is part of an employment history and cannot be removed.',
      409, 'CANDIDATE_HIRED',
    );
  }

  const { error: e } = await ctx.supabase
    .from('candidates').delete()
    .eq('organization_id', ctx.org.organizationId).eq('id', id);

  if (e) return pgError(e);
  return success({ deleted: true });
}
