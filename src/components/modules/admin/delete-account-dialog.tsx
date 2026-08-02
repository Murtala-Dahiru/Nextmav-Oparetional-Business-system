'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, ArrowRightLeft, Loader2, ShieldOff, Archive, UserMinus,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Permanent account deletion, reviewed before it happens
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  The screen this replaces had one destructive action on a member — a menu
 *  item reading "Deactivate", wired to `DELETE /api/admin/users/[id]` — and no
 *  way at all to remove an account. Meanwhile the RLS policy behind it allowed
 *  an owner to delete the membership row outright, which cascades into sixteen
 *  NOT NULL columns and takes the person's messages, comments, meetings,
 *  attendance and time entries with it.
 *
 *  So this dialog exists to make the consequences visible before the decision
 *  rather than after it:
 *
 *   · it asks the server what deletion would touch, and shows the answer
 *     grouped by what happens to each kind of record;
 *   · it refuses outright where the platform would break — the last owner, or
 *     an administrator deleting themselves;
 *   · it requires a named colleague to take over live responsibilities, since
 *     an unowned project simply stops appearing in the filters people work
 *     from;
 *   · and it makes the person type the email address, because everything below
 *     this point is irreversible.
 */

interface ImpactItem {
  table: string;
  column: string;
  label: string;
  kind: 'reassign' | 'retain' | 'personal' | 'revoke';
  count: number;
}

interface Impact {
  memberId: string;
  userId: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
  alreadyDeleted: boolean;
  blockers: string[];
  canDelete: boolean;
  requiresReassignment: boolean;
  items: ImpactItem[];
  removesPlatformIdentity: boolean;
  otherOrganizations: number;
}

export interface DeleteAccountTarget {
  memberId: string;
  name: string;
  email: string;
}

/** How each group is explained. The wording is the point of the grouping. */
const GROUPS: Record<ImpactItem['kind'], { title: string; blurb: string; icon: React.ElementType }> = {
  reassign: {
    title: 'Handed over',
    blurb: 'Live responsibilities. Someone has to own these tomorrow.',
    icon: ArrowRightLeft,
  },
  retain: {
    title: 'Kept as history',
    blurb: 'Facts about the past. These stay attributed to them — reassigning them would be falsification.',
    icon: Archive,
  },
  personal: {
    title: 'Kept on file',
    blurb: 'Their own employment records. Retained because payroll and HR obligations outlive employment.',
    icon: Archive,
  },
  revoke: {
    title: 'Removed',
    blurb: 'Rosters, invitations and access. Nothing here is history.',
    icon: UserMinus,
  },
};

const ORDER: ImpactItem['kind'][] = ['reassign', 'revoke', 'retain', 'personal'];

