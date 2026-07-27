'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';
import {
  Plus, Search, Star, StarOff, MoreHorizontal, Pencil, Trash2,
  // `Map` is aliased: the unaliased import shadows the global `Map`
  // constructor, and `new Map(...)` a few hundred lines below then resolves to
  // a React component.
  FileText, BookOpen, Map as MapIcon, Folder, FolderOpen, Code, Lightbulb, Target,
  ChevronRight, ChevronDown, Loader2, BookMarked, Table, UploadCloud,
  FileSpreadsheet, Share2, History, FolderInput, Globe, Building2, Lock,
  CornerDownRight, RotateCcw,
} from 'lucide-react';

import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { formatRelativeTime, formatDateTime } from '@/lib/format';
import { useAppStore } from '@/store/app-store';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import { SheetGrid } from './sheet-grid';
import { FileBrowser } from './file-browser';
import { ShareDialog } from './share-dialog';
import type {
  WorkspaceNode, OpenPage, PageVersion, DirectoryMember, Department, WorkspaceFile,
} from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The workspace.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  A tree of folders holding three kinds of thing: documents, spreadsheets and
 *  files. Previously only the first existed — the header offered all three but
 *  the spreadsheet was a fixed table of sample rows and the file vault stored
 *  nothing outside the browser tab. Folders could be created but not renamed,
 *  moved or nested beyond one level, and the share control raised a toast.
 *
 *  What is deliberately *not* here: a second copy of the permission rules. The
 *  server resolves each node's effective permission by walking the folder
 *  ancestry and returns it on the row, so this file asks `node.permission`
 *  rather than reasoning about visibility and shares itself. A client-side
 *  reimplementation would be both a duplication and, the moment it drifted, a
 *  disclosure.
 */

const ICON_OPTIONS = [
  { value: 'file-text', label: 'Document', icon: FileText },
  { value: 'book-open', label: 'Handbook', icon: BookOpen },
  { value: 'table', label: 'Table', icon: Table },
  { value: 'map', label: 'Plan', icon: MapIcon },
  { value: 'star', label: 'Highlight', icon: Star },
  { value: 'folder', label: 'Folder', icon: Folder },
  { value: 'code', label: 'Technical', icon: Code },
  { value: 'lightbulb', label: 'Idea', icon: Lightbulb },
  { value: 'target', label: 'Goal', icon: Target },
];

const COLOR_SWATCHES = [
  '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

const ICON_MAP: Record<string, React.ElementType> = {
  'file-text': FileText, 'book-open': BookOpen, table: Table, map: MapIcon, star: Star,
  folder: Folder, code: Code, lightbulb: Lightbulb, target: Target,
};

const VISIBILITY_ICON: Record<WorkspaceNode['visibility'], React.ElementType> = {
  organization: Globe, department: Building2, private: Lock, inherit: CornerDownRight,
};

const DOCUMENT_TEMPLATES = [
  {
    label: 'Product requirements',
    body: '# Product requirements\n\n## Summary\n\n## Problem\n\n## Proposed solution\n\n## Success measures\n\n## Out of scope\n',
  },
  {
    label: 'Standard operating procedure',
    body: '# Standard operating procedure\n\n## Purpose\n\n## Who this applies to\n\n## Steps\n1. \n2. \n3. \n\n## Escalation\n',
  },
  {
    label: 'Meeting notes',
    body: `# Meeting notes\n\n**Date:** ${new Date().toISOString().slice(0, 10)}\n**Attendees:** \n\n## Agenda\n\n## Decisions\n\n## Actions\n- [ ] \n`,
  },
];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.data as T;
}

// ═══════════════════════════════════════════════════════════════════════════

