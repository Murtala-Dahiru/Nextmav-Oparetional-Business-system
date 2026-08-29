'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Loader2, Trophy, XCircle } from 'lucide-react';

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { activeCurrencyCode } from '@/lib/format';
import { LEAD_STATUSES, DEAL_STAGES } from '@/lib/constants';

import { post, patch, getList, exact } from './data';
import { LinkPicker, type LinkValue } from './link-picker';
import {
  STAGE_LABELS, LEAD_STATUS_LABELS, SOURCE_OPTIONS, LOST_REASONS,
  type Lead, type Contact, type Company, type Deal,
} from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The record forms
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What changed, beyond the layout ──────────────────────────────────────
 *
 *   · **Owner is a field.** Every one of these records has an `owner_id` that
 *     the API defaults to whoever created it, and no form had ever offered it.
 *     So a lead could not be handed to a colleague from the screen that shows
 *     leads, and the assignment notification 0028 adds would have had almost
 *     nothing to fire on.
 *
 *   · **A deal can be lost.** `lost_reason` has been a column since 0003 and
 *     unreachable from the product for as long. It is asked for at the moment
 *     it is known - when the stage moves to Closed Lost - rather than being a
 *     field somebody fills in later, which is to say never.
 *
 *   · **The company link is a search, not a hundred-row dropdown.** See
 *     `link-picker.tsx` for what that was doing wrong.
 *
 *   · **Currency is the organisation's.** The company form's revenue field was
 *     labelled "Annual Revenue ($)" in a product that resolves currency per
 *     workspace, and the same figure was rendered in naira two columns away.
 *
 * ── On validation ────────────────────────────────────────────────────────
 *
 * These post plain objects and let the server's schema decide. The schemas in
 * `lib/validations` are the source of truth, they are checked against the
 * tables by `npm run schema:check`, and a second copy of the rules in the
 * browser is a second copy to drift. What the client does is stop the obvious
 * empty submit, so the round trip is not spent saying "name is required".
 */

/* -------------------------------------------------------------------------- */
/*  Shared pieces                                                             */
/* -------------------------------------------------------------------------- */

