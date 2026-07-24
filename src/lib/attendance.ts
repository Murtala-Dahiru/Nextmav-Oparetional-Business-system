/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Attendance rules.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Kept separate from the route handlers because these are policy decisions, not
 * transport concerns: what counts as late, when a day is a working day, how a
 * day is classified when someone never checked in. They belong in one place so
 * the check-in endpoint, the reporting endpoint and the dashboard widget all
 * agree — three implementations of "late" is how attendance reports start
 * disagreeing with payroll.
 */

export const ATTENDANCE_STATUSES = [
  'present', 'late', 'absent', 'on_leave', 'remote', 'holiday',
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/**
 * Organisation working-hours policy.
 *
 * Hard-coded for now but shaped as configuration so it can move to the Setting
 * table without changing any caller.
 */
export interface WorkPolicy {
  /** Local start of the working day, minutes from midnight. 09:00 = 540. */
  startMinute: number;
  /** Local end of the working day. 17:30 = 1050. */
  endMinute: number;
  /** Grace period before a check-in counts as late. */
  graceMinutes: number;
  /** Unpaid break deducted from a full day. */
  breakMinutes: number;
  /** Days of the week that are working days. 0 = Sunday. */
  workingDays: number[];
  /** Below this many worked minutes a day is "half day" for reporting. */
  halfDayThresholdMinutes: number;
}

export const DEFAULT_WORK_POLICY: WorkPolicy = {
  startMinute: 9 * 60,
  endMinute: 17 * 60 + 30,
  graceMinutes: 10,
  breakMinutes: 30,
  workingDays: [1, 2, 3, 4, 5],
  halfDayThresholdMinutes: 4 * 60,
};

/** Midnight of the working day a timestamp belongs to. */
export function workingDayOf(when: Date): Date {
  return new Date(when.getFullYear(), when.getMonth(), when.getDate());
}

export function isWorkingDay(day: Date, policy: WorkPolicy = DEFAULT_WORK_POLICY): boolean {
  return policy.workingDays.includes(day.getDay());
}

/** Minutes from local midnight. */
function minuteOfDay(when: Date): number {
  return when.getHours() * 60 + when.getMinutes();
}

/**
 * How late a check-in was, in minutes. Zero when within the grace period.
 *
 * Grace exists because an attendance system that flags someone at 09:01 is one
 * people learn to game or resent; the policy should match how the organisation
 * actually behaves.
 */
export function lateMinutesFor(checkInAt: Date, policy: WorkPolicy = DEFAULT_WORK_POLICY): number {
  const diff = minuteOfDay(checkInAt) - (policy.startMinute + policy.graceMinutes);
  return diff > 0 ? diff : 0;
}

/** Status implied by a check-in time alone. */
export function statusForCheckIn(
  checkInAt: Date,
  opts: { remote?: boolean } = {},
  policy: WorkPolicy = DEFAULT_WORK_POLICY,
): AttendanceStatus {
  if (opts.remote) return 'remote';
  return lateMinutesFor(checkInAt, policy) > 0 ? 'late' : 'present';
}

/**
 * Worked minutes between check-in and check-out, less the unpaid break.
 *
 * Returns 0 rather than a negative number if the times are inverted; the caller
 * validates ordering and should reject that case with a clear message instead
 * of storing nonsense.
 */
export function workedMinutesBetween(
  checkInAt: Date,
  checkOutAt: Date,
  policy: WorkPolicy = DEFAULT_WORK_POLICY,
): number {
  const gross = Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60_000);
  if (gross <= 0) return 0;
  // Only deduct a break from a shift long enough to have taken one.
  const net = gross > policy.breakMinutes * 2 ? gross - policy.breakMinutes : gross;
  return Math.max(0, net);
}

export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0h 00m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  on_leave: 'On leave',
  remote: 'Remote',
  holiday: 'Holiday',
};

/**
 * Summarise a set of records for reporting.
 *
 * `expectedDays` is passed in rather than derived, because "how many days
 * should this person have worked" depends on the period being reported and on
 * approved leave — the caller knows both.
 */
export interface AttendanceSummary {
  daysRecorded: number;
  present: number;
  late: number;
  absent: number;
  onLeave: number;
  remote: number;
  totalMinutes: number;
  averageMinutes: number;
  totalLateMinutes: number;
  /** Share of expected working days actually attended, 0–100. */
  attendanceRate: number;
  punctualityRate: number;
}

export function summarise(
  records: { status: string; workedMinutes: number; lateMinutes: number }[],
  expectedDays: number,
): AttendanceSummary {
  const count = (s: string) => records.filter(r => r.status === s).length;

  const present = count('present');
  const late = count('late');
  const remote = count('remote');
  const attended = present + late + remote;
  const totalMinutes = records.reduce((sum, r) => sum + r.workedMinutes, 0);

  const pct = (part: number, whole: number) =>
    whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

  return {
    daysRecorded: records.length,
    present,
    late,
    absent: count('absent'),
    onLeave: count('on_leave'),
    remote,
    totalMinutes,
    averageMinutes: attended > 0 ? Math.round(totalMinutes / attended) : 0,
    totalLateMinutes: records.reduce((sum, r) => sum + r.lateMinutes, 0),
    attendanceRate: pct(attended, expectedDays),
    // Punctuality is measured against days actually attended, not expected
    // days — otherwise being on leave would look like being unpunctual.
    punctualityRate: pct(present + remote, attended),
  };
}

/** Working days in a period, excluding weekends per policy. */
export function workingDaysBetween(
  from: Date,
  to: Date,
  policy: WorkPolicy = DEFAULT_WORK_POLICY,
): number {
  let n = 0;
  const cursor = workingDayOf(from);
  const end = workingDayOf(to);
  while (cursor <= end) {
    if (isWorkingDay(cursor, policy)) n++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return n;
}
