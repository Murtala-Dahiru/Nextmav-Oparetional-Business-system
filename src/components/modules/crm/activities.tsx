'use client';

import * as React from 'react';
import { Plus, CornerUpRight, Sparkles, CheckCircle2, Inbox } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useModuleRealtime } from '@/hooks/use-realtime';

import { getList, listQuery } from './data';
import {
  SectionHead, SearchField, FilterRow, FilterToggle, Blank, Broken, Spinner,
} from './ui';
import { Panel, NextActions, Timeline, useDeleteActivity } from './record-parts';
import { ActivityDialog } from './activity-dialog';
import { ACTIVITY_TYPES, type CrmActivity } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Activities
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The two halves ───────────────────────────────────────────────────────
 *
 * A CRM activity is one of two things and the screen has to keep them apart:
 *
 *   **Owed.** A follow-up with a date on it that has not happened. This is a
 *   diary, it is personal, and it is read forwards - Overdue first, then
 *   Today, then what is coming.
 *
 *   **Done.** What was said and to whom. This is history, it belongs to the
 *   company rather than to a person, and it is read backwards.
 *
 * The old tab drew both as one undifferentiated grid of cards, sorted by
 * creation date, which is the wrong order for either of them.
 *
 * ── What the grid of cards was ───────────────────────────────────────────
 *
 * Three across, bordered, each with a coloured pill and a footer. A
 * chronology in a grid has no direction: the reader has to check every card's
 * date to work out the order, which is the one thing a timeline exists to
 * save. See `Timeline` in `record-parts.tsx`.
 */

type View = 'overdue' | 'today' | 'upcoming' | 'done' | 'history';

/** The footer under a windowed list: what is shown, and how to see more. */
function More({
  shown, total, onMore,
}: {
  shown: number; total: number; onMore: () => void;
}) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
      <p className="text-[12px] tabular-nums text-muted-foreground">
        {shown} of {total}
      </p>
      <Button size="sm" variant="outline" className="h-7 text-[12px]" onClick={onMore}>
        Show more
      </Button>
    </div>
  );
}

const VIEWS: { value: View; label: string }[] = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'done', label: 'Completed' },
  { value: 'history', label: 'Everything logged' },
];