export default function WorkspaceModule() {
  const organizationId = useAppStore(s => s.user?.organizationId ?? '');

  // ── Tree ──
  const [nodes, setNodes] = useState<WorkspaceNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // ── Open page ──
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState<OpenPage | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [view, setView] = useState<'doc' | 'sheet' | 'files'>('doc');

  // ── Editing ──
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [savingDoc, setSavingDoc] = useState(false);
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  // ── Dialogs ──
  const [createIn, setCreateIn] = useState<{ parentId: string | null } | null>(null);
  const [deleting, setDeleting] = useState<WorkspaceNode | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [moving, setMoving] = useState<WorkspaceNode | null>(null);
  const [moveTarget, setMoveTarget] = useState<string>('_root');
  const [sharing, setSharing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<PageVersion[]>([]);

  // ── Reference data ──
  const [members, setMembers] = useState<DirectoryMember[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  // ─── Loading ─────────────────────────────────────────────────────────────

  const loadTree = useCallback(async () => {
    try {
      const data = await api<WorkspaceNode[]>('/api/workspace/pages?pageSize=500');
      setNodes(data ?? []);
    } catch (err: any) {
      toast.error(err.message || 'Could not load the workspace');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTree(); }, [loadTree]);

  useEffect(() => {
    /**
     * The people and departments the share dialog and the person-typed sheet
     * column need. Loaded once here rather than per dialog, because both are
     * small, stable lists and three components asking separately is three
     * requests for the same answer.
     *
     * Departments come from the admin settings endpoint, which only
     * administrators may call — so this is allowed to fail quietly and the
     * department controls simply offer nothing.
     */
    api<DirectoryMember[]>('/api/directory')
      .then(setMembers)
      .catch(() => setMembers([]));

    fetch('/api/admin/settings')
      .then(r => r.json())
      .then(j => setDepartments(j?.data?.departments ?? []))
      .catch(() => setDepartments([]));
  }, []);

  const openPage = useCallback(async (id: string) => {
    setSelectedId(id);
    setPageLoading(true);
    setEditing(false);
    try {
      const data = await api<OpenPage>(`/api/workspace/pages/${id}`);
      setPage(data);
      setDraft(data.content ?? '');
      setTitleDraft(data.title);
      setView(data.kind === 'sheet' ? 'sheet' : data.isFolder ? 'files' : 'doc');
    } catch (err: any) {
      toast.error(err.message || 'Could not open that page');
      setPage(null);
    } finally {
      setPageLoading(false);
    }
  }, []);

  // ─── Tree shape ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (!search.trim()) return nodes;
    const q = search.toLowerCase();
    const matches = nodes.filter(n => n.title.toLowerCase().includes(q));
    // A match deep in the tree is useless without the folders above it, so
    // every ancestor of a match is kept even when its own name does not match.
    const keep = new Set(matches.map(m => m.id));
    const byId = new Map(nodes.map(n => [n.id, n]));
    for (const match of matches) {
      let parent = match.parentId ? byId.get(match.parentId) : undefined;
      while (parent) {
        keep.add(parent.id);
        parent = parent.parentId ? byId.get(parent.parentId) : undefined;
      }
    }
    return nodes.filter(n => keep.has(n.id));
  }, [nodes, search]);

  const childrenOf = useCallback(
    (parentId: string | null) =>
      filtered
        .filter(n => n.parentId === parentId)
        .sort((a, b) => {
          if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
          if (a.isStarred !== b.isStarred) return a.isStarred ? -1 : 1;
          return a.title.localeCompare(b.title);
        }),
    [filtered],
  );

  const starred = useMemo(() => nodes.filter(n => n.isStarred), [nodes]);

  // Searching should reveal what it found rather than leave it behind a
  // collapsed folder the user then has to hunt for.
  useEffect(() => {
    if (search.trim()) setExpanded(new Set(filtered.filter(n => n.isFolder).map(n => n.id)));
  }, [search, filtered]);

  const toggleFolder = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // ─── Mutations ───────────────────────────────────────────────────────────

  const patchPage = useCallback(async (id: string, body: Record<string, unknown>) => {
    const updated = await api<WorkspaceNode>(`/api/workspace/pages/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    await loadTree();
    return updated;
  }, [loadTree]);

  const toggleStar = useCallback(async (node: WorkspaceNode) => {
    try {
      await patchPage(node.id, { isStarred: !node.isStarred });
      if (page?.id === node.id) setPage(p => p ? { ...p, isStarred: !p.isStarred } : p);
    } catch (err: any) {
      toast.error(err.message || 'Could not update');
    }
  }, [patchPage, page]);

  const saveDocument = useCallback(async () => {
    if (!page) return;
    setSavingDoc(true);
    try {
      await patchPage(page.id, { content: draft });
      // Re-read rather than merging locally: the version counter is maintained
      // by a trigger, and the history panel would otherwise show a stale one.
      const fresh = await api<OpenPage>(`/api/workspace/pages/${page.id}`);
      setPage(fresh);
      setEditing(false);
      toast.success('Saved');
    } catch (err: any) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSavingDoc(false);
    }
  }, [page, draft, patchPage]);

  const saveTitle = useCallback(async () => {
    if (!page || !titleDraft.trim() || titleDraft === page.title) {
      setRenamingTitle(false);
      return;
    }
    try {
      await patchPage(page.id, { title: titleDraft.trim() });
      setPage(p => p ? { ...p, title: titleDraft.trim() } : p);
      setRenamingTitle(false);
    } catch (err: any) {
      toast.error(err.message || 'Rename failed');
    }
  }, [page, titleDraft, patchPage]);

  const createNode = useCallback(async (values: {
    title: string; kind: 'document' | 'sheet'; isFolder: boolean;
    icon: string; colour: string; parentId: string | null; content: string;
  }) => {
    try {
      const created = await api<WorkspaceNode>('/api/workspace/pages', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      setCreateIn(null);
      await loadTree();
      if (values.parentId) setExpanded(prev => new Set(prev).add(values.parentId!));
      toast.success(values.isFolder ? 'Folder created' : 'Created');
      if (!values.isFolder) openPage(created.id);
      else openPage(created.id);
    } catch (err: any) {
      toast.error(err.message || 'Could not create that');
    }
  }, [loadTree, openPage]);

  const confirmDelete = useCallback(async () => {
    if (!deleting) return;
    setIsDeleting(true);
    try {
      await api(`/api/workspace/pages/${deleting.id}`, { method: 'DELETE' });
      if (selectedId === deleting.id) { setSelectedId(null); setPage(null); }
      setDeleting(null);
      await loadTree();
      toast.success('Deleted');
    } catch (err: any) {
      toast.error(err.message || 'Delete failed');
    } finally {
      setIsDeleting(false);
    }
  }, [deleting, selectedId, loadTree]);

  const confirmMove = useCallback(async () => {
    if (!moving) return;
    try {
      await patchPage(moving.id, { parentId: moveTarget === '_root' ? null : moveTarget });
      setMoving(null);
      if (moveTarget !== '_root') setExpanded(prev => new Set(prev).add(moveTarget));
      toast.success('Moved');
    } catch (err: any) {
      toast.error(err.message || 'Move failed');
    }
  }, [moving, moveTarget, patchPage]);

  const loadVersions = useCallback(async () => {
    if (!page) return;
    try {
      setVersions(await api<PageVersion[]>(`/api/workspace/pages/${page.id}/versions`));
      setHistoryOpen(true);
    } catch (err: any) {
      toast.error(err.message || 'Could not load history');
    }
  }, [page]);

  const restoreVersion = useCallback(async (version: number) => {
    if (!page) return;
    try {
      await api(`/api/workspace/pages/${page.id}/versions`, {
        method: 'POST',
        body: JSON.stringify({ version }),
      });
      const fresh = await api<OpenPage>(`/api/workspace/pages/${page.id}`);
      setPage(fresh);
      setDraft(fresh.content ?? '');
      setHistoryOpen(false);
      await loadTree();
      toast.success(`Restored version ${version}`);
    } catch (err: any) {
      toast.error(err.message || 'Restore failed');
    }
  }, [page, loadTree]);

  // ─── Rendering ───────────────────────────────────────────────────────────

  const canEdit = page?.permission === 'edit' || page?.permission === 'manage';

  /**
   * A tree row. Recursive rather than flattened, so nesting is not capped —
   * the previous sidebar rendered folders and then their direct children only,
   * which meant a folder inside a folder simply did not appear.
   */
  const renderNode = (node: WorkspaceNode, depth: number): React.ReactNode => {
    const Icon = ICON_MAP[node.icon ?? ''] ?? (node.isFolder ? Folder : node.kind === 'sheet' ? Table : FileText);
    const OpenIcon = node.isFolder && expanded.has(node.id) ? FolderOpen : Icon;
    const isOpen = expanded.has(node.id);
    const kids = node.isFolder ? childrenOf(node.id) : [];
    const VisIcon = VISIBILITY_ICON[node.visibility];

    return (
      <div key={node.id}>
        <div
          className={cn(
            'group flex items-center gap-1 rounded-md pr-1 transition-colors hover:bg-accent',
            selectedId === node.id && 'bg-accent text-accent-foreground',
          )}
          style={{ paddingLeft: `${4 + depth * 14}px` }}
        >
          {node.isFolder ? (
            <button onClick={() => toggleFolder(node.id)} className="shrink-0 p-1" aria-label="Toggle folder">
              {isOpen
                ? <ChevronDown className="size-3.5 text-muted-foreground" />
                : <ChevronRight className="size-3.5 text-muted-foreground" />}
            </button>
          ) : (
            <span className="w-[22px] shrink-0" />
          )}

          <button
            onClick={() => openPage(node.id)}
            className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-sm"
          >
            <OpenIcon className="size-4 shrink-0" style={{ color: node.colour }} />
            <span className="truncate">{node.title}</span>
            {node.isStarred && <Star className="size-3 shrink-0 fill-amber-500 text-amber-500" />}
            {node.visibility !== 'organization' && node.visibility !== 'inherit' && (
              <VisIcon className="size-3 shrink-0 text-muted-foreground" />
            )}
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon"
                className="size-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100">
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {node.isFolder && node.permission !== 'view' && (
                <>
                  <DropdownMenuItem onClick={() => setCreateIn({ parentId: node.id })}>
                    <Plus className="mr-2 size-4" /> New inside
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={() => toggleStar(node)}>
                {node.isStarred
                  ? <><StarOff className="mr-2 size-4" /> Remove star</>
                  : <><Star className="mr-2 size-4" /> Star</>}
              </DropdownMenuItem>
              {node.permission !== 'view' && (
                <DropdownMenuItem onClick={() => { openPage(node.id); setRenamingTitle(true); }}>
                  <Pencil className="mr-2 size-4" /> Rename
                </DropdownMenuItem>
              )}
              {node.permission !== 'view' && (
                <DropdownMenuItem onClick={() => { setMoving(node); setMoveTarget(node.parentId ?? '_root'); }}>
                  <FolderInput className="mr-2 size-4" /> Move to…
                </DropdownMenuItem>
              )}
              {node.permission === 'manage' && (
                <DropdownMenuItem onClick={() => { openPage(node.id); setSharing(true); }}>
                  <Share2 className="mr-2 size-4" /> Share
                </DropdownMenuItem>
              )}
              {node.permission === 'manage' && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:text-destructive"
                    onClick={() => setDeleting(node)}>
                    <Trash2 className="mr-2 size-4" /> Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {node.isFolder && isOpen && (
          <div>
            {kids.map(child => renderNode(child, depth + 1))}
            {kids.length === 0 && (
              <p className="py-1 text-xs text-muted-foreground"
                 style={{ paddingLeft: `${30 + depth * 14}px` }}>
                Empty
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  const roots = childrenOf(null);

  return (
    <TooltipProvider>
      <div className="flex h-full flex-1 overflow-hidden">
        {/* ─── Sidebar ─── */}
        <aside className="hidden w-72 shrink-0 flex-col border-r bg-card sm:flex">
          <div className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline"
                  className="w-full justify-start gap-2 border-emerald-200 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-800 dark:hover:bg-emerald-950/30">
                  <Plus className="size-4" /> New
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuItem onClick={() => setCreateIn({ parentId: null })}>
                  <FileText className="mr-2 size-4" /> Page or folder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="px-3 pb-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search the workspace…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-8 text-sm"
              />
            </div>
          </div>

          <Separator />

          <ScrollArea className="flex-1 px-2 py-2">
            {loading ? (
              <div className="space-y-2 px-1">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : roots.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                {search ? 'Nothing matches that.' : 'Nothing here yet.'}
              </p>
            ) : (
              <>
                {starred.length > 0 && !search && (
                  <div className="mb-2">
                    <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Starred
                    </p>
                    {starred.map(node => (
                      <button
                        key={`star-${node.id}`}
                        onClick={() => openPage(node.id)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                      >
                        <Star className="size-3.5 shrink-0 fill-amber-500 text-amber-500" />
                        <span className="truncate">{node.title}</span>
                      </button>
                    ))}
                    <Separator className="my-2" />
                  </div>
                )}
                <div className="space-y-0.5">{roots.map(node => renderNode(node, 0))}</div>
              </>
            )}
          </ScrollArea>
        </aside>

        {/* ─── Content ─── */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {!selectedId ? (
            <EmptyState
              icon={BookMarked}
              title="Nothing open"
              description="Choose something from the sidebar, or create a folder, document or spreadsheet."
              action={{ label: 'New', onClick: () => setCreateIn({ parentId: null }) }}
            />
          ) : pageLoading ? (
            <div className="flex-1 space-y-4 p-6">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-4 w-96" />
              <div className="mt-6 space-y-2">
                {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
              </div>
            </div>
          ) : page ? (
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Header */}
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-6">
                {(() => {
                  const Icon = ICON_MAP[page.icon ?? ''] ?? (page.isFolder ? Folder : page.kind === 'sheet' ? Table : FileText);
                  return <Icon className="size-5 shrink-0" style={{ color: page.colour }} />;
                })()}

                {renamingTitle ? (
                  <Input
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={saveTitle}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveTitle();
                      if (e.key === 'Escape') { setTitleDraft(page.title); setRenamingTitle(false); }
                    }}
                    className="h-8 max-w-xs text-lg font-semibold"
                    autoFocus
                  />
                ) : (
                  <h1
                    className={cn('truncate text-lg font-semibold', canEdit && 'cursor-pointer hover:text-emerald-600')}
                    onClick={() => canEdit && (setTitleDraft(page.title), setRenamingTitle(true))}
                  >
                    {page.title}
                  </h1>
                )}

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8"
                      onClick={() => toggleStar(page)}>
                      {page.isStarred
                        ? <Star className="size-4 fill-amber-500 text-amber-500" />
                        : <StarOff className="size-4 text-muted-foreground" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{page.isStarred ? 'Remove star' : 'Star'}</TooltipContent>
                </Tooltip>

                {page.permission === 'view' && (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <Lock className="size-3" /> Read only
                  </Badge>
                )}

                {/* View switcher */}
                <div className="flex items-center gap-1 rounded-md border bg-muted p-1 text-xs font-medium">
                  {!page.isFolder && page.kind === 'document' && (
                    <ViewTab active={view === 'doc'} onClick={() => setView('doc')} icon={FileText} label="Document" />
                  )}
                  {!page.isFolder && page.kind === 'sheet' && (
                    <ViewTab active={view === 'sheet'} onClick={() => setView('sheet')} icon={FileSpreadsheet} label="Spreadsheet" />
                  )}
                  <ViewTab active={view === 'files'} onClick={() => setView('files')} icon={UploadCloud}
                    label={`Files${page.files.length ? ` (${page.files.length})` : ''}`} />
                </div>

                <div className="ml-auto flex items-center gap-1.5">
                  {!page.isFolder && page.kind === 'document' && (
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={loadVersions}>
                      <History className="size-3.5" />
                      <span className="hidden sm:inline">History</span>
                    </Button>
                  )}

                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSharing(true)}>
                    <Share2 className="size-3.5" />
                    <span className="hidden sm:inline">Share</span>
                    {page.shareCount > 0 && (
                      <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[10px]">{page.shareCount}</Badge>
                    )}
                  </Button>

                  {view === 'doc' && !page.isFolder && canEdit && (
                    !editing ? (
                      <Button variant="outline" size="sm" className="gap-1.5"
                        onClick={() => { setDraft(page.content); setEditing(true); }}>
                        <Pencil className="size-3.5" /> Edit
                      </Button>
                    ) : (
                      <>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="text-xs">Template</Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {DOCUMENT_TEMPLATES.map(t => (
                              <DropdownMenuItem key={t.label} onClick={() => setDraft(t.body)}>
                                {t.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button variant="outline" size="sm"
                          onClick={() => { setEditing(false); setDraft(page.content); }}>
                          Cancel
                        </Button>
                        <Button size="sm" className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                          onClick={saveDocument} disabled={savingDoc}>
                          {savingDoc && <Loader2 className="size-3.5 animate-spin" />} Save
                        </Button>
                      </>
                    )
                  )}

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-8">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canEdit && (
                        <DropdownMenuItem onClick={() => { setTitleDraft(page.title); setRenamingTitle(true); }}>
                          <Pencil className="mr-2 size-4" /> Rename
                        </DropdownMenuItem>
                      )}
                      {canEdit && (
                        <DropdownMenuItem
                          onClick={() => {
                            const node = nodes.find(n => n.id === page.id);
                            if (node) { setMoving(node); setMoveTarget(node.parentId ?? '_root'); }
                          }}>
                          <FolderInput className="mr-2 size-4" /> Move to…
                        </DropdownMenuItem>
                      )}
                      {page.permission === 'manage' && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => {
                              const node = nodes.find(n => n.id === page.id);
                              if (node) setDeleting(node);
                            }}>
                            <Trash2 className="mr-2 size-4" /> Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Body */}
              <ScrollArea className="flex-1">
                <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
                  {page.isFolder && view === 'files' && (
                    <FolderContents
                      nodes={childrenOf(page.id)}
                      onOpen={openPage}
                      onCreate={() => setCreateIn({ parentId: page.id })}
                      canEdit={canEdit}
                    />
                  )}

                  {view === 'doc' && !page.isFolder && (
                    editing ? (
                      <Textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        className="min-h-[460px] font-mono text-sm"
                        placeholder="Write in Markdown…"
                      />
                    ) : (
                      <div className="prose prose-sm max-w-none dark:prose-invert">
                        {page.content
                          ? <ReactMarkdown>{page.content}</ReactMarkdown>
                          : <p className="italic text-muted-foreground">
                              This page is empty.{canEdit ? ' Choose Edit to add something.' : ''}
                            </p>}
                      </div>
                    )
                  )}

                  {view === 'sheet' && page.kind === 'sheet' && (
                    <SheetGrid
                      pageId={page.id}
                      columns={page.columns}
                      rows={page.rows}
                      members={members}
                      canEdit={!!canEdit}
                      onChanged={({ columns, rows }) => setPage(p => p ? { ...p, columns, rows } : p)}
                    />
                  )}

                  {view === 'files' && (
                    <div className={page.isFolder ? 'mt-8' : ''}>
                      <FileBrowser
                        pageId={page.id}
                        organizationId={organizationId}
                        files={page.files}
                        canEdit={!!canEdit}
                        onChanged={(files: WorkspaceFile[]) => setPage(p => p ? { ...p, files } : p)}
                      />
                    </div>
                  )}

                  <p className="mt-8 border-t pt-4 text-xs text-muted-foreground">
                    Version {page.version} · last edited{' '}
                    {page.lastEditedByName ? `by ${page.lastEditedByName} ` : ''}
                    {formatRelativeTime(page.updatedAt)}
                  </p>
                </div>
              </ScrollArea>
            </div>
          ) : null}
        </main>
      </div>

      {/*
        ─── Create ───
        Keyed on the destination so the dialog is a fresh component each time it
        opens. That is how the rest of this codebase resets a form — it avoids
        an effect that writes state on open, which cascades a render.
      */}
      <CreateDialog
        key={createIn ? `create-${createIn.parentId ?? 'root'}` : 'create-closed'}
        state={createIn}
        folders={nodes.filter(n => n.isFolder && n.permission !== 'view')}
        onClose={() => setCreateIn(null)}
        onSubmit={createNode}
      />

      {/* ─── Move ─── */}
      <Dialog open={!!moving} onOpenChange={(open) => !open && setMoving(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move “{moving?.title}”</DialogTitle>
            <DialogDescription>
              Choose the folder this should live in. A folder cannot be moved inside itself.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Destination</Label>
            <Select value={moveTarget} onValueChange={setMoveTarget}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="_root">Top level</SelectItem>
                {nodes
                  .filter(n => n.isFolder && n.id !== moving?.id && n.permission !== 'view')
                  .map(f => <SelectItem key={f.id} value={f.id}>{f.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoving(null)}>Cancel</Button>
            <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={confirmMove}>
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── History ─── */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Version history</DialogTitle>
            <DialogDescription>
              Every saved change to “{page?.title}”. Restoring keeps the current version in the
              history, so a restore can itself be undone.
            </DialogDescription>
          </DialogHeader>
          {versions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No earlier versions yet — history starts at the first edit after a page is created.
            </p>
          ) : (
            <ScrollArea className="max-h-80">
              <div className="divide-y rounded-md border">
                {versions.map(v => (
                  <div key={v.id} className="flex items-center gap-3 p-3">
                    <Badge variant="outline" className="shrink-0 font-mono text-[10px]">v{v.version}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{v.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {v.editor?.profiles?.fullName ?? 'A colleague'} · {formatDateTime(v.createdAt)}
                      </p>
                    </div>
                    {canEdit && (
                      <Button variant="outline" size="sm" className="shrink-0 gap-1.5"
                        onClick={() => restoreVersion(v.version)}>
                        <RotateCcw className="size-3.5" /> Restore
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      <ShareDialog
        page={page}
        open={sharing}
        onOpenChange={setSharing}
        members={members}
        departments={departments}
        onSaved={() => { loadTree(); if (page) openPage(page.id); }}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting?.isFolder ? 'Delete folder' : 'Delete page'}
        description={deleting?.isFolder
          ? `Delete “${deleting?.title}” and everything inside it? An administrator can restore it.`
          : `Delete “${deleting?.title}”? An administrator can restore it.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
        isLoading={isDeleting}
      />
    </TooltipProvider>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Pieces
// ═══════════════════════════════════════════════════════════════════════════

function ViewTab({
  active, onClick, icon: Icon, label,
}: { active: boolean; onClick: () => void; icon: React.ElementType; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded px-2.5 py-1 transition-colors',
        active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="size-3.5" /> {label}
    </button>
  );
}

/** What a folder contains, shown when a folder is the thing that is open. */
function FolderContents({
  nodes, onOpen, onCreate, canEdit,
}: {
  nodes: WorkspaceNode[];
  onOpen: (id: string) => void;
  onCreate: () => void;
  canEdit: boolean;
}) {
  if (!nodes.length) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <Folder className="mx-auto mb-3 size-8 text-muted-foreground" />
        <p className="text-sm font-medium">This folder is empty</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Add a document, a spreadsheet or another folder.
        </p>
        {canEdit && (
          <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={onCreate}>
            <Plus className="size-3.5" /> New inside
          </Button>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Contents</h3>
        {canEdit && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onCreate}>
            <Plus className="size-3.5" /> New inside
          </Button>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {nodes.map(node => {
          const Icon = ICON_MAP[node.icon ?? ''] ?? (node.isFolder ? Folder : node.kind === 'sheet' ? Table : FileText);
          return (
            <button
              key={node.id}
              onClick={() => onOpen(node.id)}
              className="flex items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/40"
            >
              <Icon className="size-5 shrink-0" style={{ color: node.colour }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{node.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {node.isFolder
                    ? `${node.childCount} item${node.childCount === 1 ? '' : 's'}`
                    : node.kind === 'sheet' ? 'Spreadsheet' : 'Document'}
                  {node.fileCount > 0 && ` · ${node.fileCount} file${node.fileCount === 1 ? '' : 's'}`}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CreateDialog({
  state, folders, onClose, onSubmit,
}: {
  state: { parentId: string | null } | null;
  folders: WorkspaceNode[];
  onClose: () => void;
  onSubmit: (values: {
    title: string; kind: 'document' | 'sheet'; isFolder: boolean;
    icon: string; colour: string; parentId: string | null; content: string;
  }) => void;
}) {
  const [what, setWhat] = useState<'document' | 'sheet' | 'folder'>('document');
  const [title, setTitle] = useState('');
  /**
   * `null` means "follow the kind".
   *
   * The icon tracks what is being created — picking Folder and being left with
   * a document icon is the small wrongness that makes a tree hard to scan — but
   * an explicit choice has to survive changing the kind afterwards. Deriving it
   * during render rather than syncing it in an effect keeps both true without a
   * cascading render.
   */
  const [chosenIcon, setChosenIcon] = useState<string | null>(null);
  const icon = chosenIcon ?? (what === 'folder' ? 'folder' : what === 'sheet' ? 'table' : 'file-text');
  const [colour, setColour] = useState('#10b981');
  const [parentId, setParentId] = useState(state?.parentId ?? '_root');
  const [saving, setSaving] = useState(false);

  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create</DialogTitle>
          <DialogDescription>
            A folder holds other pages and files. A document is written in Markdown; a spreadsheet
            is a grid with columns you define.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {([
              ['document', 'Document', FileText],
              ['sheet', 'Spreadsheet', FileSpreadsheet],
              ['folder', 'Folder', Folder],
            ] as const).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => setWhat(value)}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs transition-colors',
                  what === value ? 'border-emerald-500 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
                    : 'hover:bg-accent/50',
                )}
              >
                <Icon className="size-5" />
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-title">Name</Label>
            <Input id="new-title" value={title} autoFocus
              onChange={(e) => setTitle(e.target.value)}
              placeholder={what === 'folder' ? 'e.g. HR Documents' : 'e.g. Expense tracker'} />
          </div>

          <div className="space-y-2">
            <Label>Inside</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="_root">Top level</SelectItem>
                {folders.map(f => <SelectItem key={f.id} value={f.id}>{f.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Icon</Label>
              <Select value={icon} onValueChange={setChosenIcon}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ICON_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span className="flex items-center gap-2"><opt.icon className="size-4" /> {opt.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Colour</Label>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {COLOR_SWATCHES.map(c => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Colour ${c}`}
                    className={cn('size-6 rounded-full border-2 transition-all',
                      colour === c ? 'scale-110 border-foreground' : 'border-transparent')}
                    style={{ backgroundColor: c }}
                    onClick={() => setColour(c)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={!title.trim() || saving}
            onClick={() => {
              setSaving(true);
              onSubmit({
                title: title.trim(),
                kind: what === 'sheet' ? 'sheet' : 'document',
                isFolder: what === 'folder',
                icon, colour,
                parentId: parentId === '_root' ? null : parentId,
                content: what === 'document' ? '' : '',
              });
            }}
          >
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
