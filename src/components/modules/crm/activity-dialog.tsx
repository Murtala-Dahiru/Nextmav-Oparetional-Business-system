'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Loader2, Bell, BellOff } from 'lucide-react';

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { post, patch, today } from './data';
import { LinkPicker, linkBody, type LinkValue } from './link-picker';
import { ACTIVITY_TYPES, type CrmActivity } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Recording what happened, and what happens next
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── One dialog, because it is one moment ─────────────────────────────────
 *
 * A salesperson finishes a call. They have two things to write down and they
 * are thinking about both at once: what was said, and when to call back.
 * Splitting those into two screens is how the second one never gets written -
 * which is why every CRM in the world has a follow-up field that is empty.
 *
 * So logging an activity offers the next step in the same dialog, folded away
 * until it is wanted. Two rows are written: the history, and the thing owed.
 *
 * ── Why a follow-up is another activity ──────────────────────────────────
 *
 * `crm_activities` with a `due_at` and no `completed_at` *is* a follow-up. The
 * alternative - a `next_action` column on leads, deals, contacts and companies
 * - is four columns holding one idea, none of which can be listed in date
 * order across the four, and all of which are overwritten the moment there is
 * a second thing to do. See migration 0028.
 *
 * ── The time of day ──────────────────────────────────────────────────────
 *
 * A follow-up is owed on a *day*; `due_at` is an instant. It is stored at 9am
 * local, which is the start of the working day rather than midnight, so a
 * reminder set for "the morning it is due" and the date itself agree, and so
 * a follow-up never lands in yesterday for a reader in a different timezone
 * from the one who wrote it.
 */

const REMIND_PRESETS = [
  { value: 'morning', label: 'That morning, 9:00' },
  { value: 'evening-before', label: 'The evening before, 17:00' },
  { value: 'week-before', label: 'A week before, 9:00' },
  { value: 'custom', label: 'A time I choose' },
] as const;

type Preset = (typeof REMIND_PRESETS)[number]['value'];

/** A `YYYY-MM-DD` at 9am in the reader's own calendar, as an instant. */
function dueInstant(day: string): string {
  return new Date(`${day}T09:00:00`).toISOString();
}

function remindInstant(day: string, preset: Preset, custom: string): string | null {
  if (preset === 'custom') return custom ? new Date(custom).toISOString() : null;
  const due = new Date(`${day}T09:00:00`);
  if (Number.isNaN(due.getTime())) return null;

  if (preset === 'morning') return due.toISOString();
  if (preset === 'evening-before') {
    const d = new Date(due);
    d.setDate(d.getDate() - 1);
    d.setHours(17, 0, 0, 0);
    return d.toISOString();
  }
  const d = new Date(due);
  d.setDate(d.getDate() - 7);
  return d.toISOString();
}

/** `datetime-local` wants local wall-clock, not an ISO instant. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Field({
  label, hint, children, className,
}: {
  label: string; hint?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label className="text-[12.5px] font-medium text-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[11.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export interface ActivityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `log` records history; `followup` schedules work. */
  mode: 'log' | 'followup';
  /** Pre-attached record, when opened from a deal, a lead or a customer. */
  link?: LinkValue | null;
  /** An existing follow-up being rescheduled or edited. */
  editing?: CrmActivity | null;
  onSaved: () => void;
}

