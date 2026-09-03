'use client';

import * as React from 'react';
import { Plus, ListChecks, DoorOpen } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Card, Head, Stat, Meter } from '@/components/shared/readout/primitives';
import { Button } from '@/components/ui/button';
import {
  CHECKLIST_CATEGORY_LABELS, CHECKLIST_OWNER_LABELS, EXIT_TYPE_LABELS, labelOf,
} from '@/lib/hr';
import { useModuleRealtime } from '@/hooks/use-realtime';

import { getOne, getList, patch, whenWord, todayISO } from './data';
import { PersonCell, Blank, Skeleton, Pill, day } from './ui';
import { StartJourneyDialog, TemplateDialog } from './forms';
import type {
  Journey, ChecklistTemplate, StarterTemplateOption, EmployeeExit, Person, ChecklistItem,
} from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Journeys - onboarding and offboarding
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The thing worth understanding about this screen ──────────────────────
 *
 * **Every step here is also a to-do in somebody's My Work.** Ticking it in
 * either place ticks it in both, by trigger. So the IT manager issuing a
 * laptop never opens this screen at all - they see "Issue laptop — Ada
 * Balogun" in the list they open every morning, tick it there, and this board
 * moves.
 *
 * That is why the step rows show the assignee rather than hiding them behind a
 * hover: the question this screen answers is not "what is left" but "who is it
 * waiting on".
 *
 * ── Templates ship empty ─────────────────────────────────────────────────
 *
 * No template rows exist until somebody creates one. A seeded "Welcome to the
 * team!" step in every tenant's database is fabricated data wearing a helpful
 * hat - the first person to read the onboarding screen would be reading a
 * stranger's opinion presented as their own policy. The starters are offered
 * in the dialogue, which is a different act because somebody chose it.
 */

