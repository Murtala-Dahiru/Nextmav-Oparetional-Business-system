import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { isFilterValue } from '@/lib/filters';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Calibration: the same cycle, seen all at once
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── What calibration is for ──────────────────────────────────────────────
 *
 *  A 4 from a generous manager and a 4 from a severe one are not the same 4.
 *  Nobody can see that from inside a single review, which is why reviews are
 *  read together before they are shared: not to move people to fit a shape,
 *  but so that two managers can discover they mean different things by the
 *  same number and agree which one they meant.
 *
 *  ── What this route deliberately does not do ─────────────────────────────
 *
 *  **It does not propose a distribution, and it does not flag anybody as
 *  out of line.** Forced ranking — "20% must be a 5, 10% must be a 2" — makes
 *  a person's rating depend on who else happens to be in their department
 *  this year, and a system that ships a suggested curve has chosen forced
 *  ranking on the organisation's behalf whatever the label on the button
 *  says. What is returned is counts. A room of people decides what they mean.
 *
 *  For the same reason there is no "expected" figure next to the mean, and
 *  no colour on a department whose average is high. A number rendered in red
 *  is an instruction.
 *
 *  ── Why the numbers are counted here rather than in Postgres ─────────────
 *
 *  A view would be read with the *definer's* rights or need its own policy,
 *  and this data is exactly the data whose visibility is intricate: HR sees
 *  the organisation, a manager sees their department. Counting in the route
 *  over rows RLS already filtered means the totals are automatically the
 *  totals of what this reader may see, and a manager's distribution is their
 *  own department's rather than a company figure they should not have.
 *
 *  That is a real consequence and the response says so: `scope` reports whose
 *  numbers these are, so a screen never presents a departmental distribution
 *  as if it were the company's.
 */

const REVIEW_SELECT = `
  id, status, overall_rating, promotion_readiness, readiness_note,
  shared_at, closed_at, member_id, reviewer_id,
  member:organization_members!performance_reviews_member_id_fkey(
    id, department_id,
    department:departments!organization_members_department_id_fkey(id, name),
    profiles!organization_members_user_id_fkey(full_name, avatar_url, job_title)
  ),
  reviewer:organization_members!performance_reviews_reviewer_id_fkey(
    id, profiles!organization_members_user_id_fkey(full_name)
  )
`;

const RATINGS = [1, 2, 3, 4, 5];

