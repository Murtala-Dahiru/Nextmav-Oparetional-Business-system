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

import { useCrmList } from './use-list';
import { CrmTable, type Column } from './table';
import {
  SectionHead, SearchField, FilterRow, StageTag, OwnerTag, Blank, Broken, personName,
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

export function DealsSection({
  focusId, onFocusHandled, initialStage,
}: {
  focusId?: string | null;
  onFocusHandled?: () => void;
  /** A stage handed over from CRM Home, so a click on a bar arrives filtered. */
  initialStage?: string | null;
}) {
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
          <span className="block truncate text-[11.5px] text-muted-foreground">
            {[d.company?.name, personName(d.contact)].filter(Boolean).join(' · ') || 'No customer linked'}
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
      cell: d => (
        <span className="text-muted-foreground">
          {exact(d.value * d.probability / 100)}
          <span className="ml-1.5 text-[11.5px] text-muted-foreground/70">{d.probability}%</span>
        </span>
      ),
    },
    {
      key: 'expectedClose', header: 'Close', width: '15%', align: 'right', card: 'meta',
      cell: d => {
        if (!d.expectedClose) return <span className="text-muted-foreground/70">Not set</span>;
        const left = daysUntil(d.expectedClose);
        const late = left !== null && left < 0 && !CLOSED_STAGES.includes(d.stage);
        return (
          <span className={cn('inline-flex items-center gap-1.5', late && 'font-medium text-destructive')}>
            {late && <AlertTriangle className="size-3" />}
            <span>
              {formatDayShort(d.expectedClose)}
              <span className={cn('ml-1.5 text-[11.5px]', late ? '' : 'text-muted-foreground/70')}>
                {relativeDay(d.expectedClose)}
              </span>
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
          className="lg:max-w-xs"
        />
        <FilterRow
          ariaLabel="Filter by stage"
          options={stageOptions}
          value={list.filters.stage ?? ''}
          onChange={v => list.setFilter('stage', v)}
          className="lg:ml-auto"
        />
      </div>

      {list.error ? (
        <Broken message={list.error} onRetry={list.reload} />
      ) : (
        <CrmTable
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
                  label: [d.company?.name, d.name].filter(Boolean).join(' · '),
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
            list.search || list.filters.stage ? (
              <Blank
                icon={Handshake}
                title="Nothing matches"
                body="Try a different search, or clear the stage filter."
                action={
                  <Button variant="outline" size="sm" onClick={() => { list.setSearch(''); list.setFilter('stage', ''); }}>
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
