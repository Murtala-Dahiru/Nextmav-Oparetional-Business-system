'use client';
import { ExportButton } from '@/components/shared/export-button';
import { BulkFields } from './bulk-fields';
import { useListPresentation } from './list-presentation';
import { SharedViews } from './shared-views';
import { CustomFieldFilter } from './custom-field-filter';

import * as React from 'react';
import { toast } from 'sonner';
import {
  Plus, Target, Pencil, Trash2, ArrowRight, CornerUpRight, ExternalLink,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LeadInboxTools } from './lead-inbox-tools';
import { useLeadEngagement } from './use-lead-engagement';
import { LeadSummary } from './lead-summary';
import { LeadCards } from './lead-cards';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { AddToMyWorkItem } from '@/components/shared/add-to-my-work';
import { LEAD_STATUSES } from '@/lib/constants';
import { formatRelativeTime } from '@/lib/format';

import { useAppStore } from '@/store/app-store';

import { useCrmList } from './use-list';
import { RecordTable, type Column } from '@/components/shared/record-table';
import {
  SectionHead, FilterRow, FilterToggle, Monogram, LeadStatusTag, OwnerTag,
  Blank, Broken, personName,
} from './ui';
import { exact, remove } from './data';
import { LeadDialog } from './forms';
import { CaptureSettings } from './capture-settings';
import { ConvertLeadDialog } from './convert-dialog';
import { ActivityDialog } from './activity-dialog';
import { RecordSheet } from './record-sheet';
import { LEAD_STATUS_LABELS, type Lead } from './types';

