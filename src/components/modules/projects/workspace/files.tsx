'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  Upload, Link2, FileText, Loader2, MoreHorizontal, Trash2, Eye, EyeOff, Pencil,
  ExternalLink, ThumbsUp, ThumbsDown, FolderOpen, CheckCircle2, Clock,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Head } from '@/components/shared/readout/primitives';
import { formatFileSize, formatDay, relativeDay } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';
import { useAppStore } from '@/store/app-store';

import { post, patch, remove, getOne } from '../data';
import { PersonChip, Nothing } from '../ui';
import type { ProjectFile, Workspace } from '../types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Files - the project's resources, and what the client is being asked to accept
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Three things this panel could not do ─────────────────────────────────
 *
 *   1. **Add a file.** It listed them and had no upload control at all, so the
 *      only way a file reached a project was through another module. A file
 *      panel that cannot take a file is a report, not a panel.
 *
 *   2. **Put one forward as a deliverable.** `files.requires_approval` and the
 *      whole approval chain - `approval_decision`, `approved_at`,
 *      `approved_by`, `approval_note`, a notification trigger, a portal
 *      endpoint and *twenty per cent of the progress figure the client sees* -
 *      have existed since 0018, and no staff screen exposed any of it. The
 *      team could share a file with a customer and had no way to ask them to
 *      accept it.
 *
 *   3. **Point at something that is not a file.** The design is in Figma, the
 *      spec in a shared drive, the build behind a staging URL. Those were
 *      pasted into the discussion, where they scroll away. Migration 0034 made
 *      a link a `files` row with its bytes somewhere else, so it files, shares
 *      and gets approved exactly like an upload.
 *
 * ── The visibility control ───────────────────────────────────────────────
 *
 * Sharing with a client is a labelled action, never an ambiguous icon:
 * accidentally sending an internal document to a customer is not a mistake
 * that should be one click away. Marking something a deliverable is a second,
 * separate act, because a shared screenshot is not something anybody is being
 * asked to sign off - and if every shared file were a deliverable, progress
 * would fall each time somebody attached one.
 */

/** Uploads are refused above this. The storage policy has its own limit too. */
const MAX_MB = 25;

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'link';
  }
}

