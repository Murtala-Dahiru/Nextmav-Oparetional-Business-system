'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  Home as HomeIcon, Library as LibraryIcon, LayoutTemplate, FileText,
  FileSpreadsheet, Folder, Loader2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useModuleRealtime } from '@/hooks/use-realtime';
import { useFocusRequest } from '@/hooks/use-focus-request';

import { Home } from './home';
import { Library } from './library';
import { Templates } from './templates';
import { PageView } from './page';
import { ICON_OPTIONS, COLOUR_SWATCHES } from './ui';
import { getList, post } from './data';
import type {
  WorkspaceNode, DirectoryMember, Department, Section, TrashedPage,
} from './types';

/**
 * ===========================================================================
 *  Workspace
 * ===========================================================================
 *
 *  -- The shape of the module ----------------------------------------------
 *
 *  Three sections and one page view.
 *
 *    Home       the way in: what you were writing, what is pinned, the areas
 *    Library    the tree, and everything in it
 *    Templates  a starting point that knows the questions
 *
 *  Opening a page replaces the section entirely. A document is not a panel
 *  inside a browser: when somebody is reading a policy, the policy is the
 *  screen, and the navigation they need is the way back.
 *
 *  -- What this replaces ---------------------------------------------------
 *
 *  A single 1,300-line file that opened on the words "Nothing open" beside a
 *  fixed 288px sidebar, hidden entirely below `sm` - so on a phone the module
 *  had no navigation at all and no way to reach any page. The document was a
 *  monospaced textarea behind an Edit button, the spreadsheet was a table of
 *  inputs, and the only route to a page's content was knowing which folder it
 *  was in.
 *
 *  -- Why sections are local state -----------------------------------------
 *
 *  Every module in this product holds its own sub-navigation in `useState`,
 *  and lifting only this one into the sidebar would make it the only one that
 *  behaves differently. The design system's carried-forward list names it:
 *  sub-items are lifted for all thirteen modules at once, or not at all.
 */

const SECTIONS: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: 'home', label: 'Home', icon: HomeIcon },
  { id: 'library', label: 'Library', icon: LibraryIcon },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
];

