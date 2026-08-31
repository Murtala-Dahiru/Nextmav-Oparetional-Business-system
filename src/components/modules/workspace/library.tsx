'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  Search, Plus, ChevronRight, ChevronDown, Star, StarOff, Pencil, Trash2,
  MoreHorizontal, FolderInput, Share2, Loader2, RotateCcw, X, PanelLeft,
  FolderPlus, FileText, FileSpreadsheet, LayoutList, Rows3,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet as Drawer, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

import { IconTile, iconFor, folderIcon, AccessTag, Nothing } from './ui';
import { getList, count, kindWord } from './data';
import type { WorkspaceNode, TrashedPage } from './types';

/**
 * ===========================================================================
 *  The library
 * ===========================================================================
 *
 *  Two halves. On the left the shape of the workspace, as a tree; on the right
 *  whatever is currently in view, as a ruled index.
 *
 *  -- On spaces ------------------------------------------------------------
 *
 *  `workspace_spaces` exists as a table, with RLS, a visibility rule and a
 *  department, and has never had a row written to it. Adding a spaces UI now
 *  would give the product two organisational systems that mean the same thing:
 *  a top-level folder called "Finance", visible to the finance department, is
 *  a space in every respect that matters, and it already nests, shares,
 *  searches and moves. The brief for this phase says not to create duplicate
 *  organisational systems, so root folders *are* the areas and the table stays
 *  unused, noted rather than quietly wired up.
 *
 *  -- Two searches ---------------------------------------------------------
 *
 *  The field narrows the tree by title as you type, locally, which is what a
 *  tree filter should do. Pressing Enter asks the server, which matches
 *  document *bodies* as well - the thing the sidebar could never do, and the
 *  reason a phrase buried three folders deep used to be unreachable from this
 *  screen even though `/api/search` had found it since the day it was written.
 */

type Filter = 'all' | 'documents' | 'sheets' | 'starred' | 'shared';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'documents', label: 'Documents' },
  { id: 'sheets', label: 'Spreadsheets' },
  { id: 'starred', label: 'Starred' },
  { id: 'shared', label: 'Shared with me' },
];

