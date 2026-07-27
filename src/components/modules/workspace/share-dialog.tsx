'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Globe, Building2, Lock, CornerDownRight, X, Loader2, UserPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { initialsOf } from '@/lib/format';
import { cn } from '@/lib/utils';

import type { OpenPage, PageShare, DirectoryMember, Department } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Who can open this folder.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── What this replaces ───────────────────────────────────────────────────
 *
 *  The Share button raised a toast reading "Permissions: Workspace Shared
 *  (Role-based Control Active)". There was no sharing model at all: every page
 *  in the organisation was readable and writable by every employee, which is
 *  not a workspace anybody can put an HR folder in.
 *
 *  ── The model ────────────────────────────────────────────────────────────
 *
 *  A page has a base visibility, and then explicit shares on top of it. Both
 *  are inherited by everything inside a folder, resolved server-side by
 *  `page_permission()` walking up the ancestry — so sharing "HR Documents"
 *  with the HR department reaches the pages inside it, including ones created
 *  afterwards.
 */

const VISIBILITY_OPTIONS = [
  { value: 'organization', label: 'Everyone in the company', icon: Globe,
    hint: 'Any employee can find and edit this.' },
  { value: 'department', label: 'One department', icon: Building2,
    hint: 'Only people in the department you choose.' },
  { value: 'private', label: 'Private', icon: Lock,
    hint: 'Only you, administrators, and the people you add below.' },
  { value: 'inherit', label: 'Same as the folder it is in', icon: CornerDownRight,
    hint: 'Follows whatever the parent folder allows.' },
] as const;

interface ShareDialogProps {
  page: OpenPage | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: DirectoryMember[];
  departments: Department[];
  onSaved: () => void;
}

export function ShareDialog({
  page, open, onOpenChange, members, departments, onSaved,
}: ShareDialogProps) {
  const [visibility, setVisibility] = useState<OpenPage['visibility']>('organization');
  const [departmentId, setDepartmentId] = useState<string>('');
  const [shares, setShares] = useState<PageShare[]>([]);
  const [addTarget, setAddTarget] = useState<string>('');
  const [addPermission, setAddPermission] = useState<'view' | 'edit' | 'manage'>('view');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!page || !open) return;
    setVisibility(page.visibility);
    setDepartmentId(page.departmentId ?? '');
    setShares(page.shares ?? []);
    setAddTarget('');
    setAddPermission('view');
  }, [page, open]);

  const refreshShares = useCallback(async () => {
    if (!page) return;
    const res = await fetch(`/api/workspace/pages/${page.id}/shares`);
    const json = await res.json();
    if (!json.error) setShares(json.data ?? []);
  }, [page]);

  const addShare = useCallback(async () => {
    if (!page || !addTarget) return;
    setBusy(true);
    try {
      // The picker holds one list of people and departments; the prefix says
      // which, so the caller does not need two controls for one decision.
      const isDept = addTarget.startsWith('dept:');
      const body = isDept
        ? { departmentId: addTarget.slice(5), permission: addPermission }
        : { memberId: addTarget.slice(7), permission: addPermission };

      const res = await fetch(`/api/workspace/pages/${page.id}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      setAddTarget('');
      await refreshShares();
    } catch (err: any) {
      toast.error(err.message || 'Could not share');
    } finally {
      setBusy(false);
    }
  }, [page, addTarget, addPermission, refreshShares]);

  const removeShare = useCallback(async (share: PageShare) => {
    if (!page) return;
    try {
      const res = await fetch(`/api/workspace/pages/${page.id}/shares?shareId=${share.id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      await refreshShares();
    } catch (err: any) {
      toast.error(err.message || 'Could not revoke access');
    }
  }, [page, refreshShares]);

  const save = useCallback(async () => {
    if (!page) return;
    if (visibility === 'department' && !departmentId) {
      toast.error('Choose which department this is for.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/workspace/pages/${page.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visibility,
          departmentId: visibility === 'department' ? departmentId : null,
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      toast.success('Access updated');
      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  }, [page, visibility, departmentId, onSaved, onOpenChange]);

  // Only 'manage' may re-share. Rendering the controls otherwise would offer
  // an action the server will refuse.
  const canManage = page?.permission === 'manage';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share “{page?.title}”</DialogTitle>
          <DialogDescription>
            {page?.isFolder
              ? 'Everything inside this folder inherits what you set here.'
              : 'Who may open and edit this page.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label>General access</Label>
            <div className="grid gap-2">
              {VISIBILITY_OPTIONS
                .filter(option => option.value !== 'inherit' || page?.parentId)
                .map(({ value, label, icon: Icon, hint }) => (
                  <button
                    key={value}
                    type="button"
                    disabled={!canManage}
                    onClick={() => setVisibility(value)}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                      visibility === value
                        ? 'border-emerald-500 bg-emerald-500/5'
                        : 'hover:bg-accent/50',
                      !canManage && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    <Icon className={cn('mt-0.5 size-4 shrink-0',
                      visibility === value ? 'text-emerald-600' : 'text-muted-foreground')} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{label}</span>
                      <span className="block text-xs text-muted-foreground">{hint}</span>
                    </span>
                  </button>
                ))}
            </div>
          </div>

          {visibility === 'department' && (
            <div className="space-y-2">
              <Label htmlFor="share-dept">Department</Label>
              <Select value={departmentId || undefined} onValueChange={setDepartmentId} disabled={!canManage}>
                <SelectTrigger id="share-dept"><SelectValue placeholder="Choose a department" /></SelectTrigger>
                <SelectContent>
                  {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>People and departments with access</Label>

            {shares.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                Nobody has been given access individually.
              </p>
            ) : (
              <div className="divide-y rounded-md border">
                {shares.map(share => {
                  const name = share.member?.profiles?.fullName
                    ?? share.department?.name
                    ?? 'Unknown';
                  return (
                    <div key={share.id} className="flex items-center gap-2.5 p-2.5">
                      {share.department ? (
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
                          <Building2 className="size-3.5 text-muted-foreground" />
                        </div>
                      ) : (
                        <Avatar className="size-7 shrink-0">
                          <AvatarFallback className="bg-emerald-500 text-[10px] text-white">
                            {initialsOf(name)}
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
                      <Badge variant="outline" className="shrink-0 text-[10px] capitalize">
                        {share.permission}
                      </Badge>
                      {canManage && (
                        <Button variant="ghost" size="icon" className="size-6 shrink-0"
                          onClick={() => removeShare(share)} title="Revoke">
                          <X className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {canManage && (
              <div className="flex gap-2 pt-1">
                <Select value={addTarget || undefined} onValueChange={setAddTarget}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Add a person or department" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {departments.map(d => (
                      <SelectItem key={`dept:${d.id}`} value={`dept:${d.id}`}>
                        {d.name} (department)
                      </SelectItem>
                    ))}
                    {members.map(m => (
                      <SelectItem key={`member:${m.memberId}`} value={`member:${m.memberId}`}>
                        {m.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={addPermission} onValueChange={(v) => setAddPermission(v as typeof addPermission)}>
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="view">Can view</SelectItem>
                    <SelectItem value="edit">Can edit</SelectItem>
                    <SelectItem value="manage">Can manage</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" disabled={!addTarget || busy} onClick={addShare}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                </Button>
              </div>
            )}
          </div>

          {!canManage && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
              You can see who has access, but only someone with manage rights can change it.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {canManage && (
            <Button className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Save access
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
