'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Clock, LogIn, LogOut, CheckCircle2, CalendarOff,
  Loader2, Wifi, Users, Pencil, History, ShieldAlert,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { ExportButton } from '@/components/shared/export-button';
import { Card, Head, Stat, THead, TRow } from '@/components/shared/readout/primitives';
import { Button } from '@/components/ui/button';
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

import { PersonCell, Blank, Pill } from './ui';

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

/**
 * Eight statuses, five tones.
 *
 * ── Why this replaced eight hand-picked colour pairs ─────────────────────
 *
 * The previous version wrote out `bg-emerald-100 text-emerald-700
 * dark:bg-emerald-900/40 …` for each status — eight bespoke palettes that
 * belonged to no design system, invented here and used nowhere else in the
 * product. Two consequences, and the second is the one that mattered: nothing
 * kept them in step with the tokens the rest of HR uses, and a reader had to
 * learn that violet means remote on this screen and nothing anywhere else.
 *
 * `Pill`'s tones are the module's existing vocabulary. There are five, which
 * is fewer than eight on purpose: the colour says *how to feel* about a day
 * and the label says what it was. Present, early and remote are all "somebody
 * worked", and giving them three colours implied a distinction the register
 * does not make.
 */
const STATUS_TONE: Record<AttendanceStatus, 'quiet' | 'good' | 'warn' | 'bad' | 'accent'> = {
  present: 'good',
  early: 'good',
  remote: 'good',
  late: 'warn',
  half_day: 'warn',
  absent: 'bad',
  on_leave: 'accent',
  holiday: 'quiet',
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
    return (
      <Card>
        <div className="flex h-[128px] items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      </Card>
    );
  }
  if (!state) return null;

  const rec = state.record;
  const elapsed = rec?.checkedInAt && !rec.checkedOutAt
    ? Math.max(0, Math.round((now.getTime() - new Date(rec.checkedInAt).getTime()) / 60_000))
    : rec?.workedMinutes ?? 0;

  return (
    <Card>
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3.5">
          {/*
            The one place on this screen where a colour is doing real work.

            It answers "am I clocked in" from across a room, which is the
            question this card exists for. The tokens are the product's, not
            hand-picked Tailwind shades: the previous version used sky, gray,
            emerald and amber 500s that matched nothing else in HR.
          */}
          <div className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-lg',
            state.onLeave ? 'bg-[var(--chart-1)]/12 text-[var(--chart-1)]'
              : rec?.checkedOutAt ? 'bg-muted text-muted-foreground'
                : rec?.checkedInAt ? 'bg-success/12 text-success'
                  : 'bg-warning/12 text-warning',
          )}>
            {state.onLeave ? <CalendarOff className="size-5" /> : <Clock className="size-5" />}
          </div>
          <div>
            <p className="text-[13.5px] font-semibold text-foreground">
              {state.onLeave
                ? `On approved ${state.onLeave.type} leave`
                : rec?.checkedOutAt ? 'Day complete'
                  : rec?.checkedInAt ? 'Currently checked in'
                    : 'Not checked in yet'}
            </p>
            <p className="text-[11.5px] text-muted-foreground">
              {formatDate(state.date, { weekday: 'long', day: 'numeric', month: 'long' })}
              {rec?.checkedInAt && ` · in ${timeOf(rec.checkedInAt)}`}
              {rec?.checkedOutAt && ` · out ${timeOf(rec.checkedOutAt)}`}
            </p>
            {rec && rec.lateMinutes > 0 && (
              <p className="mt-0.5 text-[11.5px] font-medium text-warning">
                {rec.lateMinutes} min late
              </p>
            )}
            {rec?.adjustedAt && (
              <p className="mt-0.5 flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground">
                <History className="size-3" />
                Corrected by {rec.adjuster?.profiles?.fullName ?? 'HR'}
                {rec.adjustmentReason ? ` — ${rec.adjustmentReason}` : ''}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          {(rec?.checkedInAt || rec?.workedMinutes) && (
            <div className="text-right">
              <p className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground/85">
                {rec?.checkedOutAt ? 'Worked' : 'Elapsed'}
              </p>
              <p className="text-[19px] font-semibold leading-none tabular-nums tracking-[-0.02em]">
                {formatDuration(elapsed)}
              </p>
            </div>
          )}

          {state.canCheckIn && (
            /*
              The check-in control keeps its own emphasis, and only it.

              This is the one action on the screen somebody came here to
              perform, so it stays a filled button — but in the product's own
              primary treatment rather than a hard-coded emerald that appeared
              nowhere else and did not follow the theme.
            */
            <div className="flex gap-2">
              <Button onClick={() => act('in')} disabled={busy} className="gap-2">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
                Check in
              </Button>
              <Button
                variant="outline" onClick={() => act('in', true)} disabled={busy}
                title="Check in as remote" aria-label="Check in as remote"
              >
                <Wifi className="size-4" />
              </Button>
            </div>
          )}
          {state.canCheckOut && (
            <Button onClick={() => act('out')} disabled={busy} variant="outline" className="gap-2">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
              Check out
            </Button>
          )}
          {!state.canCheckIn && !state.canCheckOut && !state.onLeave && (
            <Pill tone="good">
              <CheckCircle2 className="mr-1 size-3" /> Recorded
            </Pill>
          )}
        </div>
      </div>
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
      {/*
        The module's own header, not the generic PageHeader.

        Every other HR tab opens with a title, a sentence and its controls on
        one line; this screen used a shared PageHeader with an icon block that
        appears nowhere else in HR, which is most of why it read as a different
        product from the tab beside it.
      */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-[-0.018em] text-foreground">Attendance</h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Clock in and out, review the register, and correct records.
          </p>
        </div>
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
      </div>

      <MyDay onChanged={() => setVersion(v => v + 1)} />

      {/*
        One divided strip rather than four floating cards.

        Four separate bordered cards with icons is the pattern this module
        replaced everywhere else: it spends a lot of ink on decoration and
        makes the four figures harder to read across, which is the only thing
        a row of figures is for.
      */}
      <Card>
        <div className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
          <Stat label="Attendance rate" value={`${summary?.attendanceRate ?? 0}%`} />
          <Stat label="Punctuality" value={`${summary?.punctualityRate ?? 0}%`} />
          <Stat label="Hours logged" value={formatDuration(summary?.totalMinutes ?? 0)} />
          <Stat
            label="Late arrivals"
            value={summary?.late ?? 0}
            tone={(summary?.late ?? 0) > 0 ? 'warning' : 'default'}
          />
        </div>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        </div>
      ) : byDay.length === 0 ? (
        <Card>
          <Blank
            title="No attendance in this period"
            note="Records appear here once people check in, or once a manager records them."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {byDay.map(([workDay, rows]) => (
            <Card key={workDay}>
              <div className="px-4 pt-3.5">
                <Head
                  title={formatDate(workDay, { weekday: 'long', day: 'numeric', month: 'long' })}
                  count={rows.length}
                />
              </div>

              {/*
                The module's own row grid, not a bare <table>.

                / are what every other list in HR uses, and they
                carry the behaviour a hand-rolled table here did not: a
                consistent hit area, the same hover treatment, and column
                hiding at narrow widths rather than a table that forces the
                page sideways on a phone.
              */}
              <div className="mt-2.5 px-2 pb-2">
                <THead columns="grid-cols-[minmax(0,1.6fr)_auto_auto] md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto_auto_auto_auto_auto]">
                  <span>Employee</span>
                  <span className="hidden md:block">Department</span>
                  <span className="hidden text-right md:block">In</span>
                  <span className="hidden text-right md:block">Out</span>
                  <span className="text-right">Worked</span>
                  <span className="text-right">Status</span>
                  <span className="hidden text-right md:block">{canAdjust ? 'Adjust' : ''}</span>
                </THead>

                {rows.map(r => (
                  <TRow
                    key={r.id}
                    columns="grid-cols-[minmax(0,1.6fr)_auto_auto] md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto_auto_auto_auto_auto]"
                  >
                    <PersonCell
                      id={r.member?.id ?? r.memberId}
                      name={r.member?.profiles?.fullName}
                      avatarUrl={r.member?.profiles?.avatarUrl}
                      secondary={r.member?.department?.name}
                    />
                    <span className="hidden truncate text-[12.5px] text-muted-foreground md:block">
                      {r.member?.department?.name ?? '—'}
                    </span>
                    <span className="hidden text-right text-[12.5px] tabular-nums text-muted-foreground md:block">
                      {timeOf(r.checkedInAt)}
                    </span>
                    <span className="hidden text-right text-[12.5px] tabular-nums text-muted-foreground md:block">
                      {timeOf(r.checkedOutAt)}
                    </span>
                    <span className="text-right text-[12.5px] tabular-nums text-foreground">
                      {formatDuration(r.workedMinutes)}
                    </span>
                    <span className="flex items-center justify-end gap-1.5">
                      <Pill tone={STATUS_TONE[r.status] ?? 'quiet'}>
                        {STATUS_LABELS[r.status] ?? r.status}
                      </Pill>
                      {r.lateMinutes > 0 && (
                        <span className="text-[11px] tabular-nums text-warning">+{r.lateMinutes}m</span>
                      )}
                    </span>
                    <span className="hidden items-center justify-end gap-1 md:flex">
                      {r.adjustedAt && (
                        <Button
                          variant="ghost" size="icon" className="size-7 text-muted-foreground"
                          onClick={() => openHistory(r)} aria-label="View correction history"
                          title={`Corrected by ${r.adjuster?.profiles?.fullName ?? 'HR'}`}
                        >
                          <History className="size-3.5" />
                        </Button>
                      )}
                      {canAdjust && (
                        <Button
                          variant="ghost" size="icon" className="size-7"
                          onClick={() => openAdjust(r)} aria-label="Adjust record"
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      )}
                    </span>
                  </TRow>
                ))}
              </div>
            </Card>
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
