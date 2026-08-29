'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Loader2, ArrowRight, Building2, User, Handshake } from 'lucide-react';

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { activeCurrencyCode } from '@/lib/format';
import { useAppStore } from '@/store/app-store';

import { post, today } from './data';
import { personName } from './ui';
import type { Lead } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Winning a lead
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The gap this closes ──────────────────────────────────────────────────
 *
 * `leads.converted_contact_id` has carried a comment since migration 0003
 * saying it is "set when the lead becomes a contact, so conversion is
 * traceable". Nothing ever set it. Marking a lead Won coloured a badge and did
 * nothing else, so the person who had just won the business went and typed the
 * company, the contact and the deal in again by hand - three records they had
 * already entered once, with three chances to spell the company differently
 * from the one already in the system.
 *
 * ── What it shows before it runs ─────────────────────────────────────────
 *
 * Exactly what will exist afterwards. Conversion writes several records at
 * once, and a button that silently creates three things is a button people are
 * right not to trust. The company line says "reuse or create", because the
 * endpoint matches on a normalised name - "Acme Ltd" here finds "Acme Limited"
 * there - and which of those happens is worth knowing in advance.
 */

export function ConvertLeadDialog({
  open, onOpenChange, lead, onConverted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lead: Lead | null;
  onConverted: () => void;
}) {
  const openRecord = useAppStore(s => s.openRecord);
  const [saving, setSaving] = React.useState(false);
  const [withDeal, setWithDeal] = React.useState(true);
  const [dealName, setDealName] = React.useState('');
  const [dealValue, setDealValue] = React.useState('');
  const [expectedClose, setExpectedClose] = React.useState('');

  React.useEffect(() => {
    if (!open || !lead) return;
    const company = lead.companyName?.trim();
    setWithDeal(true);
    setDealName(company ? `${company} opportunity` : `${personName(lead)} opportunity`);
    setDealValue(lead.estimatedValue ? String(lead.estimatedValue) : '');
    // Thirty days out, which is a starting point somebody can change rather
    // than an empty field they will leave empty.
    const d = new Date();
    d.setDate(d.getDate() + 30);
    setExpectedClose(d.toISOString().slice(0, 10));
  }, [open, lead]);

  if (!lead) return null;

  const name = personName(lead) || lead.email || 'This lead';
  const company = lead.companyName?.trim();

  const convert = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await post<any>(`/api/crm/leads/${lead.id}/convert`, {
        createDeal: withDeal,
        dealName: dealName.trim(),
        dealValue: dealValue ? Number(dealValue) : undefined,
        expectedClose: expectedClose || null,
      });

      toast.success('Converted', {
        description: withDeal
          ? 'Contact, company and deal created.'
          : 'Contact and company created.',
        action: result?.deal?.id
          ? { label: 'Open the deal', onClick: () => openRecord('crm', 'deal', result.deal.id) }
          : result?.contact?.id
            ? { label: 'Open the contact', onClick: () => openRecord('crm', 'contact', result.contact.id) }
            : undefined,
      });

      onOpenChange(false);
      onConverted();
    } catch (err: any) {
      toast.error(err.message || 'That lead could not be converted');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-[15px]">Convert {name}</DialogTitle>
          <DialogDescription className="text-[12.5px]">
            The lead stays, marked converted, so where the customer came from is not lost.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={convert} className="flex flex-col gap-4 px-5 py-4">
          {/* What will exist afterwards. */}
          <ul className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3">
            <Outcome icon={Building2} label={company || 'No company on this lead'}
              hint={company ? 'Reused if a company with this name already exists' : 'Nothing will be created'} />
            <Outcome icon={User} label={name} hint="A new contact, attached to that company" />
            {withDeal && (
              <Outcome icon={Handshake} label={dealName || 'Opportunity'}
                hint={`Opens in Qualification at ${lead.score > 0 ? `${lead.score}%` : '20%'}`} />
            )}
          </ul>

          <label className="flex cursor-pointer items-center justify-between rounded-md border border-border px-3 py-2.5">
            <span className="text-[12.5px] font-medium">Open a deal as well</span>
            <Switch checked={withDeal} onCheckedChange={setWithDeal} />
          </label>

          {withDeal && (
            <div className="space-y-4 rounded-md border border-border bg-muted/40 p-3.5">
              <div className="space-y-1.5">
                <Label className="text-[12.5px] font-medium">Deal name</Label>
                <Input
                  value={dealName} onChange={e => setDealName(e.target.value)}
                  className="h-9 bg-card text-[13px]"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-[12.5px] font-medium">Value ({activeCurrencyCode()})</Label>
                  <Input
                    type="number" min={0} inputMode="decimal"
                    value={dealValue} onChange={e => setDealValue(e.target.value)}
                    className="h-9 bg-card text-[13px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[12.5px] font-medium">Expected close</Label>
                  <Input
                    type="date" min={today()}
                    value={expectedClose} onChange={e => setExpectedClose(e.target.value)}
                    className="h-9 bg-card text-[13px]"
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />}
              Convert
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Outcome({
  icon: Icon, label, hint,
}: {
  icon: React.ElementType; label: string; hint: string;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="truncate text-[12.5px] font-medium text-foreground">{label}</p>
        <p className="text-[11.5px] text-muted-foreground">{hint}</p>
      </div>
    </li>
  );
}
