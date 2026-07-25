'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Calendar as CalendarIcon, Plus, Pencil, Trash2, ChevronLeft, ChevronRight,
  MapPin, Clock, User, Loader2, CalendarDays,
} from 'lucide-react';

import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { formatDateTime } from '@/lib/format';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

// ═══════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════

/**
 * Mirrors `/api/calendar/events`. The names are the database's, camelised:
 * `startsAt`/`endsAt`, and `colour` with the British spelling used by the
 * column. They were previously `startDate`/`endDate`/`color`, which exist
 * nowhere in the response — every event therefore rendered as "Invalid Date"
 * and had no colour bar.
 */
interface CalendarEvent {
  id: string; title: string; description: string; startsAt: string; endsAt: string;
  allDay: boolean; location: string; colour: string; createdBy: string;
  createdAt: string; updatedAt: string;
  creator?: { id: string; profiles?: { fullName: string; avatarUrl: string | null } };
}

// ═══════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════

const COLOR_SWATCHES = [
  { label: 'Emerald', value: '#10b981', bg: 'bg-emerald-500', text: 'text-emerald-500' },
  { label: 'Amber', value: '#f59e0b', bg: 'bg-amber-500', text: 'text-amber-500' },
  { label: 'Rose', value: '#f43f5e', bg: 'bg-rose-500', text: 'text-rose-500' },
  { label: 'Violet', value: '#8b5cf6', bg: 'bg-violet-500', text: 'text-violet-500' },
  { label: 'Blue', value: '#3b82f6', bg: 'bg-blue-500', text: 'text-blue-500' },
  { label: 'Cyan', value: '#06b6d4', bg: 'bg-cyan-500', text: 'text-cyan-500' },
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ═══════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? 'Request failed');
  return json;
}

