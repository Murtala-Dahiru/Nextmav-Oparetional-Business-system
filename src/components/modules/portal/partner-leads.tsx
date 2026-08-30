'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Plus, Send, Trash2, CheckCircle2, XCircle, Clock, Pencil } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { formatDate, formatCurrencyCompact } from '@/lib/format';
import { useAppStore } from '@/store/app-store';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  An external partner's lead workspace
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What a partner can and cannot see ────────────────────────────────────
 *
 * This screen is the whole of their view of the sales process. They hold no
 * CRM grant at any scope, so every lead, deal, contact and company endpoint
 * refuses them at the door, and the row policies refuse them again. Their
 * prospects live in a table they own; approving one *creates* a lead on the
 * company's side rather than revealing one that already existed.
 *
 * ── Why drafts and submissions are visibly different ─────────────────────
 *
 * A draft is private and editable: somebody typing a half-remembered name has
 * not told the company anything yet. Submitting is a one-way door, and the
 * screen says so before it happens rather than after. From that point the row
 * is the company's, which is why the edit and delete controls disappear
 * rather than failing when pressed.
 */

interface PartnerLead {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  jobTitle: string | null;
  note: string;
  estimatedValue: string | number;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  submittedAt: string | null;
  decidedAt: string | null;
  decisionNote: string;
}

const STATUS: Record<PartnerLead['status'], { word: string; tone: string; icon: React.ElementType }> = {
  draft: { word: 'Draft, only you can see it', tone: 'text-muted-foreground', icon: Pencil },
  submitted: { word: 'With the company', tone: 'text-warning', icon: Clock },
  approved: { word: 'Accepted', tone: 'text-success', icon: CheckCircle2 },
  rejected: { word: 'Not taken up', tone: 'text-destructive', icon: XCircle },
};

