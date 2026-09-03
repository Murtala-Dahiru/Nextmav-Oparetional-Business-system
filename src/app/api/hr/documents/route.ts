import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { isFilterValue } from '@/lib/filters';
import { HR_DOCUMENT_CATEGORIES, ORG_WIDE_DOCUMENTS } from '@/lib/hr';

const SELECT =
  'id, filename, mime_type, size_bytes, bucket, path, hr_category, member_id, ' +
  'hr_case_id, is_confidential, created_at, ' +
  'subject:organization_members!files_member_id_fkey(id, ' +
  'profiles!organization_members_user_id_fkey(full_name, avatar_url)), ' +
  'uploader:organization_members!files_uploaded_by_fkey(id, ' +
  'profiles!organization_members_user_id_fkey(full_name))';

/** HR documents live in the same buckets every other attachment does. */
const HR_BUCKETS = ['documents', 'attachments'];

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  HR documents.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Contracts, offer letters, identification, policies, and everything else HR
 * holds about a person - stored in `files`, which is where every other
 * attachment in this product already lives.
 *
 * ── Why there is no `hr_documents` table ─────────────────────────────────
 *
 * `files` has carried `member_id` and `is_confidential` since 0003, and
 * `files_select` has said since 0005: a confidential file is readable by its
 * subject and by owner, administrator and HR, and by nobody else. That *is*
 * the HR document rule, already enforced, already covering storage paths,
 * uploads, tenancy and soft deletion.
 *
 * A parallel table would have been a second implementation of a working
 * policy, and the second implementation is always the one that turns out to be
 * missing a clause. 0043 added one column - `hr_category`, saying what a
 * document is - and stopped.
 *
 * ── Confidential is not optional here ────────────────────────────────────
 *
 * Everything filed against a person is written `is_confidential = true`
 * regardless of what the caller sent. A contract uploaded with the flag off
 * would be readable by the whole organisation, and "the form forgot to tick
 * the box" is not a failure mode an employment contract should have. Only a
 * policy - which is the company's, not a person's - is filed openly.
 */
export async function GET(req: Request) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);

  let q = ctx.supabase
    .from('files').select(SELECT)
    .eq('organization_id', ctx.org.organizationId)
    .not('hr_category', 'is', null)
    .is('deleted_at', null);

  const memberId = searchParams.get('memberId');
  if (isFilterValue(memberId)) q = q.eq('member_id', memberId);

  const category = searchParams.get('category');
  if (isFilterValue(category)) q = q.eq('hr_category', category);

  /* The policy library: documents that belong to the company rather than to a
     person, which is the one HR category everybody can read. */
  if (searchParams.get('scope') === 'policies') {
    q = q.eq('hr_category', 'policy');
  }

  const { data, error: e } = await q
    .order('created_at', { ascending: false }).limit(500);

  if (e) return pgError(e);
  return success(data ?? []);
}

/**
 * Record a document that has already been stored.
 *
 * Bytes go from the browser straight to Supabase Storage, exactly as they do
 * for project and workspace files; this records what was stored and who it is
 * about. Two things are checked rather than trusted: that the path is inside
 * this organisation's prefix, and that the subject is a member of it.
 */
export async function POST(req: Request) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;

  const b = acceptBody(await req.json());

  const filename = String(b.filename ?? '').trim();
  const path = String(b.path ?? '').trim();
  const bucket = String(b.bucket ?? 'documents');

  if (!filename) return error('filename is required', 422, 'VALIDATION_ERROR');
  if (!path) return error('path is required', 422, 'VALIDATION_ERROR');
  if (!HR_BUCKETS.includes(bucket)) {
    return error(`HR documents live in ${HR_BUCKETS.join(' or ')}, not "${bucket}".`, 422, 'INVALID_BUCKET');
  }
  if (path.split('/')[0] !== ctx.org.organizationId) {
    return error('That storage path does not belong to this organization.', 422, 'PATH_MISMATCH');
  }

  const category = String(b.hr_category ?? 'other');
  if (!(HR_DOCUMENT_CATEGORIES as readonly string[]).includes(category)) {
    return error(`Category must be one of: ${HR_DOCUMENT_CATEGORIES.join(', ')}.`, 422, 'VALIDATION_ERROR');
  }

  const orgWide = (ORG_WIDE_DOCUMENTS as readonly string[]).includes(category);
  const memberId = orgWide ? null : (b.member_id || null);

  if (!orgWide && !memberId && !b.hr_case_id) {
    return error(
      'A document is filed against an employee or a case. Only a policy belongs to the company itself.',
      422, 'SUBJECT_REQUIRED',
    );
  }

  if (memberId) {
    const { data: member } = await ctx.supabase
      .from('organization_members').select('id')
      .eq('organization_id', ctx.org.organizationId).eq('id', memberId)
      .maybeSingle();
    if (!member) return error('That employee is not a member of this organization.', 422, 'MEMBER_NOT_FOUND');
  }

  const { data, error: e } = await ctx.supabase
    .from('files')
    .insert({
      organization_id: ctx.org.organizationId,
      bucket,
      path,
      filename,
      mime_type: b.mime_type || null,
      size_bytes: Math.max(0, Number(b.size_bytes) || 0),
      member_id: memberId,
      hr_category: category,
      hr_case_id: b.hr_case_id || null,
      /* Not the caller's choice. See the header. */
      is_confidential: !orgWide,
      uploaded_by: ctx.org.memberId,
    })
    .select(SELECT)
    .single();

  if (e) {
    if (e.code === '23505') return error('That file has already been recorded.', 409, 'DUPLICATE_PATH');
    return pgError(e);
  }

  /**
   * No activity-log entry, deliberately.
   *
   * Workspace uploads write one because colleagues look for each other's files
   * there. "Uploaded Dismissal letter - Ada Balogun" in the company feed would
   * disclose the thing the confidentiality flag exists to protect, and the
   * feed has no per-row visibility rule to fall back on.
   */
  return success(data, undefined, 201);
}
