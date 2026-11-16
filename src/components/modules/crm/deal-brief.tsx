'use client';
import * as React from 'react';
import type {Deal} from './types';
import type {PipelineInput} from '@/lib/crm/pipelines';
import {getOne,daysUntil} from './data';
export function DealBrief({deal}:{deal:Deal}){
 const [pipeline,setPipeline]=React.useState<PipelineInput|null>(null);
 React.useEffect(()=>{if(!deal.pipelineId)return;const c=new AbortController();getOne<PipelineInput[]>('/api/crm/pipelines',c.signal).then(rows=>{if(!c.signal.aborted)setPipeline(rows.find(p=>p.id===deal.pipelineId)??null);}).catch(()=>{});return()=>c.abort();},[deal.pipelineId,deal.pipelineVersion]);
 const stage=pipeline?.stages.find(s=>s.id===deal.pipelineStageId);const closed=['closed_won','closed_lost'].includes(deal.stage);
 const facts=[['Currency',deal.currency],['Owner',deal.owner?.profiles?.fullName??'Unassigned'],['Pipeline',pipeline?.name??(deal.pipelineId?'Loading configured pipeline…':'Sales overview')],['Stage',stage?.name??deal.stage.replaceAll('_',' ')],['Expected close',deal.expectedClose??'Not scheduled'],['Deal team',`${deal.dealTeamIds?.length??0} members`],['Forecast',deal.forecastCategory?.replaceAll('_',' ')??'Pipeline']];
 return <section className="space-y-4 rounded-xl border bg-white p-4"><div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">{facts.map(([label,value])=><div key={label}><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-1 text-xs font-medium">{value}</p></div>)}</div><div className="border-t pt-3"><p className="text-[11px] font-medium text-muted-foreground">Next action</p><p className="mt-1 text-sm">{deal.nextStep||'No next action recorded. Add one in Sales details.'}</p></div>{!closed&&(daysUntil(deal.expectedClose)??0)<0&&<p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">The expected close date has passed. Confirm the new date with the customer.</p>}{stage?.entryGuidance&&<p className="text-xs leading-5 text-muted-foreground">Stage guidance: {stage.entryGuidance}</p>}{Boolean(stage?.requiredFields.length)&&<p className="text-xs text-muted-foreground">Stage requirements: {stage?.requiredFields.join(', ').replaceAll('_',' ')}</p>}</section>;
}
