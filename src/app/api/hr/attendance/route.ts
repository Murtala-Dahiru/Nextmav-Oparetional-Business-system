import { db } from '@/lib/db';
import { success, error, paginated } from '@/lib/api-response';
import { authorize, scopeWhere } from '@/lib/auth-context';
import { can } from '@/lib/permissions';
import {
  workingDayOf, workingDaysBetween, summarise, DEFAULT_WORK_POLICY,
  ATTENDANCE_STATUSES, statusForCheckIn, lateMinutesFor, workedMinutesBetween,
} from '@/lib/attendance';

const RECORD_INCLUDE = {
  user: { select: { id: true, firstName: true, lastName: true, department: true, jobTitle: true, avatar: true } },
  adjustedBy: { select: { id: true, firstName: true, lastName: true } },
} as const;

/**
 * The attendance register, plus a summary of the same period.
 *
 * Returning the summary alongside the rows means the header figures and the
 * table can never disagree — they are computed from one query in one request.
 *
 * `?from=&to=` bound the period (defaults to the current month), `?userId=`
 * narrows to one person, `?status=` filters.
 */
export async function GET(req: Request) {
  const guard = await authorize('hr', 'view');
  if (guard instanceof Response) return guard;

  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(searchParams.get('pageSize')) || 31));

    const now = new Date();
    const from = searchParams.get('from')
      ? workingDayOf(new Date(searchParams.get('from')!))
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = searchParams.get('to')
      ? workingDayOf(new Date(searchParams.get('to')!))
      : workingDayOf(now);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return error('Invalid from/to date', 422, 'VALIDATION_ERROR');
    }
    if (from > to) return error('`from` must be on or before `to`', 422, 'VALIDATION_ERROR');

    // Attendance is personal data: an employee resolves only their own rows, a
    // manager their department's, HR the organisation's.
    const scoped = scopeWhere(guard, { ownerField: 'userId' });

    const where: any = { ...scoped, date: { gte: from, lte: to } };

    const status = searchParams.get('status');
    if (status && (ATTENDANCE_STATUSES as readonly string[]).includes(status)) {
      where.status = status;
    }

    // A caller may narrow to one person but never widen past their own scope.
    const requestedUser = searchParams.get('userId');
    if (requestedUser && guard.scope !== 'own') where.userId = requestedUser;

    // Department scope has no column on this model, so resolve the department's
    // members and filter by them.
    if (guard.scope === 'department') {
      const peers = await db.user.findMany({
        where: { department: guard.user.department },
        select: { id: true },
      });
      const ids = peers.map(p => p.id);
      where.userId = requestedUser && ids.includes(requestedUser)
        ? requestedUser
        : { in: ids.length ? ids : [guard.user.id] };
    }

    const [rows, total, allInPeriod] = await Promise.all([
      db.attendanceRecord.findMany({
        where,
        orderBy: [{ date: 'desc' }, { checkInAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: RECORD_INCLUDE,
      }),
      db.attendanceRecord.count({ where }),
      // Summary must cover the whole period, not just the current page.
      db.attendanceRecord.findMany({
        where,
        select: { status: true, workedMinutes: true, lateMinutes: true, userId: true },
      }),
    ]);

    // Expected working days: calendar working days per person in scope.
    const distinctPeople = new Set(allInPeriod.map(r => r.userId)).size || 1;
    const expected = workingDaysBetween(from, to) * distinctPeople;

    const summary = summarise(allInPeriod, expected);

    return success(rows, {
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      ...(summary as any),
      from: from.toISOString(),
      to: to.toISOString(),
      people: distinctPeople,
      expectedDays: expected,
    } as any);
  } catch (e: any) {
    return error(e.message || 'Failed to load attendance', 500);
  }
}

/**
 * Create or correct an attendance record on someone's behalf.
 *
 * This is the manual path HR needs for the cases a clock cannot cover: someone
 * forgot to clock out, worked offsite, or was absent and it must be recorded.
 * It requires `edit` (not `create`), because writing attendance for another
 * person is a supervisory act — and the adjustment is attributed so a corrected
 * record never looks like a clocked one.
 */
export async function POST(req: Request) {
  const guard = await authorize('hr', 'edit');
  if (guard instanceof Response) return guard;

  try {
    const body = await req.json();
    const { userId, date, checkInAt, checkOutAt, status, note } = body ?? {};

    if (!userId || !date) return error('userId and date are required', 422, 'VALIDATION_ERROR');
    if (status && !(ATTENDANCE_STATUSES as readonly string[]).includes(status)) {
      return error(`status must be one of: ${ATTENDANCE_STATUSES.join(', ')}`, 422, 'VALIDATION_ERROR');
    }

    const day = workingDayOf(new Date(date));
    if (Number.isNaN(day.getTime())) return error('Invalid date', 422, 'VALIDATION_ERROR');

    // Managers may only adjust their own department.
    if (guard.scope !== 'organization') {
      const subject = await db.user.findUnique({ where: { id: userId }, select: { department: true } });
      if (!subject) return error('Employee not found', 404);
      if (guard.scope === 'own' && userId !== guard.user.id) {
        return error('You may only record your own attendance.', 403, 'FORBIDDEN_SCOPE');
      }
      if (guard.scope === 'department' && subject.department !== guard.user.department) {
        return error('You may only adjust attendance within your department.', 403, 'FORBIDDEN_SCOPE');
      }
    }

    const inAt = checkInAt ? new Date(checkInAt) : null;
    const outAt = checkOutAt ? new Date(checkOutAt) : null;
    if (inAt && outAt && outAt <= inAt) {
      return error('Check-out must be after check-in.', 422, 'INVALID_INTERVAL');
    }

    const resolvedStatus =
      status ?? (inAt ? statusForCheckIn(inAt) : 'absent');

    const data = {
      userId,
      date: day,
      checkInAt: inAt,
      checkOutAt: outAt,
      status: resolvedStatus,
      workedMinutes: inAt && outAt ? workedMinutesBetween(inAt, outAt) : 0,
      breakMinutes: inAt && outAt ? DEFAULT_WORK_POLICY.breakMinutes : 0,
      lateMinutes: inAt ? lateMinutesFor(inAt) : 0,
      note: typeof note === 'string' ? note.slice(0, 500) : '',
      adjustedById: guard.user.id,
      adjustedAt: new Date(),
    };

    const record = await db.attendanceRecord.upsert({
      where: { userId_date: { userId, date: day } },
      update: data,
      create: data,
      include: RECORD_INCLUDE,
    });

    return success(record, undefined, 201);
  } catch (e: any) {
    if (e.code === 'P2003') return error('That employee does not exist', 400);
    return error(e.message || 'Failed to record attendance', 500);
  }
}
