'use client';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import type { Column } from '@/components/shared/record-table';
import type { CrmObject, CustomValues, FieldDefinition } from '@/lib/crm/customization';
import { getList, getOne, post } from './data';

type Presentation = {hidden:string[];order:string[];density:'comfortable'|'compact'};
const initial:Presentation={hidden:[],order:[],density:'comfortable'};
export function useListPresentation<T extends {customValues?:CustomValues}>(object:CrmObject,standard:Column<T>[]) {
 const appliedView=React.useRef(false);
 const [fields,setFields]=React.useState<FieldDefinition[]>([]);
 const [settings,setSettings]=React.useState(initial);
 const [version,setVersion]=React.useState(0);
 const [ready,setReady]=React.useState(false);
 const [busy,setBusy]=React.useState(false);
 const [message,setMessage]=React.useState('');
 React.useEffect(()=>{
  const abort=new AbortController();
  Promise.all([getList<FieldDefinition>(`/api/crm/settings/fields?object=${object}`,abort.signal),getOne<{version:number;settings:Presentation|null}>(`/api/crm/settings/list-preferences?object=${object}`,abort.signal)]).then(([metadata,prefs])=>{
   if(abort.signal.aborted)return;
   setFields(metadata.data.filter(f=>!f.archived));setVersion(prefs.version);if(!appliedView.current)setSettings(prefs.settings??{...initial,hidden:metadata.data.filter(f=>!f.archived).map(f=>`custom:${f.id}`)});setReady(true);
  }).catch(e=>{if(!abort.signal.aborted)setMessage(e.message)});
  return()=>abort.abort();
 },[object]);
 const custom:Column<T>[]=fields.map(field=>({header:`${field.label} · ${field.key}`,card:'meta',cell:row=>{
  const value=row.customValues?.[field.id];return <span className="break-words">{Array.isArray(value)?value.join(', '):typeof value==='boolean'?value?'Yes':'No':value==null?'—':String(value)}</span>;
 }}));
 const all=[...standard,...custom];
 const columnId=(column:Column<T>)=>{const index=custom.indexOf(column);return index<0?column.header:`custom:${fields[index].id}`;};
 const ordered=[...all].sort((a,b)=>{
  const ai=settings.order.indexOf(columnId(a)),bi=settings.order.indexOf(columnId(b));
  return (ai<0?1000+all.indexOf(a):ai)-(bi<0?1000+all.indexOf(b):bi);
 });
 // Custom columns are opt-in until a user explicitly chooses a presentation.
 const columns=ordered.filter(c=>c.card==='title'||!settings.hidden.includes(columnId(c)));
 async function save(){setBusy(true);try{const result=await post<{version:number}>('/api/crm/settings/list-preferences',{object,version,settings});setVersion(result.version);setMessage('Default list presentation saved');}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}}
 function move(header:string,delta:number){const order=ordered.map(columnId);const at=order.indexOf(header);const to=at+delta;if(to<0||to>=order.length)return;[order[at],order[to]]=[order[to],order[at]];setSettings({...settings,order})}
 const controls=<details className="rounded-md border bg-white p-3"><summary className="cursor-pointer text-sm font-medium">Columns and density</summary><div className="mt-3 max-h-72 space-y-2 overflow-auto">{ordered.map((c,index)=><div key={c.header} className="flex items-center justify-between gap-2 text-xs"><label className="flex gap-2"><input type="checkbox" disabled={c.card==='title'} checked={columns.includes(c)} onChange={e=>{const hidden=settings.hidden;setSettings({...settings,hidden:e.target.checked?hidden.filter(h=>h!==columnId(c)):[...hidden,columnId(c)]})}} />{c.header}</label><div className="flex gap-1"><Button size="sm" variant="ghost" disabled={index===0} onClick={()=>move(columnId(c),-1)}>Up</Button><Button size="sm" variant="ghost" disabled={index===ordered.length-1} onClick={()=>move(columnId(c),1)}>Down</Button></div></div>)}</div><div className="mt-3 flex flex-wrap items-center gap-3"><label className="text-xs">Density <select className="rounded border p-2" value={settings.density} onChange={e=>setSettings({...settings,density:e.target.value as Presentation['density']})}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label><Button size="sm" disabled={!ready||busy} onClick={()=>void save()}>Save default presentation</Button></div>{message&&<p className="mt-2 text-xs" role="status">{message}</p>}</details>;
 const applyView=React.useCallback((view:Presentation)=>{appliedView.current=true;setSettings(view)},[]);
 return {columns,controls,settings,applyView,className:settings.density==='compact'?'[&_td]:!py-1 [&_th]:!py-1':''};
}