export function DeleteAccountDialog({
  target, open, onOpenChange, onDeleted, candidates,
}: {
  target: DeleteAccountTarget | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDeleted: () => void;
  /** Active members who could take over the work, excluding the target. */
  candidates: { memberId: string; fullName: string; email: string }[];
}) {
  const [impact, setImpact] = useState<Impact | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reassignTo, setReassignTo] = useState('');
  const [confirmText, setConfirmText] = useState('');

  const memberId = target?.memberId;

  const load = useCallback(async () => {
    if (!memberId) return;
    setLoading(true);
    setImpact(null);
    try {
      const res = await fetch(`/api/admin/users/${memberId}/account`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? 'Could not review this account');
      setImpact(json.data);
    } catch (e: any) {
      toast.error(e.message);
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  }, [memberId, onOpenChange]);

  useEffect(() => {
    if (!open) {
      setImpact(null);
      setReassignTo('');
      setConfirmText('');
      return;
    }
    void load();
  }, [open, load]);

  async function performDelete() {
    if (!memberId) return;
    setDeleting(true);
    try {
      const qs = reassignTo ? `?reassignTo=${encodeURIComponent(reassignTo)}` : '';
      const res = await fetch(`/api/admin/users/${memberId}/account${qs}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? 'Deletion failed');

      const d = json.data ?? {};
      toast.success(
        d.emailReusable
          ? `${target?.email} has been deleted. The address can be used for a new account.`
          : `${target?.name} no longer has access to this organization.`,
      );
      // Reported rather than swallowed: an administrator told the deletion
      // succeeded needs to know if the login survived it.
      if (d.warning) toast.warning(d.warning);

      onOpenChange(false);
      onDeleted();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(false);
    }
  }

  const grouped = ORDER
    .map(kind => ({ kind, items: (impact?.items ?? []).filter(i => i.kind === kind) }))
    .filter(g => g.items.length > 0);

  const needsReassignment = impact?.requiresReassignment && !reassignTo;
  const confirmed = confirmText.trim().toLowerCase() === (impact?.email ?? '').toLowerCase();
  const ready = !!impact?.canDelete && !needsReassignment && confirmed && !deleting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ShieldOff className="size-5 text-red-600" />
            <DialogTitle>Delete account permanently</DialogTitle>
          </div>
          <DialogDescription>
            {target?.name} — {target?.email}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Reviewing everything linked to this account…
          </div>
        )}

        {!loading && impact && (
          <div className="space-y-5">
            {/* ── Blockers ─────────────────────────────────────────────── */}
            {impact.blockers.length > 0 && (
              <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                <p className="mb-1 flex items-center gap-2 font-medium">
                  <AlertTriangle className="size-4" /> This account cannot be deleted
                </p>
                <ul className="list-disc space-y-0.5 pl-5">
                  {impact.blockers.map(b => <li key={b}>{b}</li>)}
                </ul>
              </div>
            )}

            {/* ── What this actually does ──────────────────────────────── */}
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="font-medium">What deletion means here</p>
              <p className="mt-1 text-muted-foreground">
                {impact.removesPlatformIdentity ? (
                  <>
                    Their login is deleted, so they can no longer sign in anywhere on
                    this platform, and <span className="font-medium text-foreground">{impact.email}</span>{' '}
                    becomes available for a new account. Their record in this organization is kept —
                    without it, every message, comment and approval they were part of would be
                    deleted along with them.
                  </>
                ) : (
                  <>
                    This person also belongs to{' '}
                    {impact.otherOrganizations === 1
                      ? 'another organization'
                      : `${impact.otherOrganizations} other organizations`}{' '}
                    on this platform, so their login is left alone. They lose access here and
                    nowhere else, and their email address stays in use.
                  </>
                )}
              </p>
            </div>

            {/* ── Impact, grouped by what happens ──────────────────────── */}
            {grouped.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing in this organization is linked to this account.
              </p>
            ) : (
              <div className="space-y-4">
                {grouped.map(({ kind, items }) => {
                  const g = GROUPS[kind];
                  const Icon = g.icon;
                  return (
                    <div key={kind}>
                      <div className="mb-1 flex items-center gap-2">
                        <Icon className="size-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{g.title}</span>
                      </div>
                      <p className="mb-2 pl-6 text-xs text-muted-foreground">{g.blurb}</p>
                      <div className="flex flex-wrap gap-1.5 pl-6">
                        {items.map(i => (
                          <Badge key={`${i.table}.${i.column}`} variant="secondary" className="font-normal">
                            {i.label}
                            <span className="ml-1.5 tabular-nums opacity-70">{i.count}</span>
                          </Badge>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Reassignment ─────────────────────────────────────────── */}
            {impact.canDelete && impact.requiresReassignment && (
              <div className="space-y-2">
                <Label htmlFor="reassign">Hand their live work to</Label>
                <Select value={reassignTo} onValueChange={setReassignTo}>
                  <SelectTrigger id="reassign" className="h-10">
                    <SelectValue placeholder="Choose a colleague…" />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map(c => (
                      <SelectItem key={c.memberId} value={c.memberId}>
                        {c.fullName || c.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Required. Projects, deals and tasks with nobody responsible for them
                  disappear from the lists people actually work from.
                </p>
              </div>
            )}

            {/* ── The last gate ────────────────────────────────────────── */}
            {impact.canDelete && (
              <div className="space-y-2">
                <Label htmlFor="confirm">
                  Type <span className="font-mono font-medium">{impact.email}</span> to confirm
                </Label>
                <Input
                  id="confirm"
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  placeholder={impact.email}
                  autoComplete="off"
                  className="h-10"
                />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={performDelete}
            disabled={!ready}
          >
            {deleting && <Loader2 className="size-4 animate-spin" />}
            Delete permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
