'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  ChevronRight, Star, StarOff, MoreHorizontal, Pencil, Trash2, Share2, History,
  FolderInput, Loader2, RotateCcw, ArrowLeft, FileText, MessageSquare,
  Paperclip, Info, ListTree, Copy, BookmarkPlus, Eye, PenLine, Columns2, Check,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { formatDateTime, formatRelativeTime, initialsOf } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { useRealtime, useTyping } from '@/hooks/use-realtime';

import { ShareDialog } from './share-dialog';
import { MarkdownView } from './markdown';
import { MarkdownEditor, EditorToolbar, type MarkdownEditorHandle } from './editor';
import { Sheet } from './sheet';
import { FilePanel } from './files';
import { Discussion } from './comments';
import { LinkPanel } from './links';
import {
  IconTile, iconFor, AccessTag, Nothing, SaveIndicator, type SaveState,
} from './ui';
import {
  getOne, getList, patch, remove, outlineOf, readingTime, wordCount, count, kindWord,
  type ApiFailure,
} from './data';
import type {
  OpenPage, WorkspaceNode, PageVersion, PageComment, PageLink, WorkspaceFile,
  DirectoryMember, Department,
} from './types';

/**
 * ===========================================================================
 *  An open page
 * ===========================================================================
 *
 *  When a document is open, the document is the screen. The library, the tree
 *  and the section bar all go away, because a person reading a policy is
 *  reading a policy and the navigation they need is the way back.
 *
 *  -- Autosave, and what makes it safe -------------------------------------
 *
 *  Typing commits about a second and a half after it stops. Three things make
 *  that safe rather than merely convenient:
 *
 *    1. **Version history coalesces.** 0035 changed the snapshot trigger so
 *       consecutive edits by the same person inside ten minutes extend one
 *       revision instead of adding fifty. Without that, autosave would fill
 *       the history with keystrokes and `prune_page_versions` would then throw
 *       away the version somebody actually wanted.
 *
 *    2. **The write is conditional.** Every body save carries the version the
 *       editor opened at, and the endpoint refuses it if the stored version
 *       has moved on. Two people editing at once cannot overwrite each other:
 *       the second one is told, and keeps their draft.
 *
 *    3. **Nothing is thrown away on a failure.** A refused save leaves the
 *       draft in the box and the indicator saying so. The one behaviour this
 *       must never have is losing work quietly.
 *
 *  -- What "collaboration" means here --------------------------------------
 *
 *  Presence and conflict-safe saves, not character-by-character co-editing.
 *  Simultaneous editing of one paragraph needs a CRDT and a server that holds
 *  document state, which is infrastructure this product does not have; the
 *  brief for this phase says explicitly not to fake it. What is here is real:
 *  a colleague opening the same page appears in the header, and if they save
 *  while you are typing you are told rather than silently overwritten.
 */

/** How long after typing stops before a save goes out. */
const AUTOSAVE_MS = 1500;

type Panel = 'body' | 'files' | 'discussion' | 'details';

