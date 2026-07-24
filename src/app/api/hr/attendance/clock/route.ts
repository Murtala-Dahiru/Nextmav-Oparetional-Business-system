import { db } from '@/lib/db';
import { success, error } from '@/lib/api-response';
import { authorize } from '@/lib/auth-context';
import {
  workingDayOf, statusForCheckIn, lateMinutesFor, workedMinutesBetween,
  DEFAULT_WORK_POLICY,
} from '@/lib/attendance';

const RECORD_INCLUDE = {
  user: { select: { id: true, firstName: true, lastName: true, department: true } },
} as const;

/**
 * Today's attendance state for the signed-in user.
 *
 * The clock widget needs to know which action to offer, so this returns the
 * record plus the two booleans that drive the UI rather than making the client
 * re-derive them (and risk disagreeing with the server).
 */
export async function GET() {
  const guard = await authorize('hr', 'view');
  if (guard instanceof Response) return guard;

  const today = workingDayOf(new Date());

  const [record, leave] = await Promise.all([
    db.attendanceRecord.findUnique({
      where: { userId_date: { userId: guard.user.id, date: today } },
      include: RECORD_INCLUDE,
    }),
    // Approved leave covering today — someone on authorised absence must not
    // be prompted to clock in, and must not later be reported as absent.
    db.leaveRequest.findFirst({
      where: {
        requesterId: guard.user.id,
        status: 'approved',
        startDate: { lte: today },
        endDate: { gte: today },
      },
      select: { id: true, type: true, startDate: true, endDate: true },
    }),
  ]);

  return success({
    date: today.toISOString(),
    record,
    onLeave: leave,
    canCheckIn: !record?.checkInAt && !leave,
    canCheckOut: !!record?.checkInAt && !record?.checkOutAt,
    policy: {
      startMinute: DEFAULT_WORK_POLICY.startMinute,
      endMinute: DEFAULT_WORK_POLICY.endMinute,
      graceMinutes: DEFAULT_WORK_POLICY.graceMinutes,
    },
  });
}

/**
 * Clock in or out.
 *
 * `POST { action: "in" | "out" }`. The server supplies the timestamp — a
 * client-provided time would let anyone backdate their own attendance, which
 * defeats the purpose of recording it.
 */
export async function POST(req: Request) {
  const guard = await authorize('hr', 'create');
  if (guard instanceof Response) return guard;

  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const remote = body?.remote === true;
    const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : '';

    if (action !== 'in' && action !== 'out') {
      return error('action must be "in" or "out"', 422, 'VALIDATION_ERROR');
    }

    const now = new Date();
    const today = workingDayOf(now);
    const userId = guard.user.id;

    const record = await db.$transaction(async tx => {
      const existing = await tx.attendanceRecord.findUnique({
        where: { userId_date: { userId, date: today } },
      });

      if (action === 'in') {
        if (existing?.checkInAt) {
          throw Object.assign(
            new Error('You have already checked in today.'),
            { status: 409, code: 'ALREADY_CHECKED_IN' },
          );
        }

        // Authorised absence beats attendance: clocking in on approved leave
        // is almost always a mistake, and silently allowing it corrupts both
        // the leave balance and the attendance report.
        const leave = await tx.leaveRequest.findFirst({
          where: {
            requesterId: userId,
            status: 'approved',
            startDate: { lte: today },
            endDate: { gte: today },
          },
          select: { type: true },
        });
        if (leave) {
          throw Object.assign(
            new Error(`You are on approved ${leave.type} leave today, so there is nothing to clock in to.`),
            { status: 409, code: 'ON_LEAVE' },
          );
        }

        return tx.attendanceRecord.create({
          data: {
            userId,
            date: today,
            checkInAt: now,
            status: statusForCheckIn(now, { remote }),
            lateMinutes: lateMinutesFor(now),
            note,
          },
          include: RECORD_INCLUDE,
        });
      }

      // action === 'out'
      if (!existing?.checkInAt) {
        throw Object.assign(
          new Error('You have not checked in today, so there is nothing to check out of.'),
          { status: 409, code: 'NOT_CHECKED_IN' },
        );
      }
      if (existing.checkOutAt) {
        throw Object.assign(
          new Error('You have already checked out today.'),
          { status: 409, code: 'ALREADY_CHECKED_OUT' },
        );
      }
      if (now <= existing.checkInAt) {
        throw Object.assign(
          new Error('Check-out cannot be earlier than check-in.'),
          { status: 409, code: 'INVALID_INTERVAL' },
        );
      }

      return tx.attendanceRecord.update({
        where: { id: existing.id },
        data: {
          checkOutAt: now,
          // Computed from the stored check-in, never from the request.
          workedMinutes: workedMinutesBetween(existing.checkInAt, now),
          breakMinutes: DEFAULT_WORK_POLICY.breakMinutes,
          ...(note ? { note } : {}),
        },
        include: RECORD_INCLUDE,
      });
    });

    return success(record, undefined, action === 'in' ? 201 : 200);
  } catch (e: any) {
    if (e.status) return error(e.message, e.status, e.code);
    if (e.code === 'P2002') return error('An attendance record already exists for today.', 409);
    return error(e.message || 'Clock action failed', 500);
  }
}
