'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, useDraggable, useDroppable, closestCorners,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { Plus, AlertTriangle, GripVertical, Handshake } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DEAL_STAGES } from '@/lib/constants';
import { useModuleRealtime } from '@/hooks/use-realtime';

import { getList, getOne, patch, listQuery, exact, money, formatDayShort, daysUntil, relativeDay } from './data';
import { SectionHead, SearchField, OwnerTag, Blank, Broken, personName, Spinner } from './ui';
import { CloseDealDialog, DealDialog } from './forms';
import { RecordSheet } from './record-sheet';
import { STAGE_LABELS, CLOSED_STAGES, type Deal, type CrmOverview } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Pipeline
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What it was ──────────────────────────────────────────────────────────
 *
 * A read-only board. Six columns of cards, each card opening an edit dialog
 * whose Stage field was a `<select>`. So the one interaction a pipeline board
 * exists for - moving a deal - took a click, a dialog, two more clicks and a
 * save, and the board was a picture of the pipeline rather than a way of
 * running it.
 *
 * ── The rules the drag obeys ─────────────────────────────────────────────
 *
 *   1. **Between open stages, it just happens.** The card moves under the
 *      pointer, the request goes, and an undo toast stands for a few seconds.
 *      That is the right trade for an action that is reversible in one click
 *      and performed twenty times a day.
 *
 *   2. **Into Won or Lost, it asks.** Not as a speed bump: those two book
 *      revenue, fire a notification and stamp a close date, and they are the
 *      two moments the product needs something only the user knows - the date
 *      it actually closed, and why it was lost. The dialog is the form that
 *      collects what nobody ever goes back and fills in later.
 *
 *   3. **A failed move puts the card back.** The optimistic state is reverted
 *      and the server's sentence is shown. A board that silently keeps a card
 *      where the database did not put it is worse than one that does not move
 *      at all.
 *
 * ── Where the column totals come from ────────────────────────────────────
 *
 * `/api/crm/overview`, which reads a GROUP BY over every deal. The cards are
 * the hundred largest per stage. Those two facts are deliberately separated:
 * a column heading that said "₦33.6m" while showing the sum of whatever
 * happened to be loaded would be wrong in exactly the workspaces that matter.
 * Where a column holds more than is drawn, it says so at the foot.
 */

const CARDS_PER_STAGE = 100;

/** Won and Lost are a recent-closures list, not an archive. */
const CARDS_PER_CLOSED_STAGE = 15;

/* -------------------------------------------------------------------------- */
/*  Card                                                                      */
/* -------------------------------------------------------------------------- */

