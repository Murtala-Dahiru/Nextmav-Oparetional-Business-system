'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';
import {
  Plus, Search, Star, StarOff, MoreHorizontal, Pencil, Trash2,
  FileText, BookOpen, Map, Folder, Code, Lightbulb, Target,
  ChevronRight, ChevronDown, Loader2, BookMarked,
} from 'lucide-react';

import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { formatRelativeTime } from '@/lib/format';
import { createPageSchema } from '@/lib/validations';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
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

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

interface WorkspacePage {
  id: string;
  title: string;
  content: string;
  icon: string;
  color: string;
  parentId: string;
  isFolder: boolean;
  isStarred: boolean;
  lastEditedBy: string;
  createdAt: string;
  updatedAt: string;
}

type PageFormValues = z.infer<typeof createPageSchema>;

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const ICON_OPTIONS = [
  { value: 'file-text', label: 'File Text', icon: FileText },
  { value: 'book-open', label: 'Book Open', icon: BookOpen },
  { value: 'map', label: 'Map', icon: Map },
  { value: 'star', label: 'Star', icon: Star },
  { value: 'folder', label: 'Folder', icon: Folder },
  { value: 'code', label: 'Code', icon: Code },
  { value: 'lightbulb', label: 'Lightbulb', icon: Lightbulb },
  { value: 'target', label: 'Target', icon: Target },
];

