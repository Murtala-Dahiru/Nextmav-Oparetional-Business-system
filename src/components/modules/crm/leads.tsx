'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  Plus, Target, Pencil, Trash2, ArrowRight, CornerUpRight, ListPlus, ExternalLink,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { AddToMyWorkItem } from '@/components/shared/add-to-my-work';
import { LEAD_STATUSES } from '@/lib/constants';
import { formatRelativeTime } from '@/lib/format';

import { useAppStore } from '@/store/app-store';

import { useCrmList } from './use-list';
import { RecordTable, type Column } from '@/components/shared/record-table';
import {
  SectionHead, SearchField, FilterRow, FilterToggle, Monogram, LeadStatusTag, Gauge, OwnerTag,
  Blank, Broken, personName,
} from './ui';
import { exact, remove } from './data';
import { LeadDialog } from './forms';
import { ConvertLeadDialog } from './convert-dialog';
import { ActivityDialog } from './activity-dialog';
import { RecordSheet } from './record-sheet';
import { LEAD_STATUS_LABELS, type Lead } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Leads
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this screen is for ──────────────────────────────────────────────
 *
 * Working a list. Everything on it serves one loop: see who is next, see
 * enough to decide, act, move on. So the row carries the four things that
 * decide - who, where in the lifecycle, how warm, how much - and everything
 * else is one click away in the panel.
 *
 * ── What was removed ─────────────────────────────────────────────────────
 *
 * Four stat cards across the top reading Total, New, Qualified, Won. They were
 * computed from `?pageSize=100`, so they were wrong in any workspace with more
 * than a hundred leads, and they answered a question - "what is the shape of
 * the funnel" - that CRM Home now answers properly. What replaced them is the
 * status filter, which shows the same counts *and* does something when you
 * press it.
 *
 * ── The defect this screen shipped with ──────────────────────────────────
 *
 * A column headed Company bound to `company`. The field is `companyName`, so
 * the column rendered blank for every lead in the product.
 */