function DealCard({
  deal, dragging, onOpen,
}: {
  deal: Deal; dragging?: boolean; onOpen?: () => void;
}) {
  /**
   * A closed card shows when it closed, not when it was expected to.
   *
   * The expected close on a won deal stopped mattering the moment it was
   * signed, and the same relative phrasing turned it into a forecast for
   * something that has already happened - "closes in fifteen weeks" on a card
   * sitting in the Won column.
   */
  const closed = CLOSED_STAGES.includes(deal.stage);
  const shownDate = closed ? deal.closedAt : deal.expectedClose;
  const left = closed ? null : daysUntil(deal.expectedClose);
  const late = left !== null && left < 0;
  const soon = left !== null && left >= 0 && left <= 14;

  return (
    <div
      className={cn(
        'group/card rounded-lg border border-border bg-card p-3 shadow-e1 transition-[box-shadow,border-color]',
        dragging
          ? 'rotate-[1.5deg] cursor-grabbing shadow-e2'
          : 'cursor-grab hover:border-foreground/25',
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 cursor-pointer text-left"
        >
          <p className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground">
            {deal.name}
          </p>
          {deal.company?.name && (
            <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{deal.company.name}</p>
          )}
        </button>
        {/*
          The whole card drags, so the grip is a hint rather than the handle -
          and a hint that is always on is furniture. It appears on hover, where
          it answers the only question the card raises: does this move?
        */}
        <GripVertical
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50 opacity-0 transition-opacity group-hover/card:opacity-100"
        />
      </div>

      <div className="mt-2.5 flex items-baseline justify-between gap-2">
        <span className="text-[14px] font-semibold tabular-nums text-foreground">
          {exact(deal.value)}
        </span>
        <span className="text-[11.5px] tabular-nums text-muted-foreground">{deal.probability}%</span>
      </div>

      <span
        aria-hidden="true"
        className="mt-1.5 block h-[3px] w-full overflow-hidden rounded-full bg-border/70"
      >
        <span
          className="block h-full rounded-full"
          style={{
            width: `${deal.probability}%`,
            background: 'color-mix(in srgb, var(--chart-1) 80%, transparent)',
          }}
        />
      </span>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        {shownDate ? (
          <span className={cn(
            'inline-flex items-center gap-1 text-[11px]',
            late ? 'font-medium text-destructive' : soon ? 'font-medium text-warning' : 'text-muted-foreground',
          )}>
            {late && <AlertTriangle className="size-3" />}
            {formatDayShort(shownDate)}
            {!closed && (
              <span className="text-muted-foreground/70">{relativeDay(shownDate)}</span>
            )}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground/60">No close date</span>
        )}
        <OwnerTag member={deal.owner} showName={false} />
      </div>
    </div>
  );
}

function Draggable({
  deal, onOpen, disabled,
}: {
  deal: Deal; onOpen: () => void; disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
    data: { stage: deal.stage },
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      /*
        ── Why the card does not set `touch-action: none` ──────────────────
        It did, and that is the correct setting for a pointer sensor with a
        distance constraint - but it also told the browser that no touch
        gesture starting on a card is a scroll. On a phone the columns scroll
        and the board scrolls sideways, and with every card opted out the only
        place left to swipe was the gap between them.

        The touch sensor's 180ms delay is what disambiguates instead: a swipe
        scrolls, a press-and-hold picks the card up. dnd-kit attaches its move
        listener non-passively, so it can still take over once the delay has
        elapsed.

        Faded rather than removed while dragging: keeping the node in the flow
        stops the column re-flowing under the pointer, which is what makes a
        board feel like it is fighting you.
      */
      className={cn(isDragging && 'opacity-30')}
    >
      <DealCard deal={deal} onOpen={onOpen} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Column                                                                    */
/* -------------------------------------------------------------------------- */

function Column({
  stage, deals, total, value, weighted, loading, over, children,
}: {
  stage: string;
  deals: Deal[];
  total: number;
  value: number;
  weighted: number;
  loading: boolean;
  over: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: stage });
  const closed = CLOSED_STAGES.includes(stage);

  return (
    <div className="flex w-[264px] shrink-0 flex-col gap-2 sm:w-[276px]">
      <header className="rounded-lg border border-border bg-card px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-[7px] shrink-0 rounded-full"
              style={{
                background: stage === 'closed_won' ? 'var(--success)'
                  : stage === 'closed_lost' ? 'var(--destructive)'
                    : `color-mix(in srgb, var(--chart-1) ${30 + DEAL_STAGES.indexOf(stage as any) * 20}%, var(--muted))`,
              }}
            />
            <span className="truncate text-[12.5px] font-semibold text-foreground">
              {STAGE_LABELS[stage] ?? stage}
            </span>
          </span>
          <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">{total}</span>
        </div>

        <p className="mt-1.5 text-[15px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-foreground">
          {money(value)}
        </p>
        {!closed && (
          <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
            {money(weighted)} weighted
          </p>
        )}
      </header>

      {/*
        ── Why the column scrolls rather than growing ──────────────────────
        Flex rows stretch their items, so the tallest column set the height of
        every other one - and the tallest is Won, which holds every deal the
        company has ever closed. A board that was six hundred pixels of content
        rendered as three and a half thousand pixels of page, with the columns
        that matter stranded at the top and nothing but whitespace below.

        Capping the body and giving it its own scroll is what a board is
        supposed to be: a fixed workspace where each column moves
        independently. `overscroll-contain` stops a flick at the bottom of one
        column scrolling the page behind it.
      */}
      <div
        ref={setNodeRef}
        className={cn(
          // The cap is measured down from the viewport rather than as a bare
          // `vh`, because the board sits below the shell header, the section
          // nav, the page heading and the search field - about nineteen rems
          // of chrome that a `64vh` column would hang below.
          'flex max-h-[min(calc(100vh-19rem),620px)] min-h-[140px] flex-1 flex-col gap-2 overflow-y-auto overscroll-contain rounded-lg border border-dashed p-1.5 transition-colors',
          '[scrollbar-width:thin]',
          over ? 'border-[var(--chart-1)] bg-[color-mix(in_srgb,var(--chart-1)_8%,transparent)]' : 'border-transparent',
        )}
      >
        {loading ? (
          <>
            <div className="h-[104px] animate-pulse rounded-lg bg-muted" />
            <div className="h-[104px] animate-pulse rounded-lg bg-muted" />
          </>
        ) : deals.length === 0 ? (
          <p className="px-2 py-6 text-center text-[11.5px] text-muted-foreground/70">
            {over ? 'Drop here' : 'Nothing here'}
          </p>
        ) : children}

        {!loading && total > deals.length && (
          <p className="px-2 pb-1 pt-0.5 text-center text-[11px] text-muted-foreground/70">
            {closed
              ? `${deals.length} most recent of ${total}`
              : `${total - deals.length} more, not shown`}
          </p>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Board                                                                     */
/* -------------------------------------------------------------------------- */

export function PipelineSection({ onOpenDeals }: { onOpenDeals?: (stage: string) => void }) {
  const [byStage, setByStage] = React.useState<Record<string, { deals: Deal[]; total: number }>>({});
  const [totals, setTotals] = React.useState<CrmOverview['stages']>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');

  const [dragging, setDragging] = React.useState<Deal | null>(null);
  const [over, setOver] = React.useState<string | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [closing, setClosing] = React.useState<{ deal: Deal; outcome: 'closed_won' | 'closed_lost' } | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      /**
       * One request per column, in parallel.
       *
       * `?stage=` is an equality filter, so there is no way to ask for "the
       * four open stages" in one call - and doing it in one call without the
       * filter would mean reading the whole book to draw a board. Six small
       * indexed reads (`idx_deals_org_stage`) are cheaper than one large one,
       * and each column gets its own honest `total`.
       */
      const stageLists = await Promise.all(DEAL_STAGES.map(async stage => {
        /**
         * The open columns are ordered by value, the closed ones by date.
         *
         * "The biggest deal we are working" is the question an open column
         * answers. "The biggest deal we have ever won" is not a question
         * anybody asks a board - what they want from the Won column is what
         * has just landed, and a short list of it rather than every closure
         * since the company started.
         */
        const closed = CLOSED_STAGES.includes(stage);
        const q = listQuery({
          stage,
          pageSize: closed ? CARDS_PER_CLOSED_STAGE : CARDS_PER_STAGE,
          sort: closed ? 'closed_at' : 'value',
          sortDir: 'desc',
          search: search || undefined,
        });
        const res = await getList<Deal>(`/api/crm/deals?${q}`);
        return [stage, { deals: res.data, total: res.meta.total }] as const;
      }));

      setByStage(Object.fromEntries(stageLists));
    } catch (e: any) {
      setError(e.message || 'The pipeline could not be loaded');
    } finally {
      setLoading(false);
    }
  }, [search]);

  /**
   * The true totals, from the database's own GROUP BY.
   *
   * Separate from the cards for two reasons. It is not re-read as somebody
   * types: the aggregate describes the whole pipeline and the cards describe
   * the search, and conflating them would make a column heading change meaning
   * mid-keystroke. And a failure here is tolerated - the board still works
   * from the per-stage counts, with the headings summing what is loaded and
   * the footer saying how much is not.
   */
  const loadTotals = React.useCallback(async () => {
    try {
      setTotals(await getOne<CrmOverview>('/api/crm/overview').then(o => o.stages ?? []));
    } catch { /* headings fall back to the loaded cards */ }
  }, []);

  React.useEffect(() => { void load(); }, [load]);
  React.useEffect(() => { void loadTotals(); }, [loadTotals]);

  useModuleRealtime('crm-pipeline', ['deals'], () => { void load(); void loadTotals(); });

  /**
   * Touch needs a delay before a drag begins, or the board cannot be scrolled
   * sideways on a phone: every swipe would pick up a card instead. 180ms with
   * a small tolerance is the threshold that separates a scroll from a
   * deliberate pick-up.
   */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const findDeal = (id: string): Deal | null => {
    for (const stage of DEAL_STAGES) {
      const hit = byStage[stage]?.deals.find(d => d.id === id);
      if (hit) return hit;
    }
    return null;
  };

  const onDragStart = (e: DragStartEvent) => setDragging(findDeal(String(e.active.id)));

  const onDragEnd = async (e: DragEndEvent) => {
    const deal = dragging;
    setDragging(null);
    setOver(null);

    const target = e.over ? String(e.over.id) : null;
    if (!deal || !target || target === deal.stage) return;

    if (CLOSED_STAGES.includes(target)) {
      setClosing({ deal, outcome: target as 'closed_won' | 'closed_lost' });
      return;
    }

    await move(deal, target);
  };

  /** Move a deal, showing it moved before the server has agreed. */
  const move = async (deal: Deal, stage: string, silent = false) => {
    const from = deal.stage;
    const probability = PROBABILITY[stage] ?? deal.probability;

    setByStage(prev => shift(prev, deal, from, stage, probability));

    try {
      await patch(`/api/crm/deals/${deal.id}`, { stage, probability });
      void loadTotals();

      if (!silent) {
        toast.success(`Moved to ${STAGE_LABELS[stage]}`, {
          description: deal.name,
          action: {
            label: 'Undo',
            onClick: () => { void move({ ...deal, stage }, from, true); },
          },
        });
      }
    } catch (err: any) {
      // Put it back where it was, and say why.
      setByStage(prev => shift(prev, { ...deal, stage }, stage, from, deal.probability));
      toast.error(err.message || 'That deal could not be moved');
    }
  };

  const stageTotal = (stage: string) =>
    totals.find(t => t.stage === stage)
    ?? {
      stage,
      count: byStage[stage]?.total ?? 0,
      value: (byStage[stage]?.deals ?? []).reduce((s, d) => s + d.value, 0),
      weighted: (byStage[stage]?.deals ?? []).reduce((s, d) => s + d.value * d.probability / 100, 0),
    };

  const anyDeals = DEAL_STAGES.some(s => (byStage[s]?.deals.length ?? 0) > 0);

  return (
    <div className="flex flex-col gap-4">
      <SectionHead
        title="Pipeline"
        note="Drag a deal to move it. Won and Lost ask for the detail."
      >
        <Button size="sm" className="h-9 gap-1.5" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" /> Add deal
        </Button>
      </SectionHead>

      <SearchField
        placeholder="Search the board"
        onChange={setSearch}
        className="lg:w-80"
      />

      {error ? (
        <Broken message={error} onRetry={load} />
      ) : loading && !anyDeals ? (
        <Spinner label="Loading the pipeline" />
      ) : !anyDeals && !search ? (
        <div className="rounded-xl border border-border bg-card shadow-e1">
          <Blank
            icon={Handshake}
            title="Nothing in the pipeline"
            body="Add a deal, or convert a lead, and it appears on this board."
            action={
              <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
                <Plus className="size-4" /> Add deal
              </Button>
            }
          />
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={e => setOver(e.over ? String(e.over.id) : null)}
          onDragEnd={onDragEnd}
          onDragCancel={() => { setDragging(null); setOver(null); }}
        >
          {/*
            The board scrolls horizontally and nothing else on the page does.
            `overscroll-x-contain` stops a swipe past the last column turning
            into a browser back gesture, which on a phone is the difference
            between a board and a trap.
          */}
          <div className="-mx-4 overflow-x-auto overscroll-x-contain px-4 pb-2 md:-mx-6 md:px-6">
            <div className="flex min-w-max gap-3">
              {DEAL_STAGES.map(stage => {
                const totalsFor = stageTotal(stage);
                const deals = byStage[stage]?.deals ?? [];

                return (
                  <Column
                    key={stage}
                    stage={stage}
                    deals={deals}
                    total={search ? deals.length : totalsFor.count}
                    value={search
                      ? deals.reduce((s, d) => s + d.value, 0)
                      : totalsFor.value}
                    weighted={search
                      ? deals.reduce((s, d) => s + d.value * d.probability / 100, 0)
                      : totalsFor.weighted}
                    loading={loading}
                    over={over === stage}
                  >
                    {deals.map(d => (
                      <Draggable
                        key={d.id}
                        deal={d}
                        disabled={Boolean(dragging && dragging.id !== d.id)}
                        onOpen={() => setOpenId(d.id)}
                      />
                    ))}
                  </Column>
                );
              })}
            </div>
          </div>

          <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }}>
            {dragging ? <div className="w-[252px]"><DealCard deal={dragging} dragging /></div> : null}
          </DragOverlay>
        </DndContext>
      )}

      <DealDialog open={addOpen} onOpenChange={setAddOpen} editing={null} onSaved={load} />

      <CloseDealDialog
        open={closing !== null}
        onOpenChange={o => { if (!o) setClosing(null); }}
        deal={closing?.deal ?? null}
        outcome={closing?.outcome ?? 'closed_won'}
        onDone={() => { void load(); void loadTotals(); }}
      />

      <RecordSheet
        kind="deal"
        id={openId}
        open={openId !== null}
        onOpenChange={o => { if (!o) setOpenId(null); }}
        onChanged={() => { void load(); void loadTotals(); }}
      />
    </div>
  );
}

/** Where a deal's probability lands when it is moved by a control, not typed. */
const PROBABILITY: Record<string, number> = {
  prospecting: 20, qualification: 40, proposal: 60, negotiation: 80,
  closed_won: 100, closed_lost: 0,
};

/** Move one card between two columns, and keep both counts honest. */
function shift(
  state: Record<string, { deals: Deal[]; total: number }>,
  deal: Deal,
  from: string,
  to: string,
  probability: number,
): Record<string, { deals: Deal[]; total: number }> {
  const next = { ...state };
  const source = next[from];
  const target = next[to];

  if (source) {
    next[from] = {
      deals: source.deals.filter(d => d.id !== deal.id),
      total: Math.max(0, source.total - 1),
    };
  }

  const moved: Deal = { ...deal, stage: to, probability };

  next[to] = target
    ? {
      // Back into value order, which is the order the column is loaded in.
      deals: [...target.deals, moved].sort((a, b) => b.value - a.value),
      total: target.total + 1,
    }
    : { deals: [moved], total: 1 };

  return next;
}
