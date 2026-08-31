'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  Building2, User, Handshake, UserPlus, FolderKanban, ListTodo, IdCard,
  Receipt, LifeBuoy, Users, Plus, X, Loader2, Search, Lock,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';

import { Nothing } from './ui';
import { getList, post, remove } from './data';
import type { PageLink } from './types';

/**
 * ===========================================================================
 *  What this page is about
 * ===========================================================================
 *
 *  "Acme Website Requirements" is about Acme Corporation, the Website Redesign
 *  project and the deal that paid for it. Naming those is what turns a
 *  document store into part of the operating system: the page carries its
 *  context, and the customer's own screen can list the documents about them.
 *
 *  -- Deliberately not a graph --------------------------------------------
 *
 *  No canvas, no nodes, no force-directed anything. The useful form of this is
 *  a short list of names that are also links, and a reader who wants the deal
 *  clicks the deal. A visualisation would be a picture of a list.
 *
 *  -- A link the reader cannot follow --------------------------------------
 *
 *  A document can be linked to an invoice by somebody who holds finance and
 *  read by somebody who does not. The endpoint returns `readable: false` for
 *  those rather than dropping them, and they render as a name in muted type
 *  with a lock: the fact that the document concerns an invoice is workspace
 *  content, and hiding it would make the panel a different length for
 *  different people looking at the same page.
 */

const ENTITY_META: Record<PageLink['entityType'], {
  label: string;
  icon: React.ElementType;
  module: string;
  /** What `openRecord` calls this kind of record. */
  focus: string;
  searchTypes: string[];
}> = {
  company: { label: 'Company', icon: Building2, module: 'crm', focus: 'company', searchTypes: ['company'] },
  contact: { label: 'Contact', icon: User, module: 'crm', focus: 'contact', searchTypes: ['contact'] },
  deal: { label: 'Deal', icon: Handshake, module: 'crm', focus: 'deal', searchTypes: ['deal'] },
  lead: { label: 'Lead', icon: UserPlus, module: 'crm', focus: 'lead', searchTypes: ['lead'] },
  project: { label: 'Project', icon: FolderKanban, module: 'projects', focus: 'project', searchTypes: ['project'] },
  task: { label: 'Task', icon: ListTodo, module: 'projects', focus: 'task', searchTypes: ['task'] },
  employee: { label: 'Employee', icon: IdCard, module: 'hr', focus: 'employee', searchTypes: [] },
  invoice: { label: 'Invoice', icon: Receipt, module: 'finance', focus: 'invoice', searchTypes: ['invoice'] },
  ticket: { label: 'Ticket', icon: LifeBuoy, module: 'support', focus: 'ticket', searchTypes: ['ticket'] },
  department: { label: 'Department', icon: Users, module: 'admin', focus: 'department', searchTypes: [] },
};

