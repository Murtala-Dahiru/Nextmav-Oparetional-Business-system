import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

/**
 * The company holiday calendar.
 *
 * ── Why this is not a cosmetic setting ────────────────────────────────────
 *
 * `organizations.work_days` covered the weekly pattern, so weekends were
 * handled — but a public holiday was an ordinary working day as far as the
 * system was concerned. Approving leave across Christmas consumed the
 * employee's entitlement for it, and the attendance register recorded a day
 * that nobody attended because the office was shut.
 *
 * Adding a date here changes both immediately: `is_working_day()` is the
 * single definition both the leave trigger and the attendance reporting read.
 * That is the difference between a setting and a preference.
 *
 * ── Access ────────────────────────────────────────────────────────────────
 *
 * Read by anyone — when the office is closed is not confidential, and the
 * attendance screen shows it to everybody. Written by admins only.
 */

export async function GET(req: Request) {
  // Guarded on `hr` rather than `admin`: every employee sees the holiday
  // calendar on their own attendance screen, and almost nobody has admin.
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);

  let q = ctx.supabase
    .from('holidays')
    .select('id, name, holiday_date, is_recurring, is_half_day, notes')
    .eq('organization_id', ctx.org.organizationId);

  /**
   * Narrowing to a year has to keep recurring holidays.
   *
   * A recurring row stores the date it was first entered — Christmas added in
   * 2024 is stored as 2024-12-25 — so a plain date-range filter would drop it
   * from every subsequent year's calendar, which is precisely the year anyone
   * is looking at.
   */
  const year = searchParams.get('year');
  if (year && /^\d{4}$/.test(year)) {
    q = q.or(`is_recurring.eq.true,and(holiday_date.gte.${year}-01-01,holiday_date.lte.${year}-12-31)`);
  }

  const { data, error: e } = await q.order('holiday_date');
  if (e) return pgError(e);

  /**
   * Recurring holidays are projected onto the requested year.
   *
   * Done here rather than by the client so that every consumer — the
   * attendance screen, the leave form, a future payroll export — sees the same
   * resolved list rather than each reimplementing the recurrence rule.
   */
  const rows = (data ?? []).map((h: any) => {
    if (!year || !h.is_recurring) return { ...h, observedDate: h.holiday_date };
    return { ...h, observedDate: `${year}${String(h.holiday_date).slice(4)}` };
  });

  return success(rows);
}

export async function POST(req: Request) {
  const ctx = await authorize('admin', 'manage');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());

    const name = String(b.name ?? '').trim();
    if (!name) return error('A holiday needs a name', 422, 'VALIDATION_ERROR');

    const date = String(b.holiday_date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return error('holidayDate must be a date, as YYYY-MM-DD', 422, 'VALIDATION_ERROR');
    }

    const { data, error: e } = await ctx.supabase
      .from('holidays')
      .insert({
        organization_id: ctx.org.organizationId,
        name,
        holiday_date: date,
        is_recurring: b.is_recurring === true,
        is_half_day: b.is_half_day === true,
        notes: b.notes ?? '',
      })
      .select('id, name, holiday_date, is_recurring, is_half_day, notes')
      .single();

    if (e) {
      if (e.code === '23505') {
        return error('There is already a holiday on that date.', 409, 'DUPLICATE_HOLIDAY');
      }
      return pgError(e);
    }
    return success(data, undefined, 201);
  } catch (e: any) {
    return serverError(e, 'Could not add the holiday');
  }
}