export async function GET(req: Request) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const cycleId = searchParams.get('cycleId');
  const reviewId = searchParams.get('reviewId');

  /**
   * A single review's history, for the dialog that shows one person why their
   * rating moved. Same route because it is the same table and the same rule.
   */
  if (isFilterValue(reviewId)) {
    const { data, error: e } = await ctx.supabase
      .from('review_calibrations')
      .select('*, calibrator:organization_members!review_calibrations_calibrated_by_fkey('
        + 'id, profiles!organization_members_user_id_fkey(full_name))')
      .eq('organization_id', ctx.org.organizationId)
      .eq('review_id', reviewId)
      .order('created_at', { ascending: false });

    if (e) return pgError(e);
    return success({ changes: data ?? [] });
  }

  if (!isFilterValue(cycleId)) {
    return error('Say which cycle to calibrate.', 422, 'VALIDATION_ERROR');
  }

  const [{ data: cycle, error: cye }, { data: reviews, error: re }, { data: changes, error: che }] =
    await Promise.all([
      ctx.supabase.from('performance_cycles')
        .select('id, name, period_start, period_end, status')
        .eq('organization_id', ctx.org.organizationId).eq('id', cycleId).maybeSingle(),

      ctx.supabase.from('performance_reviews').select(REVIEW_SELECT)
        .eq('organization_id', ctx.org.organizationId).eq('cycle_id', cycleId)
        .limit(1000),

      ctx.supabase.from('review_calibrations')
        .select('review_id, previous_rating, new_rating, reason, created_at')
        .eq('organization_id', ctx.org.organizationId)
        .order('created_at', { ascending: false })
        .limit(1000),
    ]);

  if (cye) return pgError(cye);
  if (re) return pgError(re);
  if (che) return pgError(che);
  if (!cycle) return error('No such cycle.', 404, 'NOT_FOUND');

  const rows = (reviews ?? []) as any[];
  const rated = rows.filter(r => r.overall_rating != null);

  /**
   * How many changes each review has already been through.
   *
   * Counted from every calibration row this reader can see and then narrowed
   * to these reviews, rather than filtered in the query by a list of ids —
   * `.in()` with a thousand uuids is a query nobody should write, and the
   * table is small because it only gains a row when somebody moves a settled
   * rating.
   */
  const inCycle = new Set(rows.map(r => r.id));
  const changeCount = new Map<string, number>();
  for (const c of (changes ?? []) as any[]) {
    if (!inCycle.has(c.review_id)) continue;
    changeCount.set(c.review_id, (changeCount.get(c.review_id) ?? 0) + 1);
  }

  const mean = rated.length
    ? Math.round((rated.reduce((s, r) => s + r.overall_rating, 0) / rated.length) * 100) / 100
    : null;

  /** The whole-population count, by rating. */
  const distribution = RATINGS.map(rating => ({
    rating,
    count: rated.filter(r => r.overall_rating === rating).length,
  }));

  /** The same, per department, so two managers can compare like with like. */
  const byDepartment = [...new Map(
    rows.map(r => [r.member?.department?.id ?? 'none',
      r.member?.department?.name ?? 'No department']),
  )].map(([id, name]) => {
    const mine = rated.filter(r => (r.member?.department?.id ?? 'none') === id);
    return {
      departmentId: id === 'none' ? null : id,
      department: name,
      reviewed: rows.filter(r => (r.member?.department?.id ?? 'none') === id).length,
      rated: mine.length,
      mean: mine.length
        ? Math.round((mine.reduce((s, r) => s + r.overall_rating, 0) / mine.length) * 100) / 100
        : null,
      distribution: RATINGS.map(rating => ({
        rating, count: mine.filter(r => r.overall_rating === rating).length,
      })),
    };
  }).sort((a, b) => a.department.localeCompare(b.department));

  return success({
    cycle: {
      id: cycle.id, name: cycle.name,
      periodStart: cycle.period_start, periodEnd: cycle.period_end,
      status: cycle.status,
    },
    /**
     * Whose numbers these are.
     *
     * HR reads the organisation; a manager reads their own people, because
     * that is what RLS returned. Without this the same screen would show a
     * departmental distribution and a company-wide one identically, and a
     * manager would calibrate against a population they were only seeing part
     * of.
     */
    scope: ['owner', 'administrator', 'hr_staff'].includes(ctx.org.role)
      ? 'organization' : 'visible',
    counts: {
      reviews: rows.length,
      rated: rated.length,
      unrated: rows.length - rated.length,
      shared: rows.filter(r => r.shared_at).length,
      closed: rows.filter(r => r.closed_at).length,
      adjusted: [...changeCount.keys()].length,
    },
    mean,
    distribution,
    byDepartment,
    reviews: rows.map(r => ({
      id: r.id,
      status: r.status,
      overallRating: r.overall_rating,
      promotionReadiness: r.promotion_readiness,
      readinessNote: r.readiness_note ?? '',
      sharedAt: r.shared_at,
      closedAt: r.closed_at,
      timesAdjusted: changeCount.get(r.id) ?? 0,
      member: {
        id: r.member_id,
        name: r.member?.profiles?.full_name ?? 'Unknown member',
        jobTitle: r.member?.profiles?.job_title ?? null,
        avatarUrl: r.member?.profiles?.avatar_url ?? null,
        department: r.member?.department?.name ?? null,
      },
      reviewer: r.reviewer?.profiles?.full_name ?? null,
    })),
  });
}
