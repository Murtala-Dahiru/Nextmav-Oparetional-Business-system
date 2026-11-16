'use client';
import { ExportButton } from '@/components/shared/export-button';
import { BulkFields } from './bulk-fields';
import { useListPresentation } from './list-presentation';
import { SharedViews } from './shared-views';
import { CustomFieldFilter } from './custom-field-filter';

import * as React from 'react';
import { toast } from 'sonner';
import {
  Plus, Users, Pencil, Trash2, CornerUpRight, ExternalLink, Mail, Phone, Building2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { AddToMyWorkItem } from '@/components/shared/add-to-my-work';
import { formatRelativeTime } from '@/lib/format';
import { useAppStore } from '@/store/app-store';

import { useCrmList } from './use-list';
import { RecordTable, type Column } from '@/components/shared/record-table';
import { SectionHead, FilterRow, Monogram, Blank, Broken, personName } from './ui';
import { remove } from './data';
import { ContactDialog } from './forms';
import { ActivityDialog } from './activity-dialog';
import { ContactWorkspace } from './contact-workspace';
import { useDirectoryFacts } from './use-directory-facts';
import { DirectoryTools, useDirectoryTools } from './directory-tools';
import { DirectorySummary } from './directory-summary';
import { DirectoryFilters } from './directory-filters';
import type { Contact } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Contacts
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The bug this screen shipped with ─────────────────────────────────────
 *
 * The Company column was `row.original.company`, and the endpoint embeds
 * `company` as `{ id, name }`. React refuses to render an object as a child,
 * so every contact with a company - which, in a seeded workspace, is all of
 * them - threw "Objects are not valid as a React child" and took the entire
 * Contacts screen into the module error boundary.
 *
 * It is worth naming what made that survivable for so long: the error boundary
 * reports a crash honestly now, but the screen it replaced said "Loading
 * Contacts", so the failure looked like slowness.
 *
 * ── What the company column does instead ─────────────────────────────────
 *
 * Names the company and opens it. A contact's company is the single most
 * useful jump from this screen - it is how somebody goes from "who am I
 * speaking to" to "what is our relationship with them" - and it was
 * previously not a link at all.
 */

export function ContactsSection({
  focusId, onFocusHandled,
}: {
  focusId?: string | null;
  onFocusHandled?: () => void;
}) {
  const openRecord = useAppStore(s => s.openRecord);
  const mayCreate = useAppStore(s => s.allows('crm', 'create'));
  const mayEdit = useAppStore(s => s.allows('crm', 'edit'));
  const mayDelete = useAppStore(s => s.allows('crm', 'delete'));

  const list = useCrmList<Contact>('/api/crm/contacts', {
    channel: 'crm-contacts',
    watch: ['contacts','crm_activities','deals'],
    defaultSort: 'updatedAt',
  });

  const {facts,error:factsError}=useDirectoryFacts('contact',list.rows);
  const directoryTools=useDirectoryTools('contact',list);
  const [open, setOpen] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<Contact | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [logging, setLogging] = React.useState<Contact | null>(null);
  const [scheduling, setScheduling] = React.useState<Contact | null>(null);
  const [deleting, setDeleting] = React.useState<Contact | null>(null);
  const [removing, setRemoving] = React.useState(false);

  React.useEffect(() => {
    if (!focusId) return;
    setOpen(focusId);
    onFocusHandled?.();
  }, [focusId, onFocusHandled]);

  const confirmDelete = async () => {
    if (!deleting) return;
    setRemoving(true);
    try {
      await remove(`/api/crm/contacts/${deleting.id}`);
      toast.success('Contact deleted');
      setDeleting(null);
      list.reload();
    } catch (e: any) {
      toast.error(e.message || 'That could not be deleted');
    } finally {
      setRemoving(false);
    }
  };

  const columns: Column<Contact>[] = React.useMemo(() => [
    {
      key: 'lastName', header: 'Contact', width: '28%', card: 'title',
      cell: c => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Monogram name={personName(c)} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground">
              {personName(c) || c.email || 'Unnamed contact'}
            </span>
            <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
              {[c.jobTitle, c.crmProfile?.department].filter(Boolean).join(' · ') || 'No job title'}
              {!c.isActive && <span className="ml-1.5">· no longer here</span>}
            </span>
          </span>
        </span>
      ),
    },
    {
      header: 'Company', width: '18%', card: 'subtitle',
      cell: c => (c.company?.name
        ? (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); openRecord('crm', 'company', c.company!.id); }}
            className="inline-flex min-w-0 items-center gap-1.5 truncate text-left hover:underline"
          >
            <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{c.company.name}</span>
          </button>
        )
        : <span className="text-muted-foreground/70">No company</span>),
    },
    {
      key: 'email', header: 'Email', width: '24%', hide: 'lg', card: 'meta',
      cell: c => (c.email && !c.crmProfile?.emailOptOut
        ? (
          <a
            href={`mailto:${c.email}`}
            onClick={e => e.stopPropagation()}
            className="inline-flex min-w-0 items-center gap-1.5 truncate text-muted-foreground hover:text-foreground hover:underline"
          >
            <Mail className="size-3.5 shrink-0" /><span className="truncate">{c.email}</span>
          </a>
        )
        : <span className="text-muted-foreground/70">-</span>),
    },
    {
      header: 'Relationship role', width: '16%', hide: 'xl', card: 'meta',
      cell: c => <span className="text-muted-foreground">{c.crmProfile?.relationshipRole || 'Not recorded'}</span>,
    },
    {
      header: 'Last engagement', width: '14%', align: 'right', hide: 'md', card: 'meta',
      cell: c => <span className="text-muted-foreground">{facts[c.id] ? facts[c.id].lastEngagement ? formatRelativeTime(facts[c.id].lastEngagement!) : 'Not recorded' : '—'}</span>,
    },
  ], [openRecord,facts]);

  const presentation=useListPresentation('contacts',columns);
  return (
    <div className={`flex flex-col gap-4 ${presentation.className}`}>
      {presentation.controls}
      <ExportButton module="crm" datasets={[{key:"contacts",label:"Contacts",filters:{...list.filters,search:list.search,sort:list.sort,sortDir:list.sortDir,currentView:"true"}}]} />
      <BulkFields object="contacts" rows={list.rows} onChanged={list.reload} />
      <SharedViews object="contacts" presentation={presentation.settings} onPresentation={presentation.applyView} list={list} />
      <CustomFieldFilter object="contacts" value={list.filters.custom} onChange={value => list.setFilter('custom', value)} />
      <SectionHead title="Contacts" count={list.meta.total} note="People at your customers">
        <Button disabled={!mayCreate} size="sm" className="h-9 gap-1.5" onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus className="size-4" /> Add contact
        </Button>
      </SectionHead>
      <DirectorySummary kind="contact"/>

      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 lg:flex-row lg:items-center">
        <Input
          aria-label="Search contacts"
          placeholder="Search by name, email or job title"
          value={list.search}
          onChange={event => list.setSearch(event.target.value)}
          className="lg:w-80"
        />
        <FilterRow
          ariaLabel="Filter by whether the contact is still there"
          options={[
            { value: '', label: 'Everyone' },
            { value: 'true', label: 'Active' },
            { value: 'false', label: 'Moved on' },
          ]}
          value={list.filters.isActive ?? ''}
          onChange={v => list.setFilter('isActive', v)}
          className="lg:ml-auto"
        />
      </div>

      <DirectoryFilters kind="contact" filters={list.filters} setFilter={list.setFilter} />

      {factsError&&<p role="status" className="text-xs text-muted-foreground">Engagement context unavailable: {factsError}</p>}
      <DirectoryTools kind="contact" list={list} columns={presentation.columns} tools={directoryTools}/>
      {list.error ? (
        <Broken message={list.error} onRetry={list.reload} />
      ) : (
        <RecordTable
          columns={[...(mayEdit?[directoryTools.selection]:[]),...presentation.columns.filter(c=>!directoryTools.hidden.includes(c.header))]}
          rows={list.rows}
          rowKey={c => c.id}
          loading={list.loading}
          noun="contact"
          onOpen={c => setOpen(c.id)}
          sort={list.sort}
          sortDir={list.sortDir}
          onSort={list.setSort}
          page={list.page}
          pageSize={list.pageSize}
          total={list.meta.total}
          onPage={list.setPage}
          onPageSize={list.setPageSize}
          actions={c => (
            <>
              <DropdownMenuItem onClick={() => setOpen(c.id)}>
                <ExternalLink className="mr-2 size-4" /> Open
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!mayCreate} onClick={() => setLogging(c)}>
                <Plus className="mr-2 size-4" /> Log activity
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!mayCreate} onClick={() => setScheduling(c)}>
                <CornerUpRight className="mr-2 size-4" /> Schedule follow-up
              </DropdownMenuItem>
              {c.company?.id && (
                <DropdownMenuItem onClick={() => openRecord('crm', 'company', c.company!.id)}>
                  <Building2 className="mr-2 size-4" /> Open company
                </DropdownMenuItem>
              )}
              <AddToMyWorkItem
                source={{
                  module: 'crm', type: 'contact', id: c.id,
                  label: [c.company?.name, personName(c)].filter(Boolean).join(' · '),
                }}
                title={`Follow up with ${personName(c) || 'this contact'}`}
              />
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!mayEdit} onClick={() => { setEditing(c); setFormOpen(true); }}>
                <Pencil className="mr-2 size-4" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!mayDelete}
                onClick={() => setDeleting(c)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 size-4" /> Delete
              </DropdownMenuItem>
            </>
          )}
          empty={
            list.search || list.filters.isActive ? (
              <Blank
                icon={Users}
                title="Nothing matches"
                body="Try a different search, or show everyone again."
                action={
                  <Button variant="outline" size="sm" onClick={() => { list.setSearch(''); list.setFilter('isActive', ''); }}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <Blank
                icon={Users}
                title="No contacts yet"
                body="Contacts appear here when you add one, convert a lead, or import a list."
                action={
                  <Button disabled={!mayCreate} size="sm" className="gap-1.5" onClick={() => { setEditing(null); setFormOpen(true); }}>
                    <Plus className="size-4" /> Add contact
                  </Button>
                }
              />
            )
          }
        />
      )}

      <ContactDialog
        open={formOpen}
        onOpenChange={o => { setFormOpen(o); if (!o) setEditing(null); }}
        editing={editing}
        onSaved={list.reload}
      />

      {logging && (
        <ActivityDialog
          open onOpenChange={o => { if (!o) setLogging(null); }}
          mode="log"
          link={{ kind: 'contact', id: logging.id, label: personName(logging), companyId: logging.company?.id ?? null }}
          onSaved={list.reload}
        />
      )}

      {scheduling && (
        <ActivityDialog
          open onOpenChange={o => { if (!o) setScheduling(null); }}
          mode="followup"
          link={{ kind: 'contact', id: scheduling.id, label: personName(scheduling), companyId: scheduling.company?.id ?? null }}
          onSaved={list.reload}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={o => { if (!o) setDeleting(null); }}
        title="Delete this contact"
        description={
          `${personName(deleting ?? ({} as Contact)) || 'This contact'} will be removed. `
          + 'If they have simply moved on, edit them and turn off "Still at this company" instead.'
        }
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
        isLoading={removing}
      />

      <ContactWorkspace
        id={open}
        open={open !== null}
        onOpenChange={o => { if (!o) setOpen(null); }}
        onChanged={list.reload}
      />
    </div>
  );
}