export function LinkPanel({
  pageId, links, canEdit, onChanged,
}: {
  pageId: string;
  links: PageLink[];
  canEdit: boolean;
  onChanged: (next: PageLink[]) => void;
}) {
  const [adding, setAdding] = React.useState(false);
  /**
   * Selected as a single function, not as an object.
   *
   * A Zustand v5 selector that builds `{ openRecord }` returns a new object on
   * every store change and loops for ever, which reads as "the module will not
   * render" and is caught by no harness in this repository.
   */
  const openRecord = useAppStore(s => s.openRecord);

  const reload = React.useCallback(async () => {
    try {
      onChanged(await getList<PageLink>(`/api/workspace/pages/${pageId}/links`));
    } catch { /* leave what is on screen */ }
  }, [pageId, onChanged]);

  const detach = React.useCallback(async (link: PageLink) => {
    onChanged(links.filter(l => l.id !== link.id));
    try {
      await remove(`/api/workspace/pages/${pageId}/links?linkId=${link.id}`);
    } catch (err: any) {
      toast.error(err.message || 'Could not remove that link');
      await reload();
    }
  }, [links, pageId, onChanged, reload]);

  return (
    <div className="space-y-2">
      {links.length === 0 ? (
        <Nothing
          action={canEdit ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="font-medium text-foreground underline decoration-[--ring] underline-offset-2"
            >
              Link a record
            </button>
          ) : undefined}
        >
          {canEdit
            ? 'Not connected to anything yet.'
            : 'Not connected to any business records.'}
        </Nothing>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {links.map(link => {
            const meta = ENTITY_META[link.entityType];
            const Icon = meta?.icon ?? Building2;

            return (
              <li key={link.id}>
                <span
                  className={cn(
                    'group inline-flex max-w-full items-center gap-1.5 rounded-md border border-border py-1 pl-2 text-[12.5px]',
                    canEdit ? 'pr-1' : 'pr-2',
                    link.readable ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {link.readable ? (
                    <button
                      type="button"
                      onClick={() => openRecord(meta.module as any, meta.focus as any, link.entityId)}
                      className="flex min-w-0 items-center gap-1.5"
                      title={`Open in ${meta.label === 'Employee' ? 'HR' : meta.module.toUpperCase()}`}
                    >
                      <Icon className="size-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{link.label}</span>
                      {link.detail && (
                        <span className="hidden shrink-0 text-muted-foreground sm:inline">
                          {link.detail}
                        </span>
                      )}
                    </button>
                  ) : (
                    <span className="flex min-w-0 items-center gap-1.5" title="You do not have access to this record">
                      <Lock className="size-3 shrink-0" />
                      <span className="truncate">{link.label}</span>
                    </span>
                  )}

                  {canEdit && (
                    <button
                      type="button"
                      aria-label={`Unlink ${link.label}`}
                      onClick={() => detach(link)}
                      className="ml-0.5 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </span>
              </li>
            );
          })}

          {canEdit && (
            <li>
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1 text-[12.5px] text-muted-foreground transition-colors hover:border-[--ring] hover:text-foreground"
              >
                <Plus className="size-3" /> Link
              </button>
            </li>
          )}
        </ul>
      )}

      <LinkDialog
        key={adding ? 'open' : 'closed'}
        open={adding}
        pageId={pageId}
        existing={links}
        onClose={() => setAdding(false)}
        onAdded={reload}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Finding a record to link                                                  */
/* -------------------------------------------------------------------------- */

interface Found {
  type: string;
  module: string;
  id: string;
  title: string;
  subtitle: string | null;
  meta: string | null;
}

/**
 * The picker searches through the existing global search.
 *
 * A second search across nine tables would be a second definition of what
 * matches, a second set of module checks, and a second place for a leak. The
 * palette's endpoint already searches only the modules the caller can open and
 * already returns `{ type, module, id, title }`, which is exactly the shape a
 * link needs. Employees and departments are not in it, so they are read from
 * the directory and the admin settings the module already loads.
 */
function LinkDialog({
  open, pageId, existing, onClose, onAdded,
}: {
  open: boolean;
  pageId: string;
  existing: PageLink[];
  onClose: () => void;
  onAdded: () => Promise<void>;
}) {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<Found[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState<string | null>(null);

  const linkable = React.useMemo(
    () => new Set(Object.keys(ENTITY_META)),
    [],
  );

  React.useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setResults([]); return; }

    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}&limit=6`);
        const json = await res.json();
        const rows: Found[] = (json?.data?.results ?? [])
          .filter((r: Found) => linkable.has(r.type));
        setResults(rows);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 220);

    return () => clearTimeout(timer);
  }, [query, linkable]);

  const alreadyLinked = React.useCallback(
    (row: Found) => existing.some(l => l.entityType === row.type && l.entityId === row.id),
    [existing],
  );

  const attach = async (row: Found) => {
    setSaving(row.id);
    try {
      await post(`/api/workspace/pages/${pageId}/links`, {
        entityType: row.type,
        entityId: row.id,
      });
      await onAdded();
      toast.success(`Linked ${row.title}`);
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Could not link that');
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link a record</DialogTitle>
          <DialogDescription>
            Connect this page to the customer, deal, project or invoice it is about. It then
            appears on that record too.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search companies, deals, projects, invoices"
            className="pl-8"
          />
        </div>

        <div className="min-h-[180px]">
          {query.trim().length < 2 ? (
            <p className="py-6 text-center text-[12.5px] text-muted-foreground">
              Type at least two characters.
            </p>
          ) : loading ? (
            <p className="flex items-center justify-center gap-2 py-6 text-[12.5px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Searching
            </p>
          ) : results.length === 0 ? (
            <p className="py-6 text-center text-[12.5px] text-muted-foreground">
              Nothing matched, in the modules you can open.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {results.map(row => {
                const meta = ENTITY_META[row.type as PageLink['entityType']];
                const Icon = meta?.icon ?? Building2;
                const linked = alreadyLinked(row);

                return (
                  <li key={`${row.type}-${row.id}`}>
                    <button
                      type="button"
                      disabled={linked || saving === row.id}
                      onClick={() => attach(row)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/50 disabled:opacity-50"
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">{row.title}</span>
                        <span className="block truncate text-[11.5px] text-muted-foreground">
                          {meta?.label ?? row.type}
                          {row.subtitle ? ` · ${row.subtitle}` : ''}
                          {/*
                            `meta` is a raw column value: a deal's stage comes
                            back as `closed_lost`. The command palette already
                            un-snakes it on the way to the screen, and a picker
                            that printed the enum would be the same defect in a
                            second place.
                          */}
                          {row.meta ? ` · ${String(row.meta).replace(/_/g, ' ')}` : ''}
                        </span>
                      </span>
                      {saving === row.id
                        ? <Loader2 className="size-3.5 shrink-0 animate-spin" />
                        : linked
                          ? <span className="shrink-0 text-[11.5px] text-muted-foreground">Linked</span>
                          : <Plus className="size-3.5 shrink-0 text-muted-foreground" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
