'use client';

import * as React from 'react';
import { FileText, FileSpreadsheet, Folder, ArrowRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/format';
import { useAppStore } from '@/store/app-store';

/**
 * ===========================================================================
 *  The documents written about this record
 * ===========================================================================
 *
 *  The other end of a workspace page link. A page names the customer, deal or
 *  project it concerns; this is what makes that reachable from the record's
 *  own screen, which is the difference between a connection and a note filed
 *  where only its author will find it.
 *
 *  It is in `shared/` rather than inside the workspace module because it is
 *  read by other modules by definition: the project workspace is its first
 *  consumer, and the CRM customer panel and the invoice view are the obvious
 *  next two.
 *
 *  -- Why it can render nothing at all -------------------------------------
 *
 *  `/api/workspace/links` is guarded on the workspace module, and RLS resolves
 *  each row through `page_permission()`. So a reader without workspace, or
 *  without access to the pages in question, gets an empty list - and this
 *  renders nothing rather than an empty panel headed "Documents", because a
 *  heading over nothing is a claim that there is nothing written, and for that
 *  reader it is a claim the endpoint cannot make.
 */

interface LinkedPage {
  id: string;
  title: string;
  summary: string;
  icon: string | null;
  colour: string;
  kind: 'document' | 'sheet';
  isFolder: boolean;
  updatedAt: string;
  lastEditedByName: string | null;
  linkedAt: string;
}

export function LinkedDocuments({
  entityType, entityId, className, limit = 6,
}: {
  entityType: 'company' | 'contact' | 'deal' | 'lead' | 'project' | 'task'
  | 'employee' | 'invoice' | 'ticket' | 'department';
  entityId: string;
  className?: string;
  limit?: number;
}) {
  const [pages, setPages] = React.useState<LinkedPage[] | null>(null);
  // Selected as one function: a Zustand v5 selector that builds an object
  // returns a new one on every store change and loops for ever.
  const openRecord = useAppStore(s => s.openRecord);

  React.useEffect(() => {
    let live = true;
    fetch(`/api/workspace/links?entityType=${entityType}&entityId=${entityId}&limit=${limit}`)
      .then(r => r.json())
      .then(j => { if (live) setPages(j?.error ? [] : (j.data ?? [])); })
      .catch(() => { if (live) setPages([]); });
    return () => { live = false; };
  }, [entityType, entityId, limit]);

  if (!pages || pages.length === 0) return null;

  return (
    <section className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          Documents
        </h3>
        <span className="text-[11.5px] text-muted-foreground">
          written about this in the workspace
        </span>
      </div>

      <ul className="rounded-xl border border-border bg-card">
        {pages.map(page => {
          const Icon = page.isFolder ? Folder : page.kind === 'sheet' ? FileSpreadsheet : FileText;
          return (
            <li key={page.id} className="border-b border-border/70 last:border-b-0">
              <button
                type="button"
                onClick={() => openRecord('workspace', 'page', page.id)}
                className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/40"
              >
                <Icon className="size-4 shrink-0" style={{ color: page.colour }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-foreground">{page.title}</span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    {page.summary
                      || [page.lastEditedByName, formatRelativeTime(page.updatedAt)]
                        .filter(Boolean).join(' · ')}
                  </span>
                </span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
