import { authorize, pgError } from '@/lib/auth-context';
import { success, error, paginated, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { isFilterValue } from '@/lib/filters';
import { CANDIDATE_SOURCES } from '@/lib/hr';

const SELECT =
  '*, referrer:organization_members!candidates_referred_by_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), ' +
  'applications:job_applications(id, stage, status, applied_on, opening:job_openings(id, title, reference, status))';

/**
 * Candidates - people, not applications.
 *
 * The distinction is the point of the table: somebody who applied for a
 * support role in March and an engineering role in September is one candidate
 * with two applications, and a screen that cannot say so cannot answer the
 * only question a hiring database is really for - have we spoken to this
 * person before.
 */
export async function GET(req: Request) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 50));

  let q = ctx.supabase
    .from('candidates')
    .select(SELECT, { count: 'exact' })
    .eq('organization_id', ctx.org.organizationId);

  const source = searchParams.get('source');
  if (isFilterValue(source)) q = q.eq('source', source);

  const search = searchParams.get('search')?.trim().replace(/[,()*]/g, ' ').trim();
  if (search) {
    q = q.or(`full_name.ilike.%${search}%,email.ilike.%${search}%,headline.ilike.%${search}%`);
  }

  const offset = (page - 1) * pageSize;
  const { data, count, error: e } = await q
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (e) return pgError(e);
  return paginated(data ?? [], count ?? 0, page, pageSize);
}

export async function POST(req: Request) {
  const ctx = await authorize('hr', 'create');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());

    const fullName = String(b.full_name ?? '').trim();
    if (!fullName) return error('A name is required', 422, 'VALIDATION_ERROR');

    const source = String(b.source ?? 'direct');
    if (!(CANDIDATE_SOURCES as readonly string[]).includes(source)) {
      return error(`Source must be one of: ${CANDIDATE_SOURCES.join(', ')}.`, 422, 'VALIDATION_ERROR');
    }

    const email = String(b.email ?? '').trim() || null;

    /**
     * The same person, applying again.
     *
     * The unique index on (organization_id, email) would refuse the insert with
     * a constraint violation, which is correct and unhelpful: the caller wants
     * to add this person to a pipeline, and the answer is the candidate that
     * already exists. Returning it - rather than a 409 the form has to
     * interpret - is what makes "add candidate" work the second time somebody
     * good comes back.
     */
    if (email) {
      const { data: existing } = await ctx.supabase
        .from('candidates').select(SELECT)
        .eq('organization_id', ctx.org.organizationId)
        .ilike('email', email)
        .maybeSingle();

      if (existing) {
        return success({ ...(existing as any), _existing: true }, { existing: true }, 200);
      }
    }

    const { data, error: e } = await ctx.supabase
      .from('candidates')
      .insert({
        organization_id: ctx.org.organizationId,
        full_name: fullName,
        email,
        phone: b.phone || null,
        headline: b.headline ?? '',
        location: b.location ?? '',
        source,
        referred_by: b.referred_by || null,
        profile_url: b.profile_url || null,
        resume_file_id: b.resume_file_id || null,
        notes: b.notes ?? '',
        created_by: ctx.org.memberId,
      })
      .select(SELECT)
      .single();

    if (e) return pgError(e);
    return success(data, undefined, 201);
  } catch (e: any) {
    return serverError(e, 'Could not add the candidate');
  }
}
