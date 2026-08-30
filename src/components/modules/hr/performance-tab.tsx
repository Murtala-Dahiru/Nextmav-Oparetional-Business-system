'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  Target as TargetIcon, Award, ClipboardCheck, Plus, Gauge, Send, Check,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useAppStore } from '@/store/app-store';
import { formatDate } from '@/lib/format';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  HR performance: cycles, goals, reviews and what people did
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What makes this more than a form ─────────────────────────────────────
 *
 * A goal here is either *measured* or *assessed*, and the screen never
 * confuses them. A measured goal shows progress read from the same event
 * spine the Performance module uses, with no human typing a number in. An
 * assessed goal shows two ratings side by side, the person's and their
 * manager's, because a review where only one of those is visible is a verdict
 * rather than a conversation.
 *
 * ── Why the review is not editable after sharing ─────────────────────────
 *
 * It is, in fact - but sharing is stamped, and the stamp is what the person
 * sees. The database refuses to close a review that was never shared, which
 * is the failure mode this is really guarding: an assessment filed and
 * finished without the subject ever reading it.
 */

interface Cycle {
  id: string;
  name: string;
  description: string;
  periodStart: string;
  periodEnd: string;
  status: 'planning' | 'active' | 'reviewing' | 'closed';
}

interface Goal {
  id: string;
  memberId: string;
  title: string;
  description: string;
  kind: 'measured' | 'assessed';
  metric: string | null;
  weight: number;
  status: string;
  dueOn: string | null;
  selfRating: number | null;
  managerRating: number | null;
  selfComment: string;
  managerComment: string;
  member?: { profiles?: { fullName: string; avatarUrl: string | null; jobTitle: string | null } } | null;
  cycle?: { id: string; name: string } | null;
  target?: { targetValue: string | number; currency: string; metric: string } | null;
}

interface Review {
  id: string;
  memberId: string;
  status: Review['statusName'] extends never ? string : 'not_started' | 'self_review' | 'manager_review' | 'shared' | 'closed';
  statusName?: never;
  selfComment: string;
  managerComment: string;
  overallRating: number | null;
  incentiveEligible: boolean | null;
  eligibilityNote: string;
  sharedAt: string | null;
  closedAt: string | null;
  member?: { profiles?: { fullName: string; avatarUrl: string | null; jobTitle: string | null } } | null;
  reviewer?: { profiles?: { fullName: string } } | null;
  cycle?: { id: string; name: string } | null;
}

interface Achievement {
  id: string;
  memberId: string;
  title: string;
  description: string;
  happenedOn: string;
  member?: { profiles?: { fullName: string; avatarUrl: string | null } } | null;
  recorder?: { profiles?: { fullName: string } } | null;
}

const REVIEW_WORD: Record<string, string> = {
  not_started: 'Not started',
  self_review: 'With the employee',
  manager_review: 'With the manager',
  shared: 'Shared',
  closed: 'Closed',
};

const METRIC_WORD: Record<string, string> = {
  revenue_won: 'Revenue won',
  revenue_collected: 'Revenue collected',
  deals_won: 'Deals won',
  leads_qualified: 'Leads qualified',
  activities_logged: 'Activities logged',
};