export function LeadsSection({
  focusId, onFocusHandled, initialSource,
}: {
  focusId?: string | null;
  onFocusHandled?: () => void;
  initialSource?: string;
}) {
  const memberId = useAppStore(s => s.user?.memberId ?? null);
  const canCreateActivity = useAppStore(s => s.allows('crm', 'create'));
  const mayEdit = useAppStore(s => s.allows('crm', 'edit'));
  const mayDelete = useAppStore(s => s.allows('crm', 'delete'));
  const [view, setView] = React.useState<'table' | 'cards'>('table');

  const list = useCrmList<Lead>('/api/crm/leads', {
    channel: 'crm-leads',
    watch: ['leads', 'crm_activities'],
    defaultSort: 'updatedAt',
  });

  const engagement = useLeadEngagement(list.rows);

  const [open, setOpen] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<Lead | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [converting, setConverting] = React.useState<Lead | null>(null);
  const [logging, setLogging] = React.useState<Lead | null>(null);
  const [scheduling, setScheduling] = React.useState<Lead | null>(null);
  const [deleting, setDeleting] = React.useState<Lead | null>(null);
  const [removing, setRemoving] = React.useState(false);
  const setSourceFilter = list.setFilter;
  React.useEffect(() => {
    if (initialSource !== undefined) setSourceFilter('source', initialSource);
  }, [initialSource, setSourceFilter]);

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
      key: 'lastName', header: 'Lead', width: '24%', card: 'title',
      cell: l => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Monogram name={personName(l)} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground">
              {personName(l) || l.email || 'Unnamed lead'}{l.communicationPreferences?.doNotContact && <span className="ml-1.5 text-[10px] font-normal text-amber-700">Do not contact</span>}
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
      header: 'Qualification', width: '12%', hide: 'lg', card: 'meta',
      cell: l => <span className="text-xs text-muted-foreground">{l.status === 'qualified' ? 'Qualified' : Object.keys(l.qualification ?? {}).length ? 'In progress' : 'Not started'}</span>,
    },
    {
      header: 'Source / campaign', width: '13%', hide: 'lg', card: 'subtitle',
      cell: l => <span className="block min-w-0"><span className="block truncate text-xs">{l.source || 'Not recorded'}</span><span className="mt-1 block truncate text-[11px] text-muted-foreground" title={l.campaign}>{l.campaign || 'No campaign'}</span></span>,
    },
    {
      key: 'estimatedValue', header: 'Value', width: '13%', align: 'right', card: 'figure',
      cell: l => (l.estimatedValue
        ? <span className="font-medium">{exact(l.estimatedValue)}</span>
        : <span className="text-muted-foreground/70">-</span>),
    },
    {
      header: 'Owner', width: '16%', card: 'meta',
      cell: l => <OwnerTag member={l.owner} />,
    },
    {
      header: 'Next step', width: '16%', card: 'meta',
      cell: l => { const e = engagement.data[l.id]; return <span className="block text-xs"><span className={e?.overdueCount ? 'font-medium text-amber-700' : 'text-muted-foreground'}>{!e ? engagement.error ? 'Unavailable' : 'Loading…' : e.nextFollowUpAt ? (e.overdueCount ? 'Overdue · ' : '') + formatRelativeTime(e.nextFollowUpAt) : 'No next step'}</span><span className="mt-1 block text-[10px] text-muted-foreground">{e?.lastActivityAt ? 'Activity ' + formatRelativeTime(e.lastActivityAt) : e ? 'No activity recorded' : ''}</span></span>; },
    },
  ], [engagement.data, engagement.error]);

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

  const presentation=useListPresentation('leads',columns);
  return (
    <div className={`flex flex-col gap-4 ${presentation.className}`}>
      {presentation.controls}
      <ExportButton module="crm" datasets={[{key:"leads",label:"Leads",filters:{...list.filters,search:list.search,sort:list.sort,sortDir:list.sortDir,currentView:"true"}}]} />
      <BulkFields object="leads" rows={list.rows} onChanged={list.reload} />
      <SharedViews object="leads" presentation={presentation.settings} onPresentation={presentation.applyView} list={list} />
      <CustomFieldFilter object="leads" value={list.filters.custom} onChange={value => list.setFilter('custom', value)} />
      <SectionHead title="Leads" count={list.meta.total} note="Build relationships. Keep every next step in view.">
        <Button disabled={!canCreateActivity} size="sm" className="h-9 gap-1.5" onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus className="size-4" /> Add lead
        </Button>
      </SectionHead>
      <LeadSummary refreshKey={list.rows} onFilter={filters => {
        list.setSearch('');
        for (const key of new Set([...Object.keys(list.filters), ...Object.keys(filters)])) list.setFilter(key, filters[key] ?? '');
      }} />

      <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Your lead workspace</h3><p className="mt-1 text-xs text-muted-foreground">Find the right relationship, then choose its next action.</p></div><div role="group" aria-label="Lead view" className="flex gap-1 rounded-lg bg-muted/60 p-1"><Button size="sm" variant={view === 'table' ? 'secondary' : 'ghost'} aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</Button><Button size="sm" variant={view === 'cards' ? 'secondary' : 'ghost'} aria-pressed={view === 'cards'} onClick={() => setView('cards')}>Cards</Button></div></div>
        <div className="grid gap-2 md:grid-cols-4">
        <Input
          aria-label="Search leads"
          value={list.search}
          placeholder="Search by name, email or company"
          onChange={e => list.setSearch(e.target.value)}
          className="min-w-0 md:col-span-2"
        />
        <Input aria-label="Filter leads by source" placeholder="Source, e.g. website" value={list.filters.source ?? ''} onChange={e => list.setFilter('source', e.target.value)} />
        <Input aria-label="Filter leads by campaign" placeholder="Campaign" value={list.filters.campaign ?? ''} onChange={e => list.setFilter('campaign', e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterToggle label="Unassigned" active={list.filters.unassigned === 'true'} onChange={on => { list.setFilter('unassigned', on ? 'true' : ''); if (on) list.setFilter('ownerId', ''); }} />
          {memberId && (
            <FilterToggle
              label="Mine"
              active={list.filters.ownerId === memberId}
              onChange={on => { list.setFilter('ownerId', on ? memberId : ''); if (on) list.setFilter('unassigned', ''); }}
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

      {filtered && <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{list.meta.total} matching leads</span>{Object.entries(list.filters).map(([key, value]) => <button key={key} className="rounded-full border bg-card px-2.5 py-1 hover:bg-muted" onClick={() => list.setFilter(key, '')}>{key === 'awaitingResponse' ? 'Awaiting response' : key === 'overdueFollowUp' ? 'Overdue follow-up' : key === 'createdSince' ? 'New in 30 days' : key === 'active' ? 'Active leads' : key === 'unconverted' ? 'Not converted' : key + ': ' + value} ×</button>)}<Button size="sm" variant="ghost" onClick={clearFilters}>Clear all</Button></div>}
      <LeadInboxTools list={list} />

      {list.error ? (
        <Broken message={list.error} onRetry={list.reload} />
      ) : view === 'cards' && list.rows.length > 0 ? (
        <LeadCards list={list} engagement={engagement.data} onOpen={lead => setOpen(lead.id)} onLog={setLogging} onFollowUp={setScheduling} canCreateActivity={canCreateActivity}/>
      ) : (
        <RecordTable
          columns={presentation.columns}
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
              <DropdownMenuItem disabled={!canCreateActivity} onClick={() => setLogging(l)}>
                <Plus className="mr-2 size-4" /> Log activity
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canCreateActivity} onClick={() => setScheduling(l)}>
                <CornerUpRight className="mr-2 size-4" /> Schedule follow-up
              </DropdownMenuItem>
              {!l.convertedContactId && (
                <DropdownMenuItem disabled={!canCreateActivity} onClick={() => setConverting(l)}>
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
              <DropdownMenuItem disabled={!mayEdit} onClick={() => { setEditing(l); setFormOpen(true); }}>
                <Pencil className="mr-2 size-4" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!mayDelete} onClick={() => setDeleting(l)}
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
                  <Button disabled={!canCreateActivity} size="sm" className="gap-1.5" onClick={() => { setEditing(null); setFormOpen(true); }}>
                    <Plus className="size-4" /> Add lead
                  </Button>
                }
              />
            )
          }
        />
      )}

      {engagement.error && <p role="status" className="text-xs text-muted-foreground">Engagement details are unavailable. Open a lead to review its activity or refresh the list.</p>}
      <CaptureSettings />

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