export function PartnerLeads() {
  const currency = useAppStore(s => s.organization?.currency) ?? 'USD';
  const [rows, setRows] = React.useState<PartnerLead[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const [editing, setEditing] = React.useState<PartnerLead | null>(null);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    fetch('/api/portal/partner-leads?pageSize=100', { cache: 'no-store' })
      .then(async r => {
        const b = await r.json().catch(() => null);
        if (!live) return;
        if (!r.ok) { setError(b?.error?.message ?? 'That did not load.'); return; }
        setError(null);
        setRows(b?.data ?? []);
      })
      .catch(() => { if (live) setError('That did not load.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [nonce]);

  const reload = () => setNonce(n => n + 1);

  const submit = async (row: PartnerLead) => {
    setBusy(row.id);
    try {
      const res = await fetch(`/api/portal/partner-leads/${row.id}`, { method: 'POST' });
      const b = await res.json().catch(() => null);
      if (!res.ok) throw new Error(b?.error?.message ?? 'That did not send.');
      toast.success('Sent over');
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not send.');
    } finally { setBusy(null); }
  };

  const remove = async (row: PartnerLead) => {
    setBusy(row.id);
    try {
      const res = await fetch(`/api/portal/partner-leads/${row.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error?.message ?? 'That did not delete.');
      }
      toast.success('Removed');
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not delete.');
    } finally { setBusy(null); }
  };

  const drafts = rows.filter(r => r.status === 'draft');
  const sent = rows.filter(r => r.status !== 'draft');
  const accepted = rows.filter(r => r.status === 'approved').length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div>
          <h2 className="text-[18px] font-semibold tracking-[-0.02em]">Your prospects</h2>
          <p className="text-[12.5px] text-muted-foreground">
            Work them here, then send the ones worth having over
          </p>
        </div>
        <Button
          size="sm" className="ml-auto h-9 gap-1.5"
          onClick={() => { setEditing(null); setOpen(true); }}
        >
          <Plus className="size-4" /> Add a prospect
        </Button>
      </div>

      {rows.length > 0 && (
        <div className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded-xl border border-border bg-card shadow-e1">
          {[
            ['Drafts', drafts.length, 'Only you can see these'],
            ['Sent over', sent.length, 'Waiting or decided'],
            ['Accepted', accepted, 'Now in their CRM'],
          ].map(([label, value, note]) => (
            <div key={String(label)} className="px-4 py-3">
              <p className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground/85">
                {label}
              </p>
              <p className="text-[19px] font-semibold leading-none tabular-nums">{value}</p>
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">{note}</p>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="h-32 animate-pulse rounded-xl bg-muted" />
      ) : error ? (
        <div className="rounded-lg border border-destructive/25 bg-destructive/[0.04] px-4 py-6 text-center">
          <p className="text-[13px] font-medium">This did not load</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={reload}>Try again</Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-border bg-card px-6 py-14 text-center shadow-e1">
          <span className="mb-3 flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Plus className="size-[18px]" />
          </span>
          <p className="text-[14px] font-medium">Nothing here yet</p>
          <p className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">
            Add a prospect and it stays private until you send it over. Once accepted,
            it becomes a lead on their side and stays credited to you.
          </p>
          <Button size="sm" className="mt-4" onClick={() => { setEditing(null); setOpen(true); }}>
            Add a prospect
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-e1">
          {rows.map(r => {
            const s = STATUS[r.status];
            const Icon = s.icon;
            const who = [r.firstName, r.lastName].filter(Boolean).join(' ').trim();
            return (
              <li key={r.id} className="flex items-start gap-3 px-4 py-3">
                <span className={cn('mt-0.5 shrink-0', s.tone)}>
                  <Icon className="size-4" />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium">
                    {who || r.companyName || 'Unnamed prospect'}
                  </p>
                  <p className="truncate text-[11.5px] text-muted-foreground">
                    {[
                      who && r.companyName ? r.companyName : null,
                      r.jobTitle,
                      r.email,
                    ].filter(Boolean).join(' · ') || 'No contact details'}
                  </p>
                  <p className={cn('mt-1 text-[11.5px]', s.tone)}>
                    {s.word}
                    {r.submittedAt && r.status === 'submitted' ? ` since ${formatDate(r.submittedAt)}` : ''}
                    {r.decidedAt && r.status !== 'submitted' ? ` on ${formatDate(r.decidedAt)}` : ''}
                  </p>
                  {r.decisionNote && (
                    <p className="mt-0.5 text-[11.5px] italic text-muted-foreground">
                      &ldquo;{r.decisionNote}&rdquo;
                    </p>
                  )}
                </div>

                {Number(r.estimatedValue) > 0 && (
                  <span className="shrink-0 text-[13px] font-medium tabular-nums">
                    {formatCurrencyCompact(Number(r.estimatedValue), currency)}
                  </span>
                )}

                {/*
                  Controls vanish once it is submitted rather than failing when
                  pressed. The policy behind them stops applying at exactly that
                  moment, and a button that is going to be refused should not be
                  offered.
                */}
                {r.status === 'draft' && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="sm" variant="ghost" className="h-7 px-2 text-[12px]"
                      disabled={busy === r.id}
                      onClick={() => { setEditing(r); setOpen(true); }}
                    >
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      size="sm" variant="outline" className="h-7 gap-1 px-2 text-[12px]"
                      disabled={busy === r.id}
                      onClick={() => submit(r)}
                    >
                      <Send className="size-3" /> Send over
                    </Button>
                    <Button
                      size="sm" variant="ghost" className="h-7 px-2 text-[12px] text-muted-foreground"
                      disabled={busy === r.id}
                      onClick={() => remove(r)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ProspectDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        onSaved={reload}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ProspectDialog({
  open, onOpenChange, editing, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: PartnerLead | null;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState({
    firstName: '', lastName: '', email: '', phone: '',
    companyName: '', jobTitle: '', note: '', estimatedValue: '',
  });
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setForm({
      firstName: editing?.firstName ?? '',
      lastName: editing?.lastName ?? '',
      email: editing?.email ?? '',
      phone: editing?.phone ?? '',
      companyName: editing?.companyName ?? '',
      jobTitle: editing?.jobTitle ?? '',
      note: editing?.note ?? '',
      estimatedValue: editing ? String(editing.estimatedValue ?? '') : '',
    });
  }, [open, editing]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.firstName.trim() && !form.lastName.trim() && !form.companyName.trim()) {
      return toast.error('A prospect needs at least a name or a company');
    }
    setSaving(true);
    try {
      const body = {
        ...form,
        email: form.email || null,
        estimatedValue: Number(form.estimatedValue) || 0,
      };
      const res = await fetch(
        editing ? `/api/portal/partner-leads/${editing.id}` : '/api/portal/partner-leads',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const b = await res.json().catch(() => null);
      if (!res.ok) throw new Error(b?.error?.message ?? 'That did not save.');
      toast.success(editing ? 'Saved' : 'Added');
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not save.');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit prospect' : 'Add a prospect'}</DialogTitle>
          <DialogDescription>
            This stays private to you until you send it over. Once it is accepted it
            becomes a lead on their side, credited to you.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pl-first">First name</Label>
              <Input id="pl-first" value={form.firstName} onChange={set('firstName')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pl-last">Last name</Label>
              <Input id="pl-last" value={form.lastName} onChange={set('lastName')} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pl-company">Company</Label>
              <Input id="pl-company" value={form.companyName} onChange={set('companyName')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pl-title">Job title</Label>
              <Input id="pl-title" value={form.jobTitle} onChange={set('jobTitle')} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pl-email">Email</Label>
              <Input id="pl-email" type="email" value={form.email} onChange={set('email')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pl-phone">Phone</Label>
              <Input id="pl-phone" value={form.phone} onChange={set('phone')} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pl-value">What you think it is worth</Label>
            <Input
              id="pl-value" inputMode="decimal"
              value={form.estimatedValue} onChange={set('estimatedValue')}
              placeholder="Leave blank if you would rather not guess"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pl-note">What you know</Label>
            <Textarea
              id="pl-note" rows={3} value={form.note} onChange={set('note')}
              placeholder="How you found them, what they need, who else is bidding"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving' : editing ? 'Save' : 'Add'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