export function ActivityDialog({
  open, onOpenChange, mode, link = null, editing = null, onSaved,
}: ActivityDialogProps) {
  const scheduling = mode === 'followup';

  const [type, setType] = React.useState(scheduling ? 'followup' : 'call');
  const [subject, setSubject] = React.useState('');
  const [body, setBody] = React.useState('');
  const [about, setAbout] = React.useState<LinkValue | null>(link);
  const [saving, setSaving] = React.useState(false);

  /* The follow-up half, used by both modes. */
  const [withNext, setWithNext] = React.useState(scheduling);
  const [nextSubject, setNextSubject] = React.useState('');
  const [dueOn, setDueOn] = React.useState(today());
  const [remind, setRemind] = React.useState(false);
  const [preset, setPreset] = React.useState<Preset>('morning');
  const [custom, setCustom] = React.useState('');

  /**
   * Reset when the dialog opens, not when it closes.
   *
   * Resetting on close runs while the dialog is still animating out, so the
   * fields visibly empty themselves in front of the user. It also loses the
   * values before a failed save can be retried.
   */
  React.useEffect(() => {
    if (!open) return;

    if (editing) {
      setType(editing.activityType);
      setSubject(editing.subject);
      setBody(editing.body);
      setWithNext(false);
      setDueOn(editing.dueAt ? new Date(editing.dueAt).toISOString().slice(0, 10) : today());
      setRemind(Boolean(editing.remindAt));
      if (editing.remindAt) { setPreset('custom'); setCustom(toLocalInput(editing.remindAt)); }
      setAbout(
        editing.company ? { kind: 'company', id: editing.company.id, label: editing.company.name }
          : editing.deal ? { kind: 'deal', id: editing.deal.id, label: editing.deal.name }
            : editing.contact
              ? { kind: 'contact', id: editing.contact.id, label: `${editing.contact.firstName} ${editing.contact.lastName}`.trim() }
              : editing.lead
                ? { kind: 'lead', id: editing.lead.id, label: `${editing.lead.firstName} ${editing.lead.lastName}`.trim() }
                : null,
      );
      return;
    }

    setType(scheduling ? 'followup' : 'call');
    setSubject('');
    setBody('');
    setAbout(link);
    setWithNext(scheduling);
    setNextSubject('');
    setDueOn(today());
    setRemind(false);
    setPreset('morning');
    setCustom('');
  }, [open, editing, link, scheduling]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim()) { toast.error('Give this a subject'); return; }
    if (!about) { toast.error('Choose the customer, contact or deal this is about'); return; }
    if (scheduling && !dueOn) { toast.error('Choose a date for the follow-up'); return; }

    setSaving(true);
    try {
      const links = linkBody(about);

      if (editing) {
        await patch(`/api/crm/activities/${editing.id}`, {
          activityType: type,
          subject: subject.trim(),
          body: body.trim(),
          ...links,
          dueAt: editing.dueAt || scheduling ? dueInstant(dueOn) : null,
          remindAt: remind ? remindInstant(dueOn, preset, custom) : null,
        });
        toast.success('Saved');
      } else if (scheduling) {
        await post('/api/crm/activities', {
          activityType: type,
          subject: subject.trim(),
          body: body.trim(),
          ...links,
          dueAt: dueInstant(dueOn),
          remindAt: remind ? remindInstant(dueOn, preset, custom) : null,
        });
        toast.success('Follow-up scheduled');
      } else {
        /**
         * The history first, then the thing owed.
         *
         * In that order deliberately: if the second write fails, what happened
         * is still recorded, and the user is told the follow-up did not save
         * rather than losing the call as well.
         */
        await post('/api/crm/activities', {
          activityType: type,
          subject: subject.trim(),
          body: body.trim(),
          ...links,
          completedAt: new Date().toISOString(),
        });

        if (withNext && nextSubject.trim()) {
          await post('/api/crm/activities', {
            activityType: 'followup',
            subject: nextSubject.trim(),
            body: '',
            ...links,
            dueAt: dueInstant(dueOn),
            remindAt: remind ? remindInstant(dueOn, preset, custom) : null,
          });
          toast.success('Logged, and the follow-up is scheduled');
        } else {
          toast.success('Logged');
        }
      }

      onOpenChange(false);
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'That could not be saved');
    } finally {
      setSaving(false);
    }
  };

  const heading = editing
    ? (editing.dueAt ? 'Edit follow-up' : 'Edit activity')
    : scheduling ? 'Schedule follow-up' : 'Log activity';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-[15px]">{heading}</DialogTitle>
          <DialogDescription className="text-[12.5px]">
            {scheduling
              ? 'It appears on CRM Home and on the record it is about.'
              : 'What happened, and who it was with.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={save} className="flex flex-col gap-4 px-5 py-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[130px_1fr]">
            <Field label="Type">
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTIVITY_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value} className="text-[13px]">{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label={scheduling ? 'Next action' : 'Subject'}>
              <Input
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder={scheduling ? 'Follow up with Ahmed on the proposal' : 'Discovery call'}
                className="h-9 text-[13px]"
                autoFocus
              />
            </Field>
          </div>

          <Field label="About">
            <LinkPicker value={about} onChange={setAbout} allowNone={false} placeholder="Customer, contact or deal" />
          </Field>

          <Field label={scheduling ? 'Notes' : 'What happened'}>
            <Textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={3}
              placeholder={scheduling ? 'Anything worth remembering before you call' : 'Outcome, decisions, anything owed'}
              className="resize-none text-[13px]"
            />
          </Field>

          {/* ── The next step ───────────────────────────────────────────────
              In log mode this is a fold; in follow-up mode it is the point of
              the dialog and is always open. */}
          {!scheduling && !editing && (
            <label className="flex cursor-pointer items-center justify-between rounded-md border border-border px-3 py-2.5">
              <span className="text-[12.5px] font-medium">Schedule the next step</span>
              <Switch checked={withNext} onCheckedChange={setWithNext} />
            </label>
          )}

          {(withNext || (editing && editing.dueAt)) && (
            <div className="space-y-4 rounded-md border border-border bg-muted/40 p-3.5">
              {!scheduling && !editing && (
                <Field label="Next action">
                  <Input
                    value={nextSubject}
                    onChange={e => setNextSubject(e.target.value)}
                    placeholder="Send the revised quote"
                    className="h-9 bg-card text-[13px]"
                  />
                </Field>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Follow up on">
                  <Input
                    type="date"
                    value={dueOn}
                    onChange={e => setDueOn(e.target.value)}
                    className="h-9 bg-card text-[13px]"
                  />
                </Field>

                <Field label="Reminder">
                  <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-card px-3">
                    {remind
                      ? <Bell className="size-3.5 text-[var(--chart-1)]" />
                      : <BellOff className="size-3.5 text-muted-foreground" />}
                    <span className="flex-1 text-[12.5px]">{remind ? 'On' : 'Off'}</span>
                    <Switch checked={remind} onCheckedChange={setRemind} />
                  </label>
                </Field>
              </div>

              {remind && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Remind me">
                    <Select value={preset} onValueChange={v => setPreset(v as Preset)}>
                      <SelectTrigger className="h-9 bg-card text-[13px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {REMIND_PRESETS.map(p => (
                          <SelectItem key={p.value} value={p.value} className="text-[13px]">{p.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  {preset === 'custom' && (
                    <Field label="At">
                      <Input
                        type="datetime-local"
                        value={custom}
                        onChange={e => setCustom(e.target.value)}
                        className="h-9 bg-card text-[13px]"
                      />
                    </Field>
                  )}
                </div>
              )}

              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                The date is when it is owed. The reminder is when you are told - they are
                deliberately different, so a follow-up due Friday can reach you on Thursday
                evening.
              </p>
            </div>
          )}

          <DialogFooter className="gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="gap-1.5">
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              {editing ? 'Save' : scheduling ? 'Schedule' : 'Log it'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
