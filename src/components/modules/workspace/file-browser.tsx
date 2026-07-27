'use client';

import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  UploadCloud, Download, Eye, Trash2, Pencil, Loader2, FileText,
  Image as ImageIcon, FileArchive, Film, FileSpreadsheet, Folder,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { createClient } from '@/lib/supabase/client';
import { formatFileSize, formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

import type { WorkspaceFile } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Files, actually stored.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Bytes go from the browser straight to Supabase Storage — the same path the
 *  projects module already uses — and a metadata row is then recorded through
 *  `/api/workspace/files`. Uploading through the Next route instead would mean
 *  a 50 MB file crossing the server twice and sitting in its memory in between,
 *  for no benefit: the storage policies already confine a member to their own
 *  organisation's path prefix.
 *
 *  Downloads and previews go through a signed URL minted server-side, because
 *  the document buckets are private and a path alone is not readable.
 */

const MAX_MB = 50;

/** Storage rejects some characters outright; others just make paths unreadable. */
function safeName(name: string) {
  return name.replace(/[^\w.\-]+/g, '_').slice(0, 120);
}

function iconFor(file: WorkspaceFile) {
  const ext = file.filename.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif'].includes(ext)) return ImageIcon;
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return Film;
  if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return FileArchive;
  if (['csv', 'xlsx', 'xls', 'ods'].includes(ext)) return FileSpreadsheet;
  return FileText;
}

interface FileBrowserProps {
  pageId: string;
  organizationId: string;
  files: WorkspaceFile[];
  canEdit: boolean;
  onChanged: (files: WorkspaceFile[]) => void;
}

export function FileBrowser({ pageId, organizationId, files, canEdit, onChanged }: FileBrowserProps) {
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<Record<string, number>>({});
  const [renaming, setRenaming] = useState<WorkspaceFile | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState<WorkspaceFile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [preview, setPreview] = useState<{ file: WorkspaceFile; url: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/workspace/files?pageId=${pageId}`);
    const json = await res.json();
    if (!json.error) onChanged(json.data ?? []);
  }, [pageId, onChanged]);

  // ─── Upload ──────────────────────────────────────────────────────────────

  const upload = useCallback(async (list: FileList | File[]) => {
    const supabase = createClient();
    const chosen = Array.from(list);

    for (const file of chosen) {
      if (file.size > MAX_MB * 1024 * 1024) {
        toast.error(`"${file.name}" is larger than ${MAX_MB}MB.`);
        continue;
      }

      const key = `${file.name}-${file.size}`;
      setUploads(prev => ({ ...prev, [key]: 5 }));

      /**
       * The path must begin with the organisation id.
       *
       * That is the whole storage security model — every policy checks the
       * first segment against the caller's memberships — and the metadata
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
        const res = await fetch('/api/workspace/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pageId,
            bucket: 'documents',
            path,
            filename: file.name,
            mimeType: file.type || null,
            sizeBytes: file.size,
          }),
        });
        const json = await res.json();
        if (json.error) throw new Error(json.error.message);

        setUploads(prev => ({ ...prev, [key]: 100 }));
        toast.success(`Uploaded ${file.name}`);
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

  // ─── Read ────────────────────────────────────────────────────────────────

  const openSigned = useCallback(async (file: WorkspaceFile, mode: 'download' | 'preview') => {
    try {
      const res = await fetch(`/api/workspace/files/${file.id}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      const url: string | null = json.data?.url ?? null;
      if (!url) throw new Error('No link was returned for that file.');

      if (mode === 'preview') {
        setPreview({ file, url });
        return;
      }
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

  // ─── Rename and delete ───────────────────────────────────────────────────

  const submitRename = useCallback(async () => {
    if (!renaming) return;
    try {
      const res = await fetch(`/api/workspace/files/${renaming.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: renameValue }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      setRenaming(null);
      await reload();
    } catch (err: any) {
      toast.error(err.message || 'Rename failed');
    }
  }, [renaming, renameValue, reload]);

  const confirmDelete = useCallback(async () => {
    if (!deleting) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/workspace/files/${deleting.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      setDeleting(null);
      await reload();
      toast.success('File removed');
    } catch (err: any) {
      toast.error(err.message || 'Delete failed');
    } finally {
      setIsDeleting(false);
    }
  }, [deleting, reload]);

  const inFlight = Object.entries(uploads);

  return (
    <div className="space-y-4">
      {canEdit && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files?.length) upload(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors',
            dragging
              ? 'border-emerald-500 bg-emerald-500/10'
              : 'border-border hover:border-emerald-500/50 hover:bg-accent/40',
          )}
        >
          <input
            ref={inputRef} type="file" multiple className="hidden"
            onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = ''; }}
          />
          <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
            <UploadCloud className="size-5" />
          </div>
          <p className="text-sm font-medium">
            Drag files here, or <span className="text-emerald-600 underline">browse</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Documents, images, PDFs and spreadsheets, up to {MAX_MB}MB each
          </p>
        </div>
      )}

      {inFlight.length > 0 && (
        <div className="space-y-2 rounded-lg border bg-card p-3">
          {inFlight.map(([key, percent]) => (
            <div key={key} className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="truncate">{key.split('-').slice(0, -1).join('-')}</span>
                <span>{percent}%</span>
              </div>
              <Progress value={percent} className="h-1.5" />
            </div>
          ))}
        </div>
      )}

      {files.length === 0 ? (
        <EmptyState
          icon={Folder}
          title="No files here yet"
          description={canEdit
            ? 'Upload a document, image or spreadsheet to keep it with this page.'
            : 'Nothing has been filed here.'}
        />
      ) : (
        <div className="divide-y overflow-hidden rounded-lg border bg-card">
          {files.map((file) => {
            const Icon = iconFor(file);
            return (
              <div key={file.id} className="flex items-center gap-3 p-3 transition-colors hover:bg-accent/30">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                  <Icon className="size-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.filename}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {formatFileSize(file.sizeBytes)}
                    {' · '}
                    {file.uploadedByName || 'Unknown member'}
                    {' · '}
                    {formatRelativeTime(file.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon" className="size-7" title="Preview"
                    onClick={() => openSigned(file, 'preview')}>
                    <Eye className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7" title="Download"
                    onClick={() => openSigned(file, 'download')}>
                    <Download className="size-3.5" />
                  </Button>
                  {canEdit && (
                    <>
                      <Button variant="ghost" size="icon" className="size-7" title="Rename"
                        onClick={() => { setRenaming(file); setRenameValue(file.filename); }}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon"
                        className="size-7 text-muted-foreground hover:text-destructive" title="Remove"
                        onClick={() => setDeleting(file)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Preview ─── */}
      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate">{preview?.file.filename}</DialogTitle>
            <DialogDescription>
              {preview && `${formatFileSize(preview.file.sizeBytes)} · uploaded by ${preview.file.uploadedByName || 'a colleague'}`}
            </DialogDescription>
          </DialogHeader>
          {/*
            Images and PDFs render inline; anything else gets a download link.
            Embedding an arbitrary type in an iframe shows a browser download
            prompt inside a modal, which is worse than offering the link.
          */}
          {preview && /^image\//.test(preview.file.mimeType ?? '') ? (
            <img src={preview.url} alt={preview.file.filename}
              className="max-h-[60vh] w-full rounded-md object-contain" />
          ) : preview && preview.file.mimeType === 'application/pdf' ? (
            <iframe src={preview.url} title={preview.file.filename}
              className="h-[60vh] w-full rounded-md border" />
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-lg border bg-muted/30 py-10">
              <FileText className="size-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                This type cannot be previewed in the browser.
              </p>
              <Button size="sm" className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => preview && openSigned(preview.file, 'download')}>
                <Download className="size-4" /> Download
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── Rename ─── */}
      <Dialog open={!!renaming} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename file</DialogTitle>
            <DialogDescription>
              This changes the display name. The stored file itself is untouched.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="file-name">Name</Label>
            <Input id="file-name" value={renameValue} autoFocus
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitRename(); }} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>Cancel</Button>
            <Button className="bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={!renameValue.trim()} onClick={submitRename}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Remove file"
        description={`Remove "${deleting?.filename}" from this page? It can be restored by an administrator.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={confirmDelete}
        isLoading={isDeleting}
      />

      {inFlight.length > 0 && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Uploading…
        </p>
      )}
    </div>
  );
}
