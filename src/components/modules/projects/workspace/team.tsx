'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { UserPlus, Trash2, Loader2, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AvatarPresence } from '@/components/shared/presence-dot';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Head } from '@/components/shared/readout/primitives';
import { initialsOf, formatDay, todayISO } from '@/lib/format';
import { PROJECT_ROLES, statusLabel } from '@/lib/constants';
import { useAppStore } from '@/store/app-store';

import { post, patch, remove, hours } from '../data';
import { Nothing } from '../ui';
import type { Member, ProjectMember, Workspace } from '../types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Team - who is on it, and what they are carrying
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The one thing the old panel could not say ────────────────────────────
 *
 * It listed everybody with a role badge and an allocation percentage, which
 * answers "who is nominally on this" and nothing else. The question a delivery
 * lead actually has is "who is holding the work", and that is a join away: the
 * tasks are already on screen, each with an `assignee`, so the counts cost
 * nothing and change the panel from a staff list into a workload view.
 *
 * ── Allocation and load are different numbers ────────────────────────────
 *
 * `allocation_pct` is a plan - how much of somebody's week this project is
 * meant to have. Open tasks are what they are actually carrying. Neither
 * predicts the other, and showing them side by side is what makes the mismatch
 * visible: somebody allocated 20% holding eleven open tasks is the row worth
 * seeing.
 *
 * Deliberately **not** a resource-management system. No capacity model, no
 * levelling, no hours-per-week arithmetic across projects: none of that data
 * exists here, and inventing it would be a chart that looks authoritative and
 * is not.
 */

