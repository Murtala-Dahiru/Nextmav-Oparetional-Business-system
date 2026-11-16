'use client';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { getOne, exact } from './data';
import { useModuleRealtime } from '@/hooks/use-realtime';

type Bucket = { category: string; dealCount: number; totalValue: number; weightedValue: number };
const categories = [{id:'commit',name:'Commit'},{id:'best_case',name:'Best case'},{id:'pipeline',name:'Pipeline'},{id:'omitted',name:'Omitted'},{id:'won',name:'Closed won'},{id:'lost',name:'Closed lost'}];
export function PipelineForecast({ url,onDrillDown,currency }: { currency?:string;url: string;workspace?:boolean;onDrillDown?:(category:string)=>void }) {
  const [rows,setRows]=React.useState<Bucket[]>([]);
  const [loading,setLoading]=React.useState(true);
  const [error,setError]=React.useState('');
  const [nonce,setNonce]=React.useState(0);
  const refresh=React.useCallback(()=>setNonce(n=>n+1),[]);
  React.useEffect(()=>{const c=new AbortController();setLoading(true);setError('');getOne<Bucket[]|{forecast:Bucket[]}>(url,c.signal).then(data=>{if(!c.signal.aborted)setRows(Array.isArray(data)?data:data.forecast);}).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setLoading(false);});return()=>c.abort();},[url,nonce]);
  useModuleRealtime('crm-pipeline-forecast',['deals'],refresh);
  const included=rows.filter(r=>['commit','best_case','pipeline'].includes(r.category));
  const weighted=included.reduce((sum,r)=>sum+Number(r.weightedValue),0);
  const open=included.reduce((sum,r)=>sum+Number(r.totalValue),0);
  const won=Number(rows.find(r=>r.category==='won')?.totalValue??0);
  const maximum=Math.max(1,...rows.map(r=>Number(r.totalValue)));
  return <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
    <div><h3 className="text-base font-semibold">Forecast and closed business</h3><p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">Current opportunities by forecast category, in {currency??'organization currency'} only. Date filters use expected close date for every row, including closed deals. Won deal value is closed business, not invoiced or collected revenue.</p></div>
    {error?<div role="alert" className="text-sm text-destructive">{error}<Button size="sm" variant="ghost" onClick={refresh}>Retry</Button></div>:loading?<p role="status" className="py-8 text-center text-sm text-muted-foreground">Calculating forecast…</p>:<>
      <div className="grid gap-3 sm:grid-cols-3">{[{label:'Included open pipeline',value:open,note:'Commit, best case and pipeline'},{label:'Weighted forecast',value:weighted,note:'Open value × probability; omitted excluded'},{label:'Closed won',value:won,note:'Actual recorded won deal value'}].map(k=><div key={k.label} className="rounded-lg border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">{k.label}</p><p className="mt-2 break-words text-xl font-semibold tabular-nums">{exact(k.value,currency)}</p><p className="mt-1 text-[11px] text-muted-foreground">{k.note}</p></div>)}</div>
      {!rows.length?<p className="py-6 text-center text-sm text-muted-foreground">No deals match these filters.</p>:<div className="overflow-x-auto"><table className="w-full min-w-[440px] text-left text-sm"><caption className="sr-only">Current forecast category values and deal counts</caption><thead><tr className="border-b text-xs text-muted-foreground"><th className="py-3 font-medium">Category</th><th className="text-right font-medium">Deals</th><th className="text-right font-medium">Value</th><th className="text-right font-medium">Weighted open value</th></tr></thead><tbody>{categories.map(c=>{const row=rows.find(r=>r.category===c.id);return <tr key={c.id} className="border-b last:border-0"><td className="py-3 pr-4">{onDrillDown?<button className="font-medium text-blue-700 underline-offset-4 hover:underline" onClick={()=>onDrillDown(c.id)}>{c.name} →</button>:<span className="font-medium">{c.name}</span>}<div aria-hidden="true" className="mt-2 h-1 w-28 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${c.id==='won'?'bg-emerald-500':c.id==='lost'||c.id==='omitted'?'bg-slate-300':'bg-blue-500'}`} style={{width:`${100*Number(row?.totalValue??0)/maximum}%`}}/></div></td><td className="text-right tabular-nums">{row?.dealCount??0}</td><td className="text-right tabular-nums">{exact(row?.totalValue??0,currency)}</td><td className="text-right tabular-nums">{['won','lost','omitted'].includes(c.id)?'Excluded':exact(row?.weightedValue??0,currency)}</td></tr>;})}</tbody></table></div>}
      <p className="text-xs text-muted-foreground">This is a current forecast, not a historical snapshot. Category totals are mutually exclusive; closed outcomes override the former forecast category.</p>
    </>}
  </section>;
}