export function PageView({
  pageId, nodes, members, departments, onBack, onOpen, onTreeChanged, onDeleted,
}: {
  pageId: string;
  nodes: WorkspaceNode[];
  members: DirectoryMember[];
  departments: Department[];
  onBack: () => void;
  onOpen: (id: string) => void;
  onTreeChanged: () => void;
  onDeleted: () => void;
}) {
  const organizationId = useAppStore(s => s.user?.organizationId ?? '');
  const me = useAppStore(s => s.user);

  const [page, setPage] = React.useState<OpenPage | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [failed, setFailed] = React.useState<string | null>(null);

  const [panel, setPanel] = React.useState<Panel>('body');
  const [mode, setMode] = React.useState<'write' | 'read' | 'split'>('read');

  const [draft, setDraft] = React.useState('');
  const [save, setSave] = React.useState<SaveState>({ kind: 'idle' });
  const [baseVersion, setBaseVersion] = React.useState(1);

  const [comments, setComments] = React.useState<PageComment[]>([]);
  const [renaming, setRenaming] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState('');
  const [sharing, setSharing] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [versions, setVersions] = React.useState<PageVersion[]>([]);
  const [previewVersion, setPreviewVersion] = React.useState<PageVersion | null>(null);
  const [moving, setMoving] = React.useState(false);
  const [moveTarget, setMoveTarget] = React.useState('_root');
  const [deleting, setDeleting] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [outsideEdit, setOutsideEdit] = React.useState<string | null>(null);
  const [linkPrompt, setLinkPrompt] = React.useState<{ kind: 'link' | 'image' } | null>(null);

  /**
   * The editor's handle, in state rather than a ref.
   *
   * The toolbar is rendered in the header, above the editor, and needs the
   * command API the editor exposes. A ref would be null on the render that
   * draws the toolbar and would never cause a second one, so the toolbar would
   * simply not appear until something else re-rendered the page. A callback
   * ref into state attaches and re-renders, and detaches to null when the
   * editor unmounts on the way back to reading.
   */
  const [editor, setEditor] = React.useState<MarkdownEditorHandle | null>(null);

  /* ---------------------------------------------------------------------- */
  /*  Loading                                                               */
  /* ---------------------------------------------------------------------- */

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await getOne<OpenPage>(`/api/workspace/pages/${pageId}`);
      setPage(data);
      setBaseVersion(data.version);
      setTitleDraft(data.title);
      setFailed(null);
      if (!silent) {
        setDraft(data.content ?? '');
        // A folder has no body, and a sheet's body is its grid.
        setPanel(data.isFolder ? 'files' : 'body');
        setMode(data.permission === 'view' || data.isFolder ? 'read' : 'read');
      }
    } catch (err: any) {
      setFailed(err.message || 'That page could not be opened.');
      setPage(null);
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  React.useEffect(() => { void load(); }, [load]);

  React.useEffect(() => {
    getList<PageComment>(`/api/workspace/comments?pageId=${pageId}`)
      .then(setComments)
      .catch(() => setComments([]));
  }, [pageId]);

  const canEdit = page?.permission === 'edit' || page?.permission === 'manage';
  const canManage = page?.permission === 'manage';

  /* ---------------------------------------------------------------------- */
  /*  Autosave                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * The state a save needs, in refs.
   *
   * The debounce timer fires long after the render that scheduled it, and a
   * closure over `draft` and `baseVersion` would write whatever they were when
   * the person stopped typing rather than what they are now. Every previous
   * "the last word did not save" bug in an editor is this one.
   */
  const latest = React.useRef({ draft, baseVersion, canEdit, pageId });
  React.useEffect(() => {
    latest.current = { draft, baseVersion, canEdit, pageId };
  });

  const savedContent = React.useRef(draft);
  React.useEffect(() => { savedContent.current = page?.content ?? ''; }, [page?.id]);

  const commit = React.useCallback(async () => {
    const { draft: body, baseVersion: base, canEdit: allowed, pageId: id } = latest.current;
    if (!allowed) return;
    if (body === savedContent.current) return;

    setSave({ kind: 'saving' });
    try {
      const updated = await patch<{ version: number }>(`/api/workspace/pages/${id}`, {
        content: body,
        baseVersion: base,
      });
      savedContent.current = body;
      setBaseVersion(updated.version);
      setOutsideEdit(null);
      setSave({ kind: 'saved', at: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) });
      onTreeChanged();
    } catch (err) {
      const failure = err as ApiFailure;
      if (failure.code === 'VERSION_CONFLICT') {
        setSave({ kind: 'conflict', editor: failure.details?.latestEditor ?? null });
        return;
      }
      setSave({ kind: 'error', message: failure.message || 'Could not save' });
    }
  }, [onTreeChanged]);

  // The debounce.
  React.useEffect(() => {
    if (!canEdit || page?.isFolder || page?.kind === 'sheet') return;
    if (draft === savedContent.current) return;
    setSave(prev => (prev.kind === 'conflict' ? prev : { kind: 'dirty' }));
    const timer = setTimeout(() => { void commit(); }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [draft, canEdit, page?.isFolder, page?.kind, commit]);

  /**
   * A last save on the way out.
   *
   * Leaving the page, switching to another document or closing the tab all
   * happen faster than the debounce, and the one thing this editor must never
   * do is lose the sentence somebody just typed.
   */
  React.useEffect(() => {
    const flush = () => { void commit(); };
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [commit]);

  /* ---------------------------------------------------------------------- */
  /*  Live                                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * Who else has this page open.
   *
   * Broadcast, not a table: "Ada is here" is true for a few seconds, nobody
   * needs it afterwards, and writing it down would mean a row per person per
   * page with a cleanup job for state that expires on its own. A lost message
   * means an avatar does not appear, which is the right failure for something
   * this ephemeral.
   */
  const { typing: alsoHere, signal } = useTyping(
    `page:${pageId}`,
    me?.memberId
      ? {
        memberId: me.memberId,
        name: [me.firstName, me.lastName].filter(Boolean).join(' ') || me.email,
      }
      : null,
  );

  // Announce presence on arrival and every few seconds, so somebody reading
  // rather than typing still appears to their colleagues.
  React.useEffect(() => {
    signal();
    const timer = setInterval(signal, 4000);
    return () => clearInterval(timer);
  }, [signal]);

  useRealtime({
    name: `workspace-page:${pageId}`,
    onChange: () => {
      const dirty = latest.current.draft !== savedContent.current;
      if (!dirty) { void load(true); return; }
      /*
        Somebody saved while this person is mid-sentence.

        Reloading would replace their draft with a document that does not
        contain it. So the page says what happened and leaves the draft alone;
        the conditional write will refuse the next save and offer the choice.
      */
      setOutsideEdit('This page changed while you were writing.');
    },
    tables: [
      { table: 'workspace_pages', filter: `id=eq.${pageId}` },
      { table: 'comments', filter: `page_id=eq.${pageId}` },
      { table: 'files', filter: `page_id=eq.${pageId}` },
    ],
  });

  React.useEffect(() => {
    // The comment thread is not part of the page read, so a colleague posting
    // has to refresh it separately.
    if (!outsideEdit) {
      getList<PageComment>(`/api/workspace/comments?pageId=${pageId}`)
        .then(setComments)
        .catch(() => undefined);
    }
  }, [pageId, page?.updatedAt, outsideEdit]);

  /* ---------------------------------------------------------------------- */
  /*  Actions                                                               */
  /* ---------------------------------------------------------------------- */

  const saveTitle = React.useCallback(async () => {
    if (!page || !titleDraft.trim() || titleDraft === page.title) { setRenaming(false); return; }
    try {
      await patch(`/api/workspace/pages/${page.id}`, { title: titleDraft.trim() });
      setPage(p => (p ? { ...p, title: titleDraft.trim() } : p));
      setRenaming(false);
      onTreeChanged();
    } catch (err: any) {
      toast.error(err.message || 'Rename failed');
    }
  }, [page, titleDraft, onTreeChanged]);

  const toggleStar = React.useCallback(async () => {
    if (!page) return;
    const next = !page.isStarred;
    setPage(p => (p ? { ...p, isStarred: next } : p));
    try {
      await patch(`/api/workspace/pages/${page.id}`, { isStarred: next });
      onTreeChanged();
    } catch (err: any) {
      setPage(p => (p ? { ...p, isStarred: !next } : p));
      toast.error(err.message || 'Could not update');
    }
  }, [page, onTreeChanged]);

  const loadVersions = React.useCallback(async () => {
    if (!page) return;
    try {
      setVersions(await getList<PageVersion>(`/api/workspace/pages/${page.id}/versions`));
      setHistoryOpen(true);
    } catch (err: any) {
      toast.error(err.message || 'Could not load the history');
    }
  }, [page]);

  const restoreVersion = React.useCallback(async (version: number) => {
    if (!page) return;
    try {
      await fetch(`/api/workspace/pages/${page.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      });
      const fresh = await getOne<OpenPage>(`/api/workspace/pages/${page.id}`);
      setPage(fresh);
      setDraft(fresh.content ?? '');
      savedContent.current = fresh.content ?? '';
      setBaseVersion(fresh.version);
      setHistoryOpen(false);
      setPreviewVersion(null);
      setSave({ kind: 'idle' });
      onTreeChanged();
      toast.success(`Restored version ${version}`);
    } catch (err: any) {
      toast.error(err.message || 'Restore failed');
    }
  }, [page, onTreeChanged]);

  /**
   * Take the newest version and reapply this draft on top of it.
   *
   * The only honest resolution a machine can offer for two people editing the
   * same document: the person who is looking at the conflict decides. "Keep
   * mine" saves against the version that is actually stored, which overwrites
   * the colleague's change; "Take theirs" discards this draft. Both are
   * recoverable, because both versions are in the history.
   */
  const resolveConflict = React.useCallback(async (keep: 'mine' | 'theirs') => {
    if (!page) return;
    const fresh = await getOne<OpenPage>(`/api/workspace/pages/${page.id}`);

    if (keep === 'theirs') {
      setPage(fresh);
      setDraft(fresh.content ?? '');
      savedContent.current = fresh.content ?? '';
      setBaseVersion(fresh.version);
      setSave({ kind: 'idle' });
      setOutsideEdit(null);
      return;
    }

    setBaseVersion(fresh.version);
    savedContent.current = fresh.content ?? '';
    setSave({ kind: 'dirty' });
    setOutsideEdit(null);
    // The next debounce writes against the version that is really stored.
    setTimeout(() => { void commit(); }, 0);
  }, [page, commit]);

  /* ---------------------------------------------------------------------- */
  /*  Derived                                                               */
  /* ---------------------------------------------------------------------- */

  const trail = React.useMemo(() => {
    if (!page) return [];
    const byId = new Map(nodes.map(n => [n.id, n]));
    const out: WorkspaceNode[] = [];
    let parent = page.parentId ? byId.get(page.parentId) : undefined;
    let hops = 0;
    while (parent && hops < 20) {
      out.unshift(parent);
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
      hops++;
    }
    return out;
  }, [page, nodes]);

  const children = React.useMemo(
    () => nodes
      .filter(n => n.parentId === pageId)
      .sort((a, b) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        return a.title.localeCompare(b.title);
      }),
    [nodes, pageId],
  );

  const writableFolders = React.useMemo(
    () => nodes.filter(n => n.isFolder && n.permission !== 'view'),
    [nodes],
  );

  const outline = React.useMemo(() => outlineOf(draft), [draft]);

  /* ---------------------------------------------------------------------- */
  /*  Render                                                                */
  /* ---------------------------------------------------------------------- */

  if (loading) {
    return (
      <div className="space-y-6 p-4 md:p-8">
        <Skeleton className="h-4 w-52" />
        <Skeleton className="h-8 w-80" />
        <div className="mx-auto max-w-[68ch] space-y-3 pt-6">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className={cn('h-4', i % 4 === 3 ? 'w-2/3' : 'w-full')} />
          ))}
        </div>
      </div>
    );
  }

  if (failed || !page) {
    return (
      <div className="p-4 md:p-8">
        <div className="rounded-md border border-border p-8 text-center">
          <p className="text-[14px] font-medium">This page could not be opened</p>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] text-muted-foreground">
            {failed ?? 'It may have been moved, deleted, or shared with somebody else.'}
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" onClick={onBack}>Back to the library</Button>
            <Button size="sm" onClick={() => load()}>Try again</Button>
          </div>
        </div>
      </div>
    );
  }

  const Icon = iconFor(page);
  const isDocument = !page.isFolder && page.kind === 'document';
  const isSheet = !page.isFolder && page.kind === 'sheet';

  const panels: { id: Panel; label: string; icon: React.ElementType; badge?: number }[] = [
    ...(page.isFolder
      ? []
      : [{ id: 'body' as Panel, label: isSheet ? 'Sheet' : 'Document', icon: FileText }]),
    { id: 'files', label: page.isFolder ? 'Contents' : 'Files', icon: Paperclip, badge: page.files.length || undefined },
    { id: 'discussion', label: 'Discussion', icon: MessageSquare, badge: comments.length || undefined },
    { id: 'details', label: 'Details', icon: Info },
  ];

  return (
    <TooltipProvider>
      <div className="flex min-h-0 flex-1 flex-col">
        {/* -- Header -------------------------------------------------- */}
        <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="px-4 pt-3 md:px-8">
            {/* Breadcrumb */}
            <nav aria-label="Location" className="flex min-w-0 items-center gap-1 text-[11.5px] text-muted-foreground">
              <button
                type="button"
                onClick={onBack}
                className="inline-flex shrink-0 items-center gap-1 transition-colors hover:text-foreground"
              >
                <ArrowLeft className="size-3" /> Library
              </button>
              {trail.map(ancestor => (
                <React.Fragment key={ancestor.id}>
                  <ChevronRight className="size-3 shrink-0 opacity-50" />
                  <button
                    type="button"
                    onClick={() => onOpen(ancestor.id)}
                    className="min-w-0 truncate transition-colors hover:text-foreground"
                  >
                    {ancestor.title}
                  </button>
                </React.Fragment>
              ))}
            </nav>

            {/* Title row */}
            <div className="mt-1.5 flex flex-wrap items-start gap-x-3 gap-y-2">
              <IconTile icon={Icon} colour={page.colour} size="lg" className="mt-0.5" />

              <div className="min-w-0 flex-1">
                {renaming ? (
                  <Input
                    value={titleDraft}
                    autoFocus
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={saveTitle}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveTitle();
                      if (e.key === 'Escape') { setTitleDraft(page.title); setRenaming(false); }
                    }}
                    className="h-9 max-w-lg text-[21px] font-semibold tracking-[-0.015em]"
                  />
                ) : (
                  <h1
                    className={cn(
                      'truncate text-[21px] font-semibold tracking-[-0.015em] text-foreground',
                      canEdit && 'cursor-text',
                    )}
                    onClick={() => { if (canEdit) { setTitleDraft(page.title); setRenaming(true); } }}
                    title={canEdit ? 'Click to rename' : undefined}
                  >
                    {page.title}
                  </h1>
                )}

                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <AccessTag
                    visibility={page.visibility}
                    departmentName={page.departmentName}
                    shareCount={page.shareCount}
                  />
                  <span className="text-[11.5px] text-muted-foreground">
                    {kindWord(page)}
                    {page.lastEditedByName ? ` · ${page.lastEditedByName}` : ''}
                    {` · ${formatRelativeTime(page.updatedAt)}`}
                  </span>
                  {isDocument && readingTime(draft) && (
                    <span className="text-[11.5px] text-muted-foreground">{readingTime(draft)}</span>
                  )}
                  {canEdit && isDocument && <SaveIndicator state={save} />}
                </div>
              </div>

              {/* Who else is here */}
              {alsoHere.length > 0 && (
                <div className="flex -space-x-1.5">
                  {alsoHere.slice(0, 4).map(person => (
                    <Tooltip key={person.memberId}>
                      <TooltipTrigger asChild>
                        <Avatar className="size-6 border-2 border-background">
                          <AvatarFallback className="text-[9px]">{initialsOf(person.name)}</AvatarFallback>
                        </Avatar>
                      </TooltipTrigger>
                      <TooltipContent>{person.name} is here</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              )}

              <div className="flex shrink-0 items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8" onClick={toggleStar}>
                      {page.isStarred
                        ? <Star className="size-4 fill-[#d4a93f] text-[#d4a93f]" />
                        : <StarOff className="size-4 text-muted-foreground" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{page.isStarred ? 'Remove star' : 'Star for the company'}</TooltipContent>
                </Tooltip>

                {/*
                  Read / Write, on every screen.

                  This control used to be `hidden sm:flex`, which meant a
                  document could not be edited at all on a phone: the toolbar
                  and the writing surface are both behind it. The label is
                  dropped below `sm` so the pair fits beside Share, and "Both"
                  stays out until there is room for two columns of prose.
                */}
                {isDocument && canEdit && (
                  <div className="flex items-center rounded-md border border-border p-0.5">
                    {([
                      ['read', 'Read', Eye],
                      ['write', 'Write', PenLine],
                      ['split', 'Both', Columns2],
                    ] as const).map(([value, label, ModeIcon]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setMode(value)}
                        aria-pressed={mode === value}
                        aria-label={label}
                        className={cn(
                          'inline-flex items-center gap-1 rounded px-2 py-1 text-[12px] transition-colors',
                          mode === value ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
                          value === 'split' && 'hidden lg:inline-flex',
                        )}
                      >
                        <ModeIcon className="size-3.5" />
                        <span className="hidden sm:inline">{label}</span>
                      </button>
                    ))}
                  </div>
                )}

                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12.5px]"
                  onClick={() => setSharing(true)}>
                  <Share2 className="size-3.5" />
                  <span className="hidden sm:inline">Share</span>
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8" aria-label="Page options">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    {isDocument && (
                      <DropdownMenuItem onClick={loadVersions}>
                        <History className="mr-2 size-4" /> Version history
                      </DropdownMenuItem>
                    )}
                    {canEdit && (
                      <DropdownMenuItem onClick={() => { setTitleDraft(page.title); setRenaming(true); }}>
                        <Pencil className="mr-2 size-4" /> Rename
                      </DropdownMenuItem>
                    )}
                    {canEdit && (
                      <DropdownMenuItem onClick={() => { setMoveTarget(page.parentId ?? '_root'); setMoving(true); }}>
                        <FolderInput className="mr-2 size-4" /> Move to
                      </DropdownMenuItem>
                    )}
                    {canEdit && !page.isFolder && (
                      <DropdownMenuItem
                        onClick={async () => {
                          try {
                            await patch(`/api/workspace/pages/${page.id}`, {
                              isTemplate: !page.isTemplate,
                              templateCategory: page.isTemplate ? null : 'Company',
                            });
                            setPage(p => (p ? { ...p, isTemplate: !p.isTemplate } : p));
                            onTreeChanged();
                            toast.success(page.isTemplate
                              ? 'No longer a template'
                              : 'Saved as a template. It is in the gallery for everyone.');
                          } catch (err: any) {
                            toast.error(err.message || 'Could not do that');
                          }
                        }}
                      >
                        {page.isTemplate
                          ? <><Check className="mr-2 size-4" /> Stop being a template</>
                          : <><BookmarkPlus className="mr-2 size-4" /> Save as template</>}
                      </DropdownMenuItem>
                    )}
                    {isDocument && (
                      <DropdownMenuItem
                        onClick={() => {
                          void navigator.clipboard.writeText(draft)
                            .then(() => toast.success('Document copied as markdown'))
                            .catch(() => toast.error('The clipboard is not available here.'));
                        }}
                      >
                        <Copy className="mr-2 size-4" /> Copy as markdown
                      </DropdownMenuItem>
                    )}
                    {canManage && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleting(true)}
                        >
                          <Trash2 className="mr-2 size-4" /> Delete
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Summary */}
            {page.summary && (
              <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
                {page.summary}
              </p>
            )}

            {/* Panels */}
            <nav aria-label="Page sections" className="mt-2 flex items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {panels.map(item => {
                const on = panel === item.id;
                const PanelIcon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setPanel(item.id)}
                    aria-current={on ? 'page' : undefined}
                    className={cn(
                      'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 py-2.5 text-[12.5px] font-medium transition-colors',
                      on ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <PanelIcon className={cn('size-3.5', on ? 'opacity-100' : 'opacity-70')} />
                    {item.label}
                    {item.badge ? (
                      <span className="rounded bg-muted px-1 text-[10px] tabular-nums">{item.badge}</span>
                    ) : null}
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute inset-x-1.5 bottom-0 h-[2px] rounded-t-full transition-colors',
                        on ? 'bg-foreground' : 'bg-transparent',
                      )}
                    />
                  </button>
                );
              })}
            </nav>
          </div>

          {/* The formatting toolbar sits with the header, so it does not
              scroll away halfway down a long document. */}
          {panel === 'body' && isDocument && canEdit && mode !== 'read' && editor && (
            <EditorToolbar
              api={editor.api}
              onLink={() => setLinkPrompt({ kind: 'link' })}
              onImage={() => setLinkPrompt({ kind: 'image' })}
            />
          )}
        </header>

        {/* -- A colleague changed this -------------------------------- */}
        {(outsideEdit || save.kind === 'conflict') && (
          <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/60 px-4 py-2 md:px-8">
            <p className="min-w-0 flex-1 text-[12.5px] text-foreground">
              {save.kind === 'conflict'
                ? `${(save as any).editor || 'Somebody'} saved this page while you were writing. Your draft is still here.`
                : outsideEdit}
            </p>
            {save.kind === 'conflict' ? (
              <div className="flex shrink-0 items-center gap-1.5">
                <Button variant="outline" size="sm" className="h-7 text-[12px]"
                  onClick={() => resolveConflict('theirs')}>
                  Take theirs
                </Button>
                <Button size="sm" className="h-7 text-[12px]" onClick={() => resolveConflict('mine')}>
                  Keep mine
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" className="h-7 shrink-0 text-[12px]"
                onClick={() => { setOutsideEdit(null); void load(true); }}>
                Reload
              </Button>
            )}
          </div>
        )}

        {/* -- Body ---------------------------------------------------- */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={cn(
            'px-4 py-6 md:px-8 md:py-8',
            // A sheet takes the full width it can get. A document does not:
            // 68 characters is the measure prose is readable at, and a report
            // set across 1600px is one nobody finishes.
            panel === 'body' && isSheet ? 'max-w-none' : 'mx-auto w-full max-w-6xl',
          )}>
            {panel === 'body' && isDocument && (
              <DocumentBody
                mode={canEdit ? mode : 'read'}
                draft={draft}
                onDraftChange={setDraft}
                onTyping={signal}
                editorRef={setEditor}
                outline={outline}
                canEdit={!!canEdit}
              />
            )}

            {panel === 'body' && isSheet && (
              <Sheet
                pageId={page.id}
                columns={page.columns}
                rows={page.rows}
                members={members}
                canEdit={!!canEdit}
                onChanged={({ columns, rows }) => setPage(p => (p ? { ...p, columns, rows } : p))}
              />
            )}

            {panel === 'files' && (
              <div className="space-y-8">
                {page.isFolder && (
                  <FolderContents
                    items={children}
                    onOpen={onOpen}
                    canEdit={!!canEdit}
                  />
                )}
                <FilePanel
                  pageId={page.id}
                  organizationId={organizationId}
                  files={page.files}
                  canEdit={!!canEdit}
                  folders={writableFolders}
                  onChanged={(files: WorkspaceFile[]) => setPage(p => (p ? { ...p, files } : p))}
                />
              </div>
            )}

            {panel === 'discussion' && (
              <div className="mx-auto max-w-3xl">
                <Discussion
                  pageId={page.id}
                  members={members}
                  canPost
                  comments={comments}
                  onChanged={setComments}
                />
              </div>
            )}

            {panel === 'details' && (
              <Details
                page={page}
                canEdit={!!canEdit}
                onLinksChanged={(links: PageLink[]) => setPage(p => (p ? { ...p, links } : p))}
                onSummarySaved={(summary) => setPage(p => (p ? { ...p, summary } : p))}
                onHistory={isDocument ? loadVersions : undefined}
              />
            )}
          </div>
        </div>
      </div>

      {/* -- Dialogs ------------------------------------------------- */}

      <ShareDialog
        page={page}
        open={sharing}
        onOpenChange={setSharing}
        members={members}
        departments={departments}
        onSaved={() => { onTreeChanged(); void load(true); }}
      />

      <Dialog open={historyOpen} onOpenChange={(open) => { setHistoryOpen(open); if (!open) setPreviewVersion(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Version history</DialogTitle>
            <DialogDescription>
              Edits by one person inside ten minutes are kept as a single version, so this is a
              list of sittings rather than of keystrokes. Restoring keeps the current version in
              the history, so a restore can itself be undone.
            </DialogDescription>
          </DialogHeader>

          {versions.length === 0 ? (
            <Nothing>
              No earlier versions yet. History starts at the first edit after a page is created.
            </Nothing>
          ) : (
            <div className="grid gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
              <ul className="max-h-[50vh] overflow-y-auto">
                {versions.map(version => (
                  <li key={version.id}>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          setPreviewVersion(await getOne<PageVersion>(
                            `/api/workspace/pages/${page.id}/versions?version=${version.version}`,
                          ));
                        } catch (err: any) {
                          toast.error(err.message || 'Could not read that version');
                        }
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 border-b border-border/60 px-1 py-2 text-left transition-colors hover:bg-accent/50',
                        previewVersion?.version === version.version && 'bg-accent',
                      )}
                    >
                      <span className="w-8 shrink-0 font-mono text-[11px] text-muted-foreground">
                        v{version.version}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{version.title}</span>
                        <span className="block text-[11.5px] text-muted-foreground">
                          {version.editor?.profiles?.fullName ?? 'A colleague'} · {formatDateTime(version.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="min-w-0">
                {previewVersion ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12.5px] text-muted-foreground">
                        Version {previewVersion.version}, as it was then
                      </p>
                      {canEdit && (
                        <Button size="sm" className="h-7 gap-1.5 text-[12px]"
                          onClick={() => restoreVersion(previewVersion.version)}>
                          <RotateCcw className="size-3" /> Restore this
                        </Button>
                      )}
                    </div>
                    <div className="max-h-[46vh] overflow-y-auto rounded-md border border-border p-4">
                      <MarkdownView content={previewVersion.content ?? ''} compact />
                    </div>
                  </div>
                ) : (
                  <Nothing>Choose a version to read it before restoring.</Nothing>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={moving} onOpenChange={setMoving}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move &ldquo;{page.title}&rdquo;</DialogTitle>
            <DialogDescription>
              Choose where this lives. A folder cannot be moved inside itself.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Destination</Label>
            <Select value={moveTarget} onValueChange={setMoveTarget}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="_root">Top level</SelectItem>
                {writableFolders
                  .filter(f => f.id !== page.id)
                  .map(f => <SelectItem key={f.id} value={f.id}>{f.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoving(false)}>Cancel</Button>
            <Button
              onClick={async () => {
                try {
                  await patch(`/api/workspace/pages/${page.id}`, {
                    parentId: moveTarget === '_root' ? null : moveTarget,
                  });
                  setMoving(false);
                  onTreeChanged();
                  await load(true);
                  toast.success('Moved');
                } catch (err: any) {
                  toast.error(err.message || 'Move failed');
                }
              }}
            >
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        Inserting a link or an image.

        A dialog rather than `window.prompt`, which is blocked outright in some
        browsers, cannot be styled, cannot be cancelled with a keyboard in a
        predictable way, and looks like the page has been hijacked.
      */}
      <InsertDialog
        key={linkPrompt?.kind ?? 'insert-closed'}
        state={linkPrompt}
        onClose={() => setLinkPrompt(null)}
        onSubmit={({ url, label }) => {
          if (!editor) return;
          if (linkPrompt?.kind === 'image') editor.api.insertBlock(`![${label}](${url})`);
          else editor.api.wrap('[', `](${url})`, label || 'link');
          setLinkPrompt(null);
        }}
      />

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={page.isFolder ? 'Delete folder' : `Delete ${kindWord(page).toLowerCase()}`}
        description={page.isFolder
          ? `Delete "${page.title}" and everything inside it? It goes to the trash and can be restored.`
          : `Delete "${page.title}"? It goes to the trash and can be restored.`}
        confirmLabel="Delete"
        variant="destructive"
        isLoading={isDeleting}
        onConfirm={async () => {
          setIsDeleting(true);
          try {
            await remove(`/api/workspace/pages/${page.id}`);
            setDeleting(false);
            onDeleted();
            onTreeChanged();
            toast.success('Moved to the trash');
          } catch (err: any) {
            toast.error(err.message || 'Delete failed');
          } finally {
            setIsDeleting(false);
          }
        }}
      />
    </TooltipProvider>
  );
}

/* -------------------------------------------------------------------------- */
/*  Insert a link or an image                                                 */
/* -------------------------------------------------------------------------- */

function InsertDialog({
  state, onClose, onSubmit,
}: {
  state: { kind: 'link' | 'image' } | null;
  onClose: () => void;
  onSubmit: (values: { url: string; label: string }) => void;
}) {
  const [url, setUrl] = React.useState('');
  const [label, setLabel] = React.useState('');
  const isImage = state?.kind === 'image';

  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isImage ? 'Insert an image' : 'Insert a link'}</DialogTitle>
          <DialogDescription>
            {isImage
              ? 'The address of an image. To use a file of your own, upload it under Files and copy its address.'
              : 'Where the link goes. Selected text becomes the label.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="insert-url">Address</Label>
            <Input id="insert-url" value={url} autoFocus
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && url.trim()) onSubmit({ url: url.trim(), label: label.trim() }); }}
              placeholder="https://" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="insert-label">{isImage ? 'Caption' : 'Text'}</Label>
            <Input id="insert-label" value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Optional" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!url.trim()} onClick={() => onSubmit({ url: url.trim(), label: label.trim() })}>
            Insert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  The document                                                              */
/* -------------------------------------------------------------------------- */

function DocumentBody({
  mode, draft, onDraftChange, onTyping, editorRef, outline, canEdit,
}: {
  mode: 'write' | 'read' | 'split';
  draft: string;
  onDraftChange: (next: string) => void;
  onTyping: () => void;
  editorRef: (handle: MarkdownEditorHandle | null) => void;
  outline: { level: number; text: string; slug: string }[];
  canEdit: boolean;
}) {
  const empty = !draft.trim();

  const contents = outline.length >= 3 && (
    <aside className="hidden w-52 shrink-0 xl:block">
      <div className="sticky top-32">
        <p className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          <ListTree className="size-3" /> Contents
        </p>
        <nav className="border-l border-border">
          {outline.map(heading => (
            <a
              key={heading.slug}
              href={`#${heading.slug}`}
              className={cn(
                '-ml-px block border-l-2 border-transparent py-1 pr-2 text-[12px] leading-snug text-muted-foreground transition-colors',
                'hover:border-[--ring] hover:text-foreground',
              )}
              style={{ paddingLeft: `${8 + (heading.level - 1) * 10}px` }}
            >
              {heading.text}
            </a>
          ))}
        </nav>
      </div>
    </aside>
  );

  return (
    <div className="flex gap-10">
      <div className="min-w-0 flex-1">
        {mode === 'read' && (
          empty ? (
            <Nothing>
              {canEdit
                ? 'This page is empty. Choose Write and start typing, or begin from a template.'
                : 'This page is empty.'}
            </Nothing>
          ) : (
            <div className="max-w-[68ch]">
              <MarkdownView content={draft} />
            </div>
          )
        )}

        {mode === 'write' && (
          <div className="max-w-[68ch]">
            <MarkdownEditor
              ref={editorRef}
              value={draft}
              onChange={onDraftChange}
              onTyping={onTyping}
              placeholder="Start writing. Type ## for a heading, - for a list."
            />
          </div>
        )}

        {mode === 'split' && (
          <div className="grid gap-8 lg:grid-cols-2">
            <MarkdownEditor
              ref={editorRef}
              value={draft}
              onChange={onDraftChange}
              onTyping={onTyping}
              placeholder="Start writing."
            />
            <div className="border-l border-border pl-8">
              {empty
                ? <Nothing>Nothing to preview yet.</Nothing>
                : <MarkdownView content={draft} />}
            </div>
          </div>
        )}
      </div>

      {mode !== 'split' && contents}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  A folder's contents                                                       */
/* -------------------------------------------------------------------------- */

function FolderContents({
  items, onOpen, canEdit,
}: {
  items: WorkspaceNode[];
  onOpen: (id: string) => void;
  canEdit: boolean;
}) {
  if (!items.length) {
    return (
      <div>
        <h2 className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          Inside
        </h2>
        <Nothing>
          {canEdit
            ? 'Nothing in this folder yet. Add a document, a spreadsheet or another folder.'
            : 'Nothing in this folder yet.'}
        </Nothing>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
        Inside · {count(items.length, 'item')}
      </h2>
      <ul>
        {items.map(node => {
          const NodeIcon = iconFor(node);
          return (
            <li key={node.id}>
              <button
                type="button"
                onClick={() => onOpen(node.id)}
                className="flex w-full items-center gap-3 border-b border-border/60 px-1 py-2.5 text-left transition-colors last:border-b-0 hover:bg-accent/50"
              >
                <IconTile icon={NodeIcon} colour={node.colour} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium leading-tight">
                    {node.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[11.5px] leading-tight text-muted-foreground">
                    {node.summary || [
                      kindWord(node),
                      node.isFolder ? count(node.childCount, 'item') : null,
                      node.fileCount ? count(node.fileCount, 'file') : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="shrink-0 text-[11.5px] text-muted-foreground">
                  {formatRelativeTime(node.updatedAt)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Details                                                                   */
/* -------------------------------------------------------------------------- */

function Details({
  page, canEdit, onLinksChanged, onSummarySaved, onHistory,
}: {
  page: OpenPage;
  canEdit: boolean;
  onLinksChanged: (links: PageLink[]) => void;
  onSummarySaved: (summary: string) => void;
  onHistory?: () => void;
}) {
  const [summary, setSummary] = React.useState(page.summary);
  const [saving, setSaving] = React.useState(false);

  const rows: [string, React.ReactNode][] = [
    ['Kind', kindWord(page)],
    ['Owner', page.createdByName ?? 'Unknown'],
    ['Created', formatDateTime(page.createdAt)],
    ['Last edited', `${page.lastEditedByName ? `${page.lastEditedByName}, ` : ''}${formatDateTime(page.updatedAt)}`],
    ['Version', <span key="v" className="font-mono">v{page.version}</span>],
    ['Access', <AccessTag key="a" visibility={page.visibility} departmentName={page.departmentName} shareCount={page.shareCount} />],
    ...(page.departmentName ? [['Department', page.departmentName] as [string, React.ReactNode]] : []),
    ...(page.isTemplate ? [['Template', `In the gallery under ${page.templateCategory || 'Company'}`] as [string, React.ReactNode]] : []),
  ];

  return (
    <div className="mx-auto grid max-w-4xl gap-8 lg:grid-cols-2">
      <section>
        <h2 className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          About this page
        </h2>

        <div className="space-y-2">
          <Label htmlFor="page-summary" className="text-[12px] text-muted-foreground">
            What it is for
          </Label>
          <Input
            id="page-summary"
            value={summary}
            disabled={!canEdit}
            placeholder={canEdit ? 'One line. Shown under the title and in search.' : 'Not set'}
            onChange={(e) => setSummary(e.target.value)}
            onBlur={async () => {
              if (summary === page.summary) return;
              setSaving(true);
              try {
                await patch(`/api/workspace/pages/${page.id}`, { summary });
                onSummarySaved(summary);
              } catch (err: any) {
                toast.error(err.message || 'Could not save that');
                setSummary(page.summary);
              } finally {
                setSaving(false);
              }
            }}
          />
          {saving && <p className="text-[11.5px] text-muted-foreground">Saving</p>}
        </div>

        <dl className="mt-6">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-baseline gap-4 border-b border-border/60 py-2 last:border-b-0">
              <dt className="w-28 shrink-0 text-[11.5px] uppercase tracking-[0.05em] text-muted-foreground">
                {label}
              </dt>
              <dd className="min-w-0 flex-1 text-[13px]">{value}</dd>
            </div>
          ))}
        </dl>

        {onHistory && (
          <Button variant="outline" size="sm" className="mt-4 gap-1.5 text-[12.5px]" onClick={onHistory}>
            <History className="size-3.5" /> Version history
          </Button>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          What this is about
        </h2>
        <p className="mb-3 max-w-prose text-[12.5px] leading-relaxed text-muted-foreground">
          Connect this page to the customer, deal, project, invoice or person it concerns. It then
          appears on that record too, so somebody arriving from the other direction finds it.
        </p>
        <LinkPanel
          pageId={page.id}
          links={page.links}
          canEdit={canEdit}
          onChanged={onLinksChanged}
        />

        {!page.isFolder && (
          <p className="mt-6 text-[11.5px] text-muted-foreground">
            {count(wordCount(page.content), 'word')} · {count(page.files.length, 'file')} filed
          </p>
        )}
      </section>
    </div>
  );
}