export function TeamPanel({
  projectId, data, directory, onChanged,
}: {
  projectId: string;
  data: Workspace;
  directory: Member[];
  onChanged: () => void;
}) {
  const { members, tasks, project } = data;
  const [addOpen, setAddOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ProjectMember | null>(null);
  const [removing, setRemoving] = React.useState<ProjectMember | null>(null);

  const allows = useAppStore(s => s.allows);
  const mayEdit = allows('projects', 'edit');
  const today = todayISO();

  /** Open, overdue and logged work per person, from the tasks already loaded. */
  const load = React.useMemo(() => {
    const map = new Map<string, { open: number; overdue: number; done: number; logged: number }>();
    for (const t of tasks) {
      const id = t.assignee?.id;
      if (!id) continue;
      const row = map.get(id) ?? { open: 0, overdue: 0, done: 0, logged: 0 };
      if (t.status === 'done') row.done += 1;
      else {
        row.open += 1;
        if (t.dueDate && t.dueDate < today) row.overdue += 1;
      }
      row.logged += Number(t.loggedHours ?? 0);
      map.set(id, row);
    }
    return map;
  }, [tasks, today]);

  const unassigned = tasks.filter(t => !t.assignee && t.status !== 'done').length;
  const busiest = Math.max(1, ...[...load.values()].map(v => v.open));

  /**
   * Everyone on the project, owner first.
   *
   * The owner is on `projects.owner_id` rather than in `project_members`, and
   * the old panel drew them in a card of their own above the list - so the
   * person accountable for the project appeared in a different shape from
   * everybody delivering it, and could not be compared with them. One list,
   * with the owner marked.
   */
  const roster = React.useMemo(() => {
    const rows = members.map(pm => ({
      key: pm.id,
      assignment: pm,
      memberId: pm.member?.id ?? '',
      name: pm.member?.profiles?.fullName ?? 'Unknown',
      avatarUrl: pm.member?.profiles?.avatarUrl ?? null,
      jobTitle: pm.member?.profiles?.jobTitle ?? null,
      role: statusLabel(pm.role),
      allocation: pm.allocationPct,
      joinedAt: pm.joinedAt as string | null,
      isOwner: false,
    }));

    if (project.owner && !members.some(m => m.member?.id === project.owner?.id)) {
      rows.unshift({
        key: `owner-${project.owner.id}`,
        assignment: null as unknown as ProjectMember,
        memberId: project.owner.id,
        name: project.owner.profiles?.fullName ?? 'Unassigned',
        avatarUrl: project.owner.profiles?.avatarUrl ?? null,
        jobTitle: project.owner.profiles?.jobTitle ?? null,
        role: 'Owner',
        allocation: 0,
        joinedAt: null,
        isOwner: true,
      });
    }
    return rows;
  }, [members, project.owner]);

  const add = React.useCallback(async (memberId: string, role: string, allocation: number) => {
    await post('/api/projects/members', { projectId, memberId, role, allocationPct: allocation });
    onChanged();
  }, [projectId, onChanged]);

  const confirmRemove = React.useCallback(async () => {
    if (!removing) return;
    try {
      await remove(`/api/projects/members/${removing.id}`);
      toast.success('Removed from the project');
      setRemoving(null);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove them');
    }
  }, [removing, onChanged]);

  // Somebody already on the project should not be offered again: the unique
  // constraint would reject it, and an option that always errors is a bug.
  const available = React.useMemo(() => {
    const taken = new Set(members.map(m => m.member?.id));
    return directory.filter(d => !taken.has(d.memberId));
  }, [directory, members]);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <Head
          title="On this project"
          count={roster.length}
          note="Allocation is the plan. Open work is what they are carrying."
          action={mayEdit ? { label: 'Add someone', onClick: () => setAddOpen(true) } : undefined}
        />

        {roster.length === 0 ? (
          <div className="rounded-xl border border-border bg-card shadow-e1">
            <Nothing
              className="px-4"
              title="Nobody is on this project"
              note="Add colleagues so work can be assigned and they hear about changes."
              action={mayEdit
                ? <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
                    <UserPlus className="size-4" /> Add someone
                  </Button>
                : undefined}
            />
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card shadow-e1">
            {/* The header band. Hidden on a phone, where the rows stack. */}
            <div className="hidden grid-cols-[minmax(0,2fr)_5rem_minmax(0,1.6fr)_5rem_4.5rem] items-center gap-4 border-b border-border px-4 py-3 text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground/80 md:grid">
              <span>Person</span>
              <span className="text-right">Allocated</span>
              <span>Workload</span>
              <span className="text-right">Logged</span>
              <span />
            </div>

            <ul className="divide-y divide-border/70">
              {roster.map(r => {
                const l = load.get(r.memberId) ?? { open: 0, overdue: 0, done: 0, logged: 0 };
                const presence = directory.find(d => d.memberId === r.memberId)?.presence;

                return (
                  <li
                    key={r.key}
                    className="grid grid-cols-1 items-center gap-x-4 gap-y-3 px-4 py-3.5 md:grid-cols-[minmax(0,2fr)_5rem_minmax(0,1.6fr)_5rem_4.5rem]"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {/*
                        Whether a teammate is around, on the panel where you
                        decide who to ask. The verdict comes from the directory,
                        which derives it through the same `presence_of()` as the
                        chat, so nobody reads as online in one and away in the
                        other.
                      */}
                      <AvatarPresence presence={presence}>
                        <Avatar className="size-8">
                          {r.avatarUrl ? <AvatarImage src={r.avatarUrl} alt="" /> : null}
                          <AvatarFallback className="bg-muted text-[11px] font-medium text-muted-foreground">
                            {initialsOf(r.name)}
                          </AvatarFallback>
                        </Avatar>
                      </AvatarPresence>
                      <div className="min-w-0">
                        <p className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-foreground">
                          <span className="truncate">{r.name}</span>
                          {r.isOwner && (
                            <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                              Owner
                            </span>
                          )}
                        </p>
                        <p className="truncate text-[12px] text-muted-foreground">
                          {r.jobTitle || r.role}
                          {!r.isOwner && r.jobTitle && ` · ${r.role}`}
                          {r.joinedAt && ` · joined ${formatDay(r.joinedAt, { day: 'numeric', month: 'short' })}`}
                        </p>
                      </div>
                    </div>

                    <div className="text-[12.5px] tabular-nums text-muted-foreground md:text-right">
                      {r.isOwner ? <span className="text-muted-foreground/50">-</span> : `${r.allocation}%`}
                    </div>

                    <div className="min-w-0">
                      {l.open + l.done === 0 ? (
                        <span className="text-[12px] text-muted-foreground/60">Nothing assigned</span>
                      ) : (
                        <>
                          <LoadBar open={l.open} overdue={l.overdue} of={busiest} name={r.name} />
                          <p className="mt-1.5 text-[12px] text-muted-foreground">
                            <span className="font-medium text-foreground">{l.open}</span> open
                            {l.overdue > 0 && (
                              <span className="text-destructive"> · {l.overdue} overdue</span>
                            )}
                            {l.done > 0 && ` · ${l.done} done`}
                          </p>
                        </>
                      )}
                    </div>

                    <div className="text-[12.5px] tabular-nums text-muted-foreground md:text-right">
                      {l.logged > 0 ? hours(l.logged) : <span className="text-muted-foreground/50">-</span>}
                    </div>

                    <div className="flex justify-end">
                      {mayEdit && !r.isOwner && r.assignment && (
                        <div className="flex items-center">
                          <Button
                            variant="ghost" size="icon" className="size-8"
                            aria-label={`Change ${r.name}'s role`}
                            onClick={() => setEditing(r.assignment)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="size-8"
                            aria-label={`Remove ${r.name} from the project`}
                            onClick={() => setRemoving(r.assignment)}
                          >
                            <Trash2 className="size-3.5 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {unassigned > 0 && (
              <p className="border-t border-border px-4 py-3 text-[12.5px] text-muted-foreground">
                <span className="font-medium text-foreground">{unassigned}</span>{' '}
                open task{unassigned === 1 ? '' : 's'} on this project {unassigned === 1 ? 'has' : 'have'} nobody&apos;s
                name on {unassigned === 1 ? 'it' : 'them'}.
              </p>
            )}
          </div>
        )}
      </section>

      <AddDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        available={available}
        onAdd={add}
      />

      <RoleDialog
        assignment={editing}
        onClose={() => setEditing(null)}
        onSaved={onChanged}
      />

      <ConfirmDialog
        open={!!removing}
        onOpenChange={o => { if (!o) setRemoving(null); }}
        title="Remove from the project"
        description={`${removing?.member?.profiles?.fullName ?? 'This person'} stops receiving updates about this project. Work already assigned to them stays assigned, so reassign it deliberately if somebody else should pick it up.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={confirmRemove}
      />
    </div>
  );
}

/**
 * One person's open work, drawn against the heaviest load on the project.
 *
 * ── Why not the shared `Bar` ─────────────────────────────────────────────
 *
 * `Bar` normalises its segments to their own sum, which is exactly right for a
 * composition - receivables split into paid and overdue - and exactly wrong
 * here. Two people holding one task and eleven would both draw a full-width
 * bar, so the column would say every workload is the same, which is the
 * opposite of what it is for.
 *
 * The track is the busiest person's open count and the fill is this person's,
 * so the widths are comparable down the column and the row worth looking at is
 * the long one. Overdue work is drawn at the head of the fill because it is
 * the part that is already costing something.
 */
function LoadBar({
  open, overdue, of, name,
}: {
  open: number;
  overdue: number;
  of: number;
  name: string;
}) {
  const total = Math.max(1, of);
  const share = (n: number) => `${Math.min(100, (n / total) * 100)}%`;

  return (
    <span
      role="img"
      aria-label={`${name}: ${open} open of the project's heaviest load of ${of}${overdue ? `, ${overdue} overdue` : ''}`}
      className="flex h-1 w-full max-w-[12rem] overflow-hidden rounded-full bg-border/70"
    >
      <span
        className="h-full bg-warning transition-[width] duration-500"
        style={{ width: share(overdue) }}
      />
      <span
        className="h-full bg-foreground/45 transition-[width] duration-500"
        style={{ width: share(open - overdue) }}
      />
    </span>
  );
}

function AddDialog({
  open, onOpenChange, available, onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  available: Member[];
  onAdd: (memberId: string, role: string, allocation: number) => Promise<void>;
}) {
  const [memberId, setMemberId] = React.useState('');
  const [role, setRole] = React.useState('contributor');
  const [allocation, setAllocation] = React.useState(100);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) { setMemberId(''); setRole('contributor'); setAllocation(100); }
  }, [open]);

  const submit = React.useCallback(async () => {
    if (!memberId) return;
    setSaving(true);
    try {
      await onAdd(memberId, role, allocation);
      toast.success('Added to the project');
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add them');
    } finally {
      setSaving(false);
    }
  }, [memberId, role, allocation, onAdd, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add someone to this project</DialogTitle>
          <DialogDescription>
            They are told, and start receiving updates about status changes,
            phases and discussion.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-[12.5px] font-medium">Person</Label>
            <Select value={memberId} onValueChange={setMemberId}>
              <SelectTrigger><SelectValue placeholder="Choose a colleague" /></SelectTrigger>
              <SelectContent>
                {available.map(d => (
                  <SelectItem key={d.memberId} value={d.memberId}>
                    {d.fullName}
                    {d.jobTitle && (
                      <span className="ml-1.5 text-xs text-muted-foreground">{d.jobTitle}</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {available.length === 0 && (
              <p className="text-[12px] text-muted-foreground">
                Everyone in the directory is already on this project.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label className="text-[12.5px] font-medium">Role here</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROJECT_ROLES.map(r => (
                    <SelectItem key={r} value={r}>{statusLabel(r)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="alloc" className="text-[12.5px] font-medium">Allocation</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="alloc" type="number" min={0} max={100}
                  value={allocation}
                  onChange={e => setAllocation(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
                />
                <span className="text-[13px] text-muted-foreground">%</span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !memberId}>
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Changing a role or an allocation.
 *
 * `PATCH /api/projects/members/[id]` has accepted both since it was written
 * and nothing has ever called it: the old panel could add somebody and remove
 * them, so correcting a role meant doing both and losing the joined date.
 */
function RoleDialog({
  assignment, onClose, onSaved,
}: {
  assignment: ProjectMember | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [role, setRole] = React.useState('contributor');
  const [allocation, setAllocation] = React.useState(100);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!assignment) return;
    setRole(assignment.role);
    setAllocation(assignment.allocationPct);
  }, [assignment]);

  const save = React.useCallback(async () => {
    if (!assignment) return;
    setSaving(true);
    try {
      await patch(`/api/projects/members/${assignment.id}`, { role, allocationPct: allocation });
      toast.success('Updated');
      onClose();
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save that');
    } finally {
      setSaving(false);
    }
  }, [assignment, role, allocation, onClose, onSaved]);

  return (
    <Dialog open={!!assignment} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{assignment?.member?.profiles?.fullName ?? 'Team member'}</DialogTitle>
          <DialogDescription>Their role on this project, and how much of their time it has.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-[12.5px] font-medium">Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PROJECT_ROLES.map(r => (
                  <SelectItem key={r} value={r}>{statusLabel(r)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="alloc-edit" className="text-[12.5px] font-medium">Allocation</Label>
            <div className="flex items-center gap-2">
              <Input
                id="alloc-edit" type="number" min={0} max={100}
                value={allocation}
                onChange={e => setAllocation(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
              />
              <span className="text-[13px] text-muted-foreground">%</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

