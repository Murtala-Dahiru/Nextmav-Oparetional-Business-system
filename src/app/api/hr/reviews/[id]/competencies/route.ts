import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';

type Params = { params: Promise<{ id: string }> };

const SELECT =
  '*, competency:competencies!review_competencies_competency_id_fkey('
  + 'id, name, description, category, sort_order, is_active)';

/**
 * Put this review's competency sheet in front of the reviewer.
 *
 * ── Why this is not N inserts from the client ────────────────────────────
 *
 * A framework has ten or fifteen competencies. Opening a review would
 * otherwise fire fifteen POSTs, each one able to fail on its own, leaving a
 * half-populated sheet that looks like a framework with gaps in it. One
 * request either produces the whole sheet or changes nothing a reader can
 * see.
 *
 * ── Why it is idempotent ─────────────────────────────────────────────────
 *
 * The screen calls this every time a review is opened, because the framework
 * may have gained a competency since the review was created and a sheet that
 * silently omits it is worse than one that grows. Rows that already exist are
 * left exactly as they are — including their ratings — and only the missing
 * ones are added. Calling it twice is calling it once.
 *
 * Retired competencies are not added. A review opened after "Punctuality" was
 * retired does not ask about punctuality; a review that already rated it
 * keeps that rating, which is why the row is never removed either.
 */
export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('review_competencies').select(SELECT)
    .eq('organization_id', ctx.org.organizationId)
    .eq('review_id', id);

  if (e) return pgError(e);

  /**
   * Ordered by the framework's own order, not by when the row was made.
   *
   * A sheet whose questions arrive in creation order changes shape every time
   * somebody adds a competency, and a reviewer comparing two people needs the
   * same questions in the same places.
   */
  const rows = (data ?? []).slice().sort((a: any, b: any) =>
    (a.competency?.sort_order ?? 0) - (b.competency?.sort_order ?? 0)
    || String(a.competency?.name ?? '').localeCompare(String(b.competency?.name ?? '')));

  return success(rows);
}

export async function POST(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const orgId = ctx.org.organizationId;

  /**
   * The review is read first, and its absence is a 404 rather than a 403.
   *
   * RLS decides whether this reader can see it at all; if they cannot, the
   * honest answer is that there is no such review as far as they are
   * concerned. Confirming that a review exists but is not theirs tells
   * somebody that a colleague is being reviewed.
   */
  const { data: review, error: re } = await ctx.supabase
    .from('performance_reviews').select('id')
    .eq('organization_id', orgId).eq('id', id).maybeSingle();

  if (re) return pgError(re);
  if (!review) return error('No such review.', 404, 'NOT_FOUND');

  const [{ data: active, error: ce }, { data: existing, error: ee }] = await Promise.all([
    ctx.supabase.from('competencies').select('id')
      .eq('organization_id', orgId).eq('is_active', true),
    ctx.supabase.from('review_competencies').select('competency_id')
      .eq('organization_id', orgId).eq('review_id', id),
  ]);

  if (ce) return pgError(ce);
  if (ee) return pgError(ee);

  const have = new Set((existing ?? []).map((r: any) => r.competency_id));
  const missing = (active ?? []).filter((c: any) => !have.has(c.id));

  if (missing.length > 0) {
    const { error: ie } = await ctx.supabase.from('review_competencies').insert(
      missing.map((c: any) => ({
        organization_id: orgId,
        review_id: id,
        competency_id: c.id,
      })),
    );
    if (ie) return pgError(ie);
  }

  const { data, error: se } = await ctx.supabase
    .from('review_competencies').select(SELECT)
    .eq('organization_id', orgId).eq('review_id', id);

  if (se) return pgError(se);

  const rows = (data ?? []).slice().sort((a: any, b: any) =>
    (a.competency?.sort_order ?? 0) - (b.competency?.sort_order ?? 0)
    || String(a.competency?.name ?? '').localeCompare(String(b.competency?.name ?? '')));

  return success(rows, { added: missing.length });
}
