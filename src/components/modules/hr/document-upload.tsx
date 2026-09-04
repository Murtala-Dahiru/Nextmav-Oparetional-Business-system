'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Upload, Loader2, Lock } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { createClient } from '@/lib/supabase/client';
import {
  HR_DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS, ORG_WIDE_DOCUMENTS,
  labelOf, type HrDocumentCategory,
} from '@/lib/hr';

import { post } from './data';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Filing an HR document
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The gap this closes ──────────────────────────────────────────────────
 *
 * `/api/hr/documents` has existed complete for a while: a storage-path check,
 * a bucket allowlist, a category vocabulary, a confidentiality rule the caller
 * cannot override, and a reader that issues short-lived signed URLs. The
 * employee profile lists what has been filed.
 *
 * Nothing could file anything. There was no upload control anywhere in the
 * product, so the only way a document reached an employee's record was for
 * somebody to put an object in the bucket by hand and then POST its path. A
 * complete back end with no way in is the same defect as a screen with no back
 * end — it just fails in the quieter direction.
 *
 * ── Two steps, and why the order matters ─────────────────────────────────
 *
 * The object goes to storage first, then its metadata is recorded. If the
 * second step fails the object is removed again, because an orphan in a
 * private bucket is invisible to every screen, un-deletable through any of
 * them, and counted against the organisation's storage for ever — the same
 * reasoning the message composer gives for cleaning up an abandoned draft.
 *
 * Recording first and uploading second would be worse: a row pointing at
 * nothing renders as a document that exists until somebody clicks it.
 *
 * ── What this deliberately does not offer ────────────────────────────────
 *
 * A confidentiality switch. `is_confidential` is decided by the category on
 * the server — everything except a policy is confidential — and offering a
 * toggle here would imply a choice the endpoint is going to overrule. The
 * dialog says what will happen instead.
 */

/** Matches the endpoint's own allowlist; a mismatch is a 422 the user cannot fix. */
const BUCKET = 'documents';

/** Storage keys are not filenames. Keep the extension, lose everything else. */
function safeName(name: string): string {
  return name.normalize('NFKD').replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-').slice(-80);
}

export function DocumentUploadDialog({
  open,
  memberId,
  memberName,
  organizationId,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Null files a company-wide document; a policy is the only category that allows it. */
  memberId: string | null;
  memberName?: string | null;
  organizationId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [category, setCategory] = React.useState<HrDocumentCategory>('contract');
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) { setFile(null); setCategory(memberId ? 'contract' : 'policy'); }
  }, [open, memberId]);

  const orgWide = (ORG_WIDE_DOCUMENTS as readonly string[]).includes(category);

  /**
   * The categories on offer depend on who this is being filed against.
   *
   * A company-wide upload can only be a policy, and a document filed against a
   * person cannot be one — those are the endpoint's rules, and offering a
   * choice it will refuse is how a form teaches people to distrust it.
   */
  const choices = HR_DOCUMENT_CATEGORIES.filter(c =>
    memberId ? !(ORG_WIDE_DOCUMENTS as readonly string[]).includes(c)
      : (ORG_WIDE_DOCUMENTS as readonly string[]).includes(c));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { toast.error('Choose a file first.'); return; }

    setBusy(true);
    /*
      The path starts with the organisation id because the endpoint checks
      exactly that before recording anything, and the storage policies are
      written against the same first segment.
    */
    const path = `${organizationId}/hr/${memberId ?? 'company'}/${Date.now()}-${safeName(file.name)}`;
    const supabase = createClient();

    try {
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (upErr) throw new Error(upErr.message);

      try {
        await post('/api/hr/documents', {
          filename: file.name,
          path,
          bucket: BUCKET,
          hr_category: category,
          member_id: orgWide ? undefined : memberId,
          mime_type: file.type || undefined,
          size_bytes: file.size,
        });
      } catch (recordErr) {
        /* See the header: an unrecorded object is worse than no object. */
        await supabase.storage.from(BUCKET).remove([path]).catch(() => undefined);
        throw recordErr;
      }

      toast.success('Filed');
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'That did not upload.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>File a document</DialogTitle>
          <DialogDescription>
            {memberId
              ? `Against ${memberName ?? 'this employee'}'s record.`
              : 'For the company. Only a policy is filed this way.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="doc-file">File</Label>
            <input
              ref={inputRef}
              id="doc-file"
              type="file"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
              className={cn(
                'block w-full text-[12.5px] text-muted-foreground',
                'file:mr-3 file:rounded-md file:border file:border-border file:bg-background',
                'file:px-3 file:py-1.5 file:text-[12.5px] file:font-medium file:text-foreground',
              )}
            />
            {file && (
              <p className="text-[11.5px] text-muted-foreground">
                {file.name} · {(file.size / 1024).toFixed(0)} KB
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="doc-cat">What it is</Label>
            <Select value={category} onValueChange={v => setCategory(v as HrDocumentCategory)}>
              <SelectTrigger id="doc-cat"><SelectValue /></SelectTrigger>
              <SelectContent>
                {choices.map(c => (
                  <SelectItem key={c} value={c}>{labelOf(DOCUMENT_CATEGORY_LABELS, c)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/*
            Stated, not offered.

            The server decides confidentiality from the category and will
            overrule anything sent, so a switch here would be a control that
            does nothing — which is worse than no control.
          */}
          <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {orgWide
              ? 'A policy is readable by everybody in the organisation.'
              : 'Filed confidential: visible to this person and to HR, and to nobody else. That is decided by the category, not by a setting here.'}
          </p>

          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy || !file} className="gap-1.5">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
              File it
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
