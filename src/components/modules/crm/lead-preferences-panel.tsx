'use client';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAppStore } from '@/store/app-store';
import { defaultCommunicationPreferences } from '@/lib/crm/lead-preferences';
import type { Lead } from './types';

export function LeadPreferencesPanel({ lead, onChanged }: { lead: Lead; onChanged: () => void }) {
  const mayEdit = useAppStore(s => s.allows('crm', 'edit'));
  const [draft, setDraft] = React.useState(lead.communicationPreferences ?? defaultCommunicationPreferences);
  const [revision, setRevision] = React.useState(lead.updatedAt);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState('');
  async function save() {
    setBusy(true); setError(''); setMessage('');
    try {
      const r = await fetch(`/api/crm/leads/${lead.id}/preferences`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updatedAt: revision, preferences: draft }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error?.message ?? 'Save failed');
      setRevision(j.data.updatedAt); setMessage('Preferences saved and recorded in the audit history.'); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Save failed'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-xl border bg-card p-4">
    <div><h3 className="text-sm font-semibold">Communication preferences</h3><p className="mt-1 text-xs text-muted-foreground">Record the person’s instructions and the evidence for any permission. Unknown is not consent.</p></div>
    <fieldset disabled={!mayEdit || busy} className="space-y-3">
      <label className="flex items-start gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" className="mt-0.5" checked={draft.doNotContact} onChange={e => setDraft({ ...draft, doNotContact: e.target.checked })} /><span>Do not contact<span className="mt-1 block text-xs text-muted-foreground">Blocks planned calls, emails, meetings and follow-ups. Historical notes remain available.</span></span></label>
      <div className="grid grid-cols-2 gap-3">{(['email','phone'] as const).map(channel => <label key={channel} className="grid gap-1 text-xs"><span>{channel === 'email' ? 'Email permission' : 'Phone permission'}</span><select className="h-9 rounded-md border bg-background px-2" value={draft[channel]} onChange={e => setDraft({ ...draft, [channel]: e.target.value as typeof draft.email })}><option value="unknown">Not recorded</option><option value="granted">Permission recorded</option><option value="withdrawn">Opted out</option></select></label>)}</div>
      <label className="grid gap-1 text-xs">Evidence / preferences<Textarea maxLength={2000} rows={2} value={draft.note} placeholder="Scope, date, evidence reference, preferred contact times…" onChange={e => setDraft({ ...draft, note: e.target.value })} /></label>
      <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => void save()}>{busy ? 'Saving…' : 'Save preferences'}</Button><Button size="sm" variant="ghost" onClick={() => { setDraft(lead.communicationPreferences ?? defaultCommunicationPreferences); setRevision(lead.updatedAt); setError(''); }}>Discard draft / use latest record</Button></div>
    </fieldset>
    <p className="text-[11px] text-muted-foreground">Calls and emails need recorded permission before scheduling. Opt-outs remain in force after conversion and are preserved conservatively when leads merge.</p>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}{message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
  </section>;
}
