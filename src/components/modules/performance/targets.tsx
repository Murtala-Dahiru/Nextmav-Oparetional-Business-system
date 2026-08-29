'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Plus, Target as TargetIcon, Trash2, History } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal } from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { cn } from '@/lib/utils';

import { useEndpoint, metricValue, formatDay } from './data';
import { SectionHead, Avatar, Blank, Spinner, Broken } from './ui';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Targets
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The only thing in this module that is written down. Everything else is
 * derived from what happened; a target is what somebody said they would do,
 * and no aggregate can recover it.
 *
 * ── Why superseding, not editing ─────────────────────────────────────────
 *
 * A target for a period that has finished is history: somebody was measured
 * against that number, and a commission may have been paid on it. The
 * database refuses to change the figure on a closed period, so the screen
 * offers the honest alternative instead - a new target that supersedes the
 * old one, with both left visible. This is the same reasoning that gave
 * `deal_stage_events` no UPDATE policy.
 */

const METRICS = [
  { id: 'revenue_won', label: 'Revenue won', unit: 'money' as const },
  { id: 'revenue_collected', label: 'Revenue collected', unit: 'money' as const },
  { id: 'deals_won', label: 'Deals won', unit: 'count' as const },
  { id: 'leads_qualified', label: 'Leads qualified', unit: 'count' as const },
  { id: 'activities_logged', label: 'Activities logged', unit: 'count' as const },
];

interface TargetRow {
  id: string;
  subject_type: 'member' | 'team' | 'department';
  subject_id: string;
  metric: string;
  target_value: string | number;
  currency: string;
  period_label: string;
  period_start: string;
  period_end: string;
  notes: string;
  superseded_by: string | null;
  setter?: { profiles?: { full_name: string; avatar_url: string | null } } | null;
}

interface Member { id: string; name: string; avatarUrl: string | null; jobTitle: string | null }