export function ActivitiesSection() {
  const [view, setView] = React.useState<View>('today');
  /**
   * The first view is chosen from what is actually in there.
   *
   * Landing on Today is right when something is due today and wrong the rest
   * of the time - which, in a workspace with forty-six logged activities and
   * nothing scheduled, meant the screen opened on an empty box and hid every
   * thing it had. The order is the order of urgency: what has slipped, then
   * today, then what is coming, and if none of those exist, the history.
   *
   * It runs once. After that the view is the reader's, and a queue emptying
   * under them must not move the screen.
   */
  const chosen = React.useRef(false);
  const [type, setType] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [mine, setMine] = React.useState(true);

  const [rows, setRows] = React.useState<CrmActivity[]>([]);
  const [total, setTotal] = React.useState(0);
  const [counts, setCounts] = React.useState<Record<string, number>>({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  /**
   * How much of the timeline is drawn.
   *
   * A history is unbounded by nature, and rendering all of it produced a four
   * thousand pixel page on a workspace with forty-six entries - which is a
   * small one. Thirty is about a screen and a half; the rest is one click, and
   * the footer says how much is left rather than stopping silently.
   */
  const [limit, setLimit] = React.useState(30);

  const [logOpen, setLogOpen] = React.useState(false);
  const [followOpen, setFollowOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<CrmActivity | null>(null);
  const [nonce, setNonce] = React.useState(0);

  const reload = React.useCallback(() => setNonce(n => n + 1), []);
  const deleteActivity = useDeleteActivity(reload);

  const isQueue = view !== 'history';

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const query = listQuery({
      pageSize: limit,
      ...(view === 'history'
        ? { logged: 'true', sort: 'created_at', sortDir: 'desc' }
        : view === 'done'
          ? { due: 'done', sort: 'completed_at', sortDir: 'desc' }
          : { due: view, sort: 'due_at', sortDir: view === 'upcoming' ? 'asc' : 'asc' }),
      ...(mine && view !== 'history' ? { mine: 'true' } : {}),
      activityType: type || undefined,
      search: search || undefined,
    });

    getList<CrmActivity>(`/api/crm/activities?${query}`)
      .then(res => {
        if (cancelled) return;
        setRows(res.data);
        setTotal(res.meta.total);
        setError(null);
      })
      .catch((e: Error) => { if (!cancelled) { setRows([]); setError(e.message); } })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [view, type, search, mine, limit, nonce]);

  // Changing what is shown starts the window again; keeping a reader's depth
  // across a different question would open the new one part-way down.
  React.useEffect(() => { setLimit(30); }, [view, type, search, mine]);

  /**
   * The three queue counts, so the tabs say how much is behind them.
   *
   * `head`-style count reads rather than three full lists: the number is all
   * that is wanted and the rows would be thrown away. Failures are silent -
   * a missing count renders as nothing rather than as zero, because zero is a
   * claim and "we could not check" is not.
   */
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const wanted: View[] = ['overdue', 'today', 'upcoming'];
      const found = await Promise.all(wanted.map(async v => {
        try {
          const res = await getList<CrmActivity>(
            `/api/crm/activities?${listQuery({ due: v, pageSize: 1, ...(mine ? { mine: 'true' } : {}) })}`,
          );
          return [v, res.meta.total] as const;
        } catch {
          return [v, -1] as const;
        }
      }));
      if (cancelled) return;

      const next = Object.fromEntries(found.filter(([, n]) => n >= 0));
      setCounts(next);

      if (!chosen.current) {
        chosen.current = true;
        const first = wanted.find(v => (next[v] ?? 0) > 0);
        setView(first ?? 'history');
      }
    })();
    return () => { cancelled = true; };
  }, [mine, nonce]);

  useModuleRealtime('crm-activities', ['crm_activities'], reload);

  const typeOptions = React.useMemo(() => [
    { value: '', label: 'All types' },
    ...ACTIVITY_TYPES.map(t => ({ value: t.value, label: t.label })),
  ], []);

  return (
    <div className="flex flex-col gap-4">
      <SectionHead title="Activities" note="What has happened, and what is owed">
        <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => setFollowOpen(true)}>
          <CornerUpRight className="size-4" /> Schedule follow-up
        </Button>
        <Button size="sm" className="h-9 gap-1.5" onClick={() => setLogOpen(true)}>
          <Plus className="size-4" /> Log activity
        </Button>
      </SectionHead>

      <FilterRow
        ariaLabel="Which activities to show"
        value={view}
        onChange={v => setView(v as View)}
        options={VIEWS.map(v => ({
          ...v,
          count: v.value === 'overdue' || v.value === 'today' || v.value === 'upcoming'
            ? counts[v.value]
            : undefined,
        }))}
      />

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <SearchField
          placeholder="Search subjects and notes"
          onChange={setSearch}
          className="lg:w-80"
        />

        <div className="flex flex-1 flex-wrap items-center gap-2 lg:justify-end">
          {/*
            Eleven types as a pill row was a filter people scan past. It is a
            long closed list that is rarely narrowed, which is exactly what a
            select is for - and it hands the row back to the two controls that
            are used constantly.
          */}
          <Select value={type || '__all'} onValueChange={v => setType(v === '__all' ? '' : v)}>
            <SelectTrigger className="h-9 w-[168px] text-[12.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {typeOptions.map(t => (
                <SelectItem key={t.value || '__all'} value={t.value || '__all'} className="text-[13px]">
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isQueue && (
            <FilterToggle label="Only mine" active={mine} onChange={setMine} />
          )}
        </div>
      </div>

      {error ? (
        <Broken message={error} onRetry={reload} />
      ) : loading ? (
        <div className="rounded-xl border border-border bg-card shadow-e1">
          <Spinner label="Loading activities" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card shadow-e1">
          {view === 'overdue' ? (
            <Blank
              icon={CheckCircle2}
              title="Nothing overdue"
              body={mine ? 'Nothing you owe has slipped.' : 'Nothing anyone owes has slipped.'}
            />
          ) : view === 'today' ? (
            <Blank
              icon={Inbox}
              title="Nothing due today"
              body="Schedule a follow-up and it appears here on the day it is owed."
              action={
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setFollowOpen(true)}>
                  <CornerUpRight className="size-4" /> Schedule follow-up
                </Button>
              }
            />
          ) : view === 'upcoming' ? (
            <Blank
              icon={Inbox}
              title="Nothing scheduled"
              body="A customer with no next action is the commonest way one goes quiet."
              action={
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setFollowOpen(true)}>
                  <CornerUpRight className="size-4" /> Schedule follow-up
                </Button>
              }
            />
          ) : (
            <Blank
              icon={Sparkles}
              title={search || type ? 'Nothing matches' : 'Nothing logged yet'}
              body={
                search || type
                  ? 'Try a different search, or show all types.'
                  : 'Record a call, a meeting or an email and it appears here and on the customer.'
              }
              action={
                search || type ? (
                  <Button variant="outline" size="sm" onClick={() => { setSearch(''); setType(''); }}>
                    Clear filters
                  </Button>
                ) : (
                  <Button size="sm" className="gap-1.5" onClick={() => setLogOpen(true)}>
                    <Plus className="size-4" /> Log activity
                  </Button>
                )
              }
            />
          )}
        </div>
      ) : isQueue && view !== 'done' ? (
        <Panel title={VIEWS.find(v => v.value === view)!.label} count={total}>
          <NextActions
            items={rows}
            onChanged={reload}
            onEdit={a => { setEditing(a); setFollowOpen(true); }}
          />
          {total > rows.length && <More shown={rows.length} total={total} onMore={() => setLimit(n => n + 30)} />}
        </Panel>
      ) : (
        <Panel title={view === 'done' ? 'Completed' : 'Everything logged'} count={total}>
          <Timeline items={rows} onDelete={deleteActivity} />
          {total > rows.length && <More shown={rows.length} total={total} onMore={() => setLimit(n => n + 30)} />}
        </Panel>
      )}

      <ActivityDialog
        open={logOpen} onOpenChange={setLogOpen}
        mode="log" onSaved={reload}
      />
      <ActivityDialog
        open={followOpen}
        onOpenChange={o => { setFollowOpen(o); if (!o) setEditing(null); }}
        mode="followup" editing={editing} onSaved={reload}
      />
    </div>
  );
}
