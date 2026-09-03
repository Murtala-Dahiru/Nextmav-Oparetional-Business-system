'use client';

import * as React from 'react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  CHANGE_KINDS, EVENT_LABELS, EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS,
  EXIT_TYPES, EXIT_TYPE_LABELS, HR_CASE_CATEGORIES, CASE_CATEGORY_LABELS,
  RESTRICTED_BY_DEFAULT, COMP_CHANGE_REASONS, COMP_REASON_LABELS,
  PAY_PERIODS, PAY_PERIOD_LABELS, labelOf,
  type EmploymentEventKind, type HrCaseCategory,
} from '@/lib/hr';
import { LEAVE_TYPES, TICKET_PRIORITIES, statusLabel } from '@/lib/constants';

import { getOne, getList, post, patch, todayISO } from './data';
import type { Person, OrgDepartment, ChecklistTemplate, StarterTemplateOption } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The dialogues HR actually uses.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every one of these writes to an endpoint that validates the same rule again,
 * so a form here is a *convenience*, never a control. The dialogue offers what
 * the endpoint accepts; the endpoint refuses what the dialogue would not have
 * offered anyway, because a form is a suggestion and a stale tab is not.
 *
 * ── One field pattern ────────────────────────────────────────────────────
 *
 * `Field` below is the module's only labelled input wrapper. The HR module
 * this replaces declared one in `index.tsx` and a second, differently spaced
 * one in `attendance-tab.tsx`, which is how two dialogues in one module came
 * to have different label sizes.
 */