function Field({
  label, hint, error, children, className,
}: {
  label: string; hint?: string; error?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <Label className="text-[12.5px] font-medium text-foreground">{label}</Label>
      {children}
      {error
        ? <p className="text-[11.5px] text-destructive">{error}</p>
        : hint ? <p className="text-[11.5px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const input = 'h-9 text-[13px]';

export interface OwnerOption { memberId: string; fullName: string }

/**
 * The people a record can be assigned to.
 *
 * `/api/directory` rather than `/api/admin/users`, for the reason that
 * endpoint's own notes give at length: the admin one is held by two roles, so
 * every picker in the product built on it rendered empty for everybody else.
 */
export function useOwners(enabled: boolean): OwnerOption[] {
  const [owners, setOwners] = React.useState<OwnerOption[]>([]);

  React.useEffect(() => {
    if (!enabled || owners.length) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getList<any>('/api/directory?pageSize=200');
        if (cancelled) return;
        setOwners(res.data.map(m => ({ memberId: m.memberId, fullName: m.fullName })));
      } catch {
        // An owner picker that cannot load leaves the record with its default
        // owner, which is whoever is creating it. Nothing is blocked.
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, owners.length]);

  return owners;
}

function OwnerField({
  owners, value, onChange,
}: {
  owners: OwnerOption[]; value: string | undefined; onChange: (v: string | undefined) => void;
}) {
  return (
    <Field label="Owner" hint={owners.length ? undefined : 'Defaults to you'}>
      <Select
        value={value ?? '__me'}
        onValueChange={v => onChange(v === '__me' ? undefined : v)}
      >
        <SelectTrigger className={input}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__me" className="text-[13px]">Me</SelectItem>
          {owners.map(o => (
            <SelectItem key={o.memberId} value={o.memberId} className="text-[13px]">
              {o.fullName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function Shell({
  open, onOpenChange, title, description, children, onSubmit, saving, submitLabel,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  children: React.ReactNode;
  onSubmit: (e: React.FormEvent) => void;
  saving: boolean;
  submitLabel: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-[15px]">{title}</DialogTitle>
          <DialogDescription className="text-[12.5px]">{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4 px-5 py-4">
          {children}
          <DialogFooter className="gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving} className="gap-1.5">
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Number out of an input that may be empty, without turning '' into 0. */
const num = (v: string): number => (v.trim() === '' ? 0 : Number(v));

/* -------------------------------------------------------------------------- */
/*  Lead                                                                      */
/* -------------------------------------------------------------------------- */

export function LeadDialog({
  open, onOpenChange, editing, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Lead | null;
  onSaved: () => void;
}) {
  const owners = useOwners(open);
  const [saving, setSaving] = React.useState(false);
  const [f, setF] = React.useState({
    firstName: '', lastName: '', email: '', phone: '', companyName: '', jobTitle: '',
    source: 'manual', status: 'new', score: 0, estimatedValue: '', notes: '',
    ownerId: undefined as string | undefined,
  });

  React.useEffect(() => {
    if (!open) return;
    setF(editing
      ? {
        firstName: editing.firstName ?? '', lastName: editing.lastName ?? '',
        email: editing.email ?? '', phone: editing.phone ?? '',
        companyName: editing.companyName ?? '', jobTitle: editing.jobTitle ?? '',
        source: editing.source || 'manual', status: editing.status || 'new',
        score: editing.score ?? 0,
        estimatedValue: editing.estimatedValue ? String(editing.estimatedValue) : '',
        notes: editing.notes ?? '', ownerId: editing.ownerId ?? undefined,
      }
      : {
        firstName: '', lastName: '', email: '', phone: '', companyName: '', jobTitle: '',
        source: 'manual', status: 'new', score: 0, estimatedValue: '', notes: '',
        ownerId: undefined,
      });
  }, [open, editing]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.firstName.trim() && !f.lastName.trim() && !f.companyName.trim()) {
      toast.error('A lead needs a name or a company');
      return;
    }
    setSaving(true);
    try {
      const body = { ...f, estimatedValue: num(f.estimatedValue), score: Number(f.score) };
      if (editing) {
        await patch(`/api/crm/leads/${editing.id}`, body);
        toast.success('Lead updated');
      } else {
        await post('/api/crm/leads', body);
        toast.success('Lead added');
      }
      onOpenChange(false);
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'That could not be saved');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell
      open={open} onOpenChange={onOpenChange}
      title={editing ? 'Edit lead' : 'Add lead'}
      description={editing ? 'Everything known about this lead.' : 'Somebody who might buy. Convert them when they do.'}
      onSubmit={submit} saving={saving} submitLabel={editing ? 'Save' : 'Add lead'}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="First name">
          <Input value={f.firstName} onChange={e => setF({ ...f, firstName: e.target.value })} className={input} autoFocus />
        </Field>
        <Field label="Last name">
          <Input value={f.lastName} onChange={e => setF({ ...f, lastName: e.target.value })} className={input} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Email">
          <Input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} className={input} />
        </Field>
        <Field label="Phone">
          <Input value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} className={input} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Company"
          hint="Free text until the lead converts, when a company record is created."
        >
          <Input value={f.companyName} onChange={e => setF({ ...f, companyName: e.target.value })} className={input} />
        </Field>
        <Field label="Job title">
          <Input value={f.jobTitle} onChange={e => setF({ ...f, jobTitle: e.target.value })} className={input} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Status">
          <Select value={f.status} onValueChange={v => setF({ ...f, status: v })}>
            <SelectTrigger className={input}><SelectValue /></SelectTrigger>
            <SelectContent>
              {LEAD_STATUSES.map(s => (
                <SelectItem key={s} value={s} className="text-[13px]">{LEAD_STATUS_LABELS[s] ?? s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Source">
          <Select value={f.source} onValueChange={v => setF({ ...f, source: v })}>
            <SelectTrigger className={input}><SelectValue /></SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value} className="text-[13px]">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={`Value (${activeCurrencyCode()})`}>
          <Input
            type="number" min={0} inputMode="decimal"
            value={f.estimatedValue}
            onChange={e => setF({ ...f, estimatedValue: e.target.value })}
            className={input}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Score" hint="How likely this is to become business. 0 to 100.">
          <div className="flex h-9 items-center gap-3">
            <Slider
              value={[f.score]}
              onValueChange={([v]) => setF({ ...f, score: v })}
              max={100} step={5}
              className="flex-1"
            />
            <span className="w-7 shrink-0 text-right text-[13px] tabular-nums text-muted-foreground">
              {f.score}
            </span>
          </div>
        </Field>
        <OwnerField owners={owners} value={f.ownerId} onChange={v => setF({ ...f, ownerId: v })} />
      </div>

      <Field label="Notes">
        <Textarea
          value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })}
          rows={3} className="resize-none text-[13px]"
        />
      </Field>
    </Shell>
  );
}

/* -------------------------------------------------------------------------- */
/*  Contact                                                                   */
/* -------------------------------------------------------------------------- */

export function ContactDialog({
  open, onOpenChange, editing, onSaved, defaultCompany,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Contact | null;
  onSaved: () => void;
  defaultCompany?: { id: string; name: string } | null;
}) {
  const [saving, setSaving] = React.useState(false);
  const [company, setCompany] = React.useState<LinkValue | null>(null);
  const [f, setF] = React.useState({
    firstName: '', lastName: '', email: '', phone: '', jobTitle: '',
    source: 'manual', isActive: true, notes: '',
  });

  React.useEffect(() => {
    if (!open) return;
    if (editing) {
      setF({
        firstName: editing.firstName ?? '', lastName: editing.lastName ?? '',
        email: editing.email ?? '', phone: editing.phone ?? '',
        jobTitle: editing.jobTitle ?? '', source: editing.source || 'manual',
        isActive: editing.isActive, notes: editing.notes ?? '',
      });
      setCompany(editing.company ? { kind: 'company', id: editing.company.id, label: editing.company.name } : null);
    } else {
      setF({
        firstName: '', lastName: '', email: '', phone: '', jobTitle: '',
        source: 'manual', isActive: true, notes: '',
      });
      setCompany(defaultCompany ? { kind: 'company', id: defaultCompany.id, label: defaultCompany.name } : null);
    }
  }, [open, editing, defaultCompany]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.firstName.trim() && !f.lastName.trim()) {
      toast.error('A contact needs a name');
      return;
    }
    setSaving(true);
    try {
      const body = { ...f, companyId: company?.id ?? null };
      if (editing) {
        await patch(`/api/crm/contacts/${editing.id}`, body);
        toast.success('Contact updated');
      } else {
        await post('/api/crm/contacts', body);
        toast.success('Contact added');
      }
      onOpenChange(false);
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'That could not be saved');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell
      open={open} onOpenChange={onOpenChange}
      title={editing ? 'Edit contact' : 'Add contact'}
      description="Somebody at a customer or a prospect."
      onSubmit={submit} saving={saving} submitLabel={editing ? 'Save' : 'Add contact'}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="First name">
          <Input value={f.firstName} onChange={e => setF({ ...f, firstName: e.target.value })} className={input} autoFocus />
        </Field>
        <Field label="Last name">
          <Input value={f.lastName} onChange={e => setF({ ...f, lastName: e.target.value })} className={input} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Email">
          <Input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} className={input} />
        </Field>
        <Field label="Phone">
          <Input value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} className={input} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Company">
          <LinkPicker
            value={company} onChange={setCompany} kinds={['company']}
            placeholder="No company"
          />
        </Field>
        <Field label="Job title">
          <Input value={f.jobTitle} onChange={e => setF({ ...f, jobTitle: e.target.value })} className={input} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Source">
          <Select value={f.source} onValueChange={v => setF({ ...f, source: v })}>
            <SelectTrigger className={input}><SelectValue /></SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value} className="text-[13px]">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Still at this company" hint="Turn off rather than delete when somebody moves on.">
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input px-3">
            <span className="flex-1 text-[12.5px]">{f.isActive ? 'Active' : 'Inactive'}</span>
            <Switch checked={f.isActive} onCheckedChange={v => setF({ ...f, isActive: v })} />
          </label>
        </Field>
      </div>

      <Field label="Notes">
        <Textarea
          value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })}
          rows={3} className="resize-none text-[13px]"
        />
      </Field>
    </Shell>
  );
}

/* -------------------------------------------------------------------------- */
/*  Company                                                                   */
/* -------------------------------------------------------------------------- */

export function CompanyDialog({
  open, onOpenChange, editing, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Company | null;
  onSaved: () => void;
}) {
  const [saving, setSaving] = React.useState(false);
  const [f, setF] = React.useState({
    name: '', industry: '', website: '', phone: '', email: '',
    city: '', country: '', employeeCount: '', annualRevenue: '', notes: '',
  });

  React.useEffect(() => {
    if (!open) return;
    setF(editing
      ? {
        name: editing.name ?? '', industry: editing.industry ?? '',
        website: editing.website ?? '', phone: editing.phone ?? '',
        email: editing.email ?? '', city: editing.city ?? '', country: editing.country ?? '',
        employeeCount: editing.employeeCount ? String(editing.employeeCount) : '',
        annualRevenue: editing.annualRevenue ? String(editing.annualRevenue) : '',
        notes: editing.notes ?? '',
      }
      : {
        name: '', industry: '', website: '', phone: '', email: '',
        city: '', country: '', employeeCount: '', annualRevenue: '', notes: '',
      });
  }, [open, editing]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) { toast.error('A company needs a name'); return; }
    setSaving(true);
    try {
      const body = {
        ...f,
        employeeCount: num(f.employeeCount),
        annualRevenue: num(f.annualRevenue),
      };
      if (editing) {
        await patch(`/api/crm/companies/${editing.id}`, body);
        toast.success('Company updated');
      } else {
        await post('/api/crm/companies', body);
        toast.success('Company added');
      }
      onOpenChange(false);
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'That could not be saved');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell
      open={open} onOpenChange={onOpenChange}
      title={editing ? 'Edit company' : 'Add company'}
      description="A customer or a prospect. Everything else links to it."
      onSubmit={submit} saving={saving} submitLabel={editing ? 'Save' : 'Add company'}
    >
      <Field label="Name">
        <Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} className={input} autoFocus />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Industry">
          <Input value={f.industry} onChange={e => setF({ ...f, industry: e.target.value })} className={input} />
        </Field>
        <Field label="Website">
          <Input
            value={f.website} onChange={e => setF({ ...f, website: e.target.value })}
            placeholder="acme.com" className={input}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Email">
          <Input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} className={input} />
        </Field>
        <Field label="Phone">
          <Input value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} className={input} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="City">
          <Input value={f.city} onChange={e => setF({ ...f, city: e.target.value })} className={input} />
        </Field>
        <Field label="Country">
          <Input value={f.country} onChange={e => setF({ ...f, country: e.target.value })} className={input} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Employees">
          <Input
            type="number" min={0} inputMode="numeric"
            value={f.employeeCount} onChange={e => setF({ ...f, employeeCount: e.target.value })}
            className={input}
          />
        </Field>
        <Field label={`Annual revenue (${activeCurrencyCode()})`}>
          <Input
            type="number" min={0} inputMode="decimal"
            value={f.annualRevenue} onChange={e => setF({ ...f, annualRevenue: e.target.value })}
            className={input}
          />
        </Field>
      </div>

      <Field label="Notes">
        <Textarea
          value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })}
          rows={3} className="resize-none text-[13px]"
        />
      </Field>
    </Shell>
  );
}

