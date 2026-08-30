'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  Plus, Building2, Pencil, Trash2, ExternalLink, Globe, MapPin, CornerUpRight,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { AddToMyWorkItem } from '@/components/shared/add-to-my-work';
import { formatNumber } from '@/lib/format';

import { useCrmList } from './use-list';
import { CrmTable, type Column } from './table';
import { SectionHead, SearchField, Blank, Broken } from './ui';
import { exact, remove } from './data';
import { CompanyDialog } from './forms';
import { ActivityDialog } from './activity-dialog';
import { CompanyDetail } from './company-detail';
import type { Company } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Companies
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The address book. The interesting screen is what a row opens - Company 360,
 * which reads across Deals, Projects, Finance and Support - so this list's job
 * is to get somebody there quickly and to say enough on the way that they know
 * they have the right customer.
 *
 * ── Why the row opens the customer rather than an edit form ──────────────
 *
 * Reading is what people come here to do. Editing a company's postal address
 * is a rare act and it is in the row menu; understanding a customer is the
 * common one and it is the whole row.
 *
 * ── The dollar sign ──────────────────────────────────────────────────────
 *
 * The old form's revenue field was labelled "Annual Revenue ($)" in a product
 * that resolves currency per workspace, and the same figure was rendered two
 * columns away in naira by `formatCurrency`. One of the two was always wrong.
 */

export function CompaniesSection({
  focusId, onFocusHandled,
}: {
  focusId?: string | null;
  onFocusHandled?: () => void;
}) {
  const list = useCrmList<Company>('/api/crm/companies', {
    channel: 'crm-companies',
    watch: ['companies'],
    defaultSort: 'name',
    defaultSortDir: 'asc',
  });

  const [open, setOpen] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<Company | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [logging, setLogging] = React.useState<Company | null>(null);
  const [scheduling, setScheduling] = React.useState<Company | null>(null);
  const [deleting, setDeleting] = React.useState<Company | null>(null);
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
      await remove(`/api/crm/companies/${deleting.id}`);
      toast.success('Company deleted');
      setDeleting(null);
      list.reload();
    } catch (e: any) {
      toast.error(e.message || 'That could not be deleted');
    } finally {
      setRemoving(false);
    }
  };

  const columns: Column<Company>[] = React.useMemo(() => [
    {
      key: 'name', header: 'Company', width: '32%', card: 'title',
      cell: c => (
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
          >
            <Building2 className="size-3.5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground">{c.name}</span>
            <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
              {c.industry || 'No industry recorded'}
            </span>
          </span>
        </span>
      ),
    },
    {
      header: 'Website', width: '21%', hide: 'lg', card: 'meta',
      cell: c => (c.website
        ? (
          <a
            href={c.website.startsWith('http') ? c.website : `https://${c.website}`}
            target="_blank" rel="noreferrer noopener"
            onClick={e => e.stopPropagation()}
            className="inline-flex min-w-0 items-center gap-1.5 truncate text-muted-foreground hover:text-foreground hover:underline"
          >
            <Globe className="size-3.5 shrink-0" />
            <span className="truncate">{c.website.replace(/^https?:\/\//, '')}</span>
          </a>
        )
        : <span className="text-muted-foreground/70">-</span>),
    },
    {
      header: 'Location', width: '18%', hide: 'md', card: 'subtitle',
      cell: c => {
        const where = [c.city, c.country].filter(Boolean).join(', ');
        return where
          ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
              <MapPin className="size-3.5 shrink-0" /><span className="truncate">{where}</span>
            </span>
          )
          : <span className="text-muted-foreground/70">-</span>;
      },
    },
    {
      key: 'employeeCount', header: 'People', width: '11%', align: 'right', hide: 'xl',
      cell: c => (c.employeeCount
        ? <span className="text-muted-foreground">{formatNumber(c.employeeCount)}</span>
        : <span className="text-muted-foreground/70">-</span>),
    },
    {
      key: 'annualRevenue', header: 'Revenue', width: '18%', align: 'right', card: 'figure',
      cell: c => (c.annualRevenue
        ? <span className="font-medium">{exact(c.annualRevenue)}</span>
        : <span className="text-muted-foreground/70">-</span>),
    },
  ], []);

  return (
    <div className="flex flex-col gap-4">
      <SectionHead title="Companies" count={list.meta.total} note="Open one to see the whole relationship">
        <Button size="sm" className="h-9 gap-1.5" onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus className="size-4" /> Add company
        </Button>
      </SectionHead>

      <SearchField
        placeholder="Search by name, industry, city or email"
        onChange={list.setSearch}
        className="lg:w-96"
      />

      {list.error ? (
        <Broken message={list.error} onRetry={list.reload} />
      ) : (
        <CrmTable
          columns={columns}
          rows={list.rows}
          rowKey={c => c.id}
          loading={list.loading}
          noun="company"
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
                <ExternalLink className="mr-2 size-4" /> Open customer
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLogging(c)}>
                <Plus className="mr-2 size-4" /> Log activity
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setScheduling(c)}>
                <CornerUpRight className="mr-2 size-4" /> Schedule follow-up
              </DropdownMenuItem>
              <AddToMyWorkItem
                source={{ module: 'crm', type: 'company', id: c.id, label: c.name }}
                title={`Check in with ${c.name}`}
              />
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { setEditing(c); setFormOpen(true); }}>
                <Pencil className="mr-2 size-4" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setDeleting(c)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 size-4" /> Delete
              </DropdownMenuItem>
            </>
          )}
          empty={
            list.search ? (
              <Blank
                icon={Building2}
                title="Nothing matches"
                body={`No company matches "${list.search}".`}
                action={
                  <Button variant="outline" size="sm" onClick={() => list.setSearch('')}>
                    Clear search
                  </Button>
                }
              />
            ) : (
              <Blank
                icon={Building2}
                title="No companies yet"
                body="A company is where contacts, deals, projects and invoices come together. Add one, or import a list."
                action={
                  <Button size="sm" className="gap-1.5" onClick={() => { setEditing(null); setFormOpen(true); }}>
                    <Plus className="size-4" /> Add company
                  </Button>
                }
              />
            )
          }
        />
      )}

      <CompanyDialog
        open={formOpen}
        onOpenChange={o => { setFormOpen(o); if (!o) setEditing(null); }}
        editing={editing}
        onSaved={list.reload}
      />

      {logging && (
        <ActivityDialog
          open onOpenChange={o => { if (!o) setLogging(null); }}
          mode="log"
          link={{ kind: 'company', id: logging.id, label: logging.name }}
          onSaved={list.reload}
        />
      )}

      {scheduling && (
        <ActivityDialog
          open onOpenChange={o => { if (!o) setScheduling(null); }}
          mode="followup"
          link={{ kind: 'company', id: scheduling.id, label: scheduling.name }}
          onSaved={list.reload}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={o => { if (!o) setDeleting(null); }}
        title="Delete this company"
        description={
          `"${deleting?.name ?? 'This company'}" will be removed. Its contacts, deals, `
          + 'projects and invoices are not deleted, but they will no longer point at a customer.'
        }
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
        isLoading={removing}
      />

      <CompanyDetail
        companyId={open}
        open={open !== null}
        onOpenChange={o => { if (!o) setOpen(null); }}
        onEdit={id => {
          const found = list.rows.find(c => c.id === id);
          if (found) { setEditing(found); setFormOpen(true); }
        }}
        onChanged={list.reload}
      />
    </div>
  );
}