export function FilesPanel({
  projectId, data, onChanged,
}: {
  projectId: string;
  data: Workspace;
  onChanged: () => void;
}) {
  const { files, project } = data;
  const [busy, setBusy] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState<string[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [deliverableFor, setDeliverableFor] = React.useState<ProjectFile | null>(null);
  const [decisionFor, setDecisionFor] = React.useState<ProjectFile | null>(null);
  const [renaming, setRenaming] = React.useState<ProjectFile | null>(null);
  const [deleting, setDeleting] = React.useState<ProjectFile | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const organizationId = useAppStore(s => s.organization?.id);
  const allows = useAppStore(s => s.allows);
  const mayEdit = allows('projects', 'edit');
  const mayDelete = allows('projects', 'delete');

  const deliverables = files.filter(f => f.requiresApproval);
  const resources = files.filter(f => !f.requiresApproval);

  /**
   * Resources grouped by folder, loose ones first.
   *
   * `files.folder` is free text rather than a folder table - migration 0016's
   * reasoning was that a project's file tree is small and is renamed wholesale
   * far more often than it is restructured. It is offered on both the upload
   * and the link dialog, so it has to be *shown*: a field somebody fills in
   * and never sees again is a field that stops being filled in.
   *
   * The unfiled group has no heading, because "(no folder)" is a heading for
   * the absence of one.
   */
  const byFolder = React.useMemo(() => {
    const groups = new Map<string, ProjectFile[]>();
    for (const f of resources) {
      const key = f.folder || '';
      groups.set(key, [...(groups.get(key) ?? []), f]);
    }
    return [...groups.entries()].sort(([a], [b]) => {
      if (!a) return -1;
      if (!b) return 1;
      return a.localeCompare(b);
    });
  }, [resources]);

  /* ── Upload ─────────────────────────────────────────────────────────── */

  const upload = React.useCallback(async (list: FileList | File[]) => {
    if (!organizationId) {
      toast.error('The workspace is still loading. Try again in a moment.');
      return;
    }
    const supabase = createClient();

    for (const file of Array.from(list)) {
      if (file.size > MAX_MB * 1024 * 1024) {
        toast.error(`"${file.name}" is larger than ${MAX_MB}MB.`);
        continue;
      }
      setUploading(prev => [...prev, file.name]);

      /**
       * The path must begin with the organisation id.
       *
       * That is the whole storage security model - every policy checks the
       * first segment against the caller's memberships - and the metadata
       * endpoint refuses a path that does not match, so getting this wrong
       * fails loudly rather than storing something unreachable.
       */
      const path = `${organizationId}/projects/${projectId}/${Date.now()}-${safeName(file.name)}`;

      try {
        const { error: storageError } = await supabase
          .storage.from('documents')
          .upload(path, file, { contentType: file.type || undefined, upsert: false });
        if (storageError) throw new Error(storageError.message);

        await post('/api/projects/files', {
          projectId,
          bucket: 'documents',
          path,
          filename: file.name,
          mimeType: file.type || null,
          sizeBytes: file.size,
        });
      } catch (e) {
        toast.error(`${file.name}: ${e instanceof Error ? e.message : 'upload failed'}`);
      } finally {
        setUploading(prev => prev.filter(n => n !== file.name));
      }
    }

    onChanged();
  }, [organizationId, projectId, onChanged]);

  /* ── Actions ────────────────────────────────────────────────────────── */

  const open = React.useCallback(async (f: ProjectFile) => {
    // A link needs no round trip: the address is already on the row. Only a
    // stored object has to be signed, and that link lasts ten minutes.
    if (f.externalUrl) {
      window.open(f.externalUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      const res = await getOne<{ url: string | null }>(`/api/projects/files/${f.id}`);
      if (res?.url) window.open(res.url, '_blank', 'noopener');
      else throw new Error('No link was returned for that file.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not open that file');
    }
  }, []);

  const setVisibility = React.useCallback(async (f: ProjectFile, visible: boolean) => {
    setBusy(f.id);
    try {
      await patch(`/api/projects/files/${f.id}`, { isClientVisible: visible });
      toast.success(visible ? 'Shared with the client' : 'Withdrawn from the client portal');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not change visibility');
    } finally {
      setBusy(null);
    }
  }, [onChanged]);

  const withdrawDeliverable = React.useCallback(async (f: ProjectFile) => {
    setBusy(f.id);
    try {
      await patch(`/api/projects/files/${f.id}`, { requiresApproval: false });
      toast.success('No longer a deliverable. Any decision on it was cleared.');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not withdraw it');
    } finally {
      setBusy(null);
    }
  }, [onChanged]);

  const confirmDelete = React.useCallback(async () => {
    if (!deleting) return;
    try {
      await remove(`/api/projects/files/${deleting.id}`);
      setDeleting(null);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  }, [deleting, onChanged]);

  const row = (f: ProjectFile) => (
    <li key={f.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3">
      {f.externalUrl
        ? <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        : <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}

      <div className="min-w-0">
        <button
          type="button"
          onClick={() => open(f)}
          className="block max-w-full truncate text-left text-[13px] font-medium text-foreground underline-offset-2 hover:underline"
        >
          {f.filename}
        </button>
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted-foreground">
          <span className="truncate">
            {f.externalUrl ? hostOf(f.externalUrl) : formatFileSize(f.sizeBytes)}
          </span>
          <span aria-hidden="true" className="size-[3px] rounded-full bg-border" />
          <span>{formatDay(f.createdAt, { day: 'numeric', month: 'short' })}</span>
          {f.uploader?.profiles?.fullName && (
            <>
              <span aria-hidden="true" className="size-[3px] rounded-full bg-border" />
              <PersonChip person={f.uploader} size="xs" muted />
            </>
          )}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {/*
          The two states worth calling out, and only those two.

          "Client can see" is the fact somebody needs before they share a link
          in a meeting. "Confidential" is the fact that stops them. Everything
          else about a file is in the row already.
        */}
        {f.isConfidential && (
          <span className="hidden whitespace-nowrap text-[11.5px] font-medium text-muted-foreground sm:inline">
            Confidential
          </span>
        )}
        {f.isClientVisible && !f.requiresApproval && (
          <span className="hidden items-center gap-1 whitespace-nowrap text-[11.5px] text-muted-foreground sm:inline-flex">
            <Eye className="size-3" aria-hidden="true" /> Client can see
          </span>
        )}
        {f.requiresApproval && <DecisionTag file={f} />}

        {mayEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${f.filename}`}>
                {busy === f.id ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onClick={() => open(f)}>
                <ExternalLink className="mr-2 size-4" /> Open
              </DropdownMenuItem>
              {/*
                Renaming and refiling.

                `PATCH /api/projects/files/[id]` has accepted `filename` and
                `folder` since it was written, with a careful note explaining
                that the stored object is never touched - and no control ever
                called either. An upload arrives named whatever it was called
                on somebody's disk, into no folder at all.
              */}
              <DropdownMenuItem onClick={() => setRenaming(f)}>
                <Pencil className="mr-2 size-4" /> Rename or refile
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              {f.isClientVisible ? (
                <DropdownMenuItem onClick={() => setVisibility(f, false)}>
                  <EyeOff className="mr-2 size-4" /> Withdraw from the client
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => setVisibility(f, true)}>
                  <Eye className="mr-2 size-4" /> Share with the client
                </DropdownMenuItem>
              )}

              {f.requiresApproval ? (
                <>
                  <DropdownMenuItem onClick={() => setDecisionFor(f)}>
                    <ThumbsUp className="mr-2 size-4" /> Record their decision
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => withdrawDeliverable(f)}>
                    <Clock className="mr-2 size-4" /> No longer a deliverable
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem onClick={() => setDeliverableFor(f)}>
                  <CheckCircle2 className="mr-2 size-4" /> Put forward for approval
                </DropdownMenuItem>
              )}

              {mayDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeleting(f)}
                  >
                    <Trash2 className="mr-2 size-4" /> Remove
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  );

  return (
    <div className="flex flex-col gap-6">
      {/* ── Deliverables ───────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Head
          title="Deliverables"
          count={deliverables.length}
          note={project.client
            ? `Put forward to ${project.client.name} for acceptance`
            : 'Link a client to this project before asking for acceptance'}
        />
        <div className="rounded-xl border border-border bg-card shadow-e1">
          {deliverables.length === 0 ? (
            <Nothing
              className="px-4"
              title="Nothing has been put forward"
              note="Share a file or a link with the client, then mark it a deliverable to ask them to accept it. Acceptance is a fifth of this project's reported progress."
            />
          ) : (
            <ul className="divide-y divide-border/70">{deliverables.map(row)}</ul>
          )}
        </div>
      </section>

      {/* ── Everything else ────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Head
          title="Resources"
          count={resources.length}
          note="Files and links for this project"
        />

        {mayEdit && (
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => {
              e.preventDefault();
              setDragging(false);
              if (e.dataTransfer.files?.length) upload(e.dataTransfer.files);
            }}
            className={cn(
              'flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-4 transition-colors',
              dragging ? 'border-foreground/40 bg-accent/50' : 'border-border bg-card/40',
            )}
          >
            <p className="text-[12.5px] text-muted-foreground">
              Drop files here, or add a link to something that lives elsewhere.
            </p>
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="file"
                multiple
                className="sr-only"
                onChange={e => {
                  if (e.target.files?.length) upload(e.target.files);
                  e.target.value = '';
                }}
              />
              <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => inputRef.current?.click()}>
                <Upload className="size-3.5" /> Upload
              </Button>
              <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setLinkOpen(true)}>
                <Link2 className="size-3.5" /> Add link
              </Button>
            </div>
          </div>
        )}

        {uploading.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {uploading.map(name => (
              <li key={name} className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Uploading {name}
              </li>
            ))}
          </ul>
        )}

        {resources.length === 0 ? (
          <div className="rounded-xl border border-border bg-card shadow-e1">
            <Nothing
              className="px-4"
              title="No resources yet"
              note="Anything the team needs to find later belongs here rather than in the discussion, where it scrolls away."
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {byFolder.map(([folder, group]) => (
              <div key={folder || '_loose'} className="flex flex-col gap-2">
                {folder && (
                  <h4 className="flex items-center gap-1.5 px-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    <FolderOpen className="size-3.5" aria-hidden="true" />
                    {folder}
                    <span className="tabular-nums text-muted-foreground/60">{group.length}</span>
                  </h4>
                )}
                <div className="rounded-xl border border-border bg-card shadow-e1">
                  <ul className="divide-y divide-border/70">{group.map(row)}</ul>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <LinkDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        projectId={projectId}
        onSaved={onChanged}
      />

      <DeliverableDialog
        file={deliverableFor}
        onClose={() => setDeliverableFor(null)}
        onSaved={onChanged}
        hasClient={!!project.client}
      />

      <DecisionDialog
        file={decisionFor}
        onClose={() => setDecisionFor(null)}
        onSaved={onChanged}
      />

      <RenameDialog
        file={renaming}
        onClose={() => setRenaming(null)}
        onSaved={onChanged}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={o => { if (!o) setDeleting(null); }}
        title="Remove this from the project"
        description={`"${deleting?.filename}" leaves the project and is withdrawn from the client portal. ${deleting?.externalUrl ? 'The page it points at is untouched.' : 'The stored file itself is kept.'}`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </div>
  );
}

/** Where a deliverable has got to, in one phrase. */
function DecisionTag({ file }: { file: ProjectFile }) {
  if (file.approvalDecision === 'approved') {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px] font-medium text-muted-foreground">
        <ThumbsUp className="size-3" aria-hidden="true" />
        Accepted{file.approvedAt ? ` ${relativeDay(file.approvedAt)}` : ''}
      </span>
    );
  }
  if (file.approvalDecision === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px] font-medium text-destructive">
        <ThumbsDown className="size-3" aria-hidden="true" /> Changes asked
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px] font-medium text-warning">
      <Clock className="size-3" aria-hidden="true" /> With the client
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Renaming and refiling                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The display name and the folder. Never the stored object.
 *
 * `bucket` and `path` are immutable on this endpoint, because changing them
 * would leave the row pointing at bytes that are not the ones it describes.
 * Renaming changes the name people read, which is what everybody means by
 * renaming a file in a project.
 */
function RenameDialog({
  file, onClose, onSaved,
}: {
  file: ProjectFile | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState('');
  const [folder, setFolder] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!file) return;
    setName(file.filename);
    setFolder(file.folder ?? '');
  }, [file]);

  const save = React.useCallback(async () => {
    if (!file || !name.trim()) return;
    setSaving(true);
    try {
      await patch(`/api/projects/files/${file.id}`, { filename: name.trim(), folder: folder.trim() });
      toast.success('Saved');
      onClose();
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save that');
    } finally {
      setSaving(false);
    }
  }, [file, name, folder, onClose, onSaved]);

  return (
    <Dialog open={!!file} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rename or refile</DialogTitle>
          <DialogDescription>
            {file?.externalUrl
              ? 'The address this points at is unchanged.'
              : 'The stored file itself is unchanged. Only the name people read here.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="file-name" className="text-[12.5px] font-medium">Name</Label>
            <Input id="file-name" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="file-folder" className="text-[12.5px] font-medium">Folder</Label>
            <div className="relative">
              <FolderOpen className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="file-folder" className="pl-8"
                value={folder}
                onChange={e => setFolder(e.target.value)}
                placeholder="Leave blank to keep it unfiled"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Adding a link                                                             */
/* -------------------------------------------------------------------------- */

function LinkDialog({
  open, onOpenChange, projectId, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onSaved: () => void;
}) {
  const [url, setUrl] = React.useState('');
  const [name, setName] = React.useState('');
  const [folder, setFolder] = React.useState('');
  const [shared, setShared] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) { setUrl(''); setName(''); setFolder(''); setShared(false); }
  }, [open]);

  const save = React.useCallback(async () => {
    if (!url.trim()) return;
    setSaving(true);
    try {
      await post('/api/projects/files', {
        projectId,
        externalUrl: url.trim(),
        // Blank is fine: the endpoint falls back to the host, which is a
        // better default than an empty row and better than making somebody
        // name a Figma file twice.
        filename: name.trim(),
        folder: folder.trim(),
        isClientVisible: shared,
      });
      toast.success('Link added');
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add that link');
    } finally {
      setSaving(false);
    }
  }, [url, name, folder, shared, projectId, onOpenChange, onSaved]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a link</DialogTitle>
          <DialogDescription>
            For a resource that lives somewhere else: a design file, a shared
            drive folder, a staging build. NextMav stores the address, not the
            document.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="link-url" className="text-[12.5px] font-medium">Address</Label>
            <Input
              id="link-url" autoFocus
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="figma.com/file/…"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="link-name" className="text-[12.5px] font-medium">Name</Label>
            <Input
              id="link-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={url ? hostOf(url.startsWith('http') ? url : `https://${url}`) : 'Optional'}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="link-folder" className="text-[12.5px] font-medium">Folder</Label>
            <div className="relative">
              <FolderOpen className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="link-folder" className="pl-8"
                value={folder}
                onChange={e => setFolder(e.target.value)}
                placeholder="Optional, for example: designs"
              />
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-2.5">
            <Checkbox checked={shared} onCheckedChange={v => setShared(v === true)} className="mt-0.5" />
            <span className="text-[12.5px] text-foreground">
              Show this to the client
              <span className="mt-0.5 block text-[12px] text-muted-foreground">
                It appears in their portal straight away.
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !url.trim()}>
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Add link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Putting something forward                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A deliverable has to be something the client can actually see.
 *
 * The endpoint refuses `requires_approval` on a file that is not shared, and
 * says why - "this is a deliverable, awaiting their approval" against a file
 * they cannot open is a project waiting for a decision nobody was ever asked
 * to make. Rather than let somebody hit that error, this dialog offers to do
 * both in one act and says so.
 */
function DeliverableDialog({
  file, onClose, onSaved, hasClient,
}: {
  file: ProjectFile | null;
  onClose: () => void;
  onSaved: () => void;
  hasClient: boolean;
}) {
  const [saving, setSaving] = React.useState(false);

  const submit = React.useCallback(async () => {
    if (!file) return;
    setSaving(true);
    try {
      await patch(`/api/projects/files/${file.id}`, {
        isClientVisible: true,
        requiresApproval: true,
      });
      toast.success('Put forward. The client can accept it from their portal.');
      onClose();
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not put it forward');
    } finally {
      setSaving(false);
    }
  }, [file, onClose, onSaved]);

  return (
    <Dialog open={!!file} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Put forward for approval</DialogTitle>
          <DialogDescription>
            {file?.filename} becomes a deliverable the client is asked to accept.
          </DialogDescription>
        </DialogHeader>

        <ul className="flex flex-col gap-2 text-[12.5px] text-muted-foreground">
          <li>It is shared with the client, if it is not already.</li>
          <li>They can accept it or ask for changes, and the team is told either way.</li>
          <li>Acceptance counts towards this project&apos;s reported progress.</li>
          {file?.isConfidential && (
            <li className="font-medium text-destructive">
              This file is marked confidential and cannot be shared. Clear that first.
            </li>
          )}
          {!hasClient && (
            <li className="font-medium text-warning">
              This project has no client linked, so nobody can see it in a portal yet.
            </li>
          )}
        </ul>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || file?.isConfidential}>
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Put forward
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Recording a decision                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A decision that arrived by phone.
 *
 * `PATCH /api/portal/deliverables/[id]` accepts staff as well as clients,
 * deliberately: acceptance often happens in a meeting and somebody has to
 * write it down, and the alternative is a spreadsheet. It is recorded as
 * *their* decision - `approved_by` is the caller either way - so the trail
 * says who entered it rather than implying the client clicked it themselves.
 */
function DecisionDialog({
  file, onClose, onSaved,
}: {
  file: ProjectFile | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [decision, setDecision] = React.useState<'approved' | 'rejected'>('approved');
  const [note, setNote] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (file) { setDecision('approved'); setNote(''); }
  }, [file]);

  const submit = React.useCallback(async () => {
    if (!file) return;
    setSaving(true);
    try {
      await patch(`/api/portal/deliverables/${file.id}`, { decision, note: note.trim() });
      toast.success(decision === 'approved' ? 'Recorded as accepted' : 'Recorded as changes requested');
      onClose();
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record that');
    } finally {
      setSaving(false);
    }
  }, [file, decision, note, onClose, onSaved]);

  return (
    <Dialog open={!!file} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record the client&apos;s decision</DialogTitle>
          <DialogDescription>
            For a decision that arrived by phone or in a meeting. It is filed
            under your name, so the trail says who wrote it down.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            {([
              ['approved', 'Accepted', ThumbsUp],
              ['rejected', 'Changes asked', ThumbsDown],
            ] as const).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => setDecision(value)}
                aria-pressed={decision === value}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-[13px] font-medium transition-colors',
                  decision === value
                    ? 'border-foreground/30 bg-accent text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-3.5" /> {label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="decision-note" className="text-[12.5px] font-medium">
              What they said{decision === 'rejected' && ' (required)'}
            </Label>
            <Textarea
              id="decision-note" rows={3}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={decision === 'rejected'
                ? 'What has to change before they will accept it.'
                : 'Optional.'}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={saving || (decision === 'rejected' && !note.trim())}
          >
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Record it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