function getMonthGrid(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startPadding = firstDay.getDay(); // 0=Sun
  const totalCells = Math.ceil((startPadding + lastDay.getDate()) / 7) * 7;
  const cells: (Date | null)[] = [];

  for (let i = 0; i < startPadding; i++) cells.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(new Date(year, month, d));
  while (cells.length < totalCells) cells.push(null);

  return { cells, totalDays: lastDay.getDate(), firstDay, lastDay };
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function toLocalDateTimeStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}`;
}

// ═══════════════════════════════════════════════════════════════
//  Event Form Dialog
// ═══════════════════════════════════════════════════════════════

interface EventFormState {
  title: string; description: string; allDay: boolean;
  startDate: string; endDate: string; location: string; color: string;
}

const defaultEventForm: EventFormState = {
  title: '', description: '', allDay: false,
  startDate: toLocalDateTimeStr(new Date()),
  endDate: toLocalDateTimeStr(new Date()),
  location: '', color: '#10b981',
};

function EventFormDialog({
  open, onOpenChange, editing, onSubmit, isLoading,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  editing: CalendarEvent | null; onSubmit: (data: EventFormState) => void; isLoading: boolean;
}) {
  const getInitialForm = (): EventFormState => editing ? {
    title: editing.title, description: editing.description, allDay: editing.allDay,
    startDate: toLocalDateTimeStr(new Date(editing.startsAt)),
    endDate: toLocalDateTimeStr(new Date(editing.endsAt)),
    location: editing.location, color: editing.colour,
  } : { ...defaultEventForm, startDate: toLocalDateTimeStr(new Date()), endDate: toLocalDateTimeStr(new Date()) };

  const [form, setForm] = useState<EventFormState>(getInitialForm);

  const update = (k: keyof EventFormState, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Event' : 'New Event'}</DialogTitle>
          <DialogDescription>
            {editing ? 'Update event details below.' : 'Fill in the details for the new event.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="e-title">Title</Label>
            <Input id="e-title" value={form.title} onChange={(e) => update('title', e.target.value)} placeholder="Event title" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="e-desc">Description</Label>
            <Textarea id="e-desc" value={form.description} onChange={(e) => update('description', e.target.value)} placeholder="Event description..." rows={3} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <Label htmlFor="e-allday">All Day</Label>
            <Switch id="e-allday" checked={form.allDay} onCheckedChange={(v) => update('allDay', v)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="e-start">Start Date</Label>
              <Input id="e-start" type="datetime-local" value={form.startDate} onChange={(e) => update('startDate', e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="e-end">End Date</Label>
              <Input id="e-end" type="datetime-local" value={form.endDate} onChange={(e) => update('endDate', e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="e-location">Location</Label>
            <Input id="e-location" value={form.location} onChange={(e) => update('location', e.target.value)} placeholder="Event location" />
          </div>
          <div className="grid gap-2">
            <Label>Color</Label>
            <div className="flex gap-2">
              {COLOR_SWATCHES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  className={`size-8 rounded-full transition-all ${s.bg} ${form.color === s.value ? 'ring-2 ring-offset-2 ring-foreground scale-110' : 'opacity-70 hover:opacity-100'}`}
                  onClick={() => update('color', s.value)}
                  title={s.label}
                  aria-label={`Color: ${s.label}`}
                />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>Cancel</Button>
          <Button onClick={() => onSubmit(form)} disabled={isLoading || !form.title} className="bg-emerald-600 text-white hover:bg-emerald-700">
            {isLoading && <Loader2 className="size-4 animate-spin" />}
            {editing ? 'Save Changes' : 'Create Event'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════
//  Main Module
// ═══════════════════════════════════════════════════════════════

export default function CalendarModule() {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(today);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  // Dialogs
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [eventSubmitting, setEventSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CalendarEvent | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ── Month grid ──
  const { cells, firstDay, lastDay } = useMemo(
    () => getMonthGrid(viewYear, viewMonth),
    [viewYear, viewMonth],
  );

  // ── Fetch events for visible month ──
  const fetchEvents = useCallback(async () => {
    setEventsLoading(true);
    try {
      const startStr = firstDay.toISOString();
      const endStr = lastDay.toISOString();
      const res = await apiFetch<{ data: CalendarEvent[]; meta: any }>(
        `/api/calendar/events?startDateAfter=${encodeURIComponent(startStr)}&startDateBefore=${encodeURIComponent(endStr)}&pageSize=200`
      );
      setEvents(res.data);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setEventsLoading(false);
    }
  }, [firstDay, lastDay]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  // ── Navigation ──
  const goToToday = () => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()); setSelectedDate(today); };
  const goPrev = () => {
    const m = viewMonth - 1;
    if (m < 0) { setViewMonth(11); setViewYear(viewYear - 1); } else { setViewMonth(m); }
    setSelectedDate(null);
  };
  const goNext = () => {
    const m = viewMonth + 1;
    if (m > 11) { setViewMonth(0); setViewYear(viewYear + 1); } else { setViewMonth(m); }
    setSelectedDate(null);
  };

  // ── Events grouped by date ──
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    events.forEach((e) => {
      const d = new Date(e.startsAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    });
    return map;
  }, [events]);

  // ── Side panel events (upcoming) ──
  const upcomingEvents = useMemo(() => {
    const sorted = [...events].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    if (selectedDate) {
      return sorted.filter((e) => isSameDay(new Date(e.startsAt), selectedDate));
    }
    return sorted;
  }, [events, selectedDate]);

  // ── Event CRUD ──
  const handleEventSubmit = async (form: EventFormState) => {
    setEventSubmitting(true);
    try {
      // Field names must match the API, not the form's own state: the route
      // reads starts_at/ends_at/colour and rejected every event as "Start and
      // end times are required" when sent startDate/endDate/color.
      const payload = {
        title: form.title, description: form.description, allDay: form.allDay,
        startsAt: new Date(form.startDate).toISOString(),
        endsAt: new Date(form.endDate).toISOString(),
        location: form.location, colour: form.color,
      };
      if (editingEvent) {
        await apiFetch(`/api/calendar/events/${editingEvent.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast.success('Event updated');
      } else {
        await apiFetch('/api/calendar/events', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('Event created');
      }
      setEventDialogOpen(false);
      setEditingEvent(null);
      fetchEvents();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setEventSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/calendar/events/${deleteTarget.id}`, { method: 'DELETE' });
      toast.success('Event deleted');
      setDeleteTarget(null);
      fetchEvents();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(false);
    }
  };

  // ── Get events for a cell date ──
  const getEventsForCell = (date: Date | null): CalendarEvent[] => {
    if (!date) return [];
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    return eventsByDate.get(key) || [];
  };

  // ── Format time for side panel ──
  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* ═══════════ CALENDAR (LEFT) ═══════════ */}
      <div className="flex-1 flex flex-col overflow-hidden p-6">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <PageHeader title={`${MONTH_NAMES[viewMonth]} ${viewYear}`} icon={CalendarDays}>
            <Button variant="outline" size="sm" onClick={goToToday}>Today</Button>
            <Button variant="outline" size="icon" className="size-8" onClick={goPrev}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" size="icon" className="size-8" onClick={goNext}>
              <ChevronRight className="size-4" />
            </Button>
            <Button onClick={() => { setEditingEvent(null); setEventDialogOpen(true); }}
              className="bg-emerald-600 text-white hover:bg-emerald-700 ml-2">
              <Plus className="size-4 mr-2" /> New Event
            </Button>
          </PageHeader>
        </div>

        {/* View toggle (only month is implemented) */}
        <div className="flex gap-1 mb-4">
          {['Day', 'Week', 'Month'].map((v) => (
            <Button key={v} variant={v === 'Month' ? 'default' : 'outline'} size="sm"
              className={v === 'Month' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : ''}
              disabled={v !== 'Month'}>
              {v}
            </Button>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="flex-1 flex flex-col border rounded-lg overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b bg-muted/50">
            {DAY_NAMES.map((d) => (
              <div key={d} className="px-2 py-2 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {d}
              </div>
            ))}
          </div>

          {/* Date cells */}
          <div className="grid grid-cols-7 grid-rows-6 flex-1">
            {cells.map((date, i) => {
              const dayEvents = getEventsForCell(date);
              const isToday = date ? isSameDay(date, today) : false;
              const isSelected = date && selectedDate ? isSameDay(date, selectedDate) : false;

              return (
                <div
                  key={i}
                  onClick={() => date && setSelectedDate(date)}
                  className={`border-b border-r p-1 min-h-[100px] transition-colors cursor-pointer hover:bg-muted/30 ${
                    !date ? 'bg-muted/20' : ''
                  } ${isSelected ? 'bg-emerald-50 dark:bg-emerald-950/20' : ''}`}
                >
                  {date && (
                    <>
                      <span className={`text-sm font-medium inline-flex items-center justify-center size-6 rounded-full ${
                        isToday ? 'bg-emerald-500 text-white' : 'text-foreground'
                      }`}>
                        {date.getDate()}
                      </span>
                      <div className="mt-0.5 space-y-0.5 max-h-[calc(100%-28px)] overflow-hidden">
                        {dayEvents.slice(0, 3).map((ev) => (
                          <div
                            key={ev.id}
                            onClick={(e) => { e.stopPropagation(); setEditingEvent(ev); setEventDialogOpen(true); }}
                            className="text-[11px] leading-tight px-1.5 py-0.5 rounded truncate text-white cursor-pointer hover:opacity-80 transition-opacity"
                            style={{ backgroundColor: ev.colour }}
                          >
                            {ev.title}
                          </div>
                        ))}
                        {dayEvents.length > 3 && (
                          <span className="text-[10px] text-muted-foreground pl-1">+{dayEvents.length - 3} more</span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ═══════════ SIDE PANEL (RIGHT) ═══════════ */}
      <aside className="hidden lg:flex w-80 border-l flex-col bg-card">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">
              {selectedDate ? `${MONTH_NAMES[selectedDate.getMonth()]} ${selectedDate.getDate()}` : 'Upcoming Events'}
            </h2>
            <Badge variant="secondary" className="text-xs">{upcomingEvents.length}</Badge>
          </div>
          {selectedDate && (
            <Button variant="ghost" size="sm" className="mt-1 h-7 text-xs text-muted-foreground" onClick={() => setSelectedDate(null)}>
              Show all events
            </Button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-3 max-h-96 lg:max-h-none">
          {upcomingEvents.length === 0 ? (
            <EmptyState
              icon={CalendarIcon}
              title="No events"
              description={selectedDate ? 'No events on this date.' : 'No upcoming events this month.'}
            />
          ) : (
            <div className="space-y-2">
              {upcomingEvents.map((ev) => (
                <div
                  key={ev.id}
                  onClick={() => { setEditingEvent(ev); setEventDialogOpen(true); }}
                  className="group flex gap-2.5 rounded-lg border p-3 cursor-pointer hover:shadow-sm transition-shadow"
                >
                  <div className="w-1 shrink-0 rounded-full" style={{ backgroundColor: ev.colour }} />
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-medium truncate">{ev.title}</h4>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <Clock className="size-3 shrink-0" />
                      <span>
                        {ev.allDay ? 'All Day' : `${formatTime(ev.startsAt)} – ${formatTime(ev.endsAt)}`}
                      </span>
                    </div>
                    {ev.location && (
                      <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                        <MapPin className="size-3 shrink-0" />
                        <span className="truncate">{ev.location}</span>
                      </div>
                    )}
                    {ev.creator?.profiles?.fullName && (
                      <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                        <User className="size-3 shrink-0" />
                        <span>{ev.creator.profiles.fullName}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* ═══════════ DIALOGS ═══════════ */}
      <EventFormDialog
        key={editingEvent?.id ?? 'new-event'}
        open={eventDialogOpen} onOpenChange={setEventDialogOpen}
        editing={editingEvent} onSubmit={handleEventSubmit} isLoading={eventSubmitting}
      />

      <ConfirmDialog
        open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}
        title="Delete Event"
        description={`Are you sure you want to delete "${deleteTarget?.title}"? This action cannot be undone.`}
        confirmLabel="Delete" variant="destructive" onConfirm={handleDelete} isLoading={deleting}
      />
    </div>
  );
}