function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label className="text-[12.5px] font-medium">{label}</Label>
      {children}
      {hint && !error ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Recording an employment change                                            */
/* -------------------------------------------------------------------------- */

/**
 * A promotion, a transfer, a reporting change - or a note.
 *
 * The kind is chosen first and the form narrows to it, because "promoted" and
 * "transferred" touch overlapping columns and asking for all four every time
 * is how a transfer ends up recorded with a title nobody changed.
 *
 * Everything left blank means "leave this alone": the endpoint sends NULL and
 * `apply_employment_change()` coalesces. That is also why the effective date
 * defaults to today and is editable - a promotion agreed in March and
 * effective in April is one row with two dates, and payroll will ask.
 */
export function EmploymentChangeDialog({
  person,
  open,
  onClose,
  onSaved,
}: {
  person: Person;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = React.useState<EmploymentEventKind>('promoted');
  const [jobTitle, setJobTitle] = React.useState('');
  const [departmentId, setDepartmentId] = React.useState('');
  const [managerId, setManagerId] = React.useState('');
  const [employmentType, setEmploymentType] = React.useState('');
  const [effectiveOn, setEffectiveOn] = React.useState(todayISO());
  const [reason, setReason] = React.useState('');
  const [note, setNote] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const [departments, setDepartments] = React.useState<OrgDepartment[]>([]);
  const [people, setPeople] = React.useState<Person[]>([]);

  React.useEffect(() => {
    if (!open) return;
    getOne<{ departments: OrgDepartment[]; people: Person[] }>('/api/hr/org')
      .then(d => { setDepartments(d.departments ?? []); setPeople(d.people ?? []); })
      .catch(() => undefined);
  }, [open]);

  const shows = {
    title: ['promoted', 'title_change'].includes(kind),
    department: ['transferred'].includes(kind),
    manager: ['transferred', 'manager_change'].includes(kind),
    type: ['employment_type_change'].includes(kind),
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await patch(`/api/hr/people/${person.memberId}`, {
        kind,
        effective_on: effectiveOn,
        job_title: shows.title ? jobTitle.trim() || undefined : undefined,
        department_id: shows.department ? departmentId || undefined : undefined,
        manager_id: shows.manager ? managerId || undefined : undefined,
        employment_type: shows.type ? employmentType || undefined : undefined,
        reason: reason.trim(),
        note: note.trim(),
      });
      toast.success(`${labelOf(EVENT_LABELS, kind)} recorded`);
      onSaved();
    } catch (err: any) {
      /* The function's own refusals are written for a person to read - "That
         reporting line loops back on itself", "Nothing about this employment
         would change" - so they are shown rather than replaced. */
      toast.error(err.message || 'Could not record the change');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record a change</DialogTitle>
          <DialogDescription>
            For {person.fullName}. This writes both the employment record and its
            history in one step, so what changed and when is never lost.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="What happened">
              <Select value={kind} onValueChange={v => setKind(v as EmploymentEventKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CHANGE_KINDS.map(k => (
                    <SelectItem key={k} value={k}>{EVENT_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Effective from"
              hint="Not the date you are typing this. Payroll reads it."
            >
              <Input
                type="date" value={effectiveOn}
                onChange={e => setEffectiveOn(e.target.value)}
              />
            </Field>
          </div>

          {shows.title ? (
            <Field label="New job title" hint={person.jobTitle ? `Currently ${person.jobTitle}` : undefined}>
              <Input
                value={jobTitle}
                onChange={e => setJobTitle(e.target.value)}
                placeholder="Senior Systems Engineer"
              />
            </Field>
          ) : null}

          {shows.department ? (
            <Field label="New department">
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger><SelectValue placeholder="Choose a department" /></SelectTrigger>
                <SelectContent>
                  {departments.map(d => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {shows.manager ? (
            <Field label="New manager" hint="Somebody cannot report to themselves, or to anyone who reports to them.">
              <Select value={managerId} onValueChange={setManagerId}>
                <SelectTrigger><SelectValue placeholder="Choose a manager" /></SelectTrigger>
                <SelectContent>
                  {people
                    .filter(m => m.memberId !== person.memberId)
                    .map(m => (
                      <SelectItem key={m.memberId} value={m.memberId}>
                        {m.fullName}{m.jobTitle ? ` · ${m.jobTitle}` : ''}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {shows.type ? (
            <Field label="New employment type">
              <Select value={employmentType} onValueChange={setEmploymentType}>
                <SelectTrigger><SelectValue placeholder="Choose a type" /></SelectTrigger>
                <SelectContent>
                  {EMPLOYMENT_TYPES.map(t => (
                    <SelectItem key={t} value={t}>{EMPLOYMENT_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          <Field
            label="Reason"
            hint="Shown to the person in their notification, and on their record."
          >
            <Input
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Promotion following the Q1 review"
            />
          </Field>

          <Field label="Note" hint="Optional. Kept on the record, not sent to them.">
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Recording…' : 'Record change'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Compensation                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A pay decision, which is a new record rather than an edit.
 *
 * The previous one is closed by trigger the day before this one starts, so
 * "what was she earning in March" stays answerable. The dialogue says so
 * plainly, because a form that looks like an edit and behaves like an append
 * is a form people use wrongly once.
 */
export function CompensationDialog({
  person,
  currentAmount,
  currency,
  open,
  onClose,
  onSaved,
}: {
  person: Person;
  currentAmount?: number | null;
  currency: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = React.useState('');
  const [payPeriod, setPayPeriod] = React.useState('monthly');
  const [reason, setReason] = React.useState('merit');
  const [effectiveFrom, setEffectiveFrom] = React.useState(todayISO());
  const [note, setNote] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) {
      toast.error('Enter a base amount');
      return;
    }
    setSaving(true);
    try {
      await post('/api/hr/compensation', {
        member_id: person.memberId,
        base_amount: value,
        pay_period: payPeriod,
        change_reason: reason,
        effective_from: effectiveFrom,
        currency,
        note: note.trim(),
      });
      toast.success('Compensation recorded');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Could not record the compensation');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record compensation</DialogTitle>
          <DialogDescription>
            For {person.fullName}. This adds a new record from the date below and
            closes the one before it; nothing already paid changes.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Base amount"
              hint={currentAmount ? `Currently ${currentAmount.toLocaleString()}` : undefined}
            >
              <Input
                type="number" min={0} step="any" inputMode="decimal"
                value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="450000"
              />
            </Field>
            <Field label="Per">
              <Select value={payPeriod} onValueChange={setPayPeriod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAY_PERIODS.map(p => (
                    <SelectItem key={p} value={p}>
                      {PAY_PERIOD_LABELS[p].replace('per ', '')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reason">
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMP_CHANGE_REASONS.map(r => (
                    <SelectItem key={r} value={r}>{COMP_REASON_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Effective from">
              <Input
                type="date" value={effectiveFrom}
                onChange={e => setEffectiveFrom(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Note" hint="Optional context, kept on the record.">
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Recording…' : 'Record'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Leave                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Requesting leave.
 *
 * The type list is the organisation's `leave_policy.types`, not the whole enum:
 * offering `bereavement` where the company has not enabled it produces a 422
 * the person cannot act on. The endpoint checks the same policy again, because
 * the form is a suggestion and a stale tab is not.
 */
export function LeaveRequestDialog({
  open,
  onClose,
  onSaved,
  offeredTypes,
  allowHalfDay,
  people,
  canFileForOthers,
  selfMemberId,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  offeredTypes: string[];
  allowHalfDay: boolean;
  people: Person[];
  canFileForOthers: boolean;
  selfMemberId: string;
}) {
  const [memberId, setMemberId] = React.useState(selfMemberId);
  const [type, setType] = React.useState(offeredTypes[0] ?? 'vacation');
  const [startDate, setStartDate] = React.useState(todayISO());
  const [endDate, setEndDate] = React.useState(todayISO());
  const [isHalfDay, setIsHalfDay] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  /* A start date later than the end is the commonest mistake in this form, and
     moving the end with the start is what stops people making it. */
  React.useEffect(() => {
    if (endDate < startDate) setEndDate(startDate);
  }, [startDate, endDate]);

  const span = React.useMemo(() => {
    if (isHalfDay) return 0.5;
    const d = Math.round(
      (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000,
    ) + 1;
    return Number.isFinite(d) && d > 0 ? d : 0;
  }, [startDate, endDate, isHalfDay]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await post('/api/hr/leave', {
        member_id: canFileForOthers && memberId !== selfMemberId ? memberId : undefined,
        type,
        start_date: startDate,
        end_date: endDate,
        is_half_day: isHalfDay,
        reason: reason.trim(),
      });
      toast.success('Leave requested');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Could not file the request');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request leave</DialogTitle>
          <DialogDescription>
            It goes to whoever approves for you. You cannot approve your own.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          {canFileForOthers ? (
            <Field label="For" hint="HR may file on somebody's behalf, and is exempt from the notice period.">
              <Select value={memberId} onValueChange={setMemberId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={selfMemberId}>Myself</SelectItem>
                  {people
                    .filter(p => p.memberId !== selfMemberId)
                    .map(p => (
                      <SelectItem key={p.memberId} value={p.memberId}>{p.fullName}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          <Field label="Type">
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {offeredTypes.map(t => (
                  <SelectItem key={t} value={t}>{statusLabel(t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From">
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </Field>
            <Field label="To">
              <Input
                type="date" value={endDate} min={startDate}
                onChange={e => setEndDate(e.target.value)}
                disabled={isHalfDay}
              />
            </Field>
          </div>

          {allowHalfDay ? (
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div>
                <p className="text-[12.5px] font-medium">Half day</p>
                <p className="text-[11px] text-muted-foreground">Counts as half against the balance.</p>
              </div>
              <Switch
                checked={isHalfDay}
                onCheckedChange={v => { setIsHalfDay(v); if (v) setEndDate(startDate); }}
              />
            </div>
          ) : null}

          <Field label="Reason" hint={span ? `${span} day${span === 1 ? '' : 's'} requested.` : undefined}>
            <Textarea
              value={reason} onChange={e => setReason(e.target.value)} rows={2}
              placeholder="Optional, but it helps whoever decides."
            />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Filing…' : 'Request leave'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Setting somebody's entitlement for a year. */
export function LeaveBalanceDialog({
  open,
  onClose,
  onSaved,
  people,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  people: Person[];
}) {
  const [memberId, setMemberId] = React.useState('');
  const [type, setType] = React.useState<string>('vacation');
  const [entitled, setEntitled] = React.useState('20');
  const [carried, setCarried] = React.useState('0');
  const [used, setUsed] = React.useState('0');
  const [saving, setSaving] = React.useState(false);
  const year = Number(todayISO().slice(0, 4));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!memberId) { toast.error('Choose an employee'); return; }
    setSaving(true);
    try {
      await post('/api/hr/leave/balances', {
        member_id: memberId, type, year,
        entitled_days: Number(entitled) || 0,
        carried_days: Number(carried) || 0,
        used_days: Number(used) || 0,
      });
      toast.success('Entitlement saved');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Could not save the entitlement');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set an entitlement</DialogTitle>
          <DialogDescription>
            One record per person, per type, per year. Saving again updates it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <Field label="Employee">
            <Select value={memberId} onValueChange={setMemberId}>
              <SelectTrigger><SelectValue placeholder="Choose somebody" /></SelectTrigger>
              <SelectContent>
                {people.map(p => (
                  <SelectItem key={p.memberId} value={p.memberId}>{p.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Leave type">
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEAVE_TYPES.map(t => (
                  <SelectItem key={t} value={t}>{statusLabel(t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Entitled">
              <Input type="number" min={0} step="0.5" value={entitled} onChange={e => setEntitled(e.target.value)} />
            </Field>
            <Field label="Carried over">
              <Input type="number" min={0} step="0.5" value={carried} onChange={e => setCarried(e.target.value)} />
            </Field>
            <Field label="Already used">
              <Input type="number" min={0} step="0.5" value={used} onChange={e => setUsed(e.target.value)} />
            </Field>
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Days used is the authoritative figure and is not recomputed from approved
            requests. Where the two disagree the balance list says so, because a
            correction that gets silently overwritten is a dispute.
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  HR cases                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Raising a case.
 *
 * The dialogue this replaces said "Private, confidential case submission
 * directly to the HR Management team" and pushed onto a `useState` array.
 * Somebody could have typed a grievance into it.
 *
 * `is_restricted` starts from the category, because a default that has to be
 * remembered is one that gets forgotten in the case where forgetting matters
 * most - and the toggle explains what it does rather than being a switch
 * labelled "Restricted".
 */
export function CaseDialog({
  open,
  onClose,
  onSaved,
  people,
  selfMemberId,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  people: Person[];
  selfMemberId: string;
}) {
  const [category, setCategory] = React.useState<HrCaseCategory>('inquiry');
  const [subject, setSubject] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [priority, setPriority] = React.useState('medium');
  const [aboutSomebodyElse, setAboutSomebodyElse] = React.useState(false);
  const [memberId, setMemberId] = React.useState('');
  const [restricted, setRestricted] = React.useState(false);
  const [touchedRestriction, setTouchedRestriction] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  /* The default follows the category until a person overrides it, after which
     it is theirs - changing the category should not undo a deliberate choice. */
  React.useEffect(() => {
    if (!touchedRestriction) {
      setRestricted((RESTRICTED_BY_DEFAULT as readonly string[]).includes(category));
    }
  }, [category, touchedRestriction]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim()) { toast.error('Give the case a subject'); return; }
    setSaving(true);
    try {
      await post('/api/hr/cases', {
        category,
        subject: subject.trim(),
        description: description.trim(),
        priority,
        member_id: aboutSomebodyElse && memberId ? memberId : selfMemberId,
        is_restricted: restricted,
      });
      toast.success('Case raised');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Could not raise the case');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Raise an HR case</DialogTitle>
          <DialogDescription>
            It reaches HR, and it is stored. You will see every reply on it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category">
              <Select value={category} onValueChange={v => setCategory(v as HrCaseCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HR_CASE_CATEGORIES.map(c => (
                    <SelectItem key={c} value={c}>{CASE_CATEGORY_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Priority">
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TICKET_PRIORITIES.map(p => (
                    <SelectItem key={p} value={p}>{statusLabel(p)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Subject">
            <Input
              value={subject} onChange={e => setSubject(e.target.value)}
              placeholder="Employment letter for a visa application"
            />
          </Field>

          <Field label="Details">
            <Textarea
              value={description} onChange={e => setDescription(e.target.value)} rows={4}
              placeholder="What has happened, and what you need."
            />
          </Field>

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <div className="pr-3">
              <p className="text-[12.5px] font-medium">This is about somebody else</p>
              <p className="text-[11px] text-muted-foreground">
                Reporting an incident or raising a concern about a colleague.
              </p>
            </div>
            <Switch checked={aboutSomebodyElse} onCheckedChange={setAboutSomebodyElse} />
          </div>

          {aboutSomebodyElse ? (
            <Field label="Who it concerns">
              <Select value={memberId} onValueChange={setMemberId}>
                <SelectTrigger><SelectValue placeholder="Choose somebody" /></SelectTrigger>
                <SelectContent>
                  {people
                    .filter(p => p.memberId !== selfMemberId)
                    .map(p => (
                      <SelectItem key={p.memberId} value={p.memberId}>{p.fullName}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <div className="pr-3">
              <p className="text-[12.5px] font-medium">Keep this to HR only</p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {restricted
                  ? 'Only HR and you can read this case. The person it concerns cannot.'
                  : 'HR, you, and the person it concerns can read this case.'}
              </p>
            </div>
            <Switch
              checked={restricted}
              onCheckedChange={v => { setRestricted(v); setTouchedRestriction(true); }}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Raising…' : 'Raise case'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Exits                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Recording an exit.
 *
 * The dialogue is explicit about the thing it does *not* do: closing the
 * account is the identity lifecycle's, and an HR checklist that could
 * terminate somebody as a side effect of a form being submitted would be a
 * second door into the most consequential action in the product.
 */
export function ExitDialog({
  person,
  open,
  onClose,
  onSaved,
}: {
  person: Person;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [exitType, setExitType] = React.useState('resignation');
  const [notifiedOn, setNotifiedOn] = React.useState(todayISO());
  const [lastWorkingDay, setLastWorkingDay] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [rehirable, setRehirable] = React.useState(true);
  const [templateId, setTemplateId] = React.useState('');
  const [templates, setTemplates] = React.useState<ChecklistTemplate[]>([]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    getOne<{ templates: ChecklistTemplate[] }>('/api/hr/templates?kind=offboarding')
      .then(d => setTemplates(d.templates ?? []))
      .catch(() => setTemplates([]));
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!lastWorkingDay) { toast.error('A last working day is required'); return; }
    setSaving(true);
    try {
      await post('/api/hr/exits', {
        member_id: person.memberId,
        exit_type: exitType,
        notified_on: notifiedOn,
        last_working_day: lastWorkingDay,
        reason: reason.trim(),
        is_rehirable: rehirable,
        template_id: templateId || undefined,
      });
      toast.success('Exit recorded');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Could not record the exit');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record an exit</DialogTitle>
          <DialogDescription>
            For {person.fullName}. They move to notice and stay in the directory
            until their last day, because the handover needs them there.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type">
              <Select value={exitType} onValueChange={setExitType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXIT_TYPES.map(t => (
                    <SelectItem key={t} value={t}>{EXIT_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Notified on">
              <Input type="date" value={notifiedOn} onChange={e => setNotifiedOn(e.target.value)} />
            </Field>
          </div>

          <Field label="Last working day">
            <Input
              type="date" value={lastWorkingDay} min={notifiedOn}
              onChange={e => setLastWorkingDay(e.target.value)}
            />
          </Field>

          <Field label="Reason" hint="HR and administrators only. Not visible to the person.">
            <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} />
          </Field>

          <Field
            label="Offboarding checklist"
            hint="Anchored on the last working day, so a step due on day 0 means their last day."
          >
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder={templates.length ? 'None' : 'No offboarding templates yet'} />
              </SelectTrigger>
              <SelectContent>
                {templates.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <div>
              <p className="text-[12.5px] font-medium">Would rehire</p>
              <p className="text-[11px] text-muted-foreground">HR only.</p>
            </div>
            <Switch checked={rehirable} onCheckedChange={setRehirable} />
          </div>

          <p className="rounded-lg border border-warning/30 bg-warning/[0.07] px-3 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
            This does not close their account. Suspending or terminating access is
            done from the employee record by an administrator, and stays the only
            way to do it.
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Recording…' : 'Record exit'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Onboarding                                                                */
/* -------------------------------------------------------------------------- */

/** Starting somebody's onboarding from a template. */
export function StartJourneyDialog({
  open,
  kind,
  onClose,
  onSaved,
  people,
}: {
  open: boolean;
  kind: 'onboarding' | 'offboarding';
  onClose: () => void;
  onSaved: () => void;
  people: Person[];
}) {
  const [memberId, setMemberId] = React.useState('');
  const [templateId, setTemplateId] = React.useState('');
  const [anchorDate, setAnchorDate] = React.useState(todayISO());
  const [templates, setTemplates] = React.useState<ChecklistTemplate[]>([]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    getOne<{ templates: ChecklistTemplate[] }>(`/api/hr/templates?kind=${kind}`)
      .then(d => setTemplates(d.templates ?? []))
      .catch(() => setTemplates([]));
  }, [open, kind]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!memberId) { toast.error('Choose somebody'); return; }
    setSaving(true);
    try {
      await post('/api/hr/checklists', {
        member_id: memberId,
        kind,
        template_id: templateId || undefined,
        anchor_date: anchorDate,
      });
      toast.success(kind === 'onboarding' ? 'Onboarding started' : 'Offboarding started');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Could not start the checklist');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start {kind}</DialogTitle>
          <DialogDescription>
            Every step becomes a to-do in the right person&rsquo;s My Work, and
            ticking it in either place ticks it in both.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <Field label="Employee">
            <Select value={memberId} onValueChange={setMemberId}>
              <SelectTrigger><SelectValue placeholder="Choose somebody" /></SelectTrigger>
              <SelectContent>
                {people.map(p => (
                  <SelectItem key={p.memberId} value={p.memberId}>
                    {p.fullName}{p.jobTitle ? ` · ${p.jobTitle}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="Template"
            hint={templates.length
              ? 'Its steps are copied now, so editing the template later will not change this checklist.'
              : 'No templates yet. Starting without one creates an empty checklist you fill in by hand.'}
          >
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                {templates.map(t => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} ({t.items?.length ?? 0} steps)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label={kind === 'onboarding' ? 'First day' : 'Last day'}
            hint="Every step's due date is counted from here, forwards or backwards."
          >
            <Input type="date" value={anchorDate} onChange={e => setAnchorDate(e.target.value)} />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Starting…' : 'Start'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Creating a checklist template, from a starter or from nothing. */
export function TemplateDialog({
  open,
  onClose,
  onSaved,
  starters,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  starters: StarterTemplateOption[];
}) {
  const [starter, setStarter] = React.useState('');
  const [name, setName] = React.useState('');
  const [kind, setKind] = React.useState<'onboarding' | 'offboarding'>('onboarding');
  const [saving, setSaving] = React.useState(false);

  const chosen = starters.find(s => s.key === starter);

  React.useEffect(() => {
    if (chosen) { setName(chosen.name); setKind(chosen.kind); }
  }, [chosen]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast.error('Give the template a name'); return; }
    setSaving(true);
    try {
      await post('/api/hr/templates', {
        starter: starter || undefined,
        name: name.trim(),
        kind,
      });
      toast.success('Template created');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Could not create the template');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New checklist template</DialogTitle>
          <DialogDescription>
            What this company does when somebody joins or leaves. Nothing is
            pre-installed: a template you did not write is a stranger&rsquo;s
            opinion presented as your policy.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <Field
            label="Start from"
            hint={chosen ? `${chosen.itemCount} steps, all editable afterwards.` : undefined}
          >
            <Select value={starter} onValueChange={setStarter}>
              <SelectTrigger><SelectValue placeholder="An empty template" /></SelectTrigger>
              <SelectContent>
                {starters.map(s => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.name} ({s.itemCount} steps)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Name">
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Standard onboarding" />
          </Field>

          {!starter ? (
            <Field label="Kind">
              <Select value={kind} onValueChange={v => setKind(v as 'onboarding' | 'offboarding')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="onboarding">Onboarding</SelectItem>
                  <SelectItem value="offboarding">Offboarding</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {chosen ? (
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              {chosen.description}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
