'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  UploadCloud, Download, Eye, Trash2, Pencil, Loader2, Link2, ExternalLink,
  FolderInput, Plus,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
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
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { createClient } from '@/lib/supabase/client';
import { formatFileSize, formatRelativeTime } from '@/lib/format';
import { hostOf } from '@/lib/links';
import { cn } from '@/lib/utils';

import { IconTile, fileIcon, Nothing } from './ui';
import { getList, getOne, patch, post, remove } from './data';
import type { WorkspaceFile, WorkspaceNode } from './types';

/**
 * ===========================================================================
 *  Files and resources
 * ===========================================================================
 *
 *  Bytes go from the browser straight to Supabase Storage, which is the same
 *  path the projects module uses, and a metadata row is recorded through
 *  `/api/workspace/files`. Uploading through the Next route instead would mean
 *  a 50MB file crossing the server twice and sitting in its memory in between,
 *  for no benefit: the storage policies already confine a member to their own
 *  organisation's path prefix.
 *
 *  -- The link, and what it is not ----------------------------------------
 *
 *  Not everything a team needs is bytes in a bucket. The brand assets are in
 *  Figma, the signed contract is in Drive, the staging build is behind a URL.
 *  Those are now rows here too: a link and an upload sit in the same list,
 *  under the same folder, following the same sharing rule.
 *
 *  NextMav is deliberately not recreating Drive or Figma. It is the one place
 *  somebody looks to find out where a thing is.
 */

const MAX_MB = 50;

/** Storage rejects some characters outright; others just make paths unreadable. */
function safeName(name: string) {
  return name.replace(/[^\w.\-]+/g, '_').slice(0, 120);
}

const PREVIEWABLE = /^(image\/|application\/pdf|text\/)/;

interface FilesProps {
  pageId: string;
  organizationId: string;
  files: WorkspaceFile[];
  canEdit: boolean;
  /** Folders this person may file something into, for the move control. */
  folders: WorkspaceNode[];
  onChanged: (files: WorkspaceFile[]) => void;
}

