'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import {
  CalendarOff, Megaphone, Plus, Trash2, Loader2, Pencil, Pin, Users, Building2,
} from 'lucide-react';

import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

async function api<T>(url: string, init?: RequestInit): Promise<{ data: T }> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const json = await res.json().catch(() => null);
  if (json?.error) throw new Error(json.error.message || 'Request failed');
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return json;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Holidays
// ═══════════════════════════════════════════════════════════════════════════

interface Holiday {
  id: string;
  name: string;
  holidayDate: string;
  observedDate?: string;
  isRecurring: boolean;
  isHalfDay: boolean;
  notes: string;
}

/**
 * The company holiday calendar.
 *
 * ── Why this is a real setting, not a preference ──────────────────────────
 *
 * `organizations.work_days` already covered the weekly pattern, so weekends
 * were handled — but a public holiday was an ordinary working day as far as
 * the system was concerned. Approving leave over Christmas consumed the
 * employee's entitlement for it, and the attendance register showed a day the
 * whole company failed to attend.
 *
 * A date added here changes both immediately: `is_working_day()` in the
 * database is what the leave trigger and the attendance reporting both read,
 * so there is one definition rather than three.
 */
export function HolidaysTab() {
  const currentYear = new Date().getFullYear();

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [year, setYear] = useState(String(currentYear));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Holiday | null>(null);
  const [deleting, setDeleting] = useState<Holiday | null>(null);

  const [form, setForm] = useState({
    name: '', holidayDate: '', isRecurring: false, isHalfDay: false, notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<Holiday[]>(`/api/admin/holidays?year=${year}`);
      setHolidays(res.data ?? []);
    } catch (e: any) {
      toast.error(e.message || 'Could not load the holiday calendar');
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const openCreate = useCallback(() => {
    setEditing(null);
    setForm({ name: '', holidayDate: '', isRecurring: false, isHalfDay: false, notes: '' });
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((h: Holiday) => {
    setEditing(h);
    setForm({
      name: h.name,
      holidayDate: h.holidayDate,
      isRecurring: h.isRecurring,
      isHalfDay: h.isHalfDay,
      notes: h.notes ?? '',
    });
    setDialogOpen(true);
  }, []);

  const save = useCallback(async () => {
    if (!form.name.trim() || !form.holidayDate) return;
    setSaving(true);
    try {
      if (editing) {
        await api(`/api/admin/holidays/${editing.id}`, { method: 'PATCH', body: JSON.stringify(form) });
      } else {
        await api('/api/admin/holidays', { method: 'POST', body: JSON.stringify(form) });
      }
      toast.success(
        editing
          ? 'Holiday updated'
          : 'Holiday added — leave requests across this date no longer consume entitlement.',
      );
      setDialogOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [form, editing, load]);

  const confirmDelete = useCallback(async () => {
    if (!deleting) return;
    try {
      await api(`/api/admin/holidays/${deleting.id}`, { method: 'DELETE' });
      setDeleting(null);
      load();
    } catch (e: any) {
      toast.error(e.message || 'Delete failed');
    }
  }, [deleting, load]);

  const years = useMemo(
    () => [currentYear - 1, currentYear, currentYear + 1, currentYear + 2].map(String),
    [currentYear],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Company Holidays"
        description="Days the company is closed. These stop counting against leave entitlement and attendance."
        icon={CalendarOff}
      >
        <div className="flex items-center gap-2">
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={openCreate} className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700">
            <Plus className="size-4" /> Add holiday
          </Button>
        </div>
      </PageHeader>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
        </div>
      ) : holidays.length === 0 ? (
        <EmptyState
          icon={CalendarOff}
          title={`No holidays recorded for ${year}`}
          description="Until a date is added here it counts as an ordinary working day, and leave taken across it consumes entitlement."
          action={{ label: 'Add holiday', onClick: openCreate }}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {holidays.map(h => (
                <div key={h.id} className="group flex items-center gap-4 p-4">
                  <div className="flex size-11 shrink-0 flex-col items-center justify-center rounded-md border bg-muted/40">
                    <span className="text-[10px] uppercase text-muted-foreground">
                      {formatDate(h.observedDate ?? h.holidayDate, { month: 'short' })}
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-foreground">
                      {new Date(h.observedDate ?? h.holidayDate).getDate()}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{h.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(h.observedDate ?? h.holidayDate, {
                        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
                      })}
                      {h.notes && ` · ${h.notes}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {h.isRecurring && (
                      <Badge variant="outline" className="font-normal">Every year</Badge>
                    )}
                    {/* A half-day is still a working day — people are expected
                        in — so it is labelled differently from a closure. */}
                    {h.isHalfDay && (
                      <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                        Half day
                      </Badge>
                    )}
                    <Button
                      variant="ghost" size="icon"
                      className="size-7 opacity-0 transition group-hover:opacity-100"
                      onClick={() => openEdit(h)}
                      aria-label="Edit holiday"
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon"
                      className="size-7 opacity-0 transition group-hover:opacity-100"
                      onClick={() => setDeleting(h)}
                      aria-label="Delete holiday"
                    >
                      <Trash2 className="size-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit holiday' : 'Add a holiday'}</DialogTitle>
            <DialogDescription>
              Takes effect immediately: leave requests spanning this date stop
              consuming entitlement, and it no longer appears as an unattended
              working day on the register.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label htmlFor="hol-name">Name *</Label>
              <Input
                id="hol-name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Christmas Day"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="hol-date">Date *</Label>
              <Input
                id="hol-date" type="date"
                value={form.holidayDate}
                onChange={e => setForm(f => ({ ...f, holidayDate: e.target.value }))}
              />
            </div>

            <label className="flex cursor-pointer items-start gap-2.5">
              <Checkbox
                checked={form.isRecurring}
                onCheckedChange={v => setForm(f => ({ ...f, isRecurring: v === true }))}
                className="mt-0.5"
              />
              <span className="text-sm">
                <span className="font-medium text-foreground">Repeats every year</span>
                <span className="block text-xs text-muted-foreground">
                  For fixed dates like Christmas. Movable dates such as Easter
                  should be entered per year instead.
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2.5">
              <Checkbox
                checked={form.isHalfDay}
                onCheckedChange={v => setForm(f => ({ ...f, isHalfDay: v === true }))}
                className="mt-0.5"
              />
              <span className="text-sm">
                <span className="font-medium text-foreground">Half day</span>
                <span className="block text-xs text-muted-foreground">
                  Still a working day — staff are expected in, and it continues
                  to count towards attendance.
                </span>
              </span>
            </label>

            <div className="space-y-2">
              <Label htmlFor="hol-notes">Notes</Label>
              <Input
                id="hol-notes"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Optional"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={save}
              disabled={saving || !form.name.trim() || !form.holidayDate}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              {editing ? 'Save' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={o => { if (!o) setDeleting(null); }}
        title="Remove this holiday"
        description={`"${deleting?.name}" will become an ordinary working day again. Leave already approved across it keeps the days it consumed.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Announcements
// ═══════════════════════════════════════════════════════════════════════════

interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: string;
  isPinned: boolean;
  publishedAt: string;
  expiresAt: string | null;
  author?: { id: string; profiles?: { fullName: string } };
}

const AUDIENCE_LABELS: Record<string, string> = {
  staff: 'Staff only',
  clients: 'Clients only',
  everyone: 'Everyone',
};

/**
 * Company announcements.
 *
 * The one thing the platform pushes at people rather than waiting for them to
 * come and look. Publishing fans out a notification to every member of the
 * chosen audience immediately — which is the point, since an announcement
 * nobody is told about is just a document.
 *
 * The audience matters more than it looks: `clients` is what makes this the
 * client portal's news feed, so "we are closed next Monday" reaches customers
 * without anybody writing an email.
 */
export function AnnouncementsTab() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<Announcement | null>(null);

  const [form, setForm] = useState({
    title: '', body: '', audience: 'staff', isPinned: false, expiresAt: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<Announcement[]>('/api/admin/announcements?pageSize=50');
      setItems(res.data ?? []);
    } catch (e: any) {
      toast.error(e.message || 'Could not load announcements');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const publish = useCallback(async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await api('/api/admin/announcements', {
        method: 'POST',
        body: JSON.stringify({ ...form, expiresAt: form.expiresAt || null }),
      });
      toast.success('Published — everyone in the audience has been notified.');
      setDialogOpen(false);
      setForm({ title: '', body: '', audience: 'staff', isPinned: false, expiresAt: '' });
      load();
    } catch (e: any) {
      toast.error(e.message || 'Could not publish');
    } finally {
      setSaving(false);
    }
  }, [form, load]);

  const confirmDelete = useCallback(async () => {
    if (!deleting) return;
    try {
      await api(`/api/admin/announcements/${deleting.id}`, { method: 'DELETE' });
      setDeleting(null);
      load();
    } catch (e: any) {
      toast.error(e.message || 'Delete failed');
    }
  }, [deleting, load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Announcements"
        description="Broadcast to staff, clients, or both. Publishing notifies everyone in the audience."
        icon={Megaphone}
      >
        <Button
          onClick={() => setDialogOpen(true)}
          className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
        >
          <Plus className="size-4" /> New announcement
        </Button>
      </PageHeader>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="Nothing announced"
          description="Use this for company-wide notices — closures, policy changes, anything everyone needs to know without being asked."
          action={{ label: 'New announcement', onClick: () => setDialogOpen(true) }}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map(a => (
            <Card key={a.id} className={cn(a.isPinned && 'border-emerald-500/40')}>
              <CardContent className="flex items-start gap-3 p-4">
                {a.isPinned && <Pin className="mt-0.5 size-4 shrink-0 text-emerald-600" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{a.title}</p>
                    <Badge
                      variant="secondary"
                      className={cn(
                        'gap-1',
                        a.audience === 'clients' && 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
                      )}
                    >
                      {a.audience === 'clients' ? <Building2 className="size-3" /> : <Users className="size-3" />}
                      {AUDIENCE_LABELS[a.audience] ?? a.audience}
                    </Badge>
                  </div>
                  {a.body && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>
                  )}
                  <p className="mt-1.5 text-[11px] text-muted-foreground/70">
                    {formatDate(a.publishedAt)}
                    {a.author?.profiles?.fullName && ` · ${a.author.profiles.fullName}`}
                    {a.expiresAt && ` · expires ${formatDate(a.expiresAt)}`}
                  </p>
                </div>
                <Button
                  variant="ghost" size="icon" className="size-7 shrink-0"
                  onClick={() => setDeleting(a)}
                  aria-label="Withdraw announcement"
                >
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New announcement</DialogTitle>
            <DialogDescription>
              This is sent as a notification to everyone in the audience the
              moment you publish. It cannot be un-sent.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label htmlFor="ann-title">Title *</Label>
              <Input
                id="ann-title"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Office closed on Monday"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ann-body">Message</Label>
              <Textarea
                id="ann-body" rows={4}
                value={form.body}
                onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Audience</Label>
                <Select value={form.audience} onValueChange={v => setForm(f => ({ ...f, audience: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="staff">Staff only</SelectItem>
                    <SelectItem value="clients">Clients only</SelectItem>
                    <SelectItem value="everyone">Everyone</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ann-expires">Expires</Label>
                <Input
                  id="ann-expires" type="date"
                  value={form.expiresAt}
                  onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))}
                />
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2.5">
              <Checkbox
                checked={form.isPinned}
                onCheckedChange={v => setForm(f => ({ ...f, isPinned: v === true }))}
              />
              <span className="text-sm text-foreground">Pin to the top</span>
            </label>

            {form.audience !== 'staff' && (
              <p className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 text-xs text-muted-foreground">
                This will appear in the client portal and be sent to every
                client account.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={publish}
              disabled={saving || !form.title.trim()}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={o => { if (!o) setDeleting(null); }}
        title="Withdraw this announcement"
        description={`"${deleting?.title}" will stop appearing. Notifications already delivered are not recalled.`}
        confirmLabel="Withdraw"
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