export function LeadsSection({
  focusId, onFocusHandled,
}: {
  focusId?: string | null;
  onFocusHandled?: () => void;
}) {
  const memberId = useAppStore(s => s.user?.memberId ?? null);

  const list = useCrmList<Lead>('/api/crm/leads', {
    channel: 'crm-leads',
    watch: ['leads'],
    defaultSort: 'updatedAt',
  });

  const [open, setOpen] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<Lead | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [converting, setConverting] = React.useState<Lead | null>(null);
  const [logging, setLogging] = React.useState<Lead | null>(null);
  const [scheduling, setScheduling] = React.useState<Lead | null>(null);
  const [deleting, setDeleting] = React.useState<Lead | null>(null);
  const [removing, setRemoving] = React.useState(false);

  /** A lead another surface asked this module to open. */
  React.useEffect(() => {
    if (!focusId) return;
    setOpen(focusId);
    onFocusHandled?.();
  }, [focusId, onFocusHandled]);

  const confirmDelete = async () => {
    if (!deleting) return;
    setRemoving(true);
    try {
      await remove(`/api/crm/leads/${deleting.id}`);
      toast.success('Lead deleted');
      setDeleting(null);
      list.reload();
    } catch (e: any) {
      toast.error(e.message || 'That could not be deleted');
    } finally {
      setRemoving(false);
    }
  };

  const columns: Column<Lead>[] = React.useMemo(() => [
    {
      key: 'lastName', header: 'Lead', width: '31%', card: 'title',
      cell: l => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Monogram name={personName(l)} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground">
              {personName(l) || l.email || 'Unnamed lead'}
            </span>
            <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
              {[l.jobTitle, l.companyName].filter(Boolean).join(' · ') || 'No company recorded'}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: 'status', header: 'Status', width: '13%', card: 'meta',
      cell: l => <LeadStatusTag status={l.status} />,
    },
    {
      key: 'score', header: 'Score', width: '12%', hide: 'lg', card: 'meta',
      cell: l => <Gauge value={l.score ?? 0} label="Score" />,
    },
    {
      key: 'estimatedValue', header: 'Value', width: '13%', align: 'right', card: 'figure',
      cell: l => (l.estimatedValue
        ? <span className="font-medium">{exact(l.estimatedValue)}</span>
        : <span className="text-muted-foreground/70">-</span>),
    },
    {
      header: 'Owner', width: '17%', hide: 'xl',
      cell: l => <OwnerTag member={l.owner} />,
    },
    {
      key: 'updatedAt', header: 'Last touched', width: '13%', align: 'right', hide: 'md', card: 'meta',
      cell: l => <span className="text-muted-foreground">{formatRelativeTime(l.updatedAt)}</span>,
    },
  ], []);

  /** Any narrowing at all, so the empty state says the right thing. */
  const filtered = Boolean(list.search || Object.keys(list.filters).length);
  const clearFilters = () => {
    list.setSearch('');
    for (const key of Object.keys(list.filters)) list.setFilter(key, '');
  };

  const statusOptions = React.useMemo(() => [
    { value: '', label: 'All' },
    ...LEAD_STATUSES.map(s => ({ value: s, label: LEAD_STATUS_LABELS[s] ?? s })),
  ], []);

  return (
    <div className="flex flex-col gap-4">
      <SectionHead title="Leads" count={list.meta.total} note="People who might buy">
        <Button size="sm" className="h-9 gap-1.5" onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus className="size-4" /> Add lead
        </Button>
      </SectionHead>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <SearchField
          placeholder="Search by name, email or company"
          onChange={list.setSearch}
          className="lg:w-80"
        />
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          {memberId && (
            <FilterToggle
              label="Mine"
              active={list.filters.ownerId === memberId}
              onChange={on => list.setFilter('ownerId', on ? memberId : '')}
            />
          )}
          <FilterRow
            ariaLabel="Filter by status"
            options={statusOptions}
            value={list.filters.status ?? ''}
            onChange={v => list.setFilter('status', v)}
          />
        </div>
      </div>

      {list.error ? (
        <Broken message={list.error} onRetry={list.reload} />
      ) : (
        <RecordTable
          columns={columns}
          rows={list.rows}
          rowKey={l => l.id}
          loading={list.loading}
          noun="lead"
          onOpen={l => setOpen(l.id)}
          sort={list.sort}
          sortDir={list.sortDir}
          onSort={list.setSort}
          page={list.page}
          pageSize={list.pageSize}
          total={list.meta.total}
          onPage={list.setPage}
          onPageSize={list.setPageSize}
          actions={l => (
            <>
              <DropdownMenuItem onClick={() => setOpen(l.id)}>
                <ExternalLink className="mr-2 size-4" /> Open
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLogging(l)}>
                <Plus className="mr-2 size-4" /> Log activity
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setScheduling(l)}>
                <CornerUpRight className="mr-2 size-4" /> Schedule follow-up
              </DropdownMenuItem>
              {!l.convertedContactId && (
                <DropdownMenuItem onClick={() => setConverting(l)}>
                  <ArrowRight className="mr-2 size-4" /> Convert
                </DropdownMenuItem>
              )}
              <AddToMyWorkItem
                source={{
                  module: 'crm', type: 'lead', id: l.id,
                  label: [l.companyName, personName(l)].filter(Boolean).join(' · '),
                }}
                title={`Follow up with ${personName(l) || 'this lead'}`}
              />
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { setEditing(l); setFormOpen(true); }}>
                <Pencil className="mr-2 size-4" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setDeleting(l)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 size-4" /> Delete
              </DropdownMenuItem>
            </>
          )}
          empty={
            filtered ? (
              <Blank
                icon={Target}
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
                icon={Target}
                title="No leads yet"
                body="Add one by hand, or bring a list in from a spreadsheet in the Import Center."
                action={
                  <Button size="sm" className="gap-1.5" onClick={() => { setEditing(null); setFormOpen(true); }}>
                    <Plus className="size-4" /> Add lead
                  </Button>
                }
              />
            )
          }
        />
      )}

      <LeadDialog
        open={formOpen}
        onOpenChange={o => { setFormOpen(o); if (!o) setEditing(null); }}
        editing={editing}
        onSaved={list.reload}
      />

      <ConvertLeadDialog
        open={converting !== null}
        onOpenChange={o => { if (!o) setConverting(null); }}
        lead={converting}
        onConverted={list.reload}
      />

      {logging && (
        <ActivityDialog
          open onOpenChange={o => { if (!o) setLogging(null); }}
          mode="log"
          link={{ kind: 'lead', id: logging.id, label: personName(logging) }}
          onSaved={list.reload}
        />
      )}

      {scheduling && (
        <ActivityDialog
          open onOpenChange={o => { if (!o) setScheduling(null); }}
          mode="followup"
          link={{ kind: 'lead', id: scheduling.id, label: personName(scheduling) }}
          onSaved={list.reload}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={o => { if (!o) setDeleting(null); }}
        title="Delete this lead"
        description={
          `${personName(deleting ?? ({} as Lead)) || 'This lead'} will be removed from the list. `
          + 'Anything logged against them stays on the timeline.'
        }
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
        isLoading={removing}
      />

      <RecordSheet
        kind="lead"
        id={open}
        open={open !== null}
        onOpenChange={o => { if (!o) setOpen(null); }}
        onChanged={list.reload}
      />
    </div>
  );
}