export function Journeys({
  canManage,
  onOpenPerson,
}: {
  canManage: boolean;
  onOpenPerson: (memberId: string) => void;
}) {
  const [journeys, setJourneys] = React.useState<Journey[]>([]);
  const [templates, setTemplates] = React.useState<ChecklistTemplate[]>([]);
  const [starters, setStarters] = React.useState<StarterTemplateOption[]>([]);
  const [exits, setExits] = React.useState<EmployeeExit[]>([]);
  const [people, setPeople] = React.useState<Person[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [view, setView] = React.useState<'active' | 'templates' | 'exits'>('active');
  const [starting, setStarting] = React.useState<'onboarding' | 'offboarding' | null>(null);
  const [newTemplate, setNewTemplate] = React.useState(false);

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [j, t, e, p] = await Promise.all([
        getList<Journey>('/api/hr/checklists?include=all'),
        getOne<{ templates: ChecklistTemplate[]; starters: StarterTemplateOption[] }>('/api/hr/templates'),
        getList<EmployeeExit>('/api/hr/exits').catch(() => ({ data: [] as EmployeeExit[] })),
        getList<Person>('/api/hr/people?pageSize=200'),
      ]);
      setJourneys(j.data);
      setTemplates(t.templates ?? []);
      setStarters(t.starters ?? []);
      setExits(e.data);
      setPeople(p.data);
    } catch (err: any) {
      if (!silent) toast.error(err.message || 'Could not load journeys');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  useModuleRealtime('hr-journeys', ['employee_checklists', 'employee_checklist_items'], () => load(true));

  if (loading) return <Card><Skeleton rows={5} /></Card>;

  const active = journeys.filter(j => j.status === 'active');
  const onboarding = active.filter(j => j.kind === 'onboarding');
  const offboarding = active.filter(j => j.kind === 'offboarding');
  const overdue = active.reduce((s, j) => s + (j.progress?.overdue ?? 0), 0);

  return (
    <div className="nm-enter space-y-4">
      <div className="grid grid-cols-2 divide-x divide-y divide-border rounded-xl border border-border bg-card sm:grid-cols-4 sm:divide-y-0">
        <Stat label="Onboarding" value={onboarding.length} />
        <Stat label="Offboarding" value={offboarding.length} />
        <Stat label="Steps overdue" value={overdue} tone={overdue ? 'warning' : 'default'} />
        <Stat label="Templates" value={templates.length} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {([
            ['active', 'In flight'],
            ['templates', 'Templates'],
            ['exits', 'Exits'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              aria-pressed={view === id}
              className={cn(
                'rounded-md border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
                view === id
                  ? 'border-foreground/20 bg-accent text-foreground'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {canManage ? (
          <div className="ml-auto flex gap-2">
            {view === 'templates' ? (
              <Button size="sm" className="h-8 text-[12.5px]" onClick={() => setNewTemplate(true)}>
                <Plus className="mr-1.5 size-3.5" />
                New template
              </Button>
            ) : (
              <>
                <Button
                  size="sm" variant="outline" className="h-8 text-[12.5px]"
                  onClick={() => setStarting('offboarding')}
                >
                  Start offboarding
                </Button>
                <Button
                  size="sm" className="h-8 text-[12.5px]"
                  onClick={() => setStarting('onboarding')}
                >
                  <Plus className="mr-1.5 size-3.5" />
                  Start onboarding
                </Button>
              </>
            )}
          </div>
        ) : null}
      </div>

      {view === 'active' ? (
        active.length ? (
          <div className="space-y-4">
            {onboarding.length ? (
              <div className="space-y-3">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Joining
                </p>
                {onboarding.map(j => (
                  <JourneyCard
                    key={j.id} journey={j} canManage={canManage}
                    onChanged={() => load(true)} onOpenPerson={onOpenPerson}
                  />
                ))}
              </div>
            ) : null}

            {offboarding.length ? (
              <div className="space-y-3">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Leaving
                </p>
                {offboarding.map(j => (
                  <JourneyCard
                    key={j.id} journey={j} canManage={canManage}
                    onChanged={() => load(true)} onOpenPerson={onOpenPerson}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <Card>
            <Blank
              title="Nobody joining or leaving"
              note="Starting an onboarding creates a to-do in each assignee's My Work, and ticking it in either place ticks it in both."
              action={canManage ? (
                <Button size="sm" onClick={() => setStarting('onboarding')}>Start one</Button>
              ) : undefined}
            />
          </Card>
        )
      ) : null}

      {view === 'templates' ? (
        templates.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {templates.map(t => (
              <Card key={t.id}>
                <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
                  <Head title={t.name} count={t.items?.length ?? 0} />
                  <Pill tone={t.kind === 'onboarding' ? 'accent' : 'quiet'}>{t.kind}</Pill>
                </div>
                {t.description ? (
                  <p className="px-4 pt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                    {t.description}
                  </p>
                ) : null}
                {t.items?.length ? (
                  <ul className="mt-2 divide-y divide-border">
                    {[...t.items]
                      .sort((a, b) => a.sortOrder - b.sortOrder)
                      .slice(0, 8)
                      .map(i => (
                        <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-1.5">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] text-foreground">{i.title}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {labelOf(CHECKLIST_CATEGORY_LABELS, i.category)} ·{' '}
                              {labelOf(CHECKLIST_OWNER_LABELS, i.owner)}
                            </span>
                          </span>
                          {/* Signed offsets are the useful half: a contract and
                              a laptop are both before the first day. */}
                          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                            {i.dueOffsetDays === 0 ? 'day 0'
                              : i.dueOffsetDays > 0 ? `+${i.dueOffsetDays}d` : `${i.dueOffsetDays}d`}
                          </span>
                        </li>
                      ))}
                    {(t.items?.length ?? 0) > 8 ? (
                      <li className="px-4 py-1.5 text-[11px] text-muted-foreground">
                        and {(t.items?.length ?? 0) - 8} more
                      </li>
                    ) : null}
                  </ul>
                ) : (
                  <Blank title="No steps" note="An empty template creates an empty checklist." />
                )}
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <Blank
              title="No templates yet"
              note="A template is what your company does when somebody joins or leaves. Nothing is pre-installed — a checklist you did not write is a stranger's opinion presented as your policy. There are starters to work from."
              action={canManage ? (
                <Button size="sm" onClick={() => setNewTemplate(true)}>Create one</Button>
              ) : undefined}
            />
          </Card>
        )
      ) : null}

      {view === 'exits' ? (
        exits.length ? (
          <Card>
            <div className="px-4 pt-3.5">
              <Head title="Exit records" count={exits.length} />
            </div>
            <ul className="mt-2 divide-y divide-border">
              {exits.map(e => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                  <PersonCell
                    id={e.member?.id ?? e.memberId}
                    name={e.member?.profiles?.fullName}
                    avatarUrl={e.member?.profiles?.avatarUrl}
                    secondary={`${labelOf(EXIT_TYPE_LABELS, e.exitType)} · last day ${day(e.lastWorkingDay)}`}
                    onClick={() => onOpenPerson(e.memberId)}
                  />
                  <div className="flex items-center gap-2">
                    {e.isRehirable === true ? <Pill tone="good">Would rehire</Pill> : null}
                    {e.isRehirable === false ? <Pill tone="bad">Would not rehire</Pill> : null}
                    {/* The account is the identity lifecycle's, and this says
                        plainly whether it has been dealt with rather than
                        implying the exit closed it. */}
                    {e.accountClosedAt
                      ? <Pill tone="quiet">Access closed</Pill>
                      : <Pill tone="warn">Access still open</Pill>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <Card>
            <Blank
              title="No exits recorded"
              note="An exit records why and when somebody left. It moves them to notice and starts the offboarding, and it deliberately does not close their account."
            />
          </Card>
        )
      ) : null}

      {starting ? (
        <StartJourneyDialog
          open
          kind={starting}
          people={people}
          onClose={() => setStarting(null)}
          onSaved={() => { setStarting(null); load(); }}
        />
      ) : null}

      {newTemplate ? (
        <TemplateDialog
          open
          starters={starters}
          onClose={() => setNewTemplate(false)}
          onSaved={() => { setNewTemplate(false); load(); }}
        />
      ) : null}
    </div>
  );
}

function JourneyCard({
  journey,
  canManage,
  onChanged,
  onOpenPerson,
}: {
  journey: Journey;
  canManage: boolean;
  onChanged: () => void;
  onOpenPerson: (id: string) => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const today = todayISO();
  const items = [...(journey.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  async function toggle(item: ChecklistItem) {
    setBusy(item.id);
    try {
      await patch(`/api/hr/checklists/items/${item.id}`, { is_done: !item.isDone });
      onChanged();
    } catch (e: any) {
      /* A step that requires a document refuses to be ticked without one, and
         says so - which is the whole point of "signed contract on file". */
      toast.error(e.message || 'Could not update the step');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3.5">
        <PersonCell
          id={journey.member?.id ?? journey.memberId}
          name={journey.member?.profiles?.fullName}
          avatarUrl={journey.member?.profiles?.avatarUrl}
          size="md"
          secondary={
            journey.kind === 'onboarding'
              ? `Starts ${day(journey.anchorDate)} · ${whenWord(journey.anchorDate)}`
              : `Last day ${day(journey.anchorDate)} · ${whenWord(journey.anchorDate)}`
          }
          onClick={() => onOpenPerson(journey.memberId)}
        />
        <div className="flex items-center gap-3">
          {journey.progress?.overdue ? (
            <Pill tone="warn">{journey.progress.overdue} overdue</Pill>
          ) : null}
          <span className="text-[12.5px] font-semibold tabular-nums text-foreground">
            {journey.progress?.done ?? 0}/{journey.progress?.total ?? 0}
          </span>
        </div>
      </div>

      <div className="px-4 pb-1 pt-2.5">
        <Meter
          value={journey.progress?.percent ?? 0}
          tone={journey.progress?.overdue ? 'warning' : 'accent'}
        />
      </div>

      <ul className="divide-y divide-border px-4 py-2">
        {items.map(item => {
          const late = !item.isDone && item.dueOn && item.dueOn < today;
          return (
            <li key={item.id} className="flex items-center gap-3 py-2">
              <button
                type="button"
                onClick={() => toggle(item)}
                disabled={busy === item.id}
                aria-pressed={item.isDone}
                aria-label={item.isDone ? `Reopen ${item.title}` : `Complete ${item.title}`}
                className={cn(
                  'flex size-[18px] shrink-0 items-center justify-center rounded border text-[10px] transition-colors',
                  item.isDone
                    ? 'border-success bg-success/15 text-success'
                    : 'border-input text-transparent hover:border-foreground/40',
                )}
              >
                ✓
              </button>

              <span className="min-w-0 flex-1">
                <span className={cn(
                  'block truncate text-[12.5px]',
                  item.isDone ? 'text-muted-foreground line-through' : 'text-foreground',
                )}>
                  {item.title}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {labelOf(CHECKLIST_CATEGORY_LABELS, item.category)}
                  {item.requiresDocument ? ' · needs a document' : ''}
                  {item.todoId ? ' · in My Work' : ''}
                </span>
              </span>

              <span className="shrink-0 text-right">
                <span className="block truncate text-[11.5px] text-foreground">
                  {item.assignee?.profiles?.fullName ?? 'Unassigned'}
                </span>
                {item.dueOn ? (
                  <span className={cn(
                    'block text-[11px]',
                    late ? 'font-medium text-warning' : 'text-muted-foreground',
                  )}>
                    {whenWord(item.dueOn)}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}

        {items.length === 0 ? (
          <li className="py-3">
            <p className="text-[12px] text-muted-foreground">
              No steps. This checklist was started without a template — add steps to it,
              or create a template so the next person gets them automatically.
            </p>
          </li>
        ) : null}
      </ul>
    </Card>
  );
}
