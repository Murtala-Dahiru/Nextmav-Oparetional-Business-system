'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Clock, LogIn, LogOut, CheckCircle2, AlertTriangle, CalendarOff,
  Loader2, Wifi, TrendingUp, Users, CalendarDays, Pencil, History, ShieldAlert,
} from 'lucide-react';

import { PageHeader } from '@/components/shared/page-header';
import { ExportButton } from '@/components/shared/export-button';
import { StatCard } from '@/components/shared/stat-card';
import { EmptyState } from '@/components/shared/empty-state';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { formatDate } from '@/lib/format';
import { useAppStore } from '@/store/app-store';
import { useModuleRealtime } from '@/hooks/use-realtime';
import {
  formatDuration, STATUS_LABELS, ATTENDANCE_STATUSES, type AttendanceStatus,
} from '@/lib/attendance';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A row of `/api/hr/attendance`.
 *
 * These are the column names the endpoint actually returns. The previous shape
 * — `date`, `checkInAt`, `checkOutAt`, a flat `user` — matched none of them,
 * and the register groups rows with `r.workDate.slice(0, 10)`. With `date`
 * undefined that threw during render, the module error boundary caught it, and
 * the whole tab was replaced by the "Loading HR enterprise environment…"
 * placeholder.
 *
 * It presented as a check-in bug because checking in is what triggered the
 * refetch: on an empty register there were no rows to group and nothing threw,
 * so the crash only appeared once the first record existed.
 */
interface AttendanceRecord {
  id: string; memberId: string; workDate: string;
  checkedInAt: string | null; checkedOutAt: string | null;
  status: AttendanceStatus; workedMinutes: number; lateMinutes: number; earlyMinutes: number;
  note: string; adjustedAt: string | null; adjustmentReason: string | null; adjustedBy: string | null;
  member?: {
    id: string;
    departmentId: string | null;
    profiles?: { fullName: string; avatarUrl: string | null };
    department?: { id: string; name: string } | null;
  };
  adjuster?: { id: string; profiles?: { fullName: string } } | null;
}

interface Summary {
  total: number; page: number; pageSize: number; totalPages: number;
  daysRecorded: number; present: number; late: number; early: number; halfDay: number;
  absent: number; onLeave: number; remote: number; attended: number;
  totalMinutes: number; averageMinutes: number;
  totalLateMinutes: number; attendanceRate: number; punctualityRate: number;
  from: string; to: string; people: number; expectedDays: number;
}

interface ClockState {
  date: string;
  record: AttendanceRecord | null;
  onLeave: { id: string; type: string } | null;
  canCheckIn: boolean;
  canCheckOut: boolean;
}

/** One row of `attendance_adjustments` — what a correction changed. */
interface Adjustment {
  id: string; workDate: string; reason: string; createdAt: string;
  previousStatus: AttendanceStatus | null;
  previousCheckedInAt: string | null; previousCheckedOutAt: string | null; previousWorkedMinutes: number | null;
  newStatus: AttendanceStatus;
  newCheckedInAt: string | null; newCheckedOutAt: string | null; newWorkedMinutes: number;
  adjuster?: { id: string; profiles?: { fullName: string; avatarUrl: string | null } } | null;
}

const STATUS_STYLES: Record<AttendanceStatus, string> = {
  present: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  early: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  late: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  half_day: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  absent: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  on_leave: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  remote: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  holiday: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? 'Request failed');
  return json;
}

const timeOf = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';

const dateTimeOf = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

/** Current month as an ISO date, for the default period. */
function monthBounds() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: first.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}

// ═══════════════════════════════════════════════════════════════════════════
//  My day — the clock
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Personal clock. Deliberately the first thing in the tab: for most employees
 * this is the only part of attendance they ever touch, and burying it under a
 * company-wide register would be backwards.
 */
