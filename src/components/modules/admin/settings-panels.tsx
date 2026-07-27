'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Clock, CalendarDays, Palette, Bell, FolderKanban, Building2, Save, Loader2,
  Plus, Pencil, Trash2, UploadCloud, Users,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { createClient } from '@/lib/supabase/client';
import { statusLabel, LEAVE_TYPES } from '@/lib/constants';
import { NOTIFICATION_EVENT_LABELS } from '@/lib/org-settings';
import { cn } from '@/lib/utils';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The administration control centre.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── The rule every panel here follows ────────────────────────────────────
 *
 *  A control only exists if something reads it. The Settings tab previously
 *  offered General and Finance and nothing else, while the columns that decide
 *  how attendance is classified — `work_start`, `work_end`, `work_days`,
 *  `grace_minutes`, `break_minutes` — had no control at all despite the
 *  endpoint accepting them and the database functions reading them on every
 *  check-in. The opposite failure is worse and more common: a settings page
 *  full of switches that persist and change nothing.
 *
 *  So each panel below names, in its own comment, what consumes the value.
 */

// ─── Shared plumbing ───────────────────────────────────────────────────────

export interface SettingsBundle {
  organization: Record<string, any>;
  settings: Record<string, any>;
  departments: DepartmentRow[];
}

export interface DepartmentRow {
  id: string;
  name: string;
  description: string;
  parentId: string | null;
  headId: string | null;
  headName: string | null;
  memberCount: number;
}

interface DirectoryMember {
  memberId: string;
  fullName: string;
  jobTitle: string | null;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.data as T;
}

function Panel({
  title, description, icon: Icon, children, footer,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4 text-emerald-600" /> {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
      {footer && <div className="flex justify-end border-t px-6 py-3">{footer}</div>}
    </Card>
  );
}

