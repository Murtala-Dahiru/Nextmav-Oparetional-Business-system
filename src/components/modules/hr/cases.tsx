'use client';

import * as React from 'react';
import { Plus, Lock, Send } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Card, Head, Stat, THead, TRow } from '@/components/shared/readout/primitives';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useModuleRealtime } from '@/hooks/use-realtime';
import { statusLabel } from '@/lib/constants';
import {
  CASE_CATEGORY_LABELS, CASE_STATUS_LABELS, HR_CASE_STATUSES,
  OPEN_CASE_STATUSES, labelOf,
} from '@/lib/hr';

import { getList, getOne, post, patch, whenWord } from './data';
import { PersonCell, Blank, Skeleton, Pill, day } from './ui';
import { CaseDialog } from './forms';
import type { HrCase, Person } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The HR case desk
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this replaces ───────────────────────────────────────────────────
 *
 * Three rows in a `useState` array, an "Avg Resolution Time: 18 Hours" that
 * was a string literal, and a submission dialogue whose own words were
 * "Private, confidential case submission directly to the HR Management team".
 * Nothing received it and nothing stored it, and the person was told it
 * worked. Somebody could have typed a grievance into that.
 *
 * ── The two audiences ────────────────────────────────────────────────────
 *
 * An employee sees the cases they raised and the ones about them, and HR sees
 * everything - **except** a restricted case, which only HR and the person who
 * filed it can read. That is what makes "raise a concern about your manager" a
 * feature rather than a way to email your manager.
 *
 * Notes carry the same split at a finer grain: an internal note is HR talking
 * to HR, and the employee's thread simply does not contain it. Not greyed out,
 * not "1 hidden note" - absent, because a hidden note somebody can count is a
 * note they will ask about.
 */

