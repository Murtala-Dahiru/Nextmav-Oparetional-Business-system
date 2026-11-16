'use client';
import * as React from 'react';
import { PlanHistory } from './plan-history';
import { StructuredPlan } from './structured-plan';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Target, Users, TrendingUp, ShieldAlert, ListChecks } from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { getOne, getList } from './data';
import { emptyAccountPlan, type AccountPlan, type AccountPlanInput } from '@/lib/crm/account-plan';

const fields = [
  ['objectives','Strategic objectives','What should this relationship achieve?'],
  ['stakeholders','Key stakeholders','Names, roles, influence and engagement plans.'],
  ['opportunities','Growth opportunities','Customer needs and opportunities to explore.'],
  ['risks','Relationship risks','Known risks, evidence and mitigation.'],
  ['actions','Account actions','Next steps, responsible people and due dates.'],
] as const;
const fieldIcons = {objectives:Target,stakeholders:Users,opportunities:TrendingUp,risks:ShieldAlert,actions:ListChecks};

export function AccountPlanPanel({ companyId }: { companyId: string }) {
  const mayEdit = useAppStore(s => s.allows('crm','edit'));
  const memberId = useAppStore(s => s.user?.memberId);
  const [plan,setPlan] = React.useState<AccountPlanInput>(emptyAccountPlan);
  const [saved,setSaved] = React.useState<AccountPlanInput>(emptyAccountPlan);
  const [loading,setLoading] = React.useState(true);
  const [busy,setBusy] = React.useState(false);
  const [error,setError] = React.useState<string | null>(null);
  const [notice,setNotice] = React.useState('');
  const [nonce,setNonce] = React.useState(0);
  const [conflict,setConflict] = React.useState<AccountPlan | null>(null);
  const [owners,setOwners] = React.useState<{memberId:string;fullName:string}[]>([]);
  const [ownerError,setOwnerError] = React.useState(false);
  const [ownerSearch,setOwnerSearch] = React.useState('');
  const dirty = JSON.stringify(plan)!==JSON.stringify(saved);
  React.useEffect(() => {
    const controller = new AbortController();
    const timer=setTimeout(()=>{
      void getList<{memberId:string;fullName:string}>(`/api/directory?search=${encodeURIComponent(ownerSearch)}`,controller.signal)
        .then(result=>{if(!controller.signal.aborted) {setOwners(result.data);setOwnerError(false);}})
        .catch(()=>{if(!controller.signal.aborted) setOwnerError(true);});
    },250);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[ownerSearch]);
  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    getOne<AccountPlan | null>(`/api/crm/companies/${companyId}/plan`,controller.signal).then(row => {
      if(controller.signal.aborted) return;
      const next = Object.fromEntries(Object.keys(emptyAccountPlan).map(k => [k,row?.[k as keyof AccountPlanInput] ?? emptyAccountPlan[k as keyof AccountPlanInput]])) as AccountPlanInput;
      setPlan(next); setSaved(next); setError(null);
    }).catch(e => {if(!controller.signal.aborted) setError(e.message);})
      .finally(() => {if(!controller.signal.aborted) setLoading(false);});
    return () => controller.abort();
  },[companyId,nonce]);
  React.useEffect(() => {
    if(!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload',guard);
    return () => window.removeEventListener('beforeunload',guard);
  },[dirty]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setNotice('');
    try {
      const response = await fetch(`/api/crm/companies/${companyId}/plan`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(plan)});
      const json = await response.json();
      if(!response.ok) {
        if(response.status===409) setConflict(await getOne<AccountPlan>(`/api/crm/companies/${companyId}/plan`));
        throw new Error(json.error?.message ?? 'Could not save this plan.');
      }
      const next = {...plan,version:json.data.version};
      setPlan(next); setSaved(next); setConflict(null); setNotice(`Revision ${next.version} saved.`);
    } catch(e) { setError(e instanceof Error ? e.message : 'Could not save this plan.'); }
    finally {setBusy(false);}
  }
  if(loading) return <p role="status" className="p-4 text-sm text-muted-foreground">Loading account plan…</p>;
  if(error && !saved.version && !dirty) return <div role="alert" className="space-y-3 p-4 text-sm"><p>{error}</p><Button variant="outline" onClick={()=>setNonce(n=>n+1)}>Retry</Button></div>;
  return <form onSubmit={save} className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-muted/20 p-4"><div><h3 className="text-sm font-semibold">Account plan</h3><p className="mt-1 text-xs text-muted-foreground">Turn relationship context into shared objectives and next steps.</p></div><span className="rounded-md border bg-background px-2 py-1 text-[11px] text-muted-foreground">{plan.version ? `Revision ${plan.version}` : 'No saved plan'}</span></div>
    {error && <p role="alert" className="rounded border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
    {conflict && <div className="rounded border border-border p-3 text-sm"><p>A newer revision exists. Your draft is preserved below. Compare it before choosing which version to keep.</p>
      <details className="my-2"><summary>Review revision {conflict.version}</summary>{fields.map(([key,label])=><div key={key} className="mt-2"><strong>{label}</strong><p className="whitespace-pre-wrap break-words">{conflict[key] || 'Not recorded'}</p></div>)}<pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(conflict.items,null,2)}</pre><p className="mt-2">Review date: {conflict.reviewDate || 'Not scheduled'}</p><p>Plan owner: {owners.find(o=>o.memberId===conflict.ownerId)?.fullName || (conflict.ownerId===memberId?'You':conflict.ownerId?'Another workspace member':'Unassigned')}{conflict.ownerId!==plan.ownerId?' · differs from your draft':''}</p></details>
      <Button type="button" variant="outline" onClick={()=>{setPlan(p=>({...p,version:conflict.version}));setConflict(null);setError(null);}}>Keep draft and enable a reviewed save</Button>
    </div>}
    <fieldset disabled={!mayEdit || busy} className="space-y-4 disabled:opacity-70">
      <StructuredPlan items={plan.items} owners={owners} onChange={items=>setPlan(p=>({...p,items}))}/>
      <details className="rounded-xl border p-4"><summary className="cursor-pointer text-sm font-medium">Strategy narrative and existing planning notes</summary><div className="mt-4 grid gap-3 lg:grid-cols-2">{fields.map(([key,label,hint])=>{const Icon=fieldIcons[key];return <div key={key} className={`min-w-0 rounded-xl border bg-card p-4 ${key==='objectives'?'lg:col-span-2':''}`}><label htmlFor={`plan-${key}`} className="flex items-center gap-2 text-sm font-medium"><Icon aria-hidden="true" className="size-4 text-primary"/>{label}</label><p id={`plan-${key}-hint`} className="mb-3 mt-1.5 text-xs leading-5 text-muted-foreground">{hint}</p><Textarea id={`plan-${key}`} aria-describedby={`plan-${key}-hint`} maxLength={12000} rows={4} value={plan[key]} onChange={e=>setPlan(p=>({...p,[key]:e.target.value}))}/></div>;})}</div></details>
      <div><label htmlFor="plan-owner-search" className="text-xs font-medium">Find an account owner</label><Input id="plan-owner-search" placeholder="Search the workspace directory" value={ownerSearch} onChange={e=>setOwnerSearch(e.target.value)}/></div>
      <div className="grid gap-3 sm:grid-cols-2"><div><label htmlFor="plan-review" className="text-xs font-medium">Review date</label><Input id="plan-review" type="date" value={plan.reviewDate ?? ''} onChange={e=>setPlan(p=>({...p,reviewDate:e.target.value || null}))}/></div>
        <div><label htmlFor="plan-owner" className="text-xs font-medium">Plan owner</label><select id="plan-owner" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={plan.ownerId ?? ''} onChange={e=>setPlan(p=>({...p,ownerId:e.target.value || null}))}><option value="">Unassigned</option>{plan.ownerId && !owners.some(o=>o.memberId===plan.ownerId) && <option value={plan.ownerId}>{plan.ownerId===memberId ? 'You' : 'Current owner'}</option>}{owners.map(o=><option key={o.memberId} value={o.memberId}>{o.fullName}</option>)}</select>{ownerError && <p className="mt-1 text-xs text-destructive">Could not load the directory. Existing ownership is preserved.</p>}</div></div>
    </fieldset>
    <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">{mayEdit && <Button type="submit" disabled={busy || !dirty || Boolean(conflict)}>{busy ? 'Saving…' : 'Save plan'}</Button>}<span role="status" className="text-xs text-muted-foreground">{notice || (dirty ? 'Unsaved changes' : saved.version ? 'All changes saved' : 'Add a strategy to create the first revision')}</span></div>
    <PlanHistory companyId={companyId} version={saved.version}/>
  </form>;
}