function useList<T>(url: string, nonce: number) {
  const [data, setData] = React.useState<T[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    fetch(url, { cache: 'no-store' })
      .then(async r => {
        const b = await r.json().catch(() => null);
        if (!live) return;
        if (!r.ok) { setError(b?.error?.message ?? 'That did not load.'); return; }
        setError(null);
        setData(b?.data ?? []);
      })
      .catch(() => { if (live) setError('That did not load.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [url, nonce]);

  return { data, loading, error };
}

export default function PerformanceTab() {
  const allows = useAppStore(s => s.allows);
  const mayRunCycles = allows('hr', 'manage');
  const mayReview = allows('hr', 'approve');

  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce(n => n + 1);

  const [cycleDialog, setCycleDialog] = React.useState(false);
  const [goalDialog, setGoalDialog] = React.useState(false);
  const [achDialog, setAchDialog] = React.useState(false);

  const cycles = useList<Cycle>('/api/hr/cycles?pageSize=50', nonce);
  const goals = useList<Goal>('/api/hr/goals?pageSize=100', nonce);
  const reviews = useList<Review>('/api/hr/reviews?pageSize=100', nonce);
  const achievements = useList<Achievement>('/api/hr/achievements?pageSize=50', nonce);

  const activeCycle = cycles.data.find(c => c.status === 'active' || c.status === 'reviewing')
    ?? cycles.data[0] ?? null;

  const move = async (r: Review, status: string) => {
    try {
      const res = await fetch(`/api/hr/reviews/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const b = await res.json().catch(() => null);
      if (!res.ok) throw new Error(b?.error?.message ?? 'That did not save.');
      toast.success(status === 'shared' ? 'Shared with them' : 'Review updated');
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not save.');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ── Cycles ──────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 className="text-[15px] font-semibold tracking-[-0.015em]">Review cycles</h3>
          <p className="text-[12.5px] text-muted-foreground">
            When the company reviews, and how far along it is
          </p>
          {mayRunCycles && (
            <Button size="sm" className="ml-auto h-8 gap-1.5" onClick={() => setCycleDialog(true)}>
              <Plus className="size-3.5" /> New cycle
            </Button>
          )}
        </div>

        {cycles.loading ? (
          <div className="h-16 animate-pulse rounded-xl bg-muted" />
        ) : cycles.data.length === 0 ? (
          <Empty
            icon={ClipboardCheck}
            title="No review cycle yet"
            body={mayRunCycles
              ? 'A cycle is the period goals and reviews belong to. Create one to start.'
              : 'HR has not opened a review cycle yet.'}
          />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {cycles.data.map(c => (
              <div key={c.id} className="rounded-xl border border-border bg-card p-3.5 shadow-e1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-[13.5px] font-medium">{c.name}</p>
                  <span className={cn(
                    'shrink-0 text-[11px] font-medium',
                    c.status === 'active' ? 'text-success'
                      : c.status === 'reviewing' ? 'text-warning'
                        : 'text-muted-foreground',
                  )}>
                    {c.status === 'reviewing' ? 'In review' : c.status[0].toUpperCase() + c.status.slice(1)}
                  </span>
                </div>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {formatDate(c.periodStart)} to {formatDate(c.periodEnd)}
                </p>
                {c.description && (
                  <p className="mt-1.5 text-[12px] text-muted-foreground">{c.description}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Goals ───────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 className="text-[15px] font-semibold tracking-[-0.015em]">Goals</h3>
          <p className="text-[12.5px] text-muted-foreground">
            Measured goals read their own progress. Assessed goals are judged.
          </p>
          <Button size="sm" variant="outline" className="ml-auto h-8 gap-1.5" onClick={() => setGoalDialog(true)}>
            <Plus className="size-3.5" /> Add a goal
          </Button>
        </div>

        {goals.loading ? (
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
        ) : goals.data.length === 0 ? (
          <Empty
            icon={TargetIcon}
            title="No goals set"
            body="A goal is either something to count or something to be judged on. Both belong here."
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-e1">
            {goals.data.map(g => (
              <li key={g.id} className="flex items-start gap-3 px-4 py-3">
                <span className={cn(
                  'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full',
                  g.kind === 'measured' ? 'bg-[var(--chart-1)]/12 text-[var(--chart-1)]' : 'bg-muted text-muted-foreground',
                )}>
                  {g.kind === 'measured' ? <Gauge className="size-3.5" /> : <ClipboardCheck className="size-3.5" />}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium text-foreground">{g.title}</p>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {g.member?.profiles?.fullName ?? 'Unassigned'}
                    {g.cycle?.name ? ` · ${g.cycle.name}` : ''}
                    {' · '}
                    {g.kind === 'measured'
                      ? `Measured on ${METRIC_WORD[g.metric ?? ''] ?? g.metric}`
                      : 'Assessed at review'}
                    {g.dueOn ? ` · due ${formatDate(g.dueOn)}` : ''}
                  </p>
                  {g.description && (
                    <p className="mt-1 text-[12px] text-muted-foreground">{g.description}</p>
                  )}
                </div>

                {/*
                  Assessed goals show both ratings, never one.

                  A review that displays only the manager's number is a verdict.
                  Showing the pair is what makes it a conversation, and the
                  gap between them is the most useful thing on the row.
                */}
                {g.kind === 'assessed' && (
                  <div className="shrink-0 text-right text-[11.5px]">
                    <p className="text-muted-foreground">
                      Self <span className="tabular-nums text-foreground">{g.selfRating ?? '-'}</span>
                    </p>
                    <p className="text-muted-foreground">
                      Manager <span className="tabular-nums text-foreground">{g.managerRating ?? '-'}</span>
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Reviews ─────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 className="text-[15px] font-semibold tracking-[-0.015em]">Reviews</h3>
          <p className="text-[12.5px] text-muted-foreground">
            A review is not finished until the person has seen it
          </p>
        </div>

        {reviews.loading ? (
          <div className="h-20 animate-pulse rounded-xl bg-muted" />
        ) : reviews.data.length === 0 ? (
          <Empty
            icon={ClipboardCheck}
            title="No reviews open"
            body={activeCycle
              ? `Nothing has been opened for ${activeCycle.name} yet.`
              : 'Reviews belong to a cycle. Create one first.'}
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-e1">
            {reviews.data.map(r => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium">
                    {r.member?.profiles?.fullName ?? 'Unknown member'}
                  </p>
                  <p className="text-[11.5px] text-muted-foreground">
                    {r.cycle?.name ?? 'No cycle'}
                    {' · '}{REVIEW_WORD[r.status] ?? r.status}
                    {r.reviewer?.profiles?.fullName ? ` · ${r.reviewer.profiles.fullName}` : ''}
                    {r.sharedAt ? ` · shared ${formatDate(r.sharedAt)}` : ''}
                  </p>
                </div>

                {r.overallRating !== null && (
                  <span className="shrink-0 text-[13px] tabular-nums text-foreground">
                    {r.overallRating}/5
                  </span>
                )}

                {mayReview && r.status !== 'closed' && (
                  <div className="flex shrink-0 gap-1">
                    {r.status !== 'shared' && (
                      <Button
                        size="sm" variant="outline" className="h-7 gap-1 px-2 text-[12px]"
                        onClick={() => move(r, 'shared')}
                      >
                        <Send className="size-3" /> Share
                      </Button>
                    )}
                    {r.status === 'shared' && (
                      <Button
                        size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[12px] text-muted-foreground"
                        onClick={() => move(r, 'closed')}
                      >
                        <Check className="size-3" /> Close
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Achievements ────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 className="text-[15px] font-semibold tracking-[-0.015em]">Recorded achievements</h3>
          <p className="text-[12.5px] text-muted-foreground">
            Things worth citing at review time. Written about somebody, not by them.
          </p>
          {mayReview && (
            <Button size="sm" variant="outline" className="ml-auto h-8 gap-1.5" onClick={() => setAchDialog(true)}>
              <Plus className="size-3.5" /> Record one
            </Button>
          )}
        </div>

        {achievements.loading ? (
          <div className="h-20 animate-pulse rounded-xl bg-muted" />
        ) : achievements.data.length === 0 ? (
          <Empty
            icon={Award}
            title="Nothing recorded yet"
            body="A dated note about something somebody did. Not badges or points: evidence a promotion case can cite."
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-e1">
            {achievements.data.map(a => (
              <li key={a.id} className="px-4 py-3">
                <p className="text-[13.5px] font-medium">{a.title}</p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {a.member?.profiles?.fullName ?? 'Unknown member'}
                  {' · '}{formatDate(a.happenedOn)}
                  {a.recorder?.profiles?.fullName ? ` · recorded by ${a.recorder.profiles.fullName}` : ''}
                </p>
                {a.description && (
                  <p className="mt-1 text-[12px] text-muted-foreground">{a.description}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <CycleDialog open={cycleDialog} onOpenChange={setCycleDialog} onSaved={reload} />
      <GoalDialog open={goalDialog} onOpenChange={setGoalDialog} onSaved={reload} cycles={cycles.data} />
      <AchievementDialog open={achDialog} onOpenChange={setAchDialog} onSaved={reload} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Empty({ icon: Icon, title, body }: { icon: React.ElementType; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-border bg-card px-6 py-10 text-center shadow-e1">
      <span className="mb-3 flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-[18px]" />
      </span>
      <p className="text-[14px] font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function usePeople() {
  const [people, setPeople] = React.useState<{ id: string; name: string }[]>([]);
  React.useEffect(() => {
    fetch('/api/directory', { cache: 'no-store' })
      .then(r => r.json())
      .then(b => setPeople((b?.data ?? []).map((p: any) => ({ id: p.member_id, name: p.full_name }))))
      .catch(() => { /* the picker simply stays empty */ });
  }, []);
  return people;
}

function CycleDialog({ open, onOpenChange, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void;
}) {
  const [name, setName] = React.useState('');
  const [start, setStart] = React.useState('');
  const [end, setEnd] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const now = new Date();
    const y = now.getUTCFullYear();
    const half = now.getUTCMonth() < 6 ? 1 : 2;
    setName(`H${half} ${y}`);
    setStart(half === 1 ? `${y}-01-01` : `${y}-07-01`);
    setEnd(half === 1 ? `${y}-06-30` : `${y}-12-31`);
  }, [open]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/hr/cycles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, periodStart: start, periodEnd: end, status: 'active' }),
      });
      const b = await res.json().catch(() => null);
      if (!res.ok) throw new Error(b?.error?.message ?? 'That did not save.');
      toast.success('Cycle created');
      onOpenChange(false); onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not save.');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New review cycle</DialogTitle>
          <DialogDescription>
            The period goals and reviews belong to. Everybody can see when it runs.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cycle-name">Name</Label>
            <Input id="cycle-name" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cycle-start">From</Label>
              <Input id="cycle-start" type="date" value={start} onChange={e => setStart(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cycle-end">To</Label>
              <Input id="cycle-end" type="date" value={end} onChange={e => setEnd(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GoalDialog({ open, onOpenChange, onSaved, cycles }: {
  open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void; cycles: Cycle[];
}) {
  const people = usePeople();
  const [member, setMember] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [kind, setKind] = React.useState<'measured' | 'assessed'>('assessed');
  const [metric, setMetric] = React.useState('revenue_won');
  const [cycle, setCycle] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setMember(''); setTitle(''); setDescription('');
    setKind('assessed'); setMetric('revenue_won');
    setCycle(cycles.find(c => c.status === 'active')?.id ?? '');
  }, [open, cycles]);

  const save = async () => {
    if (!title.trim()) return toast.error('Say what the goal is');
    setSaving(true);
    try {
      const res = await fetch('/api/hr/goals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId: member || undefined,
          cycleId: cycle || null,
          title, description, kind,
          metric: kind === 'measured' ? metric : undefined,
        }),
      });
      const b = await res.json().catch(() => null);
      if (!res.ok) throw new Error(b?.error?.message ?? 'That did not save.');
      toast.success('Goal added');
      onOpenChange(false); onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not save.');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a goal</DialogTitle>
          <DialogDescription>
            A measured goal counts itself from what happens in the CRM. An assessed
            goal is judged by a person at review time. Both are real work.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="goal-title">Goal</Label>
            <Input
              id="goal-title" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Mentor two junior sellers"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Kind</Label>
            <div className="flex gap-1.5">
              {(['assessed', 'measured'] as const).map(k => (
                <button
                  key={k} type="button" onClick={() => setKind(k)}
                  className={cn(
                    'rounded-md border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
                    kind === k
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {k === 'assessed' ? 'Judged at review' : 'Counted automatically'}
                </button>
              ))}
            </div>
          </div>

          {kind === 'measured' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="goal-metric">Counts</Label>
              <select
                id="goal-metric" value={metric} onChange={e => setMetric(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-[13px]"
              >
                {Object.entries(METRIC_WORD).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="goal-who">For</Label>
              <select
                id="goal-who" value={member} onChange={e => setMember(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-[13px]"
              >
                <option value="">Myself</option>
                {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="goal-cycle">Cycle</Label>
              <select
                id="goal-cycle" value={cycle} onChange={e => setCycle(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-[13px]"
              >
                <option value="">No cycle</option>
                {cycles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="goal-desc">Notes</Label>
            <Textarea
              id="goal-desc" rows={2} value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What good looks like"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving' : 'Add goal'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AchievementDialog({ open, onOpenChange, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void;
}) {
  const people = usePeople();
  const [member, setMember] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [when, setWhen] = React.useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setMember(''); setTitle(''); setDescription('');
    setWhen(new Date().toISOString().slice(0, 10));
  }, [open]);

  const save = async () => {
    if (!member) return toast.error('Choose who this is about');
    if (!title.trim()) return toast.error('Say what they did');
    setSaving(true);
    try {
      const res = await fetch('/api/hr/achievements', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: member, title, description, happenedOn: when }),
      });
      const b = await res.json().catch(() => null);
      if (!res.ok) throw new Error(b?.error?.message ?? 'That did not save.');
      toast.success('Recorded');
      onOpenChange(false); onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not save.');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record an achievement</DialogTitle>
          <DialogDescription>
            A dated note about something somebody did, which a review or a
            promotion case can cite later. You cannot record one about yourself.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ach-who">About</Label>
            <select
              id="ach-who" value={member} onChange={e => setMember(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-[13px]"
            >
              <option value="">Choose a person</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ach-title">What they did</Label>
            <Input
              id="ach-title" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Rescued the Corvo Health renewal"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ach-when">When</Label>
            <Input id="ach-when" type="date" value={when} onChange={e => setWhen(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ach-desc">Detail</Label>
            <Textarea
              id="ach-desc" rows={2} value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Enough that somebody reading it in six months understands"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving' : 'Record'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
