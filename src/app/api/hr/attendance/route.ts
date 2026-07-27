import { isFilterValue } from '@/lib/filters';
import { authorize, pgError } from '@/lib/auth-context';
import { success, error, paginated } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { workingDaysBetween } from '@/lib/attendance';
import { todayIn, startOfMonthIn } from '@/lib/org-time';

const SELECT =
  '*, member:organization_members!attendance_records_member_id_fkey(id, department_id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

/**
 * The attendance register, with a summary of the same period.
 *
 * Row visibility is enforced by RLS through `auth_visible_member_ids()`: an
 * employee resolves only their own rows, a manager their department's, HR the
 * organisation's. No filtering is applied here for that — attempting to would
 * duplicate the rule and eventually contradict it.
 *
 * The summary is computed over the whole period rather than the current page,
 * so the header figures do not change as you paginate.
 */
export async function GET(req: Request) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get('pageSize')) || 31));

  /**
   * The default window is this month, in the *organisation's* timezone.
   *
   * It was built from `new Date().toISOString()`, which is UTC. `work_date` is
   * written by `clock_in()` as `now() AT TIME ZONE organizations.timezone`, so
   * for any workspace east of UTC the two disagreed for part of every day: a
   * check-in at 00:20 in Lagos was stored against the 27th while `to` still
   * said the 26th, and today's attendance simply did not appear on the
   * register. The rows were there; the query did not reach them.
   */
  const from = searchParams.get('from') ?? startOfMonthIn(ctx.org.timezone);
  const to = searchParams.get('to') ?? todayIn(ctx.org.timezone);

  if (from > to) return error('`from` must be on or before `to`', 422, 'VALIDATION_ERROR');

  const base = () =>
    ctx.supabase
      .from('attendance_records')
      .select(SELECT, { count: 'exact' })
      .eq('organization_id', ctx.org.organizationId)
      .gte('work_date', from)
      .lte('work_date', to);

  let rows = base();
  const status = searchParams.get('status');
  if (isFilterValue(status)) rows = rows.eq('status', status);
  const memberId = searchParams.get('memberId');
  if (isFilterValue(memberId)) rows = rows.eq('member_id', memberId);

  const offset = (page - 1) * pageSize;
  const { data, count, error: e } = await rows
    .order('work_date', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (e) return pgError(e);

  // Separate unpaginated pass for the totals. Only the columns the summary
  // needs, so it stays cheap over a long period.
  const { data: all } = await ctx.supabase
    .from('attendance_records')
    .select('status, worked_minutes, late_minutes, member_id')
    .eq('organization_id', ctx.org.organizationId)
    .gte('work_date', from)
    .lte('work_date', to);

  const rowsAll = all ?? [];
  const countBy = (s: string) => rowsAll.filter(r => r.status === s).length;
  const attended = countBy('present') + countBy('late') + countBy('remote') + countBy('half_day');
  const totalMinutes = rowsAll.reduce((sum, r) => sum + (r.worked_minutes ?? 0), 0);
  const people = new Set(rowsAll.map(r => r.member_id)).size;

  const pct = (part: number, whole: number) =>
    whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

  /**
   * The summary was being computed and then dropped.
   *
   * Everything above this line was already here; `paginated()` was called
   * without it, so the figures were calculated on every request and thrown
   * away. The register's four headline cards — attendance rate, punctuality,
   * hours logged, late arrivals — read them from `meta` and therefore showed
   * zero no matter what the register contained.
   */
  /**
   * Expected working days, from the organisation's own calendar.
   *
   * `working_days_between()` reads `organizations.work_days` and the `holidays`
   * table, so changing the working week or adding a public holiday in the
   * administration screen changes this figure immediately — which is the whole
   * point of the setting. The TypeScript helper is the fallback and is
   * deliberately second: it carries a hard-coded Monday-to-Friday policy and
   * knows nothing about holidays, so using it as the primary source meant the
   * attendance rate was computed against a working week the organisation might
   * not have.
   */
  const { data: expected } = await ctx.supabase.rpc('working_days_between', {
    org: ctx.org.organizationId,
    from_date: from,
    to_date: to,
  });

  const expectedDays = typeof expected === 'number'
    ? expected
    : workingDaysBetween(new Date(from), new Date(to));
  const perPerson = people > 0 ? expectedDays * people : expectedDays;

  return paginated(data ?? [], count ?? 0, page, pageSize, {
    from,
    to,
    people,
    expectedDays,
    daysRecorded: rowsAll.length,
    present: countBy('present'),
    late: countBy('late'),
    absent: countBy('absent'),
    onLeave: countBy('on_leave'),
    remote: countBy('remote'),
    totalMinutes,
    averageMinutes: attended > 0 ? Math.round(totalMinutes / attended) : 0,
    totalLateMinutes: rowsAll.reduce((sum, r) => sum + (r.late_minutes ?? 0), 0),
    attendanceRate: pct(attended, perPerson),
    // Measured against days actually attended, not days expected — otherwise
    // approved leave would count as unpunctual.
    punctualityRate: pct(countBy('present') + countBy('remote'), attended),
  });
}

/**
 * Record or correct attendance on someone's behalf.
 *
 * The clock endpoints are the normal path; this covers what a clock cannot:
 * a forgotten check-out, offsite work, a recorded absence. It requires `edit`
 * rather than `create`, because writing attendance for another person is a
 * supervisory act, and every correction is attributed so an adjusted record
 * never masquerades as a clocked one.
 */
export async function POST(req: Request) {
  const ctx = await authorize('hr', 'edit');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());
    if (!b.member_id || !b.work_date) {
      return error('member_id and work_date are required', 422, 'VALIDATION_ERROR');
    }
    if (b.checked_in_at && b.checked_out_at && new Date(b.checked_out_at) <= new Date(b.checked_in_at)) {
      return error('Check-out must be after check-in.', 422, 'INVALID_INTERVAL');
    }

    const worked =
      b.checked_in_at && b.checked_out_at
        ? Math.max(
            0,
            Math.round(
              (new Date(b.checked_out_at).getTime() - new Date(b.checked_in_at).getTime()) / 60000,
            ),
          )
        : 0;

    const { data, error: e } = await ctx.supabase
      .from('attendance_records')
      .upsert(
        {
          organization_id: ctx.org.organizationId,
          member_id: b.member_id,
          work_date: b.work_date,
          checked_in_at: b.checked_in_at ?? null,
          checked_out_at: b.checked_out_at ?? null,
          status: b.status ?? (b.checked_in_at ? 'present' : 'absent'),
          worked_minutes: worked,
          note: b.note ?? '',
          // Marks this as a supervised correction. The server-time trigger
          // honours the supplied times only when this is set.
          adjusted_by: ctx.org.memberId,
          adjusted_at: new Date().toISOString(),
          adjustment_reason: b.adjustment_reason ?? b.note ?? '',
        },
        { onConflict: 'member_id,work_date' },
      )
      .select(SELECT)
      .single();

    if (e) return pgError(e);
    return success(data, undefined, 201);
  } catch (e: any) {
    return error(e.message || 'Failed to record attendance', 500);
  }
}