export default function WorkspaceModule() {
  const [section, setSection] = React.useState<Section>('home');
  const [openPageId, setOpenPageId] = React.useState<string | null>(null);
  const [openFolderId, setOpenFolderId] = React.useState<string | null>(null);

  const [nodes, setNodes] = React.useState<WorkspaceNode[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [trashCount, setTrashCount] = React.useState(0);

  const [members, setMembers] = React.useState<DirectoryMember[]>([]);
  const [departments, setDepartments] = React.useState<Department[]>([]);

  const [creating, setCreating] = React.useState<{ parentId: string | null; what?: 'document' | 'sheet' | 'folder' } | null>(null);

  /**
   * Bumped whenever the tree changes.
   *
   * Home and Templates each read their own endpoint, and passing this down is
   * how they know to refetch after a create, a rename or a delete somewhere
   * else in the module. Cheaper and clearer than lifting their responses up
   * here, which would make this component the owner of three shapes it never
   * reads.
   */
  const [revision, setRevision] = React.useState(0);

  /* -- Data -------------------------------------------------------------- */

  const loadTree = React.useCallback(async () => {
    try {
      setNodes(await getList<WorkspaceNode>('/api/workspace/pages?pageSize=500'));
    } catch (err: any) {
      toast.error(err.message || 'Could not load the workspace');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTrash = React.useCallback(async () => {
    try {
      setTrashCount((await getList<TrashedPage>('/api/workspace/trash')).length);
    } catch {
      setTrashCount(0);
    }
  }, []);

  React.useEffect(() => { void loadTree(); void loadTrash(); }, [loadTree, loadTrash]);

  const refresh = React.useCallback(() => {
    void loadTree();
    void loadTrash();
    setRevision(n => n + 1);
  }, [loadTree, loadTrash]);

  /**
   * The people and departments every dialog in the module needs.
   *
   * Loaded once here rather than per dialog: the share dialog, the person-typed
   * sheet column and the mention picker all want the same two small, stable
   * lists, and three components asking separately is three requests for one
   * answer. Departments come from the admin settings endpoint, which only
   * administrators may call, so it is allowed to fail quietly and the
   * department controls then simply offer nothing.
   */
  React.useEffect(() => {
    getList<DirectoryMember>('/api/directory')
      .then(setMembers)
      .catch(() => setMembers([]));

    fetch('/api/admin/settings')
      .then(r => r.json())
      .then(j => setDepartments(j?.data?.departments ?? []))
      .catch(() => setDepartments([]));
  }, []);

  /**
   * A colleague creating, renaming, moving or deleting a page moves this tree.
   *
   * `files` is watched too: a folder's file count is on every row, and an
   * upload is the change most likely to be happening while somebody else is
   * looking at the library.
   */
  useModuleRealtime('workspace', ['workspace_pages', 'files'], () => {
    void loadTree();
    setRevision(n => n + 1);
  });

  /**
   * Open a page the command palette or another module found.
   *
   * `/api/search` matches page *content* and now workspace *files* as well,
   * and a file result carries the id of the folder it sits in, so both land
   * here as a page to open.
   */
  useFocusRequest('workspace', ({ type, id }) => {
    if (type === 'page') {
      setOpenPageId(id);
      setSection('library');
    }
  });

  /* -- Creating ---------------------------------------------------------- */

  const create = React.useCallback(async (values: {
    title: string; summary: string; kind: 'document' | 'sheet'; isFolder: boolean;
    icon: string; colour: string; parentId: string | null;
  }) => {
    try {
      const node = await post<WorkspaceNode>('/api/workspace/pages', values);
      setCreating(null);
      refresh();
      setOpenPageId(node.id);
      if (node.isFolder) { setOpenPageId(null); setOpenFolderId(node.id); setSection('library'); }
      toast.success(values.isFolder ? 'Folder created' : 'Created');
    } catch (err: any) {
      toast.error(err.message || 'Could not create that');
    }
  }, [refresh]);

  const writableFolders = React.useMemo(
    () => nodes.filter(n => n.isFolder && n.permission !== 'view'),
    [nodes],
  );

  /* -- Render ------------------------------------------------------------ */

  const openPage = React.useCallback((id: string) => setOpenPageId(id), []);

  const openFolder = React.useCallback((id: string | null) => {
    setOpenPageId(null);
    setOpenFolderId(id);
    setSection('library');
  }, []);

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        {/*
          The section bar.

          Hidden while a page is open: that screen has its own panel navigation
          and its own way back, and two rows of tabs stacked on top of each
          other is the reader having to work out which one they are in.
        */}
        {!openPageId && (
          <div className="shrink-0 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="flex items-center gap-3 px-4 md:px-8">
              <nav
                aria-label="Workspace sections"
                className="-mb-px flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {SECTIONS.map(item => {
                  const on = item.id === section;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSection(item.id)}
                      aria-current={on ? 'page' : undefined}
                      className={cn(
                        'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 py-3 text-[13px] font-medium transition-colors',
                        on ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <Icon className={cn('size-3.5', on ? 'opacity-100' : 'opacity-70')} />
                      {item.label}
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
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {openPageId ? (
            <PageView
              key={openPageId}
              pageId={openPageId}
              nodes={nodes}
              members={members}
              departments={departments}
              onBack={() => { setOpenPageId(null); setSection('library'); }}
              onOpen={(id) => {
                const node = nodes.find(n => n.id === id);
                if (node?.isFolder) openFolder(id);
                else setOpenPageId(id);
              }}
              onTreeChanged={refresh}
              onDeleted={() => { setOpenPageId(null); setSection('library'); }}
            />
          ) : section === 'home' ? (
            <Home
              reloadKey={revision}
              onOpenPage={openPage}
              onOpenFolder={openFolder}
              onBrowse={() => setSection('library')}
              onTemplates={() => setSection('templates')}
              onNew={(what) => {
                if (what === 'upload') {
                  /*
                    An upload has to land somewhere.

                    A file belongs in a folder - the endpoint requires it, and
                    the folder is what carries the sharing rule - so "Upload a
                    file" opens the library rather than a file picker with
                    nowhere to put the result.
                  */
                  toast.info('Choose a folder to upload into.');
                  setSection('library');
                  return;
                }
                setCreating({ parentId: openFolderId, what });
              }}
            />
          ) : section === 'library' ? (
            <Library
              nodes={nodes}
              loading={loading}
              openFolderId={openFolderId}
              onOpenFolder={openFolder}
              onOpenPage={openPage}
              onCreate={(parentId) => setCreating({ parentId })}
              onReload={refresh}
              trashCount={trashCount}
            />
          ) : (
            <Templates
              reloadKey={revision}
              folders={writableFolders}
              onOpenPage={openPage}
              onCreated={(node) => { refresh(); setOpenPageId(node.id); }}
            />
          )}
        </div>
      </div>

      <CreateDialog
        key={creating ? `create-${creating.parentId ?? 'root'}-${creating.what ?? 'any'}` : 'create-closed'}
        state={creating}
        folders={writableFolders}
        onClose={() => setCreating(null)}
        onSubmit={create}
      />
    </TooltipProvider>
  );
}

/* -------------------------------------------------------------------------- */
/*  Create                                                                    */
/* -------------------------------------------------------------------------- */

function CreateDialog({
  state, folders, onClose, onSubmit,
}: {
  state: { parentId: string | null; what?: 'document' | 'sheet' | 'folder' } | null;
  folders: WorkspaceNode[];
  onClose: () => void;
  onSubmit: (values: {
    title: string; summary: string; kind: 'document' | 'sheet'; isFolder: boolean;
    icon: string; colour: string; parentId: string | null;
  }) => void;
}) {
  const [what, setWhat] = React.useState<'document' | 'sheet' | 'folder'>(state?.what ?? 'document');
  const [title, setTitle] = React.useState('');
  const [summary, setSummary] = React.useState('');
  /**
   * `null` means "follow the kind".
   *
   * The icon tracks what is being created - picking Folder and being left with
   * a document icon is the small wrongness that makes a tree hard to scan -
   * but an explicit choice has to survive changing the kind afterwards.
   * Derived during render rather than synced in an effect, which would cascade
   * a second render on every keystroke in the name field.
   */
  const [chosenIcon, setChosenIcon] = React.useState<string | null>(null);
  const icon = chosenIcon ?? (what === 'folder' ? 'folder' : what === 'sheet' ? 'table' : 'file-text');
  const [colour, setColour] = React.useState(COLOUR_SWATCHES[0]);
  const [parentId, setParentId] = React.useState(state?.parentId ?? '_root');
  const [saving, setSaving] = React.useState(false);

  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create</DialogTitle>
          <DialogDescription>
            A folder holds pages and files. A document is written and read; a spreadsheet is a
            grid with columns you define.
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
                aria-pressed={what === value}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-md border p-3 text-[12px] transition-colors',
                  what === value
                    ? 'border-foreground bg-accent text-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
              >
                <Icon className="size-5" />
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-title">Name</Label>
            <Input
              id="new-title" value={title} autoFocus
              onChange={(e) => setTitle(e.target.value)}
              placeholder={what === 'folder' ? 'e.g. HR policies' : what === 'sheet' ? 'e.g. 2026 budget' : 'e.g. Leave policy'}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-summary">What it is for</Label>
            <Input
              id="new-summary" value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Optional. One line, shown under the title and in search."
            />
          </div>

          <div className="space-y-1.5">
            <Label>Inside</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="_root">Top level</SelectItem>
                {folders.map(folder => (
                  <SelectItem key={folder.id} value={folder.id}>{folder.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Icon</Label>
              <Select value={icon} onValueChange={setChosenIcon}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ICON_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      <span className="flex items-center gap-2">
                        <option.icon className="size-3.5" /> {option.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Colour</Label>
              <div className="flex flex-wrap gap-1.5 pt-1.5">
                {COLOUR_SWATCHES.map(swatch => (
                  <button
                    key={swatch}
                    type="button"
                    aria-label={`Colour ${swatch}`}
                    aria-pressed={colour === swatch}
                    onClick={() => setColour(swatch)}
                    className={cn(
                      'size-5 rounded-full ring-offset-2 ring-offset-background transition-all',
                      colour === swatch ? 'ring-2 ring-foreground' : 'ring-0',
                    )}
                    style={{ backgroundColor: swatch }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!title.trim() || saving}
            onClick={() => {
              setSaving(true);
              onSubmit({
                title: title.trim(),
                summary: summary.trim(),
                kind: what === 'sheet' ? 'sheet' : 'document',
                isFolder: what === 'folder',
                icon,
                colour,
                parentId: parentId === '_root' ? null : parentId,
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
