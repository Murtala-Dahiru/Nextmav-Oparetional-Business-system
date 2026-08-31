'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  Plus, Handshake, Pencil, Trash2, CornerUpRight, ExternalLink, Trophy, XCircle,
  AlertTriangle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { AddToMyWorkItem } from '@/components/shared/add-to-my-work';
import { DEAL_STAGES } from '@/lib/constants';
import { cn } from '@/lib/utils';

import { useAppStore } from '@/store/app-store';

import { useCrmList } from './use-list';
import { RecordTable, type Column } from '@/components/shared/record-table';
import {
  SectionHead, SearchField, FilterRow, FilterToggle, StageTag, OwnerTag, Blank, Broken,
  personName, sourceLabel,
} from './ui';
import { exact, remove, formatDayShort, daysUntil, relativeDay } from './data';
import { DealDialog, CloseDealDialog } from './forms';
import { ActivityDialog } from './activity-dialog';
import { RecordSheet } from './record-sheet';
import { STAGE_LABELS, CLOSED_STAGES, type Deal } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Deals
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The list view of the pipeline. Pipeline is the board; this is the ledger -
 * sortable by value, by close date, by stage, and the only one of the two that
 * can answer "show me everything closing in March, biggest first".
 *
 * ── The two columns that are new ─────────────────────────────────────────
 *
 *   · **Weighted.** Value times probability. It was computed nowhere in the
 *     product's UI despite `v_pipeline_summary` having done it in the database
 *     since 0007, and it is the figure a forecast is actually made of.
 *
 *   · **Close date, with its distance.** "12 Mar" is a date; "12 Mar,
 *     3 days ago" is a problem. An open deal whose expected close has passed
 *     is the commonest thing wrong with a pipeline and nothing said so.
 *
 * ── What was removed ─────────────────────────────────────────────────────
 *
 * A recharts bar chart of deals by stage, sitting above the table, drawn from
 * the same capped hundred rows as the stat cards. CRM Home draws that chart
 * from a GROUP BY over every deal; two versions of one chart disagreeing is
 * worse than one of them not existing.
 */

/**
 * The line under a deal's name: who it is with.
 *
 * Most deals get named after the customer, so "Corvo Health - hardware
 * refresh" with "Corvo Health · Amara Salami" beneath it says the company
 * twice and the useful half - the person - is what gets truncated away on a
 * narrow screen. When the name already opens with the company, the company is
 * dropped from the line rather than the person.
 */
function subtitle(d: Deal): string {
  const company = (d.company?.name ?? '').trim();
  const who = personName(d.contact);
  const named = company && d.name.toLowerCase().startsWith(company.toLowerCase());

  const parts = [named ? '' : company, who].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return company ? 'No contact linked' : 'No customer linked';
}