export function Cases({
  isHr,
  selfMemberId,
}: {
  isHr: boolean;
  selfMemberId: string;
}) {
  const [cases, setCases] = React.useState<HrCase[]>([]);
  const [people, setPeople] = React.useState<Person[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [raising, setRaising] = React.useState(false);
  const [scope, setScope] = React.useState<'open' | 'mine' | 'all'>(isHr ? 'open' : 'mine');

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (scope === 'all') params.set('include', 'all');
      if (scope === 'mine') { params.set('mine', 'true'); params.set('include', 'all'); }

      const [c, p] = await Promise.all([
        getList<HrCase>(`/api/hr/cases?${params}`),
        getList<Person>('/api/hr/people?pageSize=200').catch(() => ({ data: [] as Person[] })),
      ]);
      setCases(c.data);
      setPeople(p.data);
    } catch (e: any) {
      if (!silent) toast.error(e.message || 'Could not load cases');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  React.useEffect(() => { load(); }, [load]);

  useModuleRealtime('hr-cases', ['hr_cases', 'hr_case_notes'], () => load(true));

  if (loading) return <Card><Skeleton rows={5} /></Card>;

  const open = cases.filter(c => (OPEN_CASE_STATUSES as readonly string[]).includes(c.status));
  const unassigned = open.filter(c => !c.assignedTo).length;
  const mine = cases.filter(c => c.assignedTo === selfMemberId).length;

  /**
   * Time to first reply, over the cases that have had one.
   *
   * A real median from `first_response_at`, which a trigger stamps when
   * somebody other than the raiser writes the first note. Where nothing has
   * been answered yet the figure is absent rather than zero - the old screen's
   * "18 Hours" was a literal, and a fabricated average is the same lie with
   * arithmetic in front of it.
   */
  const responded = cases
    .filter(c => c.firstResponseAt)
    .map(c => (Date.parse(c.firstResponseAt!) - Date.parse(c.createdAt)) / 3_600_000)
    .sort((a, b) => a - b);
  const medianHours = responded.length
    ? responded[Math.floor(responded.length / 2)]
    : null;

  return (
    <div className="nm-enter space-y-4">
      <div className="grid grid-cols-2 divide-x divide-y divide-border rounded-xl border border-border bg-card sm:grid-cols-4 sm:divide-y-0">
        <Stat label="Open" value={open.length} />
        {isHr ? (
          <Stat label="Unassigned" value={unassigned} tone={unassigned ? 'warning' : 'default'} />
        ) : (
          <Stat label="Raised by you" value={cases.filter(c => c.raisedBy === selfMemberId).length} />
        )}
        <Stat label="Assigned to you" value={mine} />
        <Stat
          label="Median first reply"
          value={medianHours === null
            ? '—'
            : medianHours < 1 ? '<1h'
              : medianHours < 48 ? `${Math.round(medianHours)}h`
                : `${Math.round(medianHours / 24)}d`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {([
            ...(isHr ? [['open', 'Open queue'] as const] : []),
            ['mine', 'Mine'] as const,
            ['all', 'Everything'] as const,
          ]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setScope(id as typeof scope)}
              aria-pressed={scope === id}
              className={cn(
                'rounded-md border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
                scope === id
                  ? 'border-foreground/20 bg-accent text-foreground'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <Button size="sm" className="ml-auto h-8 text-[12.5px]" onClick={() => setRaising(true)}>
          <Plus className="mr-1.5 size-3.5" />
          Raise a case
        </Button>
      </div>

      <Card>
        <div className="px-4 pt-3.5">
          <Head title="Cases" count={cases.length} />
        </div>
        {cases.length ? (
          <div className="mt-2.5 px-2 pb-2">
            <THead columns="grid-cols-[minmax(0,2fr)_auto] md:grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_auto_auto]">
              <span className="hidden md:block">Ref</span>
              <span>Subject</span>
              <span className="hidden md:block">Assigned</span>
              <span className="hidden text-right md:block">Raised</span>
              <span className="text-right">Status</span>
            </THead>
            {cases.map(c => (
              <TRow
                key={c.id}
                columns="grid-cols-[minmax(0,2fr)_auto] md:grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_auto_auto]"
                onClick={() => setOpenId(c.id)}
                ariaLabel={`Open case ${c.reference}`}
              >
                <span className="hidden font-mono text-[11.5px] text-muted-foreground md:block">
                  {c.reference}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    {c.isRestricted ? (
                      <Lock className="size-3 shrink-0 text-muted-foreground" aria-label="Restricted" />
                    ) : null}
                    <span className="truncate text-[12.5px] font-medium text-foreground">
                      {c.subject}
                    </span>
                  </span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    {labelOf(CASE_CATEGORY_LABELS, c.category)}
                    {c.raiser?.profiles?.fullName ? ` · ${c.raiser.profiles.fullName}` : ''}
                  </span>
                </span>
                <span className="hidden truncate text-[12.5px] text-muted-foreground md:block">
                  {c.assignee?.profiles?.fullName ?? 'Unassigned'}
                </span>
                <span className="hidden text-right text-[11.5px] text-muted-foreground md:block">
                  {whenWord(c.createdAt.slice(0, 10))}
                </span>
                <span className="flex justify-end">
                  <Pill tone={
                    c.status === 'resolved' || c.status === 'closed' ? 'good'
                      : c.status === 'waiting_on_employee' ? 'quiet' : 'warn'
                  }>
                    {labelOf(CASE_STATUS_LABELS, c.status)}
                  </Pill>
                </span>
              </TRow>
            ))}
          </div>
        ) : (
          <Blank
            title={scope === 'mine' ? 'You have raised nothing' : 'No cases'}
            note="A case is anything you need HR for: a letter, a question about your pay, a concern about a colleague. It is stored, it is answered, and you see every reply."
            action={<Button size="sm" onClick={() => setRaising(true)}>Raise one</Button>}
          />
        )}
      </Card>

      {openId ? (
        <CaseDetail
          caseId={openId}
          isHr={isHr}
          selfMemberId={selfMemberId}
          people={people}
          onClose={() => setOpenId(null)}
          onChanged={() => load(true)}
        />
      ) : null}

      {raising ? (
        <CaseDialog
          open
          people={people}
          selfMemberId={selfMemberId}
          onClose={() => setRaising(false)}
          onSaved={() => { setRaising(false); load(); }}
        />
      ) : null}
    </div>
  );
}

function CaseDetail({
  caseId,
  isHr,
  selfMemberId,
  people,
  onClose,
  onChanged,
}: {
  caseId: string;
  isHr: boolean;
  selfMemberId: string;
  people: Person[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [item, setItem] = React.useState<HrCase | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [note, setNote] = React.useState('');
  const [internal, setInternal] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setItem(await getOne<HrCase>(`/api/hr/cases/${caseId}`));
    } catch (e: any) {
      toast.error(e.message || 'Could not open the case');
      onClose();
    } finally {
      setLoading(false);
    }
  }, [caseId, onClose]);

  React.useEffect(() => { load(); }, [load]);

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    try {
      await post(`/api/hr/cases/${caseId}/notes`, { body: note.trim(), is_internal: internal });
      setNote('');
      load();
      onChanged();
    } catch (err: any) {
      toast.error(err.message || 'Could not add the note');
    } finally {
      setBusy(false);
    }
  }

  async function update(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await patch(`/api/hr/cases/${caseId}`, body);
      load();
      onChanged();
    } catch (err: any) {
      toast.error(err.message || 'Could not update the case');
    } finally {
      setBusy(false);
    }
  }

  const canWork = item?.viewer?.isHr || item?.viewer?.isAssignee;

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {loading || !item ? (
          <Skeleton rows={5} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {item.isRestricted ? (
                  <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Restricted" />
                ) : null}
                <span className="min-w-0 truncate">{item.subject}</span>
              </DialogTitle>
              <DialogDescription>
                {item.reference} · {labelOf(CASE_CATEGORY_LABELS, item.category)} · raised{' '}
                {whenWord(item.createdAt.slice(0, 10))}
                {item.raiser?.profiles?.fullName ? ` by ${item.raiser.profiles.fullName}` : ''}
              </DialogDescription>
            </DialogHeader>

            {item.isRestricted ? (
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
                This case is restricted: only HR and the person who raised it can read it.
                {item.subjectMember?.profiles?.fullName
                  ? ` ${item.subjectMember.profiles.fullName} cannot.`
                  : ''}
              </p>
            ) : null}

            {item.description ? (
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
                {item.description}
              </p>
            ) : null}

            {canWork ? (
              <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-muted/30 p-2.5">
                <Select
                  value={item.status}
                  onValueChange={v => update({ status: v })}
                >
                  <SelectTrigger className="h-8 w-[190px] text-[12.5px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HR_CASE_STATUSES.map(s => (
                      <SelectItem key={s} value={s}>{CASE_STATUS_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {item.viewer?.isHr ? (
                  <Select
                    value={item.assignedTo ?? ''}
                    onValueChange={v => update({ assigned_to: v })}
                  >
                    <SelectTrigger className="h-8 w-[190px] text-[12.5px]">
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      {people.map(p => (
                        <SelectItem key={p.memberId} value={p.memberId}>{p.fullName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
              </div>
            ) : item.viewer?.isRaiser && item.status !== 'closed' ? (
              <Button
                size="sm" variant="outline" className="h-8 self-start text-[12.5px]"
                onClick={() => update({ status: 'closed' })}
                disabled={busy}
              >
                Withdraw this case
              </Button>
            ) : null}

            {/* The conversation. Internal notes are simply absent for anybody
                who may not read them - not greyed, not counted. */}
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                Conversation
              </h3>
              {item.notes?.length ? (
                <ul className="mt-2 space-y-2.5">
                  {item.notes.map(n => (
                    <li
                      key={n.id}
                      className={cn(
                        'rounded-lg border px-3 py-2',
                        n.isInternal
                          ? 'border-dashed border-border bg-muted/40'
                          : 'border-border bg-card',
                      )}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[12px] font-medium text-foreground">
                          {n.author?.profiles?.fullName ?? 'Somebody'}
                          {n.isInternal ? (
                            <span className="ml-1.5 text-[10.5px] font-normal uppercase tracking-[0.08em] text-muted-foreground">
                              internal
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {whenWord(n.createdAt.slice(0, 10))}
                        </span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
                        {n.body}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[12px] text-muted-foreground">Nothing yet.</p>
              )}

              <form onSubmit={addNote} className="mt-3 space-y-2">
                <Textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={2}
                  placeholder="Reply on this case"
                  className="text-[12.5px]"
                />
                <div className="flex items-center justify-between gap-3">
                  {item.viewer?.isHr ? (
                    <label className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                      <Switch checked={internal} onCheckedChange={setInternal} />
                      Internal — HR only
                    </label>
                  ) : <span />}
                  <Button type="submit" size="sm" className="h-7 text-[12px]" disabled={busy || !note.trim()}>
                    <Send className="mr-1.5 size-3" />
                    Reply
                  </Button>
                </div>
              </form>
            </section>

            {item.events?.length ? (
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                  History
                </h3>
                <ol className="mt-1.5 space-y-1">
                  {item.events.map(e => (
                    <li key={e.id} className="flex items-baseline justify-between gap-3 text-[11.5px]">
                      <span className="text-muted-foreground">
                        {e.kind === 'raised' ? 'Raised'
                          : e.kind === 'status' ? `${statusLabel(e.fromValue ?? '')} → ${statusLabel(e.toValue ?? '')}`
                            : e.kind === 'assignment' ? `Assigned to ${e.toValue ?? 'nobody'}`
                              : `${e.kind}: ${e.toValue}`}
                        {e.member?.profiles?.fullName ? ` · ${e.member.profiles.fullName}` : ''}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {whenWord(e.createdAt.slice(0, 10))}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
