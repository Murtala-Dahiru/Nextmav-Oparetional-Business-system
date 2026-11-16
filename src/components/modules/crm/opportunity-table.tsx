'use client';
import * as React from 'react';
import {Button} from '@/components/ui/button';
import {money,relativeDay,daysUntil} from './data';
import type {Deal} from './types';
import type {PipelineInput} from '@/lib/crm/pipelines';
type Column={id:string;label:string;value:(deal:Deal)=>string};
export function OpportunityTable({rows,pipeline,selected,onSelected,onOpen,disabled,storageKey}:{rows:Deal[];pipeline:PipelineInput;selected:string[];onSelected:(ids:string[])=>void;onOpen:(id:string)=>void;disabled:boolean;storageKey:string}){
 const columns:Column[]=[
  {id:'company',label:'Company',value:d=>d.company?.name??'—'},
  {id:'owner',label:'Owner',value:d=>d.owner?.profiles?.fullName??'Unassigned'},
  {id:'pipeline',label:'Pipeline',value:()=>pipeline.name},
  {id:'stage',label:'Stage',value:d=>pipeline.stages.find(s=>s.id===d.pipelineStageId)?.name??'—'},
  {id:'currency',label:'Currency',value:d=>d.currency},
  {id:'value',label:'Amount',value:d=>money(d.value,d.currency)},
  {id:'probability',label:'Probability',value:d=>`${d.probability}%`},
  {id:'expectedClose',label:'Expected close',value:d=>d.expectedClose??'—'},
  {id:'nextStep',label:'Next action',value:d=>d.nextStep||'Not recorded'},
  {id:'lastActivityAt',label:'Last engagement',value:d=>d.lastActivityAt?relativeDay(d.lastActivityAt):'No recorded engagement'},
  {id:'stageAge',label:'Time in stage',value:d=>d.stageEnteredAt&&!['closed_won','closed_lost'].includes(d.stage)?`${Math.max(0,Math.floor((Date.now()-Date.parse(d.stageEnteredAt))/86400000))} days`:'—'},
  {id:'updatedAt',label:'Last updated',value:d=>relativeDay(d.updatedAt)},
  {id:'age',label:'Deal age',value:d=>`${Math.max(0,Math.floor(((d.closedAt?Date.parse(d.closedAt):Date.now())-Date.parse(d.createdAt))/86400000))} days`},
  {id:'risk',label:'Risk',value:d=>['closed_won','closed_lost'].includes(d.stage)?'Closed':(daysUntil(d.expectedClose)??0)<0?'Past close date':!d.nextStep?.trim()?'Missing next action':'—'},
 ];
 const defaults=['company','owner','stage','value','currency','expectedClose','nextStep','risk'];
 const [visible,setVisible]=React.useState(defaults);const [error,setError]=React.useState('');
 React.useEffect(()=>{try{const stored=JSON.parse(localStorage.getItem(`${storageKey}:columns`)??'null');if(Array.isArray(stored)&&stored.every(v=>typeof v==='string'))setVisible(stored.filter(v=>columns.some(c=>c.id===v)));}catch{setError('Column preferences could not be loaded.');}},[storageKey]); // columns are a fixed vocabulary
 function toggle(id:string){const next=visible.includes(id)?visible.filter(v=>v!==id):[...visible,id];setVisible(next);try{localStorage.setItem(`${storageKey}:columns`,JSON.stringify(next));}catch{setError('Column preferences could not be saved.');}}
 function exportPage(){
  const active=columns.filter(c=>visible.includes(c.id)||c.id==='currency');
  const cell=(value:string)=>`"${(/^[=+@\-\t\r]/.test(value)?`'${value}`:value).replaceAll('"','""')}"`;
  const csv=[['Opportunity',...active.map(c=>c.label)],...rows.map(d=>[d.name,...active.map(c=>c.id==='value'?String(d.value):c.value(d))])].map(r=>r.map(cell).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='opportunities-current-page.csv';link.click();URL.revokeObjectURL(url);
 }
 const active=columns.filter(c=>visible.includes(c.id));
 return <><div className="flex flex-wrap items-start justify-between gap-2 border-b p-3"><details className="text-xs"><summary className="cursor-pointer font-medium">Columns</summary><div className="mt-3 flex max-w-2xl flex-wrap gap-3">{columns.map(c=><label key={c.id} className="flex items-center gap-1.5"><input type="checkbox" checked={visible.includes(c.id)} onChange={()=>toggle(c.id)}/>{c.label}</label>)}</div></details><Button size="sm" variant="ghost" disabled={!rows.length} onClick={exportPage}>Export this page · {rows.length} rows</Button></div>{error&&<p role="status" className="p-3 text-xs text-muted-foreground">{error}</p>}<div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><caption className="sr-only">Opportunities in the selected pipeline and filters</caption><thead><tr className="border-b bg-muted/20 text-xs text-muted-foreground"><th className="p-3"><input type="checkbox" aria-label="Select this page" disabled={disabled||!rows.length} checked={rows.length>0&&rows.every(d=>selected.includes(d.id))} onChange={e=>onSelected(e.target.checked?rows.map(d=>d.id):[])}/></th><th className="p-3 font-medium">Opportunity</th>{active.map(c=><th key={c.id} className="whitespace-nowrap p-3 font-medium">{c.label}</th>)}</tr></thead><tbody>{!rows.length&&<tr><td colSpan={active.length+2} className="p-10 text-center text-muted-foreground">No opportunities match these filters.</td></tr>}{rows.map(d=><tr key={d.id} className="border-b last:border-0 hover:bg-muted/20"><td className="p-3"><input type="checkbox" aria-label={`Select ${d.name}`} disabled={disabled} checked={selected.includes(d.id)} onChange={e=>onSelected(e.target.checked?[...selected,d.id]:selected.filter(id=>id!==d.id))}/></td><td className="min-w-48 p-3"><button className="text-left font-medium hover:text-blue-700" onClick={()=>onOpen(d.id)}>{d.name}</button></td>{active.map(c=><td key={c.id} className="max-w-64 p-3 text-xs"><span className="line-clamp-2" title={c.value(d)}>{c.value(d)}</span></td>)}</tr>)}</tbody></table></div></>;
}