/* -------------------------------------------------------------------------- */
/*  Deal                                                                      */
/* -------------------------------------------------------------------------- */

export function DealDialog({
  open, onOpenChange, editing, onSaved, defaultCompany,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Deal | null;
  onSaved: () => void;
  defaultCompany?: { id: string; name: string } | null;
}) {
  const owners = useOwners(open);
  const [saving, setSaving] = React.useState(false);
  const [company, setCompany] = React.useState<LinkValue | null>(null);
  const [contact, setContact] = React.useState<LinkValue | null>(null);
  const [f, setF] = React.useState({
    name: '', value: '', stage: 'prospecting', probability: 20,
    expectedClose: '', notes: '', ownerId: undefined as string | undefined,
    lostReason: '',
  });

  React.useEffect(() => {
    if (!open) return;
    if (editing) {
      setF({
        name: editing.name ?? '',
        value: editing.value ? String(editing.value) : '',
        stage: editing.stage || 'prospecting',
        probability: editing.probability ?? 20,
        expectedClose: editing.expectedClose?.slice(0, 10) ?? '',
        notes: editing.notes ?? '',
        ownerId: editing.ownerId ?? undefined,
        lostReason: editing.lostReason ?? '',
      });
      setCompany(editing.company ? { kind: 'company', id: editing.company.id, label: editing.company.name } : null);
      setContact(editing.contact
        ? { kind: 'contact', id: editing.contact.id, label: `${editing.contact.firstName} ${editing.contact.lastName}`.trim() }
        : null);
    } else {
      setF({
        name: '', value: '', stage: 'prospecting', probability: 20,
        expectedClose: '', notes: '', ownerId: undefined, lostReason: '',
      });
      setCompany(defaultCompany ? { kind: 'company', id: defaultCompany.id, label: defaultCompany.name } : null);
      setContact(null);
    }
  }, [open, editing, defaultCompany]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) { toast.error('A deal needs a name'); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: f.name,
        value: num(f.value),
        stage: f.stage,
        probability: Number(f.probability),
        expectedClose: f.expectedClose || null,
        notes: f.notes,
        ownerId: f.ownerId,
        companyId: company?.id ?? null,
        contactId: contact?.id ?? null,
      };
      // Only sent where it means something. The trigger clears it on anything
      // that is not a loss, so sending it always would be noise on the wire.
      if (f.stage === 'closed_lost') body.lostReason = f.lostReason || null;

      if (editing) {
        await patch(`/api/crm/deals/${editing.id}`, body);
        toast.success('Deal updated');
      } else {
        await post('/api/crm/deals', body);
        toast.success('Deal added');
      }
      onOpenChange(false);
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'That could not be saved');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell
      open={open} onOpenChange={onOpenChange}
      title={editing ? 'Edit deal' : 'Add deal'}
      description="A piece of business you are trying to win."
      onSubmit={submit} saving={saving} submitLabel={editing ? 'Save' : 'Add deal'}
    >
      <Field label="Name">
        <Input
          value={f.name} onChange={e => setF({ ...f, name: e.target.value })}
          placeholder="Acme - platform rollout" className={input} autoFocus
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Company">
          <LinkPicker value={company} onChange={setCompany} kinds={['company']} placeholder="No company" />
        </Field>
        <Field label="Contact">
          <LinkPicker value={contact} onChange={setContact} kinds={['contact']} placeholder="No contact" />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={`Value (${activeCurrencyCode()})`}>
          <Input
            type="number" min={0} inputMode="decimal"
            value={f.value} onChange={e => setF({ ...f, value: e.target.value })}
            className={input}
          />
        </Field>
        <Field label="Expected close">
          <Input
            type="date" value={f.expectedClose}
            onChange={e => setF({ ...f, expectedClose: e.target.value })}
            className={input}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Stage">
          <Select value={f.stage} onValueChange={v => setF({ ...f, stage: v })}>
            <SelectTrigger className={input}><SelectValue /></SelectTrigger>
            <SelectContent>
              {DEAL_STAGES.map(s => (
                <SelectItem key={s} value={s} className="text-[13px]">{STAGE_LABELS[s] ?? s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          label="Probability"
          hint={`Weighted forecast: ${exact(num(f.value) * (Number(f.probability) / 100))}`}
        >
          <div className="flex h-9 items-center gap-3">
            <Slider
              value={[f.probability]}
              onValueChange={([v]) => setF({ ...f, probability: v })}
              max={100} step={5} className="flex-1"
            />
            <span className="w-9 shrink-0 text-right text-[13px] tabular-nums text-muted-foreground">
              {f.probability}%
            </span>
          </div>
        </Field>
      </div>

      {f.stage === 'closed_lost' && (
        <Field label="Why was it lost" hint="A short list, so it can be counted.">
          <Select value={f.lostReason} onValueChange={v => setF({ ...f, lostReason: v })}>
            <SelectTrigger className={input}><SelectValue placeholder="Choose a reason" /></SelectTrigger>
            <SelectContent>
              {LOST_REASONS.map(r => (
                <SelectItem key={r} value={r} className="text-[13px]">{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      <OwnerField owners={owners} value={f.ownerId} onChange={v => setF({ ...f, ownerId: v })} />

      <Field label="Notes">
        <Textarea
          value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })}
          rows={3} className="resize-none text-[13px]"
        />
      </Field>
    </Shell>
  );
}

/* -------------------------------------------------------------------------- */
/*  Closing a deal                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The one confirmation the pipeline board asks for.
 *
 * Every other drag applies immediately with an undo. Won and Lost are
 * different in kind: they book revenue, they fire a notification, they stamp a
 * close date, and they are the two a mis-drop is expensive on. They are also
 * the two moments where the product needs something from the user that no
 * other stage change does - the date it actually closed, and why it was lost.
 *
 * So the dialog is not a speed bump, it is the form that collects the data
 * nobody would ever go back and fill in later.
 */
export function CloseDealDialog({
  open, onOpenChange, deal, outcome, onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  deal: Deal | null;
  outcome: 'closed_won' | 'closed_lost';
  onDone: () => void;
}) {
  const won = outcome === 'closed_won';
  const [saving, setSaving] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [closedOn, setClosedOn] = React.useState('');
  const [note, setNote] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setReason('');
    setNote('');
    setClosedOn(new Date().toISOString().slice(0, 10));
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deal) return;
    if (!won && !reason) { toast.error('Choose why it was lost'); return; }

    setSaving(true);
    try {
      await patch(`/api/crm/deals/${deal.id}`, {
        stage: outcome,
        probability: won ? 100 : 0,
        closedAt: closedOn ? new Date(`${closedOn}T12:00:00`).toISOString() : undefined,
        ...(won ? {} : { lostReason: reason }),
      });

      /**
       * The outcome, on the customer's timeline.
       *
       * A deal that changes stage in a table is a number moving. On the
       * customer's history it is "we won this, on this date, and here is what
       * was said" - which is what somebody picking the account up in six
       * months actually needs.
       */
      if (note.trim() || deal.companyId) {
        await post('/api/crm/activities', {
          activityType: 'note',
          subject: won ? 'Deal won' : `Deal lost - ${reason}`,
          body: note.trim(),
          dealId: deal.id,
          companyId: deal.companyId,
          contactId: deal.contactId,
          completedAt: new Date().toISOString(),
        }).catch(() => {
          // The deal is already closed; a missing timeline note must not
          // present as a failed close.
        });
      }

      toast.success(won ? 'Marked as won' : 'Marked as lost');
      onOpenChange(false);
      onDone();
    } catch (err: any) {
      toast.error(err.message || 'That could not be saved');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            {won
              ? <Trophy className="size-4 text-success" />
              : <XCircle className="size-4 text-destructive" />}
            {won ? 'Mark as won' : 'Mark as lost'}
          </DialogTitle>
          <DialogDescription className="text-[12.5px]">
            {deal?.name}
            {deal ? ` · ${exact(deal.value)}` : ''}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4 px-5 py-4">
          <Field label={won ? 'Closed on' : 'Lost on'}>
            <Input type="date" value={closedOn} onChange={e => setClosedOn(e.target.value)} className={input} />
          </Field>

          {!won && (
            <Field label="Why">
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger className={input}><SelectValue placeholder="Choose a reason" /></SelectTrigger>
                <SelectContent>
                  {LOST_REASONS.map(r => (
                    <SelectItem key={r} value={r} className="text-[13px]">{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          <Field label="Note" hint="Goes on the customer's timeline.">
            <Textarea
              value={note} onChange={e => setNote(e.target.value)}
              rows={3} className="resize-none text-[13px]"
              placeholder={won ? 'What got it over the line' : 'What we would do differently'}
            />
          </Field>

          <DialogFooter className="gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving} className="gap-1.5">
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              {won ? 'Mark as won' : 'Mark as lost'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