export function Library({
  nodes, loading, openFolderId, onOpenFolder, onOpenPage, onCreate, onReload, trashCount,
}: {
  nodes: WorkspaceNode[];
  loading: boolean;
  openFolderId: string | null;
  onOpenFolder: (id: string | null) => void;
  onOpenPage: (id: string) => void;
  onCreate: (parentId: string | null) => void;
  onReload: () => void;
  trashCount: number;
}) {
  const [search, setSearch] = React.useState('');
  const [deep, setDeep] = React.useState<WorkspaceNode[] | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [filter, setFilter] = React.useState<Filter>('all');
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [treeOpen, setTreeOpen] = React.useState(false);
  const [trashOpen, setTrashOpen] = React.useState(false);
  const [density, setDensity] = React.useState<'comfortable' | 'compact'>('comfortable');

  /* -- The tree ---------------------------------------------------------- */

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return nodes;

    const matches = nodes.filter(n => n.title.toLowerCase().includes(term));
    // A match deep in the tree is useless without the folders above it, so
    // every ancestor of a match is kept even when its own name does not match.
    const keep = new Set(matches.map(m => m.id));
    const byId = new Map(nodes.map(n => [n.id, n]));
    for (const match of matches) {
      let parent = match.parentId ? byId.get(match.parentId) : undefined;
      let hops = 0;
      while (parent && hops < 20) {
        keep.add(parent.id);
        parent = parent.parentId ? byId.get(parent.parentId) : undefined;
        hops++;
      }
    }
    return nodes.filter(n => keep.has(n.id));
  }, [nodes, search]);

  const childrenOf = React.useCallback(
    (parentId: string | null) => filtered
      .filter(n => n.parentId === parentId && !n.isTemplate)
      .sort((a, b) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        if (a.isStarred !== b.isStarred) return a.isStarred ? -1 : 1;
        return a.title.localeCompare(b.title);
      }),
    [filtered],
  );

  // Searching should reveal what it found rather than leave it behind a
  // collapsed folder somebody then has to hunt for.
  React.useEffect(() => {
    if (search.trim()) {
      setExpanded(new Set(filtered.filter(n => n.isFolder).map(n => n.id)));
    }
  }, [search, filtered]);

  // The open folder's ancestors are unfolded, so the tree always shows where
  // the reader is.
  React.useEffect(() => {
    if (!openFolderId) return;
    const byId = new Map(nodes.map(n => [n.id, n]));
    setExpanded(prev => {
      const next = new Set(prev);
      let current = byId.get(openFolderId);
      let hops = 0;
      while (current && hops < 20) {
        next.add(current.id);
        current = current.parentId ? byId.get(current.parentId) : undefined;
        hops++;
      }
      return next;
    });
  }, [openFolderId, nodes]);

  /* -- What the right-hand side shows ------------------------------------ */

  const runDeepSearch = React.useCallback(async () => {
    const term = search.trim();
    if (term.length < 2) return;
    setSearching(true);
    try {
      setDeep(await getList<WorkspaceNode>(`/api/workspace/pages?q=${encodeURIComponent(term)}&pageSize=100`));
    } catch (err: any) {
      toast.error(err.message || 'Search failed');
    } finally {
      setSearching(false);
    }
  }, [search]);

  React.useEffect(() => { if (!search.trim()) setDeep(null); }, [search]);

  const listing = React.useMemo(() => {
    if (deep) return deep;

    let list = openFolderId
      ? nodes.filter(n => n.parentId === openFolderId)
      : nodes.filter(n => !n.isTemplate);

    if (filter === 'documents') list = list.filter(n => !n.isFolder && n.kind === 'document');
    if (filter === 'sheets') list = list.filter(n => !n.isFolder && n.kind === 'sheet');
    if (filter === 'starred') list = list.filter(n => n.isStarred);
    if (filter === 'shared') list = list.filter(n => n.isSharedWithMe);

    const term = search.trim().toLowerCase();
    if (term) list = list.filter(n => n.title.toLowerCase().includes(term));

    return [...list].sort((a, b) => {
      if (openFolderId && a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return String(b.updatedAt).localeCompare(String(a.updatedAt));
    });
  }, [deep, nodes, openFolderId, filter, search]);

  const openFolder = openFolderId ? nodes.find(n => n.id === openFolderId) ?? null : null;

  const trail = React.useMemo(() => {
    if (!openFolder) return [];
    const byId = new Map(nodes.map(n => [n.id, n]));
    const out: WorkspaceNode[] = [];
    let current: WorkspaceNode | undefined = openFolder;
    let hops = 0;
    while (current && hops < 20) {
      out.unshift(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
      hops++;
    }
    return out;
  }, [openFolder, nodes]);

  /* -- Tree row ---------------------------------------------------------- */

  const renderNode = (node: WorkspaceNode, depth: number): React.ReactNode => {
    const isOpen = expanded.has(node.id);
    const Icon = node.isFolder ? folderIcon(isOpen) : iconFor(node);
    const kids = node.isFolder ? childrenOf(node.id) : [];
    const selected = openFolderId === node.id;

    return (
      <div key={node.id}>
        <div
          className={cn(
            'group flex items-center rounded-md pr-1 transition-colors hover:bg-accent/60',
            selected && 'bg-accent',
          )}
          style={{ paddingLeft: `${2 + depth * 12}px` }}
        >
          {node.isFolder ? (
            <button
              type="button"
              onClick={() => setExpanded(prev => {
                const next = new Set(prev);
                if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
                return next;
              })}
              aria-label={isOpen ? `Collapse ${node.title}` : `Expand ${node.title}`}
              aria-expanded={isOpen}
              className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
            >
              {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
          ) : (
            <span className="w-[22px] shrink-0" />
          )}

          <button
            type="button"
            onClick={() => {
              if (node.isFolder) { onOpenFolder(node.id); setTreeOpen(false); }
              else { onOpenPage(node.id); setTreeOpen(false); }
            }}
            className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
          >
            <Icon className="size-3.5 shrink-0" style={{ color: node.colour }} />
            <span className="truncate text-[13px]">{node.title}</span>
            {node.isStarred && <Star className="size-3 shrink-0 fill-[#d4a93f] text-[#d4a93f]" />}
          </button>

          {node.isFolder && node.permission !== 'view' && (
            <button
              type="button"
              onClick={() => onCreate(node.id)}
              aria-label={`New inside ${node.title}`}
              className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Plus className="size-3.5" />
            </button>
          )}
        </div>

        {node.isFolder && isOpen && (
          <div>
            {kids.map(child => renderNode(child, depth + 1))}
            {kids.length === 0 && (
              <p
                className="py-1 text-[11.5px] text-muted-foreground"
                style={{ paddingLeft: `${26 + depth * 12}px` }}
              >
                Empty
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  const tree = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <button
          type="button"
          onClick={() => { onOpenFolder(null); setTreeOpen(false); }}
          className={cn(
            'mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent/60',
            !openFolderId && 'bg-accent',
          )}
        >
          <LayoutList className="size-3.5 text-muted-foreground" />
          Everything
        </button>

        {loading ? (
          <div className="space-y-1.5 px-1 pt-2">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
          </div>
        ) : childrenOf(null).length === 0 ? (
          <p className="px-2 py-6 text-[12px] text-muted-foreground">
            {search ? 'Nothing matches that.' : 'Nothing here yet.'}
          </p>
        ) : (
          <div className="space-y-0.5">{childrenOf(null).map(node => renderNode(node, 0))}</div>
        )}
      </div>

      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={() => setTrashOpen(true)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        >
          <Trash2 className="size-3.5 shrink-0" />
          <span className="flex-1">Trash</span>
          {trashCount > 0 && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">{trashCount}</span>
          )}
        </button>
      </div>
    </div>
  );

  /* -- Render ------------------------------------------------------------ */

  return (
    <div className="flex min-h-0 flex-1">
      {/* The tree, on a wide screen */}
      <aside className="hidden w-64 shrink-0 border-r border-border lg:flex lg:flex-col">
        {tree}
      </aside>

      {/* On a narrow one it is a drawer, because a 260px tree beside a 375px
          screen leaves 115px for the document. */}
      <Drawer open={treeOpen} onOpenChange={setTreeOpen}>
        <SheetContent side="left" className="w-[85vw] max-w-sm p-0">
          <SheetHeader className="border-b border-border px-4 py-3">
            <SheetTitle className="text-[14px]">Browse</SheetTitle>
          </SheetHeader>
          {tree}
        </SheetContent>
      </Drawer>

      <div className="min-w-0 flex-1">
        <div className="px-4 py-5 md:px-8 md:py-6">
          {/* Heading and search */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost" size="icon" className="size-8 lg:hidden"
              aria-label="Browse folders"
              onClick={() => setTreeOpen(true)}
            >
              <PanelLeft className="size-4" />
            </Button>

            <div className="min-w-0 flex-1">
              {trail.length > 0 ? (
                <nav aria-label="Location" className="flex min-w-0 items-center gap-1 text-[11.5px] text-muted-foreground">
                  <button type="button" onClick={() => onOpenFolder(null)} className="shrink-0 hover:text-foreground">
                    Everything
                  </button>
                  {trail.map((ancestor, index) => (
                    <React.Fragment key={ancestor.id}>
                      <ChevronRight className="size-3 shrink-0 opacity-50" />
                      <button
                        type="button"
                        onClick={() => onOpenFolder(ancestor.id)}
                        className={cn('min-w-0 truncate hover:text-foreground',
                          index === trail.length - 1 && 'text-foreground')}
                      >
                        {ancestor.title}
                      </button>
                    </React.Fragment>
                  ))}
                </nav>
              ) : (
                <h1 className="text-[17px] font-semibold tracking-[-0.018em]">Library</h1>
              )}
            </div>

            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void runDeepSearch(); }}
                placeholder="Search titles, Enter to search inside"
                className="h-8 pl-8 pr-8 text-[13px]"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => { setSearch(''); setDeep(null); }}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            <NewMenu onCreate={() => onCreate(openFolderId)} />
          </div>

          {/* Filters */}
          <div className="mt-4 flex flex-wrap items-center gap-1">
            {FILTERS.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                aria-pressed={filter === item.id}
                className={cn(
                  'rounded-md px-2 py-1 text-[12.5px] transition-colors',
                  filter === item.id
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {item.label}
              </button>
            ))}

            <button
              type="button"
              onClick={() => setDensity(d => (d === 'compact' ? 'comfortable' : 'compact'))}
              aria-label="Change row height"
              className="ml-auto rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
              title={density === 'compact' ? 'Comfortable rows' : 'Compact rows'}
            >
              <Rows3 className="size-3.5" />
            </button>
          </div>

          {/* The listing */}
          <div className="mt-4 border-t border-border pt-1">
            {deep && (
              <p className="py-2 text-[12px] text-muted-foreground">
                {searching
                  ? 'Searching inside documents'
                  : `${count(deep.length, 'result')} for "${search.trim()}", including document text`}
              </p>
            )}

            {loading ? (
              <div className="space-y-2 pt-2">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}
              </div>
            ) : listing.length === 0 ? (
              <Nothing
                action={
                  <button
                    type="button"
                    onClick={() => onCreate(openFolderId)}
                    className="font-medium text-foreground underline decoration-[--ring] underline-offset-2"
                  >
                    Create something
                  </button>
                }
              >
                {search
                  ? 'Nothing matches that.'
                  : openFolder
                    ? 'This folder is empty.'
                    : filter === 'starred'
                      ? 'Nothing has been starred yet.'
                      : filter === 'shared'
                        ? 'Nothing has been shared with you directly.'
                        : 'The workspace is empty.'}
              </Nothing>
            ) : (
              <ul>
                {listing.map(node => (
                  <LibraryRow
                    key={node.id}
                    node={node}
                    density={density}
                    showPath={!openFolderId || !!deep}
                    nodes={nodes}
                    onOpen={() => (node.isFolder ? onOpenFolder(node.id) : onOpenPage(node.id))}
                    onReload={onReload}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <TrashDialog open={trashOpen} onOpenChange={setTrashOpen} onRestored={onReload} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  A row                                                                     */
/* -------------------------------------------------------------------------- */

function LibraryRow({
  node, density, showPath, nodes, onOpen, onReload,
}: {
  node: WorkspaceNode;
  density: 'comfortable' | 'compact';
  showPath: boolean;
  nodes: WorkspaceNode[];
  onOpen: () => void;
  onReload: () => void;
}) {
  const Icon = iconFor(node);

  const path = React.useMemo(() => {
    if (!showPath || !node.parentId) return null;
    const byId = new Map(nodes.map(n => [n.id, n]));
    const parts: string[] = [];
    let parent = byId.get(node.parentId);
    let hops = 0;
    while (parent && hops < 6) {
      parts.unshift(parent.title);
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
      hops++;
    }
    return parts.join(' / ');
  }, [showPath, node.parentId, nodes]);

  const star = async () => {
    try {
      await fetch(`/api/workspace/pages/${node.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isStarred: !node.isStarred }),
      });
      onReload();
    } catch {
      toast.error('Could not update');
    }
  };

  return (
    <li
      className={cn(
        'group flex items-center gap-3 border-b border-border/60 px-1 transition-colors last:border-b-0 hover:bg-accent/50',
        density === 'compact' ? 'py-1.5' : 'py-2.5',
      )}
    >
      <IconTile icon={Icon} colour={node.colour} size={density === 'compact' ? 'sm' : 'md'} />

      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[13.5px] font-medium leading-tight">
          {node.title}
        </span>
        {density === 'comfortable' && (
          <span className="mt-0.5 block truncate text-[11.5px] leading-tight text-muted-foreground">
            {[
              node.summary || kindWord(node),
              path,
              node.isFolder ? count(node.childCount, 'item') : null,
              node.fileCount ? count(node.fileCount, 'file') : null,
              node.commentCount ? count(node.commentCount, 'comment') : null,
            ].filter(Boolean).join(' · ')}
          </span>
        )}
      </button>

      <span className="hidden shrink-0 md:block">
        <AccessTag
          visibility={node.visibility}
          departmentName={node.departmentName}
          shareCount={node.shareCount}
        />
      </span>

      <span className="hidden w-24 shrink-0 text-right text-[11.5px] tabular-nums text-muted-foreground sm:block">
        {formatRelativeTime(node.updatedAt)}
      </span>

      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={star}
          aria-label={node.isStarred ? `Unstar ${node.title}` : `Star ${node.title}`}
          className={cn(
            'rounded p-1 transition-opacity',
            node.isStarred
              ? 'text-[#d4a93f]'
              : 'text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100',
          )}
        >
          {node.isStarred ? <Star className="size-3.5 fill-current" /> : <StarOff className="size-3.5" />}
        </button>
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/*  New                                                                       */
/* -------------------------------------------------------------------------- */

function NewMenu({ onCreate }: { onCreate: () => void }) {
  return (
    <Button size="sm" className="h-8 gap-1.5 text-[12.5px]" onClick={onCreate}>
      <Plus className="size-3.5" /> New
    </Button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Trash                                                                     */
/* -------------------------------------------------------------------------- */

export function TrashDialog({
  open, onOpenChange, onRestored,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored: () => void;
}) {
  const [rows, setRows] = React.useState<TrashedPage[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [restoring, setRestoring] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setRows(await getList<TrashedPage>('/api/workspace/trash'));
    } catch (err: any) {
      toast.error(err.message || 'Could not load the trash');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { if (open) void load(); }, [open, load]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Trash</DialogTitle>
          <DialogDescription>
            Deleted pages are kept here. Restoring one brings back the folders it lived in, and
            restoring a folder brings back what was inside it.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2 py-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-md" />)}
          </div>
        ) : rows.length === 0 ? (
          <Nothing>Nothing has been deleted from this workspace.</Nothing>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {rows.map(row => {
              const Icon = iconFor({ icon: row.icon, isFolder: row.isFolder, kind: row.kind });
              return (
                <li key={row.id} className="flex items-center gap-3 border-b border-border/60 py-2.5 last:border-b-0">
                  <IconTile icon={Icon} colour={row.colour} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">{row.title}</span>
                    <span className="block text-[11.5px] text-muted-foreground">
                      {row.isFolder ? 'Folder' : row.kind === 'sheet' ? 'Spreadsheet' : 'Document'}
                      {row.deletedAt && ` · deleted ${formatRelativeTime(row.deletedAt)}`}
                    </span>
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 gap-1.5 text-[12px]"
                    disabled={restoring === row.id}
                    onClick={async () => {
                      setRestoring(row.id);
                      try {
                        const res = await fetch('/api/workspace/trash', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ id: row.id }),
                        });
                        const json = await res.json();
                        if (json.error) throw new Error(json.error.message);
                        /*
                          The count is the honest thing to report. Restoring a
                          folder brings back everything deleted with it, and
                          restoring a document brings back the folders it lived
                          in, so "1 restored" would understate what happened and
                          leave somebody hunting for the rest.
                        */
                        toast.success(json.data?.restored > 1
                          ? `Restored ${json.data.restored} items`
                          : 'Restored');
                        await load();
                        onRestored();
                      } catch (err: any) {
                        toast.error(err.message || 'Could not restore that');
                      } finally {
                        setRestoring(null);
                      }
                    }}
                  >
                    {restoring === row.id
                      ? <Loader2 className="size-3 animate-spin" />
                      : <RotateCcw className="size-3" />}
                    Restore
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