function SaveButton({ onClick, saving, label = 'Save' }: {
  onClick: () => void; saving: boolean; label?: string;
}) {
  return (
    <Button onClick={onClick} disabled={saving}
      className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
      {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      {label}
    </Button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Workplace: hours, days, attendance
// ═══════════════════════════════════════════════════════════════════════════

const WEEKDAYS = [
  { value: 0, label: 'Sun' }, { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

/**
 * Working hours and the attendance rules built on them.
 *
 * Read by `clock_in()`, which classifies a check-in as present, early or late
 * against `work_start` plus `grace_minutes`; by `clock_out()`, which deducts
 * `break_minutes` from a shift long enough to have had one; and by
 * `working_days_between()`, which counts `work_days` less any holiday to give
 * the register its expected-days figure. Saving here changes the next
 * check-in, with no deployment involved.
 */
export function WorkplacePanel({
  bundle, onSaved,
}: { bundle: SettingsBundle; onSaved: () => void }) {
  const org = bundle.organization ?? {};
  const policy = bundle.settings?.attendancePolicy ?? {};

  const [workStart, setWorkStart] = useState(String(org.workStart ?? '09:00').slice(0, 5));
  const [workEnd, setWorkEnd] = useState(String(org.workEnd ?? '17:30').slice(0, 5));
  const [grace, setGrace] = useState(String(org.graceMinutes ?? 10));
  const [breakMins, setBreakMins] = useState(String(org.breakMinutes ?? 30));
  const [days, setDays] = useState<number[]>(
    Array.isArray(org.workDays) ? org.workDays : [1, 2, 3, 4, 5],
  );
  const [timezone, setTimezone] = useState(String(org.timezone ?? 'UTC'));
  const [allowRemote, setAllowRemote] = useState(policy.allowRemote !== false);
  const [requireNote, setRequireNote] = useState(policy.requireNoteRemote === true);
  const [halfDay, setHalfDay] = useState(String(policy.halfDayMinutes ?? 240));
  const [autoAbsent, setAutoAbsent] = useState(policy.autoAbsent !== false);
  const [overtime, setOvertime] = useState(String(policy.overtimeAfterMinutes ?? 540));
  const [saving, setSaving] = useState(false);

  // Intl carries the full IANA list; offering it beats a hand-maintained
  // dropdown that will not contain somebody's city.
  const zones: string[] = (() => {
    try {
      const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
        .supportedValuesOf?.('timeZone');
      return supported?.length ? supported : [timezone, 'UTC'];
    } catch {
      return [timezone, 'UTC'];
    }
  })();

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await api('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          workStart, workEnd, workDays: days, timezone,
          graceMinutes: Number(grace) || 0,
          breakMinutes: Number(breakMins) || 0,
          settings: {
            attendance_policy: {
              allow_remote: allowRemote,
              require_note_remote: requireNote,
              half_day_minutes: Number(halfDay) || 0,
              auto_absent: autoAbsent,
              overtime_after_minutes: Number(overtime) || 0,
            },
          },
        }),
      });
      toast.success('Working hours updated — the next check-in uses them');
      onSaved();
    } catch (e: any) {
      toast.error(e.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  }, [workStart, workEnd, days, timezone, grace, breakMins,
      allowRemote, requireNote, halfDay, autoAbsent, overtime, onSaved]);

  return (
    <Panel
      title="Working hours and attendance"
      description="What counts as on time, what counts as a working day, and how a shift is measured. Applied by the clock immediately."
      icon={Clock}
      footer={<SaveButton onClick={save} saving={saving} />}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-2">
          <Label htmlFor="w-start">Day starts</Label>
          <Input id="w-start" type="time" value={workStart} onChange={(e) => setWorkStart(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="w-end">Day ends</Label>
          <Input id="w-end" type="time" value={workEnd} onChange={(e) => setWorkEnd(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="w-grace">Grace period (min)</Label>
          <Input id="w-grace" type="number" min={0} value={grace} onChange={(e) => setGrace(e.target.value)} />
          <p className="text-xs text-muted-foreground">Arriving within this is not late.</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="w-break">Unpaid break (min)</Label>
          <Input id="w-break" type="number" min={0} value={breakMins} onChange={(e) => setBreakMins(e.target.value)} />
          <p className="text-xs text-muted-foreground">Deducted from a full shift.</p>
        </div>
      </div>

      <div className="grid gap-2">
        <Label>Working days</Label>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map(day => {
            const on = days.includes(day.value);
            return (
              <button
                key={day.value}
                type="button"
                onClick={() => setDays(prev => on
                  ? prev.filter(d => d !== day.value)
                  : [...prev, day.value].sort((a, b) => a - b))}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                  on
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                    : 'text-muted-foreground hover:bg-accent',
                )}
              >
                {day.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Leave requests only consume these days, and the attendance rate is measured against them.
        </p>
      </div>

      <div className="grid gap-2 sm:max-w-sm">
        <Label htmlFor="w-tz">Time zone</Label>
        <Select value={timezone} onValueChange={setTimezone}>
          <SelectTrigger id="w-tz"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            {zones.map(z => <SelectItem key={z} value={z}>{z}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Decides which calendar day a check-in belongs to, and what “today” means on every screen.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <ToggleRow
          label="Allow remote check-in"
          hint="People can record a day as worked remotely rather than on site."
          checked={allowRemote}
          onChange={setAllowRemote}
        />
        <ToggleRow
          label="Require a note for remote days"
          hint="Ask where they are working from."
          checked={requireNote}
          onChange={setRequireNote}
          disabled={!allowRemote}
        />
        <ToggleRow
          label="Record a missed working day as absent"
          hint="Otherwise the register simply leaves the day blank."
          checked={autoAbsent}
          onChange={setAutoAbsent}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="w-half">Half day below (min worked)</Label>
          <Input id="w-half" type="number" min={0} max={1440} value={halfDay}
            onChange={(e) => setHalfDay(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="w-ot">Overtime after (min worked)</Label>
          <Input id="w-ot" type="number" min={0} max={1440} value={overtime}
            onChange={(e) => setOvertime(e.target.value)} />
        </div>
      </div>
    </Panel>
  );
}

function ToggleRow({
  label, hint, checked, onChange, disabled,
}: {
  label: string; hint: string; checked: boolean;
  onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4', disabled && 'opacity-60')}>
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Leave
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Leave types and limits.
 *
 * `types` is what the HR request form offers — it carried a hard-coded list of
 * five and omitted `bereavement` and `unpaid`, so two kinds of leave the
 * database has always accepted could not be requested. The endpoint validates
 * every entry against the `leave_type` enum, because a value that is not a
 * member renders happily as an option and then fails with Postgres 22P02 at
 * the moment somebody submits.
 */
export function LeavePanel({
  bundle, onSaved,
}: { bundle: SettingsBundle; onSaved: () => void }) {
  const policy = bundle.settings?.leavePolicy ?? {};

  const [types, setTypes] = useState<string[]>(
    Array.isArray(policy.types) ? policy.types : [...LEAVE_TYPES],
  );
  const [requiresApproval, setRequiresApproval] = useState(policy.requiresApproval !== false);
  const [allowHalfDay, setAllowHalfDay] = useState(policy.allowHalfDay !== false);
  const [minNotice, setMinNotice] = useState(String(policy.minNoticeDays ?? 0));
  const [maxDays, setMaxDays] = useState(String(policy.maxConsecutiveDays ?? 30));
  const [carryOver, setCarryOver] = useState(String(policy.carryOverDays ?? 5));
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await api('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          settings: {
            leave_policy: {
              types,
              requires_approval: requiresApproval,
              allow_half_day: allowHalfDay,
              min_notice_days: Number(minNotice) || 0,
              max_consecutive_days: Number(maxDays) || 1,
              carry_over_days: Number(carryOver) || 0,
            },
          },
        }),
      });
      toast.success('Leave policy updated');
      onSaved();
    } catch (e: any) {
      toast.error(e.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  }, [types, requiresApproval, allowHalfDay, minNotice, maxDays, carryOver, onSaved]);

  return (
    <Panel
      title="Leave"
      description="Which kinds of leave people can request, and the limits on them. The request form is built from this."
      icon={CalendarDays}
      footer={<SaveButton onClick={save} saving={saving} />}
    >
      <div className="grid gap-2">
        <Label>Types offered</Label>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {LEAVE_TYPES.map(type => (
            <label key={type} className="flex cursor-pointer items-center gap-2 rounded-md border p-2.5">
              <Checkbox
                checked={types.includes(type)}
                onCheckedChange={(checked) => setTypes(prev => checked
                  ? [...prev, type]
                  : prev.filter(t => t !== type))}
              />
              <span className="text-sm">{statusLabel(type)}</span>
            </label>
          ))}
        </div>
        {types.length === 0 && (
          <p className="text-xs text-destructive">
            Offer at least one, or nobody can request leave.
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="l-notice">Minimum notice (days)</Label>
          <Input id="l-notice" type="number" min={0} value={minNotice}
            onChange={(e) => setMinNotice(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="l-max">Maximum consecutive days</Label>
          <Input id="l-max" type="number" min={1} value={maxDays}
            onChange={(e) => setMaxDays(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="l-carry">Days carried into next year</Label>
          <Input id="l-carry" type="number" min={0} value={carryOver}
            onChange={(e) => setCarryOver(e.target.value)} />
        </div>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <ToggleRow
          label="Requests need approval"
          hint="A manager or HR has to decide before the days are taken. The database refuses self-approval either way."
          checked={requiresApproval}
          onChange={setRequiresApproval}
        />
        <ToggleRow
          label="Allow half days"
          hint="A half day consumes 0.5 of the balance rather than a whole one."
          checked={allowHalfDay}
          onChange={setAllowHalfDay}
        />
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Projects
// ═══════════════════════════════════════════════════════════════════════════

const ALL_PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'cancelled', 'archived'];
const ALL_PRIORITIES = ['low', 'medium', 'high', 'critical'];
const ALL_STAGES = ['planning', 'development', 'testing', 'review', 'deployment', 'completed'];

/**
 * Project vocabulary and templates.
 *
 * Statuses, priorities and stages are constrained to the database's own enums
 * and CHECK constraints — an organisation chooses which of them to *use*, not
 * what they are. Offering free text here would let somebody configure a status
 * that every insert then rejects, which is a settings page that breaks the
 * module it configures.
 *
 * Task categories are free text, because they are labels and nothing but the
 * picker reads them.
 */
export function ProjectsPanel({
  bundle, onSaved,
}: { bundle: SettingsBundle; onSaved: () => void }) {
  const defaults = bundle.settings?.projectDefaults ?? {};

  const [statuses, setStatuses] = useState<string[]>(
    Array.isArray(defaults.statuses) ? defaults.statuses : ALL_PROJECT_STATUSES);
  const [priorities, setPriorities] = useState<string[]>(
    Array.isArray(defaults.priorities) ? defaults.priorities : ALL_PRIORITIES);
  const [stages, setStages] = useState<string[]>(
    Array.isArray(defaults.milestoneStages) ? defaults.milestoneStages : ALL_STAGES);
  const [categories, setCategories] = useState(
    (Array.isArray(defaults.taskCategories) ? defaults.taskCategories : []).join('\n'));
  const [defaultStatus, setDefaultStatus] = useState(String(defaults.defaultStatus ?? 'planning'));
  const [defaultPriority, setDefaultPriority] = useState(String(defaults.defaultPriority ?? 'medium'));
  const [templates, setTemplates] = useState<{ name: string; description: string; milestones: string[] }[]>(
    Array.isArray(defaults.templates) ? defaults.templates : []);
  const [templateDialog, setTemplateDialog] = useState<{ index: number | null } | null>(null);
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await api('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          settings: {
            project_defaults: {
              statuses,
              priorities,
              milestone_stages: stages,
              task_categories: categories.split('\n').map(c => c.trim()).filter(Boolean),
              default_status: defaultStatus,
              default_priority: defaultPriority,
              templates,
            },
          },
        }),
      });
      toast.success('Project settings updated');
      onSaved();
    } catch (e: any) {
      toast.error(e.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  }, [statuses, priorities, stages, categories, defaultStatus, defaultPriority, templates, onSaved]);

  const chipGroup = (
    all: string[], selected: string[], setSelected: (v: string[]) => void,
  ) => (
    <div className="flex flex-wrap gap-1.5">
      {all.map(value => {
        const on = selected.includes(value);
        return (
          <button
            key={value}
            type="button"
            onClick={() => setSelected(on
              ? selected.filter(v => v !== value)
              : [...selected, value])}
            className={cn(
              'rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
              on
                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {statusLabel(value)}
          </button>
        );
      })}
    </div>
  );

  return (
    <Panel
      title="Projects"
      description="The vocabulary every project form offers, and the templates a new project can start from."
      icon={FolderKanban}
      footer={<SaveButton onClick={save} saving={saving} />}
    >
      <div className="grid gap-2">
        <Label>Statuses in use</Label>
        {chipGroup(ALL_PROJECT_STATUSES, statuses, setStatuses)}
      </div>

      <div className="grid gap-2">
        <Label>Priority levels</Label>
        {chipGroup(ALL_PRIORITIES, priorities, setPriorities)}
      </div>

      <div className="grid gap-2">
        <Label>Roadmap phases</Label>
        {chipGroup(ALL_STAGES, stages, setStages)}
        <p className="text-xs text-muted-foreground">
          The columns a project roadmap is laid out in, in this order.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label>Default status for a new project</Label>
          <Select value={defaultStatus} onValueChange={setDefaultStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {statuses.map(s => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>Default priority for a new task</Label>
          <Select value={defaultPriority} onValueChange={setDefaultPriority}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {priorities.map(p => <SelectItem key={p} value={p}>{statusLabel(p)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="p-cats">Task categories</Label>
        <Textarea id="p-cats" rows={4} value={categories}
          onChange={(e) => setCategories(e.target.value)}
          placeholder={'Feature\nBug\nImprovement'} />
        <p className="text-xs text-muted-foreground">One per line.</p>
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label>Project templates</Label>
          <Button variant="outline" size="sm" className="gap-1.5"
            onClick={() => setTemplateDialog({ index: null })}>
            <Plus className="size-3.5" /> Template
          </Button>
        </div>
        {templates.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            No templates yet. A template pre-fills a new project’s roadmap phases.
          </p>
        ) : (
          <div className="divide-y rounded-md border">
            {templates.map((template, index) => (
              <div key={`${template.name}-${index}`} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{template.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {template.milestones.length} phase{template.milestones.length === 1 ? '' : 's'}
                    {template.description ? ` · ${template.description}` : ''}
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="size-7"
                  onClick={() => setTemplateDialog({ index })}>
                  <Pencil className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  onClick={() => setTemplates(prev => prev.filter((_, i) => i !== index))}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <TemplateDialog
        key={templateDialog ? `tpl-${templateDialog.index ?? 'new'}` : 'tpl-closed'}
        state={templateDialog}
        existing={templateDialog?.index != null ? templates[templateDialog.index] : undefined}
        onClose={() => setTemplateDialog(null)}
        onSubmit={(value) => {
          setTemplates(prev => templateDialog?.index != null
            ? prev.map((t, i) => i === templateDialog.index ? value : t)
            : [...prev, value]);
          setTemplateDialog(null);
        }}
      />
    </Panel>
  );
}

function TemplateDialog({
  state, existing, onClose, onSubmit,
}: {
  state: { index: number | null } | null;
  existing?: { name: string; description: string; milestones: string[] };
  onClose: () => void;
  onSubmit: (value: { name: string; description: string; milestones: string[] }) => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [milestones, setMilestones] = useState((existing?.milestones ?? []).join('\n'));

  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit template' : 'New project template'}</DialogTitle>
          <DialogDescription>
            Starting a project from a template creates its roadmap phases in this order.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="t-name">Name</Label>
            <Input id="t-name" value={name} autoFocus onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Website build" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="t-desc">Description</Label>
            <Input id="t-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="t-ms">Phases</Label>
            <Textarea id="t-ms" rows={5} value={milestones}
              onChange={(e) => setMilestones(e.target.value)}
              placeholder={'Discovery\nDesign\nBuild\nLaunch'} />
            <p className="text-xs text-muted-foreground">One per line, in order.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={!name.trim()}
            onClick={() => onSubmit({
              name: name.trim(),
              description: description.trim(),
              milestones: milestones.split('\n').map(m => m.trim()).filter(Boolean),
            })}>
            Save template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Notifications
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Which events produce a notification.
 *
 * Enforced inside `notify_members()`, which reads this before it writes
 * anything — so switching one off stops the row existing rather than hiding it
 * afterwards. The keys are the `type` the triggers actually emit, so every
 * switch here provably controls something.
 */
export function NotificationsPanel({
  bundle, onSaved,
}: { bundle: SettingsBundle; onSaved: () => void }) {
  const stored = bundle.settings?.notificationEvents ?? {};
  const [events, setEvents] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(NOTIFICATION_EVENT_LABELS.map(e => [e.key, stored[e.key] !== false])));
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await api('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ settings: { notification_events: events } }),
      });
      toast.success('Notification settings updated');
      onSaved();
    } catch (e: any) {
      toast.error(e.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  }, [events, onSaved]);

  return (
    <Panel
      title="Notifications"
      description="Turning one off stops the notification being created at all, for everybody in the company."
      icon={Bell}
      footer={<SaveButton onClick={save} saving={saving} />}
    >
      <div className="divide-y rounded-lg border">
        {NOTIFICATION_EVENT_LABELS.map(({ key, label, hint }) => (
          <div key={key} className="flex items-start justify-between gap-4 p-3.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground">{hint}</p>
            </div>
            <Switch
              checked={events[key] !== false}
              onCheckedChange={(v) => setEvents(prev => ({ ...prev, [key]: v }))}
            />
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Branding
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Logo and brand colour.
 *
 * The logo goes to the public `logos` bucket under the organisation's own path
 * prefix, which is what the storage policies key on. It is public because it
 * is rendered in an `<img>` on the sign-in page, and signing that URL would be
 * a round trip on every unauthenticated page load for something that is on the
 * company's website anyway.
 */
export function BrandingPanel({
  bundle, onSaved,
}: { bundle: SettingsBundle; onSaved: () => void }) {
  const org = bundle.organization ?? {};
  const branding = bundle.settings?.branding ?? {};

  const [logoUrl, setLogoUrl] = useState<string>(org.logoUrl ?? '');
  const [colour, setColour] = useState(String(branding.primaryColour ?? '#10b981'));
  const [loginMessage, setLoginMessage] = useState(String(branding.loginMessage ?? ''));
  const [showLogo, setShowLogo] = useState(branding.showLogoInSidebar !== false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const upload = useCallback(async (file: File) => {
    if (!org.id) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('A logo has to be under 5MB.');
      return;
    }
    setUploading(true);
    try {
      const supabase = createClient();
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const path = `${org.id}/logo-${Date.now()}.${ext}`;
      const { error: e } = await supabase.storage.from('logos')
        .upload(path, file, { contentType: file.type || undefined, upsert: true });
      if (e) throw new Error(e.message);

      const { data } = supabase.storage.from('logos').getPublicUrl(path);
      setLogoUrl(data.publicUrl);
      toast.success('Logo uploaded — save to apply it');
    } catch (e: any) {
      toast.error(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [org.id]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await api('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          logoUrl: logoUrl || null,
          settings: {
            branding: {
              primary_colour: colour,
              login_message: loginMessage,
              show_logo_in_sidebar: showLogo,
            },
          },
        }),
      });
      toast.success('Branding updated');
      onSaved();
    } catch (e: any) {
      toast.error(e.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  }, [logoUrl, colour, loginMessage, showLogo, onSaved]);

  return (
    <Panel
      title="Branding"
      description="How the workspace presents itself to your people and your clients."
      icon={Palette}
      footer={<SaveButton onClick={save} saving={saving} />}
    >
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
          {logoUrl
            ? <img src={logoUrl} alt="Company logo" className="size-full object-contain" />
            : <Building2 className="size-6 text-muted-foreground" />}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="b-logo" className="cursor-pointer">
            <span className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
              {logoUrl ? 'Replace logo' : 'Upload logo'}
            </span>
          </Label>
          <input
            id="b-logo" type="file" className="hidden"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }}
          />
          <p className="text-xs text-muted-foreground">PNG, JPG, WebP or SVG, up to 5MB.</p>
        </div>
        {logoUrl && (
          <Button variant="ghost" size="sm" className="text-muted-foreground"
            onClick={() => setLogoUrl('')}>
            Remove
          </Button>
        )}
      </div>

      <div className="grid gap-2 sm:max-w-xs">
        <Label htmlFor="b-colour">Brand colour</Label>
        <div className="flex items-center gap-2">
          <input
            id="b-colour" type="color" value={colour}
            onChange={(e) => setColour(e.target.value)}
            className="size-9 cursor-pointer rounded border bg-transparent"
          />
          <Input value={colour} onChange={(e) => setColour(e.target.value)}
            className="font-mono" maxLength={7} />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="b-msg">Message on the sign-in page</Label>
        <Textarea id="b-msg" rows={2} value={loginMessage}
          onChange={(e) => setLoginMessage(e.target.value)}
          placeholder="Optional. Shown to everybody signing in." />
      </div>

      <div className="rounded-lg border p-4">
        <ToggleRow
          label="Show the logo in the sidebar"
          hint="Otherwise the company name is shown as text."
          checked={showLogo}
          onChange={setShowLogo}
        />
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Departments
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Departments and who manages them.
 *
 * Not cosmetic: `auth_visible_member_ids()` widens a manager's view to their
 * own department, HR and project scoping both resolve through
 * `department_id`, and a workspace folder can be shared with a department.
 * Until now every organisation had exactly the one seeded "General" row and no
 * way to add another, so all of that was pinned to a single group.
 */
export function DepartmentsPanel({
  departments, onChanged,
}: { departments: DepartmentRow[]; onChanged: () => void }) {
  const [people, setPeople] = useState<DirectoryMember[]>([]);
  const [dialog, setDialog] = useState<{ editing: DepartmentRow | null } | null>(null);
  const [removing, setRemoving] = useState<DepartmentRow | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<DirectoryMember[]>('/api/directory').then(setPeople).catch(() => setPeople([]));
  }, []);

  const submit = useCallback(async (values: {
    name: string; description: string; headId: string | null;
  }) => {
    setBusy(true);
    try {
      const editing = dialog?.editing;
      await api('/api/admin/departments', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(editing ? { id: editing.id, ...values } : values),
      });
      setDialog(null);
      onChanged();
      toast.success(editing ? 'Department updated' : 'Department created');
    } catch (e: any) {
      toast.error(e.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  }, [dialog, onChanged]);

  const confirmRemove = useCallback(async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api(`/api/admin/departments?id=${removing.id}`, { method: 'DELETE' });
      setRemoving(null);
      onChanged();
      toast.success('Department removed');
    } catch (e: any) {
      toast.error(e.message || 'Could not remove it');
    } finally {
      setBusy(false);
    }
  }, [removing, onChanged]);

  return (
    <Panel
      title="Departments"
      description="Who reports where. A manager sees their own department’s records, and folders can be shared with one."
      icon={Building2}
      footer={
        <Button variant="outline" className="gap-1.5" onClick={() => setDialog({ editing: null })}>
          <Plus className="size-4" /> New department
        </Button>
      }
    >
      {departments.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No departments yet.
        </p>
      ) : (
        <div className="divide-y rounded-lg border">
          {departments.map(dept => (
            <div key={dept.id} className="flex items-center gap-3 p-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                <Building2 className="size-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{dept.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {dept.headName ? `Managed by ${dept.headName}` : 'No manager assigned'}
                  {dept.description ? ` · ${dept.description}` : ''}
                </p>
              </div>
              <Badge variant="outline" className="shrink-0 gap-1 text-[10px]">
                <Users className="size-3" /> {dept.memberCount}
              </Badge>
              <Button variant="ghost" size="icon" className="size-7 shrink-0"
                onClick={() => setDialog({ editing: dept })}>
                <Pencil className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon"
                className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => setRemoving(dept)}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <DepartmentDialog
        key={dialog ? `dept-${dialog.editing?.id ?? 'new'}` : 'dept-closed'}
        state={dialog}
        people={people}
        onClose={() => setDialog(null)}
        onSubmit={submit}
        isSaving={busy}
      />

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove department"
        description={`Remove “${removing?.name}”? Anybody still filed under it has to be moved first.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={confirmRemove}
        isLoading={busy}
      />
    </Panel>
  );
}

function DepartmentDialog({
  state, people, onClose, onSubmit, isSaving,
}: {
  state: { editing: DepartmentRow | null } | null;
  people: DirectoryMember[];
  onClose: () => void;
  onSubmit: (values: { name: string; description: string; headId: string | null }) => void;
  isSaving: boolean;
}) {
  const [name, setName] = useState(state?.editing?.name ?? '');
  const [description, setDescription] = useState(state?.editing?.description ?? '');
  const [headId, setHeadId] = useState(state?.editing?.headId ?? '_none');

  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{state?.editing ? 'Edit department' : 'New department'}</DialogTitle>
          <DialogDescription>
            The manager you name here sees their department’s HR, project and attendance records.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="d-name">Name</Label>
            <Input id="d-name" value={name} autoFocus onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Marketing" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="d-desc">Description</Label>
            <Input id="d-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Manager</Label>
            <Select value={headId} onValueChange={setHeadId}>
              <SelectTrigger><SelectValue placeholder="Nobody yet" /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="_none">Nobody yet</SelectItem>
                {people.map(p => (
                  <SelectItem key={p.memberId} value={p.memberId}>{p.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={!name.trim() || isSaving}
            onClick={() => onSubmit({
              name: name.trim(),
              description: description.trim(),
              headId: headId === '_none' ? null : headId,
            })}>
            {isSaving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            {state?.editing ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