export function TargetsSection() {
  const allows = useAppStore(s => s.allows);
  const mayWrite = allows('performance', 'create');

  const [nonce, setNonce] = React.useState(0);
  const [formOpen, setFormOpen] = React.useState(false);
  const [supersede, setSupersede] = React.useState<TargetRow | null>(null);

  const listUrl = `/api/performance/targets?pageSize=200&sort=period_start&sortDir=desc&_=${nonce}`;
  const list = useEndpoint<TargetRow[]>(listUrl);
  /**
   * The people picker.
   *
   * `/api/directory` is the endpoint every picker in the product uses, and it
   * returns `v_assignable_members` rows verbatim - snake_case, with
   * `member_id` as the key rather than `id`. Mapped here rather than wished
   * into a different shape: the endpoint is shared by eleven other screens and
   * changing it for this one is how a picker somewhere else goes blank.
   */
  const people = useEndpoint<{
    member_id: string; full_name: string; avatar_url: string | null; job_title: string | null;
  }[]>('/api/directory');

  const members: Member[] = React.useMemo(
    () => (people.data ?? []).map(p => ({
      id: p.member_id, name: p.full_name, avatarUrl: p.avatar_url, jobTitle: p.job_title,
    })),
    [people.data],
  );

  const byId = React.useMemo(
    () => new Map(members.map(m => [m.id, m])),
    [members],
  );

  const reload = () => setNonce(n => n + 1);

  if (list.loading && !list.data) return <Spinner label="Reading targets" />;
  if (list.error) return <Broken message={list.error} onRetry={list.reload} />;

  const rows = list.data ?? [];
  const live = rows.filter(r => !r.superseded_by);
  const past = rows.filter(r => r.superseded_by);

  return (
    <div className="flex flex-col gap-5">
      <SectionHead
        title="Targets"
        count={live.length}
        note="What people committed to, and for when"
      >
        {mayWrite && (
          <Button size="sm" className="h-9 gap-1.5" onClick={() => { setSupersede(null); setFormOpen(true); }}>
            <Plus className="size-4" /> Set a target
          </Button>
        )}
      </SectionHead>

      {live.length === 0 ? (
        <div className="rounded-xl border border-border bg-card shadow-e1">
          <Blank
            icon={TargetIcon}
            title="No targets set"
            body={mayWrite
              ? 'A target turns a running total into progress. Set one for a person, a team or a department.'
              : 'Nobody has set a target you can see. Your manager or HR sets these.'}
            action={mayWrite
              ? <Button size="sm" onClick={() => setFormOpen(true)}>Set a target</Button>
              : undefined}
          />
        </div>
      ) : (
        <TargetTable
          rows={live}
          byId={byId}
          mayWrite={mayWrite}
          onSupersede={r => { setSupersede(r); setFormOpen(true); }}
          onChanged={reload}
        />
      )}

      {past.length > 0 && (
        <details className="rounded-xl border border-border bg-card shadow-e1">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-[12.5px] font-medium text-muted-foreground">
            <History className="size-3.5" />
            {past.length} superseded {past.length === 1 ? 'target' : 'targets'}
          </summary>
          <div className="border-t border-border">
            <TargetTable rows={past} byId={byId} mayWrite={false} onSupersede={() => {}} onChanged={reload} muted />
          </div>
        </details>
      )}

      <TargetDialog
        open={formOpen}
        onOpenChange={o => { setFormOpen(o); if (!o) setSupersede(null); }}
        members={members}
        supersede={supersede}
        onSaved={reload}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function TargetTable({
  rows, byId, mayWrite, onSupersede, onChanged, muted,
}: {
  rows: TargetRow[];
  byId: Map<string, Member>;
  mayWrite: boolean;
  onSupersede: (r: TargetRow) => void;
  onChanged: () => void;
  muted?: boolean;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);

  const remove = async (r: TargetRow) => {
    setBusy(r.id);
    try {
      const res = await fetch(`/api/performance/targets/${r.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'That did not delete.');
      }
      toast.success('Target removed');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not delete.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <ul className={cn('divide-y divide-border', !muted && 'overflow-hidden rounded-xl border border-border bg-card shadow-e1')}>
      {rows.map(r => {
        const who = r.subject_type === 'member' ? byId.get(r.subject_id) : null;
        const meta = METRICS.find(m => m.id === r.metric);
        const label = r.subject_type === 'member'
          ? (who?.name ?? 'A member who has left')
          : `${r.subject_type === 'team' ? 'Team' : 'Department'} target`;

        return (
          <li key={r.id} className={cn('flex items-center gap-3 px-4 py-3', muted && 'opacity-70')}>
            {r.subject_type === 'member'
              ? <Avatar name={who?.name ?? '?'} url={who?.avatarUrl} />
              : (
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <TargetIcon className="size-3.5" />
                </span>
              )}

            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium text-foreground">{label}</span>
              <span className="block truncate text-[11.5px] text-muted-foreground">
                {meta?.label ?? r.metric} · {r.period_label || `${formatDay(r.period_start)} to ${formatDay(r.period_end)}`}
              </span>
            </span>

            <span className="shrink-0 text-right">
              <span className="block text-[14px] font-semibold tabular-nums text-foreground">
                {metricValue(Number(r.target_value), meta?.unit ?? 'count', r.currency)}
              </span>
              {r.setter?.profiles?.full_name && (
                <span className="block text-[11px] text-muted-foreground">
                  set by {r.setter.profiles.full_name}
                </span>
              )}
            </span>

            {mayWrite && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-8 shrink-0" disabled={busy === r.id}>
                    <MoreHorizontal className="size-4" />
                    <span className="sr-only">Actions for this target</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onSupersede(r)}>
                    <History className="mr-2 size-4" /> Replace with a new target
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => remove(r)}
                  >
                    <Trash2 className="mr-2 size-4" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */

function TargetDialog({
  open, onOpenChange, members, supersede, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  members: Member[];
  supersede: TargetRow | null;
  onSaved: () => void;
}) {
  const thisQuarter = React.useMemo(() => {
    const now = new Date();
    const y = now.getUTCFullYear();
    const q = Math.floor(now.getUTCMonth() / 3);
    const startMonth = q * 3 + 1;
    return {
      start: `${y}-${String(startMonth).padStart(2, '0')}-01`,
      end: new Date(Date.UTC(y, startMonth + 2, 0)).toISOString().slice(0, 10),
      label: `Q${q + 1} ${y}`,
    };
  }, []);

  const [subjectId, setSubjectId] = React.useState('');
  const [metric, setMetric] = React.useState('revenue_won');
  const [value, setValue] = React.useState('');
  const [start, setStart] = React.useState(thisQuarter.start);
  const [end, setEnd] = React.useState(thisQuarter.end);
  const [label, setLabel] = React.useState(thisQuarter.label);
  const [notes, setNotes] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  /* A replacement starts as a copy of what it replaces, minus the number. */
  React.useEffect(() => {
    if (!open) return;
    if (supersede) {
      setSubjectId(supersede.subject_id);
      setMetric(supersede.metric);
      setValue('');
      setStart(supersede.period_start);
      setEnd(supersede.period_end);
      setLabel(supersede.period_label);
      setNotes('');
    } else {
      setSubjectId('');
      setMetric('revenue_won');
      setValue('');
      setStart(thisQuarter.start);
      setEnd(thisQuarter.end);
      setLabel(thisQuarter.label);
      setNotes('');
    }
  }, [open, supersede, thisQuarter]);

  const save = async () => {
    if (!subjectId) return toast.error('Choose who this target is for');
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return toast.error('A target has to be a number above zero');

    setSaving(true);
    try {
      const res = await fetch('/api/performance/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_type: 'member',
          subject_id: subjectId,
          metric,
          target_value: n,
          period_start: start,
          period_end: end,
          period_label: label,
          notes,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? 'That did not save.');

      /*
       * Point the old target at the new one, so both stay readable and only
       * one is current. Done after the insert succeeds, because a supersede
       * flag on a row whose replacement failed to save would hide the only
       * live target.
       */
      if (supersede && body?.data?.id) {
        await fetch(`/api/performance/targets/${supersede.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ supersededBy: body.data.id }),
        });
      }

      toast.success(supersede ? 'Target replaced' : 'Target set');
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not save.');
    } finally {
      setSaving(false);
    }
  };

  const unit = METRICS.find(m => m.id === metric)?.unit ?? 'count';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{supersede ? 'Replace this target' : 'Set a target'}</DialogTitle>
          <DialogDescription>
            {supersede
              ? 'The old target stays visible, marked as superseded, so the history of what somebody was measured against is intact.'
              : 'Targets are what progress is measured against. Everything else on this screen is worked out from what actually happened.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="target-who">Who</Label>
            <select
              id="target-who"
              value={subjectId}
              onChange={e => setSubjectId(e.target.value)}
              disabled={Boolean(supersede)}
              className="h-9 rounded-md border border-input bg-background px-3 text-[13px]"
            >
              <option value="">Choose a person</option>
              {members.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}{m.jobTitle ? ` - ${m.jobTitle}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="target-metric">Measure</Label>
              <select
                id="target-metric"
                value={metric}
                onChange={e => setMetric(e.target.value)}
                disabled={Boolean(supersede)}
                className="h-9 rounded-md border border-input bg-background px-3 text-[13px]"
              >
                {METRICS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="target-value">
                Target {unit === 'money' ? 'amount' : 'count'}
              </Label>
              <Input
                id="target-value"
                inputMode="decimal"
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder={unit === 'money' ? '40000000' : '20'}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="target-start">From</Label>
              <Input id="target-start" type="date" value={start} onChange={e => setStart(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="target-end">To</Label>
              <Input id="target-end" type="date" value={end} onChange={e => setEnd(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="target-label">Called</Label>
              <Input id="target-label" value={label} onChange={e => setLabel(e.target.value)} placeholder="Q3 2026" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="target-notes">Notes</Label>
            <Textarea
              id="target-notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="What this number is based on, if it needs saying"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving' : supersede ? 'Replace target' : 'Set target'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