export function FilePanel({
  pageId, organizationId, files, canEdit, folders, onChanged,
}: FilesProps) {
  const [dragging, setDragging] = React.useState(false);
  const [uploads, setUploads] = React.useState<Record<string, number>>({});
  const [linking, setLinking] = React.useState(false);
  const [editingFile, setEditingFile] = React.useState<WorkspaceFile | null>(null);
  const [moving, setMoving] = React.useState<WorkspaceFile | null>(null);
  const [deleting, setDeleting] = React.useState<WorkspaceFile | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [preview, setPreview] = React.useState<{ file: WorkspaceFile; url: string } | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const reload = React.useCallback(async () => {
    try {
      onChanged(await getList<WorkspaceFile>(`/api/workspace/files?pageId=${pageId}`));
    } catch { /* the list simply stays as it was */ }
  }, [pageId, onChanged]);

  /* -- Upload ------------------------------------------------------------ */

  const upload = React.useCallback(async (list: FileList | File[]) => {
    const supabase = createClient();

    for (const file of Array.from(list)) {
      if (file.size > MAX_MB * 1024 * 1024) {
        toast.error(`"${file.name}" is larger than ${MAX_MB}MB.`);
        continue;
      }

      const key = `${file.name}-${file.size}`;
      setUploads(prev => ({ ...prev, [key]: 5 }));

      /**
       * The path must begin with the organisation id.
       *
       * That is the whole storage security model - every policy checks the
       * first segment against the caller's memberships - and the metadata
       * endpoint refuses a path that does not match, so getting this wrong
       * fails loudly rather than storing something unreachable.
       */
      const path = `${organizationId}/workspace/${pageId}/${Date.now()}-${safeName(file.name)}`;

      try {
        setUploads(prev => ({ ...prev, [key]: 35 }));
        const { error: storageError } = await supabase
          .storage.from('documents')
          .upload(path, file, { contentType: file.type || undefined, upsert: false });
        if (storageError) throw new Error(storageError.message);

        setUploads(prev => ({ ...prev, [key]: 75 }));
        await post('/api/workspace/files', {
          pageId,
          bucket: 'documents',
          path,
          filename: file.name,
          mimeType: file.type || null,
          sizeBytes: file.size,
        });

        setUploads(prev => ({ ...prev, [key]: 100 }));
      } catch (err: any) {
        toast.error(`${file.name}: ${err.message || 'upload failed'}`);
      } finally {
        setUploads(prev => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    }

    await reload();
  }, [organizationId, pageId, reload]);

  /* -- Reading ----------------------------------------------------------- */

  const open = React.useCallback(async (file: WorkspaceFile, mode: 'download' | 'preview') => {
    // A link needs no round trip: its address is already on the row.
    if (file.externalUrl) {
      window.open(file.externalUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      const data = await getOne<{ url: string | null }>(`/api/workspace/files/${file.id}`);
      const url = data?.url ?? null;
      if (!url) throw new Error('No link was returned for that file.');

      if (mode === 'preview') { setPreview({ file, url }); return; }

      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.filename;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (err: any) {
      toast.error(err.message || 'Could not open that file');
    }
  }, []);

  /* -- Render ------------------------------------------------------------ */

  const uploading = Object.entries(uploads);

  return (
    <div className="space-y-3">
      {canEdit && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
          }}
          className={cn(
            'flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2.5 transition-colors',
            dragging ? 'border-[--ring] bg-[--ring]/5' : 'border-border',
          )}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = ''; }}
          />
          <UploadCloud className="size-4 shrink-0 text-muted-foreground" />
          <p className="min-w-0 flex-1 text-[12.5px] text-muted-foreground">
            {dragging ? 'Drop to upload' : `Drop files here, up to ${MAX_MB}MB each`}
          </p>
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[12.5px]"
            onClick={() => inputRef.current?.click()}>
            <Plus className="size-3.5" /> Upload
          </Button>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-[12.5px]"
            onClick={() => setLinking(true)}>
            <Link2 className="size-3.5" /> Add a link
          </Button>
        </div>
      )}

      {uploading.length > 0 && (
        <ul className="space-y-1.5">
          {uploading.map(([key, value]) => (
            <li key={key} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
                {key.split('-').slice(0, -1).join('-')}
              </span>
              <Progress value={value} className="h-1 w-28" />
            </li>
          ))}
        </ul>
      )}

      {files.length === 0 ? (
        <Nothing>
          {canEdit
            ? 'Nothing filed here yet. Upload a file, or point at one that lives somewhere else.'
            : 'Nothing filed here yet.'}
        </Nothing>
      ) : (
        <ul>
          {files.map(file => {
            const isLink = !!file.externalUrl;
            const Icon = fileIcon(file.filename, isLink);
            const canPreview = !isLink && PREVIEWABLE.test(file.mimeType ?? '');

            return (
              <li
                key={file.id}
                className="group flex items-center gap-3 border-b border-border/60 py-2.5 last:border-b-0"
              >
                <IconTile icon={Icon} colour={isLink ? '#2c6fa7' : null} />

                <button
                  type="button"
                  onClick={() => open(file, canPreview ? 'preview' : 'download')}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-[13.5px] font-medium leading-tight">
                    {file.filename}
                  </span>
                  <span className="mt-0.5 block truncate text-[11.5px] leading-tight text-muted-foreground">
                    {isLink ? hostOf(file.externalUrl!) : formatFileSize(file.sizeBytes)}
                    {file.uploadedByName ? ` · ${file.uploadedByName}` : ''}
                    {' · '}{formatRelativeTime(file.createdAt)}
                    {file.description ? ` · ${file.description}` : ''}
                  </span>
                </button>

                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  {isLink ? (
                    <Button variant="ghost" size="icon" className="size-7" title="Open"
                      onClick={() => open(file, 'preview')}>
                      <ExternalLink className="size-3.5" />
                    </Button>
                  ) : (
                    <>
                      {canPreview && (
                        <Button variant="ghost" size="icon" className="size-7" title="Preview"
                          onClick={() => open(file, 'preview')}>
                          <Eye className="size-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="size-7" title="Download"
                        onClick={() => open(file, 'download')}>
                        <Download className="size-3.5" />
                      </Button>
                    </>
                  )}

                  {canEdit && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7" aria-label={`${file.filename} options`}>
                          <Pencil className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => setEditingFile(file)}>
                          <Pencil className="mr-2 size-3.5" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setMoving(file)}>
                          <FolderInput className="mr-2 size-3.5" /> Move to
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleting(file)}
                        >
                          <Trash2 className="mr-2 size-3.5" /> Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* -- Add a link -- */}
      <LinkDialog
        key={linking ? 'open' : 'closed'}
        open={linking}
        onClose={() => setLinking(false)}
        onSubmit={async (values) => {
          try {
            await post('/api/workspace/files', { pageId, ...values });
            setLinking(false);
            await reload();
            toast.success('Link added');
          } catch (err: any) {
            toast.error(err.message || 'Could not add that link');
          }
        }}
      />

      {/* -- Rename and describe -- */}
      <EditDialog
        key={editingFile?.id ?? 'edit-closed'}
        file={editingFile}
        onClose={() => setEditingFile(null)}
        onSubmit={async (values) => {
          try {
            await patch(`/api/workspace/files/${editingFile!.id}`, values);
            setEditingFile(null);
            await reload();
          } catch (err: any) {
            toast.error(err.message || 'Could not save that');
          }
        }}
      />

      {/* -- Move -- */}
      <MoveDialog
        key={moving?.id ?? 'move-closed'}
        file={moving}
        folders={folders}
        onClose={() => setMoving(null)}
        onSubmit={async (destination) => {
          try {
            await patch(`/api/workspace/files/${moving!.id}`, { pageId: destination });
            setMoving(null);
            await reload();
            toast.success('Moved');
          } catch (err: any) {
            toast.error(err.message || 'Could not move that');
          }
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting?.externalUrl ? 'Remove link' : 'Remove file'}
        description={deleting?.externalUrl
          ? `Remove "${deleting?.filename}"? The resource it points at is untouched.`
          : `Remove "${deleting?.filename}" from this folder? An administrator can restore it.`}
        confirmLabel="Remove"
        variant="destructive"
        isLoading={isDeleting}
        onConfirm={async () => {
          if (!deleting) return;
          setIsDeleting(true);
          try {
            await remove(`/api/workspace/files/${deleting.id}`);
            setDeleting(null);
            await reload();
          } catch (err: any) {
            toast.error(err.message || 'Could not remove that');
          } finally {
            setIsDeleting(false);
          }
        }}
      />

      {/* -- Preview -- */}
      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="truncate text-[15px]">{preview?.file.filename}</DialogTitle>
            <DialogDescription className="text-[12px]">
              {preview && formatFileSize(preview.file.sizeBytes)}
              {preview?.file.uploadedByName ? ` · ${preview.file.uploadedByName}` : ''}
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="max-h-[70vh] overflow-auto rounded-md border border-border bg-muted/30">
              {/^image\//.test(preview.file.mimeType ?? '') ? (
                <img src={preview.url} alt={preview.file.filename} className="mx-auto max-h-[68vh]" />
              ) : (
                /*
                  Everything else is shown in a sandboxed frame.

                  `sandbox` with no `allow-same-origin` is what keeps a PDF or
                  an HTML attachment from a colleague out of this page's origin.
                  The signed URL expires in ten minutes either way.
                */
                <iframe
                  src={preview.url}
                  title={preview.file.filename}
                  sandbox=""
                  className="h-[68vh] w-full bg-background"
                />
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>Close</Button>
            {preview && (
              <Button onClick={() => open(preview.file, 'download')} className="gap-1.5">
                <Download className="size-3.5" /> Download
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Dialogs                                                                   */
/* -------------------------------------------------------------------------- */

function LinkDialog({
  open, onClose, onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: { externalUrl: string; filename: string; description: string }) => Promise<void>;
}) {
  const [url, setUrl] = React.useState('');
  const [name, setName] = React.useState('');
  const [note, setNote] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a link</DialogTitle>
          <DialogDescription>
            Point at something that lives somewhere else: a Drive folder, a Figma file, a
            dashboard. It is filed here and shared exactly like an upload.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="link-url">Address</Label>
            <Input
              id="link-url" value={url} autoFocus
              onChange={(e) => setUrl(e.target.value)}
              placeholder="figma.com/file/..."
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link-name">Name</Label>
            <Input
              id="link-name" value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={url ? hostOf(url.startsWith('http') ? url : `https://${url}`) : 'Optional'}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link-note">What it is</Label>
            <Input
              id="link-note" value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!url.trim() || saving}
            onClick={async () => {
              setSaving(true);
              await onSubmit({ externalUrl: url.trim(), filename: name.trim(), description: note.trim() });
              setSaving(false);
            }}
          >
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({
  file, onClose, onSubmit,
}: {
  file: WorkspaceFile | null;
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => Promise<void>;
}) {
  const [name, setName] = React.useState(file?.filename ?? '');
  const [note, setNote] = React.useState(file?.description ?? '');
  const [url, setUrl] = React.useState(file?.externalUrl ?? '');
  const [saving, setSaving] = React.useState(false);

  return (
    <Dialog open={!!file} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{file?.externalUrl ? 'Edit link' : 'Rename file'}</DialogTitle>
          <DialogDescription>
            {file?.externalUrl
              ? 'The name and the address people follow.'
              : 'The name people see. The stored file is not touched.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="file-name">Name</Label>
            <Input id="file-name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
          </div>
          {file?.externalUrl && (
            <div className="space-y-1.5">
              <Label htmlFor="file-url">Address</Label>
              <Input id="file-url" value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="file-note">What it is</Label>
            <Input id="file-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!name.trim() || saving}
            onClick={async () => {
              setSaving(true);
              await onSubmit({
                filename: name.trim(),
                description: note.trim(),
                ...(file?.externalUrl ? { externalUrl: url.trim() } : {}),
              });
              setSaving(false);
            }}
          >
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoveDialog({
  file, folders, onClose, onSubmit,
}: {
  file: WorkspaceFile | null;
  folders: WorkspaceNode[];
  onClose: () => void;
  onSubmit: (destination: string) => Promise<void>;
}) {
  const [destination, setDestination] = React.useState(file?.pageId ?? '');
  const [saving, setSaving] = React.useState(false);

  return (
    <Dialog open={!!file} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move &ldquo;{file?.filename}&rdquo;</DialogTitle>
          <DialogDescription>
            A file lives in a folder, and takes that folder&rsquo;s sharing rule with it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label>Destination</Label>
          <Select value={destination} onValueChange={setDestination}>
            <SelectTrigger><SelectValue placeholder="Choose a folder" /></SelectTrigger>
            <SelectContent className="max-h-64">
              {folders.map(folder => (
                <SelectItem key={folder.id} value={folder.id}>{folder.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!folders.length && (
            <p className="text-[11.5px] text-muted-foreground">
              There is nowhere else you can write to.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!destination || destination === file?.pageId || saving}
            onClick={async () => { setSaving(true); await onSubmit(destination); setSaving(false); }}
          >
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