function MyDay({ onChanged }: { onChanged: () => void }) {
  const [state, setState] = useState<ClockState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    try {
      const res = await api<{ data: ClockState }>('/api/hr/attendance/clock');
      setState(res.data);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // A live clock makes the elapsed figure trustworthy; without it the card
  // silently goes stale and people assume the whole feature is broken.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 30);
    return () => clearInterval(t);
  }, []);

  /**
   * Live, not just self-triggered.
   *
   * `onChanged` covers this device's own click. It does not cover a manager
   * correcting today's row from the register while the employee's clock card
   * is open, or a second device this same person is also signed into — both
   * of which used to require a manual reload to notice. `attendance_records`
   * has carried REPLICA IDENTITY FULL and a place in the publication since
   * 0006; nothing before this subscribed to it.
   */
  useModuleRealtime('hr-attendance-clock', ['attendance_records'], load);

  const act = async (action: 'in' | 'out', remote = false) => {
    setBusy(true);
    try {
      await api('/api/hr/attendance/clock', {
        method: 'POST',
        body: JSON.stringify({ action, remote }),
      });
      toast.success(action === 'in' ? 'Checked in' : 'Checked out');
      await load();
      onChanged();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <Card><CardContent className="flex h-[128px] items-center justify-center">
      <Loader2 className="text-muted-foreground size-5 animate-spin" />
    </CardContent></Card>;
  }
  if (!state) return null;

  const rec = state.record;
  const elapsed = rec?.checkedInAt && !rec.checkedOutAt
    ? Math.max(0, Math.round((now.getTime() - new Date(rec.checkedInAt).getTime()) / 60_000))
    : rec?.workedMinutes ?? 0;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${
            state.onLeave ? 'bg-sky-500/10 text-sky-600'
              : rec?.checkedOutAt ? 'bg-gray-500/10 text-gray-500'
                : rec?.checkedInAt ? 'bg-emerald-500/10 text-emerald-600'
                  : 'bg-amber-500/10 text-amber-600'
          }`}>
            {state.onLeave ? <CalendarOff className="size-5" /> : <Clock className="size-5" />}
          </div>
          <div>
            <p className="text-sm font-semibold">
              {state.onLeave
                ? `On approved ${state.onLeave.type} leave`
                : rec?.checkedOutAt ? 'Day complete'
                  : rec?.checkedInAt ? 'Currently checked in'
                    : 'Not checked in yet'}
            </p>
            <p className="text-muted-foreground text-xs">
              {formatDate(state.date, { weekday: 'long', day: 'numeric', month: 'long' })}
              {rec?.checkedInAt && ` · in ${timeOf(rec.checkedInAt)}`}
              {rec?.checkedOutAt && ` · out ${timeOf(rec.checkedOutAt)}`}
            </p>
            {rec && rec.lateMinutes > 0 && (
              <p className="mt-0.5 text-xs font-medium text-amber-600">
                {rec.lateMinutes} min late
              </p>
            )}
            {rec?.adjustedAt && (
              <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <History className="size-3" />
                Corrected by {rec.adjuster?.profiles?.fullName ?? 'HR'}
                {rec.adjustmentReason ? ` — ${rec.adjustmentReason}` : ''}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          {(rec?.checkedInAt || rec?.workedMinutes) && (
            <div className="text-right">
              <p className="text-muted-foreground text-xs">
                {rec?.checkedOutAt ? 'Worked' : 'Elapsed'}
              </p>
              <p className="text-xl font-semibold tabular-nums">{formatDuration(elapsed)}</p>
            </div>
          )}

          {state.canCheckIn && (
            <div className="flex gap-2">
              <Button onClick={() => act('in')} disabled={busy}
                className="bg-emerald-600 text-white hover:bg-emerald-700">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
                <span className="ml-2">Check in</span>
              </Button>
              <Button variant="outline" onClick={() => act('in', true)} disabled={busy} title="Check in as remote">
                <Wifi className="size-4" />
              </Button>
            </div>
          )}
          {state.canCheckOut && (
            <Button onClick={() => act('out')} disabled={busy} variant="outline">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
              <span className="ml-2">Check out</span>
            </Button>
          )}
          {!state.canCheckIn && !state.canCheckOut && !state.onLeave && (
            <Badge className={STATUS_STYLES.present}>
              <CheckCircle2 className="mr-1 size-3" /> Recorded
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  History — what a correction actually changed
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The audit trail for one record, read from `attendance_adjustments`.
 *
 * Available to anyone who can see the row it corrects — an employee reads
 * their own, exactly as `attendance_adjustments_select` (0046) permits — not
 * only to people who can make a correction. Being told your Tuesday was
 * changed, by whom and why, is the assurance this table exists to give the
 * person whose day it was, not a management convenience.
 */
function HistoryDialog({
  record, open, onOpenChange,
}: {
  record: AttendanceRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [rows, setRows] = useState<Adjustment[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (attendanceId: string) => {
    setLoading(true);
    try {
      const res = await api<{ data: Adjustment[] }>(`/api/hr/attendance/adjustments?attendanceId=${attendanceId}`);
      setRows(res.data);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && record) void load(record.id);
  }, [open, record, load]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Correction history</DialogTitle>
          <DialogDescription>
            {record?.member?.profiles?.fullName ? `${record.member.profiles.fullName} · ` : ''}
            {record ? formatDate(record.workDate, { day: 'numeric', month: 'long', year: 'numeric' }) : ''}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">No corrections recorded.</p>
        ) : (
          <div className="flex max-h-[360px] flex-col gap-3 overflow-y-auto">
            {rows.map(a => (
              <div key={a.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{a.adjuster?.profiles?.fullName ?? 'HR'}</span>
                  <span className="text-muted-foreground text-xs">{dateTimeOf(a.createdAt)}</span>
                </div>
                <p className="text-muted-foreground mt-1 text-xs italic">"{a.reason}"</p>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div>
                    <span className="text-muted-foreground">Before: </span>
                    {STATUS_LABELS[a.previousStatus ?? 'absent'] ?? '—'}
                    {a.previousCheckedInAt && ` · in ${timeOf(a.previousCheckedInAt)}`}
                    {a.previousCheckedOutAt && ` · out ${timeOf(a.previousCheckedOutAt)}`}
                  </div>
                  <div>
                    <span className="text-muted-foreground">After: </span>
                    {STATUS_LABELS[a.newStatus] ?? a.newStatus}
                    {a.newCheckedInAt && ` · in ${timeOf(a.newCheckedInAt)}`}
                    {a.newCheckedOutAt && ` · out ${timeOf(a.newCheckedOutAt)}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Attendance tab
// ═══════════════════════════════════════════════════════════════════════════

export default function AttendanceTab() {
  const { allows } = useAppStore();
  const canAdjust = allows('hr', 'edit');

  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(monthBounds);
  const [status, setStatus] = useState<string>('all');
  const [version, setVersion] = useState(0);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [editing, setEditing] = useState<AttendanceRecord | null>(null);
  const [form, setForm] = useState({ status: 'present', checkIn: '', checkOut: '', note: '', reason: '' });
  const [saving, setSaving] = useState(false);

  const [historyRecord, setHistoryRecord] = useState<AttendanceRecord | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ from: period.from, to: period.to, pageSize: '100' });
      if (status !== 'all') p.set('status', status);
      const res = await api<{ data: AttendanceRecord[]; meta: Summary }>(`/api/hr/attendance?${p}`);
      setRecords(res.data);
      setSummary(res.meta);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [period, status]);

  useEffect(() => { load(); }, [load, version]);

  /**
   * The whole register, live.
   *
   * A colleague checking in, a manager correcting a row, a leave approval
   * that reaches the same table — none of it used to touch a register that
   * was already open. `attendance_adjustments` is included so the "adjusted"
   * marker and the history dialog reflect a correction the moment it lands,
   * not on the next reload.
   */
  useModuleRealtime('hr-attendance-register', ['attendance_records', 'attendance_adjustments'], () => load());

  const openAdjust = (r: AttendanceRecord) => {
    setEditing(r);
    setForm({
      status: r.status,
      checkIn: r.checkedInAt ? new Date(r.checkedInAt).toISOString().slice(0, 16) : '',
      checkOut: r.checkedOutAt ? new Date(r.checkedOutAt).toISOString().slice(0, 16) : '',
      note: r.note ?? '',
      reason: '',
    });
    setAdjustOpen(true);
  };

  const openHistory = (r: AttendanceRecord) => {
    setHistoryRecord(r);
    setHistoryOpen(true);
  };

  const reasonMissing = adjustOpen && form.reason.trim() === '';

  const saveAdjust = async () => {
    if (!editing) return;
    if (reasonMissing) {
      toast.error('Say why this record is being corrected.');
      return;
    }
    setSaving(true);
    try {
      await api('/api/hr/attendance', {
        method: 'POST',
        body: JSON.stringify({
          memberId: editing.memberId,
          workDate: editing.workDate,
          status: form.status,
          /**
           * `checkedInAt` / `checkedOutAt`, not `checkInAt` / `checkOutAt`.
           *
           * `acceptBody` snake-cases a camelCase key by inserting an
           * underscore before every capital, so `checkInAt` becomes
           * `check_in_at` — a column that has never existed; the real one is
           * `checked_in_at`. This is what the dialog sent before this fix,
           * silently: the request succeeded, the status and note were saved,
           * and the two fields the form exists for were dropped on the floor
           * every time. No harness caught it because none of them typed into
           * this form — see `app:verify`'s own note about the gap between a
           * green harness and a screen a person actually used.
           */
          checkedInAt: form.checkIn ? new Date(form.checkIn).toISOString() : null,
          checkedOutAt: form.checkOut ? new Date(form.checkOut).toISOString() : null,
          note: form.note,
          adjustmentReason: form.reason.trim(),
        }),
      });
      toast.success('Attendance corrected');
      setAdjustOpen(false);
      setVersion(v => v + 1);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  // Group by day so the register reads like a register rather than a flat log.
  const byDay = useMemo(() => {
    const map = new Map<string, AttendanceRecord[]>();
    for (const r of records) {
      // Guarded rather than assumed. This line is what took the module down
      // when the field was named differently to the response, and a row with
      // no date is a row to leave out of the register — not a reason for the
      // whole tab to be replaced by an error placeholder.
      if (!r.workDate) continue;
      const key = String(r.workDate).slice(0, 10);
      (map.get(key) ?? map.set(key, []).get(key)!).push(r);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [records]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Attendance"
        description="Clock in and out, review the register, and correct records."
        icon={Clock}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={period.from} className="h-9 w-[150px]"
            onChange={e => setPeriod(p => ({ ...p, from: e.target.value }))} />
          <span className="text-muted-foreground text-xs">to</span>
          <Input type="date" value={period.to} className="h-9 w-[150px]"
            onChange={e => setPeriod(p => ({ ...p, to: e.target.value }))} />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {ATTENDANCE_STATUSES.map(s => (
                <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ExportButton module="hr" datasets={[{ key: 'attendance', label: 'Attendance' }]} />
        </div>
      </PageHeader>

      <MyDay onChanged={() => setVersion(v => v + 1)} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Attendance rate" value={`${summary?.attendanceRate ?? 0}%`} icon={TrendingUp} />
        <StatCard label="Punctuality" value={`${summary?.punctualityRate ?? 0}%`} icon={CheckCircle2} />
        <StatCard label="Hours logged" value={formatDuration(summary?.totalMinutes ?? 0)} icon={Clock} />
        <StatCard label="Late arrivals" value={summary?.late ?? 0} icon={AlertTriangle} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        </div>
      ) : byDay.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No attendance in this period"
          description="Records appear here once people check in, or once a manager records them."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {byDay.map(([day, rows]) => (
            <div key={day} className="overflow-hidden rounded-lg border bg-card">
              <div className="bg-muted/40 flex items-center justify-between border-b px-4 py-2">
                <span className="text-sm font-medium">
                  {formatDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}
                </span>
                <span className="text-muted-foreground text-xs">
                  {rows.length} record{rows.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-b text-xs">
                      <th className="p-3 text-left font-medium">Employee</th>
                      <th className="p-3 text-left font-medium">Department</th>
                      <th className="p-3 text-left font-medium">In</th>
                      <th className="p-3 text-left font-medium">Out</th>
                      <th className="p-3 text-left font-medium">Worked</th>
                      <th className="p-3 text-left font-medium">Status</th>
                      <th className="p-3 text-right font-medium">
                        {canAdjust ? 'Adjust' : ''}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.id} className="hover:bg-accent/30 border-b last:border-0">
                        <td className="p-3 font-medium">
                          {r.member?.profiles?.fullName || '—'}
                        </td>
                        <td className="text-muted-foreground p-3">
                          {r.member?.department?.name ?? '—'}
                        </td>
                        <td className="p-3 tabular-nums">{timeOf(r.checkedInAt)}</td>
                        <td className="p-3 tabular-nums">{timeOf(r.checkedOutAt)}</td>
                        <td className="p-3 tabular-nums">{formatDuration(r.workedMinutes)}</td>
                        <td className="p-3">
                          <Badge className={STATUS_STYLES[r.status] ?? STATUS_STYLES.holiday}>
                            {STATUS_LABELS[r.status] ?? r.status}
                          </Badge>
                          {r.lateMinutes > 0 && (
                            <span className="ml-1.5 text-xs text-amber-600">+{r.lateMinutes}m</span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {r.adjustedAt && (
                              <Button variant="ghost" size="icon" className="text-muted-foreground size-8"
                                onClick={() => openHistory(r)} aria-label="View correction history"
                                title={`Corrected by ${r.adjuster?.profiles?.fullName ?? 'HR'}`}>
                                <History className="size-3.5" />
                              </Button>
                            )}
                            {canAdjust && (
                              <Button variant="ghost" size="icon" className="size-8"
                                onClick={() => openAdjust(r)} aria-label="Adjust record">
                                <Pencil className="size-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {summary && summary.people > 1 && (
        <p className="text-muted-foreground text-xs">
          <Users className="mr-1 inline size-3" />
          {summary.people} people · {summary.expectedDays} expected working days in this period
        </p>
      )}

      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Correct attendance</DialogTitle>
            <DialogDescription>
              {editing?.member?.profiles?.fullName ? `${editing.member.profiles.fullName} · ` : ''}
              {editing ? formatDate(editing.workDate, { day: 'numeric', month: 'long', year: 'numeric' }) : ''}
              {' '}— the correction is recorded against your name, and the times it replaces are kept.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm font-medium">Status</Label>
              <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ATTENDANCE_STATUSES.map(s => (
                    <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-sm font-medium">Check in</Label>
                <Input type="datetime-local" value={form.checkIn}
                  onChange={e => setForm({ ...form, checkIn: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-sm font-medium">Check out</Label>
                <Input type="datetime-local" value={form.checkOut}
                  onChange={e => setForm({ ...form, checkOut: e.target.value })} />
              </div>
            </div>
            {/*
              Reason is separate from the note, and required.

              The note is the record's own free-text field — an employee may
              set it on their own row, and it can say something as ordinary as
              "worked from the Lagos office". The reason is the audit trail: it
              is kept forever in `attendance_adjustments`, next to who wrote it
              and when, and the database refuses the write without one.
              Conflating the two meant a correction's only trace of "why" was
              whatever happened to be sitting in a field nobody was required to
              fill in.
            */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm font-medium">
                Reason for this correction <span className="text-destructive">*</span>
              </Label>
              <Textarea rows={2} value={form.reason} placeholder="Forgot to clock out…"
                onChange={e => setForm({ ...form, reason: e.target.value })} />
              <p className="text-muted-foreground flex items-center gap-1 text-[11px]">
                <ShieldAlert className="size-3" />
                Kept permanently with this correction. Visible to {editing?.member?.profiles?.fullName || 'this person'}.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm font-medium">Note <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea rows={2} value={form.note} placeholder="Anything worth recording on the day itself…"
                onChange={e => setForm({ ...form, note: e.target.value })} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>Cancel</Button>
            <Button onClick={saveAdjust} disabled={saving || reasonMissing}
              className="bg-emerald-600 text-white hover:bg-emerald-700">
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save correction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <HistoryDialog record={historyRecord} open={historyOpen} onOpenChange={setHistoryOpen} />
    </div>
  );
}
