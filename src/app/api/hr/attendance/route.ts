import { authorize, pgError } from '@/lib/auth-context';
import { success, error, paginated } from '@/lib/api-response';

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

  const today = new Date();
  const from =
    searchParams.get('from') ??
    new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const to = searchParams.get('to') ?? today.toISOString().slice(0, 10);

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
  if (status) rows = rows.eq('status', status);
  const memberId = searchParams.get('memberId');
  if (memberId) rows = rows.eq('member_id', memberId);

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

  return paginated(data ?? [], count ?? 0, page, pageSize);
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
    const b = await req.json();
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