const COLOR_SWATCHES = [
  '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

const ICON_MAP: Record<string, React.ElementType> = {
  'file-text': FileText,
  'book-open': BookOpen,
  map: Map,
  star: Star,
  folder: Folder,
  code: Code,
  lightbulb: Lightbulb,
  target: Target,
};

async function apiFetch<T>(url: string, init?: RequestInit): Promise<{ data: T; meta?: { total: number; page: number; pageSize: number; totalPages: number } }> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Module
// ═══════════════════════════════════════════════════════════════════════════

export default function WorkspaceModule() {
  // Data state
  const [pages, setPages] = useState<WorkspacePage[]>([]);
  const [loading, setLoading] = useState(true);

  // Selection state
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  // Full page content
  const [fullPage, setFullPage] = useState<WorkspacePage | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [savingContent, setSavingContent] = useState(false);

  // Inline title editing
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');

  // Dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingPage, setDeletingPage] = useState<WorkspacePage | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Fetch all pages for sidebar (large page size)
  const fetchPages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<WorkspacePage[]>('/api/workspace/pages?page=1&pageSize=200');
      setPages(res.data || []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load pages');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPages(); }, [fetchPages]);

  // Fetch full page
  const fetchFullPage = useCallback(async (id: string) => {
    setPageLoading(true);
    setSelectedPageId(id);
    setEditing(false);
    try {
      const res = await apiFetch<WorkspacePage>(`/api/workspace/pages/${id}`);
      setFullPage(res.data);
      setEditContent(res.data.content);
      setEditTitle(res.data.title);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load page');
    } finally {
      setPageLoading(false);
    }
  }, []);

  // Derived: filtered pages
  const filteredPages = useMemo(() => {
    if (!sidebarSearch) return pages;
    const q = sidebarSearch.toLowerCase();
    return pages.filter((p) => p.title.toLowerCase().includes(q));
  }, [pages, sidebarSearch]);

  // Derived: folders and non-folder pages
  const rootPages = useMemo(() => {
    const folders = filteredPages.filter((p) => p.isFolder && !p.parentId);
    const items = filteredPages.filter((p) => !p.isFolder && !p.parentId);
    return { folders, items };
  }, [filteredPages]);

  // Get children of a folder
  const getFolderChildren = useCallback((folderId: string) => {
    return filteredPages.filter((p) => p.parentId === folderId && !p.isFolder);
  }, [filteredPages]);

  // Toggle folder collapse
  const toggleFolder = useCallback((folderId: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  // Save page content
  const saveContent = useCallback(async () => {
    if (!fullPage) return;
    setSavingContent(true);
    try {
      const res = await apiFetch<WorkspacePage>(`/api/workspace/pages/${fullPage.id}`, {
        method: 'PUT',
        body: JSON.stringify({ content: editContent }),
      });
      setFullPage(res.data);
      setEditing(false);
      fetchPages();
      toast.success('Page saved');
    } catch (err: any) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSavingContent(false);
    }
  }, [fullPage, editContent, fetchPages]);

  // Save page title (inline)
  const saveTitle = useCallback(async () => {
    if (!fullPage) return;
    try {
      const res = await apiFetch<WorkspacePage>(`/api/workspace/pages/${fullPage.id}`, {
        method: 'PUT',
        body: JSON.stringify({ title: editTitle }),
      });
      setFullPage(res.data);
      setIsEditingTitle(false);
      fetchPages();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update title');
    }
  }, [fullPage, editTitle, fetchPages]);

  // Toggle star
  const toggleStar = useCallback(async (page: WorkspacePage) => {
    try {
      await apiFetch(`/api/workspace/pages/${page.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isStarred: !page.isStarred }),
      });
      fetchPages();
      if (selectedPageId === page.id) {
        setFullPage((prev) => prev ? { ...prev, isStarred: !prev.isStarred } : null);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to toggle star');
    }
  }, [fetchPages, selectedPageId]);

  // Delete
  const confirmDelete = useCallback(() => {
    if (!deletingPage) return;
    setDeleting(true);
    apiFetch(`/api/workspace/pages/${deletingPage.id}`, { method: 'DELETE' })
      .then(() => {
        toast.success('Page deleted');
        setDeleteDialogOpen(false);
        setDeletingPage(null);
        if (selectedPageId === deletingPage.id) {
          setSelectedPageId(null);
          setFullPage(null);
        }
        fetchPages();
      })
      .catch((err: any) => toast.error(err.message || 'Delete failed'))
      .finally(() => setDeleting(false));
  }, [deletingPage, fetchPages, selectedPageId]);

  // Sort: starred first, then by updatedAt desc
  const sortedItems = useMemo(() => {
    return [...rootPages.items].sort((a, b) => {
      if (a.isStarred && !b.isStarred) return -1;
      if (!a.isStarred && b.isStarred) return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [rootPages.items]);

  const sortedFolders = useMemo(() => {
    return [...rootPages.folders].sort((a, b) => {
      if (a.isStarred && !b.isStarred) return -1;
      if (!a.isStarred && b.isStarred) return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [rootPages.folders]);

  // Form for create dialog
  const { register, handleSubmit, control, reset, watch, formState: { errors } } = useForm<PageFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(createPageSchema) as any,
    defaultValues: {
      title: '', content: '', icon: 'file-text', color: '#10b981',
      parentId: '', isFolder: false, isStarred: false, lastEditedBy: '',
    },
  });

  const watchIsFolder = watch('isFolder');

  // Open create dialog
  const openCreate = useCallback(() => {
    reset({
      title: '', content: '# New Page\n\nStart writing here...', icon: 'file-text', color: '#10b981',
      parentId: '', isFolder: false, isStarred: false, lastEditedBy: '',
    });
    setCreateDialogOpen(true);
  }, [reset]);

  // Submit create
  const onSubmit = useCallback(async (values: PageFormValues) => {
    setSaving(true);
    try {
      const payload = {
        ...values,
        parentId: values.parentId || '',
      };
      const res = await apiFetch<WorkspacePage>('/api/workspace/pages', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      toast.success(values.isFolder ? 'Folder created' : 'Page created');
      setCreateDialogOpen(false);
      fetchPages();
      // Auto-select the new page
      if (!values.isFolder) {
        fetchFullPage(res.data.id);
      }
    } catch (err: any) {
      toast.error(err.message || 'Create failed');
    } finally {
      setSaving(false);
    }
  }, [fetchPages, fetchFullPage]);

  // Page icon component
  const PageIcon = ({ icon, color, className }: { icon: string; color: string; className?: string }) => {
    const IconComp = ICON_MAP[icon] || FileText;
    return <IconComp className={className} style={{ color }} />;
  };

  // Render sidebar page item
  const renderPageItem = (page: WorkspacePage, indent = 0) => (
    <button
      key={page.id}
      onClick={() => fetchFullPage(page.id)}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors text-left hover:bg-accent ${
        selectedPageId === page.id ? 'bg-accent text-accent-foreground' : 'text-foreground'
      }`}
      style={{ paddingLeft: `${12 + indent * 20}px` }}
    >
      <PageIcon icon={page.icon} color={page.color} className="size-4 shrink-0" />
      <span className="truncate flex-1">{page.title}</span>
      {page.isStarred && <Star className="size-3 text-amber-500 fill-amber-500 shrink-0" />}
      <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
        {formatRelativeTime(page.updatedAt)}
      </span>
    </button>
  );

  // Render folder group
  const renderFolder = (folder: WorkspacePage) => {
    const children = getFolderChildren(folder.id);
    const isCollapsed = collapsedFolders.has(folder.id);

    return (
      <div key={folder.id}>
        <button
          onClick={() => toggleFolder(folder.id)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors text-left hover:bg-accent text-foreground"
        >
          {isCollapsed ? (
            <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
          )}
          <PageIcon icon={folder.icon} color={folder.color} className="size-4 shrink-0" />
          <span className="truncate flex-1 font-medium">{folder.title}</span>
          {folder.isStarred && <Star className="size-3 text-amber-500 fill-amber-500 shrink-0" />}
          <span className="text-xs text-muted-foreground shrink-0">{children.length}</span>
        </button>
        {!isCollapsed && (
          <div className="mt-0.5 space-y-0.5">
            {children.map((child) => renderPageItem(child, 1))}
            {children.length === 0 && (
              <p className="text-xs text-muted-foreground pl-12 py-1">Empty folder</p>
            )}
          </div>
        )}
      </div>
    );
  };

  // Current selected page icon for header
  const currentIcon = fullPage ? (ICON_MAP[fullPage.icon] || FileText) : FileText;

  return (
    <TooltipProvider>
      <div className="flex flex-1 overflow-hidden h-full">
        {/* ─── Left Sidebar ─── */}
        <aside className="w-64 border-r bg-card flex flex-col shrink-0 hidden sm:flex">
          {/* New Page Button */}
          <div className="p-3">
            <Button
              onClick={openCreate}
              variant="outline"
              className="w-full justify-start gap-2 text-emerald-600 border-emerald-200 hover:bg-emerald-50 dark:border-emerald-800 dark:hover:bg-emerald-950/30"
            >
              <Plus className="size-4" /> New Page
            </Button>
          </div>

          {/* Search */}
          <div className="px-3 pb-2">
            <div className="relative">
              <Search className="text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5" />
              <Input
                placeholder="Search pages..."
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
          </div>

          <Separator />

          {/* Page List */}
          <ScrollArea className="flex-1 px-2 py-2">
            {loading ? (
              <div className="space-y-2 px-1">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : filteredPages.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">
                {sidebarSearch ? 'No pages match your search.' : 'No pages yet.'}
              </p>
            ) : (
              <div className="space-y-0.5">
                {/* Folders */}
                {sortedFolders.length > 0 && (
                  <div className="space-y-0.5 mb-2">
                    {sortedFolders.map(renderFolder)}
                  </div>
                )}

                {/* Divider if both exist */}
                {sortedFolders.length > 0 && sortedItems.length > 0 && (
                  <Separator className="my-2" />
                )}

                {/* Root pages */}
                {sortedItems.map((page) => renderPageItem(page))}
              </div>
            )}
          </ScrollArea>
        </aside>

        {/* ─── Right Content Area ─── */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {!selectedPageId ? (
            <EmptyState
              icon={BookMarked}
              title="Select a page or create a new one"
              description="Choose a page from the sidebar or create a new page to get started."
              action={{ label: 'New Page', onClick: openCreate }}
            />
          ) : pageLoading ? (
            <div className="flex-1 p-6 space-y-4">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-4 w-96" />
              <div className="space-y-2 mt-6">
                {Array.from({ length: 12 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </div>
            </div>
          ) : fullPage ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Page Header */}
              <div className="flex items-center gap-3 px-6 py-4 border-b shrink-0">
                <PageIcon icon={fullPage.icon} color={fullPage.color} className="size-5 shrink-0" />

                {isEditingTitle ? (
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={saveTitle}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setIsEditingTitle(false); }}
                    className="h-8 text-lg font-semibold max-w-md"
                    autoFocus
                  />
                ) : (
                  <h1
                    className="text-lg font-semibold text-foreground cursor-pointer hover:text-emerald-600 transition-colors"
                    onClick={() => { setEditTitle(fullPage.title); setIsEditingTitle(true); }}
                  >
                    {fullPage.title}
                  </h1>
                )}

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => toggleStar(fullPage)}
                    >
                      {fullPage.isStarred ? (
                        <Star className="size-4 text-amber-500 fill-amber-500" />
                      ) : (
                        <StarOff className="size-4 text-muted-foreground" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{fullPage.isStarred ? 'Unstar' : 'Star'}</TooltipContent>
                </Tooltip>

                {/* Edit / Save / More */}
                <div className="flex items-center gap-1 ml-auto">
                  {!editing ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => { setEditContent(fullPage.content); setEditing(true); }}
                    >
                      <Pencil className="size-3.5" /> Edit
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setEditing(false); setEditContent(fullPage.content); }}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="bg-emerald-600 text-white hover:bg-emerald-700 gap-1.5"
                        onClick={saveContent}
                        disabled={savingContent}
                      >
                        {savingContent && <Loader2 className="size-3.5 animate-spin" />}
                        Save
                      </Button>
                    </>
                  )}

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-8">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => { setEditTitle(fullPage.title); setIsEditingTitle(true); }}>
                        <Pencil className="size-4 mr-2" /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => { setDeletingPage(fullPage); setDeleteDialogOpen(true); }}
                      >
                        <Trash2 className="size-4 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Page Content */}
              <ScrollArea className="flex-1">
                <div className="max-w-3xl mx-auto px-6 py-8">
                  {editing ? (
                    <Textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="min-h-[400px] font-mono text-sm"
                      placeholder="Write markdown here..."
                    />
                  ) : (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      {fullPage.content ? (
                        <ReactMarkdown>{fullPage.content}</ReactMarkdown>
                      ) : (
                        <p className="text-muted-foreground italic">This page is empty. Click Edit to add content.</p>
                      )}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          ) : null}
        </main>
      </div>

      {/* ─── Create Page Dialog ─── */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Page</DialogTitle>
            <DialogDescription>Create a new page or folder in your workspace.</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label htmlFor="page-title">Title *</Label>
              <Input id="page-title" {...register('title')} placeholder="Page title" autoFocus />
              {errors.title && <p className="text-sm text-destructive">{errors.title.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Icon</Label>
                <Controller
                  control={control}
                  name="icon"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ICON_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value} className="gap-2">
                            <opt.icon className="size-4 inline mr-2" />
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              <div className="space-y-2">
                <Label>Color</Label>
                <Controller
                  control={control}
                  name="color"
                  render={({ field }) => (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {COLOR_SWATCHES.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={`w-6 h-6 rounded-full border-2 transition-all ${
                            field.value === c ? 'border-foreground scale-110' : 'border-transparent'
                          }`}
                          style={{ backgroundColor: c }}
                          onClick={() => field.onChange(c)}
                        />
                      ))}
                    </div>
                  )}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Controller
                control={control}
                name="isFolder"
                render={({ field }) => (
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                )}
              />
              <Label>Create as folder</Label>
            </div>

            {watchIsFolder && (
              <div className="space-y-2">
                <Label>Parent Folder</Label>
                <Controller
                  control={control}
                  name="parentId"
                  render={({ field }) => (
                    <Select value={field.value || '_none'} onValueChange={(v) => field.onChange(v === '_none' ? '' : v)}>
                      <SelectTrigger><SelectValue placeholder="No parent" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">No parent (root level)</SelectItem>
                        {pages
                          .filter((p) => p.isFolder)
                          .map((f) => (
                            <SelectItem key={f.id} value={f.id}>{f.title}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            )}

            {!watchIsFolder && (
              <div className="space-y-2">
                <Label htmlFor="page-content">Initial Content</Label>
                <Textarea
                  id="page-content"
                  {...register('content')}
                  rows={6}
                  className="font-mono text-sm"
                  placeholder="# Hello World\n\nWrite something..."
                />
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving} className="bg-emerald-600 text-white hover:bg-emerald-700">
                {saving && <Loader2 className="size-4 animate-spin mr-1.5" />}
                Create {watchIsFolder ? 'Folder' : 'Page'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Confirmation ─── */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Page"
        description={`Are you sure you want to delete "${deletingPage?.title}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
        isLoading={deleting}
      />
    </TooltipProvider>
  );
}