export function DealsSection({
  focusId, onFocusHandled, initialStage,
}: {
  focusId?: string | null;
  onFocusHandled?: () => void;
  /** A stage handed over from CRM Home, so a click on a bar arrives filtered. */
  initialStage?: string | null;
}) {
  const memberId = useAppStore(s => s.user?.memberId ?? null);

  const list = useCrmList<Deal>('/api/crm/deals', {
    channel: 'crm-deals',
    watch: ['deals'],
    defaultSort: 'updatedAt',
  });

  const [open, setOpen] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<Deal | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [logging, setLogging] = React.useState<Deal | null>(null);
  const [scheduling, setScheduling] = React.useState<Deal | null>(null);
  const [closing, setClosing] = React.useState<{ deal: Deal; outcome: 'closed_won' | 'closed_lost' } | null>(null);
  const [deleting, setDeleting] = React.useState<Deal | null>(null);
  const [removing, setRemoving] = React.useState(false);

  const applied = React.useRef(false);
  React.useEffect(() => {
    if (!initialStage || applied.current) return;
    applied.current = true;
    list.setFilter('stage', initialStage);
  }, [initialStage, list]);

  React.useEffect(() => {
    if (!focusId) return;
    setOpen(focusId);
    onFocusHandled?.();
  }, [focusId, onFocusHandled]);

  const confirmDelete = async () => {
    if (!deleting) return;
    setRemoving(true);
    try {
      await remove(`/api/crm/deals/${deleting.id}`);
      toast.success('Deal deleted');
      setDeleting(null);
      list.reload();
    } catch (e: any) {
      toast.error(e.message || 'That could not be deleted');
    } finally {
      setRemoving(false);
    }
  };

  const columns: Column<Deal>[] = React.useMemo(() => [
    {
      key: 'name', header: 'Deal', width: '30%', card: 'title',
      cell: d => (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-foreground">{d.name}</span>
          <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
            {subtitle(d)}
          </span>
        </span>
      ),
    },
    {
      key: 'stage', header: 'Stage', width: '14%', card: 'meta',
      cell: d => <StageTag stage={d.stage} />,
    },
    {
      key: 'value', header: 'Value', width: '13%', align: 'right', card: 'figure',
      cell: d => <span className="font-medium">{exact(d.value)}</span>,
    },
    {
      key: 'probability', header: 'Weighted', width: '13%', align: 'right', hide: 'lg',
      /*
        A closed deal has no weighted value: it is worth what it is worth, or
        nothing. Rendering "₦8,000,000 100%" beside "₦8,000,000" and "₦0 0%"
        under a Lost row was arithmetic nobody asked for, in the column a
        forecast is read from.
      */
      /*
        Stacked, not trailed.

        "₦7,192,000 62%" right-aligns as one string, so the *percentage* lands
        on the column edge and the amounts underneath each other do not line
        up - which defeats the point of a right-aligned money column, where
        the whole value is being able to compare magnitudes by eye. The figure
        gets the edge; the probability sits under it.
      */
      cell: d => (CLOSED_STAGES.includes(d.stage)
        ? <span className="text-muted-foreground/50">-</span>
        : (
          <span className="block">
            <span className="block text-muted-foreground">
              {exact(d.value * d.probability / 100)}
            </span>
            <span className="mt-0.5 block text-[11.5px] text-muted-foreground/70">
              {d.probability}% likely
            </span>
          </span>
        )),
    },
    {
      key: 'expectedClose', header: 'Close', width: '15%', align: 'right', card: 'meta',
      cell: d => {
        /**
         * A closed deal shows when it closed, not when it was expected to.
         *
         * The expected close on a won deal is a date that stopped mattering
         * the moment it was signed, and running the same "in 15 weeks" through
         * it produced a forecast for something that has already happened.
         */
        if (CLOSED_STAGES.includes(d.stage)) {
          return d.closedAt
            ? <span className="text-muted-foreground">{formatDayShort(d.closedAt)}</span>
            : <span className="text-muted-foreground/70">-</span>;
        }

        if (!d.expectedClose) return <span className="text-muted-foreground/70">Not set</span>;
        const left = daysUntil(d.expectedClose);
        const late = left !== null && left < 0;

        /* The date holds the column edge; how far off it is sits beneath. */
        return (
          <span className={cn('block', late && 'text-destructive')}>
            <span className={cn(
              'flex items-center justify-end gap-1.5',
              late && 'font-medium',
            )}>
              {late && <AlertTriangle className="size-3 shrink-0" />}
              {formatDayShort(d.expectedClose)}
            </span>
            <span className={cn(
              'mt-0.5 block text-[11.5px]',
              late ? 'text-destructive/80' : 'text-muted-foreground/70',
            )}>
              {relativeDay(d.expectedClose)}
            </span>
          </span>
        );
      },
    },
    {
      header: 'Owner', width: '15%', hide: 'xl',
      cell: d => <OwnerTag member={d.owner} />,
    },
  ], []);

  /** Any narrowing at all, so the empty state says the right thing. */
  const filtered = Boolean(list.search || Object.keys(list.filters).length);
  const clearFilters = () => {
    list.setSearch('');
    for (const key of Object.keys(list.filters)) list.setFilter(key, '');
  };

  const stageOptions = React.useMemo(() => [
    { value: '', label: 'All' },
    ...DEAL_STAGES.map(s => ({ value: s, label: STAGE_LABELS[s] ?? s })),
  ], []);

  return (
    <div className="flex flex-col gap-4">
      <SectionHead title="Deals" count={list.meta.total} note="Business you are trying to win">
        <Button size="sm" className="h-9 gap-1.5" onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus className="size-4" /> Add deal
        </Button>
      </SectionHead>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <SearchField
          placeholder="Search deals"
          onChange={list.setSearch}
          className="lg:w-80"
        />
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          {/*
            "Mine" is the filter a salesperson reaches for first and no screen
            offered it. `owner_id` has been filterable on this route since the
            beginning; nothing was asking.
          */}
          {memberId && (
            <FilterToggle
              label="Mine"
              active={list.filters.ownerId === memberId}
              onChange={on => list.setFilter('ownerId', on ? memberId : '')}
            />
          )}
          <FilterRow
            ariaLabel="Filter by stage"
            options={stageOptions}
            value={list.filters.stage ?? ''}
            onChange={v => list.setFilter('stage', v)}
          />
        </div>
      </div>

      {list.error ? (
        <Broken message={list.error} onRetry={list.reload} />
      ) : (
        <RecordTable
          columns={columns}
          rows={list.rows}
          rowKey={d => d.id}
          loading={list.loading}
          noun="deal"
          onOpen={d => setOpen(d.id)}
          sort={list.sort}
          sortDir={list.sortDir}
          onSort={list.setSort}
          page={list.page}
          pageSize={list.pageSize}
          total={list.meta.total}
          onPage={list.setPage}
          onPageSize={list.setPageSize}
          actions={d => (
            <>
              <DropdownMenuItem onClick={() => setOpen(d.id)}>
                <ExternalLink className="mr-2 size-4" /> Open
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLogging(d)}>
                <Plus className="mr-2 size-4" /> Log activity
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setScheduling(d)}>
                <CornerUpRight className="mr-2 size-4" /> Schedule follow-up
              </DropdownMenuItem>
              {!CLOSED_STAGES.includes(d.stage) && (
                <>
                  <DropdownMenuItem onClick={() => setClosing({ deal: d, outcome: 'closed_won' })}>
                    <Trophy className="mr-2 size-4" /> Mark as won
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setClosing({ deal: d, outcome: 'closed_lost' })}>
                    <XCircle className="mr-2 size-4" /> Mark as lost
                  </DropdownMenuItem>
                </>
              )}
              <AddToMyWorkItem
                source={{
                  module: 'crm', type: 'deal', id: d.id,
                  label: sourceLabel(d.company?.name, d.name),
                }}
                title={`Move ${d.name} forward`}
              />
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { setEditing(d); setFormOpen(true); }}>
                <Pencil className="mr-2 size-4" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setDeleting(d)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 size-4" /> Delete
              </DropdownMenuItem>
            </>
          )}
          empty={
            filtered ? (
              <Blank
                icon={Handshake}
                title="Nothing matches"
                body="Try a different search, or clear the filters."
                action={
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <Blank
                icon={Handshake}
                title="No deals yet"
                body="A deal is a piece of business with a value and a date. Convert a lead, or add one directly."
                action={
                  <Button size="sm" className="gap-1.5" onClick={() => { setEditing(null); setFormOpen(true); }}>
                    <Plus className="size-4" /> Add deal
                  </Button>
                }
              />
            )
          }
        />
      )}

      <DealDialog
        open={formOpen}
        onOpenChange={o => { setFormOpen(o); if (!o) setEditing(null); }}
        editing={editing}
        onSaved={list.reload}
      />

      <CloseDealDialog
        open={closing !== null}
        onOpenChange={o => { if (!o) setClosing(null); }}
        deal={closing?.deal ?? null}
        outcome={closing?.outcome ?? 'closed_won'}
        onDone={list.reload}
      />

      {logging && (
        <ActivityDialog
          open onOpenChange={o => { if (!o) setLogging(null); }}
          mode="log"
          link={{ kind: 'deal', id: logging.id, label: logging.name, companyId: logging.company?.id ?? null }}
          onSaved={list.reload}
        />
      )}

      {scheduling && (
        <ActivityDialog
          open onOpenChange={o => { if (!o) setScheduling(null); }}
          mode="followup"
          link={{ kind: 'deal', id: scheduling.id, label: scheduling.name, companyId: scheduling.company?.id ?? null }}
          onSaved={list.reload}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={o => { if (!o) setDeleting(null); }}
        title="Delete this deal"
        description={
          `"${deleting?.name ?? 'This deal'}" will be removed from the pipeline, and its value `
          + 'will stop counting towards the forecast.'
        }
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
        isLoading={removing}
      />

      <RecordSheet
        kind="deal"
        id={open}
        open={open !== null}
        onOpenChange={o => { if (!o) setOpen(null); }}
        onChanged={list.reload}
      />
    </div>
  );
}
