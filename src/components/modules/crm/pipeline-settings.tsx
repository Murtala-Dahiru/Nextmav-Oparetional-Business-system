'use client';
import * as React from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {useAppStore} from '@/store/app-store';
import {canonicalStages,pipelineSchema,stageFields,type PipelineInput,type PipelineStageInput} from '@/lib/crm/pipelines';
import {getOne,post} from './data';
import {PipelineLifecycle,type PipelineLifecycleData} from './pipeline-lifecycle';
import {STAGE_LABELS} from './types';

const selectClass='h-9 w-full rounded-md border border-input bg-background px-2 text-sm';
function newStage(name:string,canonicalStage:PipelineStageInput['canonicalStage']='prospecting'):PipelineStageInput {
 return {id:crypto.randomUUID(),name,canonicalStage,probability:canonicalStage==='closed_won'?100:canonicalStage==='closed_lost'?0:20,inactivityDays:30,entryGuidance:'',exitGuidance:'',requiredFields:[],exitRequiredFields:[],allowedNext:[],ownerId:null,requiresApproval:false};
}
type PipelineRow=PipelineInput & PipelineLifecycleData;
export function PipelineSettings({onSaved}:{onSaved?:()=>void}){
 const mayManage=useAppStore(s=>s.allows('crm','manage'));
 const [customEvidence,setCustomEvidence]=React.useState<{id:string;label:string;archived:boolean}[]>([]);
 const [template,setTemplate]=React.useState('simple');
 const [open,setOpen]=React.useState(false);
 const [rows,setRows]=React.useState<PipelineRow[]>([]);
 const [draft,setDraft]=React.useState<PipelineInput|null>(null);
 const [baseline,setBaseline]=React.useState('');
 const [loading,setLoading]=React.useState(false);
 const [busy,setBusy]=React.useState(false);
 const [error,setError]=React.useState('');
 const [notice,setNotice]=React.useState('');
 const [revision,setRevision]=React.useState(0);
 const [owners,setOwners]=React.useState<{memberId:string;fullName:string}[]>([]);
 const [ownerError,setOwnerError]=React.useState(false);
 const dirty=Boolean(draft&&JSON.stringify(draft)!==baseline);
 React.useEffect(()=>{
  if(!open)return;
  const controller=new AbortController();setLoading(true);setError('');
  getOne<{id:string;label:string;archived:boolean}[]>('/api/crm/settings/fields?object=deals',controller.signal).then(data=>{if(!controller.signal.aborted)setCustomEvidence(data.filter(f=>!f.archived))}).catch(()=>{});
  getOne<PipelineRow[]>('/api/crm/pipelines',controller.signal).then(data=>{if(!controller.signal.aborted)setRows(data);})
   .catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[open,revision]);
 React.useEffect(()=>{
  if(!open||!mayManage)return;
  const controller=new AbortController();
  getOne<{memberId:string;fullName:string}[]>('/api/directory',controller.signal).then(data=>{if(!controller.signal.aborted){setOwners(data);setOwnerError(false);}}).catch(()=>{if(!controller.signal.aborted)setOwnerError(true);});
  return ()=>controller.abort();
 },[open,mayManage]);
 React.useEffect(()=>{
  if(!dirty)return;
  const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',warn);
  return ()=>window.removeEventListener('beforeunload',warn);
 },[dirty]);
 function edit(row:PipelineInput){
  // Explicitly project database responses onto writable configuration fields.
  const clean:PipelineInput={id:row.id,version:row.version,name:row.name,purpose:row.purpose,stages:row.stages.map(s=>({
   id:s.id,name:s.name,canonicalStage:s.canonicalStage,probability:s.probability,inactivityDays:s.inactivityDays,
   entryGuidance:s.entryGuidance,exitGuidance:s.exitGuidance,requiredFields:s.requiredFields,exitRequiredFields:s.exitRequiredFields,
   allowedNext:s.allowedNext,ownerId:s.ownerId,requiresApproval:s.requiresApproval,
  }))};
  setDraft(clean);setBaseline(JSON.stringify(clean));setNotice('');setError('');
 }
 function stageChange(index:number,patch:Partial<PipelineStageInput>){setDraft(d=>d?{...d,stages:d.stages.map((s,i)=>i===index?{...s,...patch}:s)}:d);}
 async function save(){
  const parsed=pipelineSchema.safeParse(draft);if(!parsed.success){setError(parsed.error.issues[0]?.message??'Check the pipeline');return;}
  setBusy(true);setError('');setNotice('');
  try{await post('/api/crm/pipelines',parsed.data);setDraft(null);setBaseline('');setRevision(r=>r+1);setNotice('Pipeline saved. Stage rules apply to every deal update.');onSaved?.();}
  catch(e){setError(e instanceof Error?e.message:'Could not save the pipeline');}finally{setBusy(false);}
 }
 return <section className="rounded-xl border border-border bg-card">
  <button type="button" aria-expanded={open} onClick={()=>setOpen(v=>!v)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium">
   <span>Pipeline configuration</span><span className="text-xs text-muted-foreground">{open?'Collapse':'Stages, requirements and approvals'}</span>
  </button>
  <div hidden={!open} className="space-y-4 border-t border-border p-4">
   <p className="text-xs leading-5 text-muted-foreground">Each custom stage maps to an existing reporting category, keeping historical reports and integrations consistent. Existing deals retain their current pipeline.</p>
   {loading&&<p role="status" className="text-sm text-muted-foreground">Loading pipelines…</p>}
   {error&&<div role="alert" className="rounded-lg border border-destructive/20 p-3 text-sm text-destructive">{error}<Button variant="ghost" size="sm" onClick={()=>setRevision(r=>r+1)}>Retry loading</Button></div>}
   {notice&&<p role="status" className="text-sm">{notice}</p>}
   {ownerError&&<p role="status" className="text-xs text-muted-foreground">The member directory could not be loaded. Existing stage owners are preserved. Reopen configuration to retry.</p>}
   {!loading&&!error&&rows.length===0&&<p className="text-sm text-muted-foreground">No custom pipelines yet. The existing sales board remains available.</p>}
   <div className="flex flex-wrap gap-2">{rows.map(row=><Button key={row.id} size="sm" variant="outline" disabled={Boolean(draft)||busy} onClick={()=>edit(row)}>{row.name}</Button>)}
   {mayManage&&<><select aria-label="Optional pipeline template" className="h-8 rounded-md border bg-background px-2 text-xs" disabled={Boolean(draft)||busy} value={template} onChange={e=>setTemplate(e.target.value)}><option value="simple">Simple sales template</option><option value="enterprise">Enterprise sales template</option><option value="consulting">Consulting template</option></select><Button size="sm" disabled={Boolean(draft)||busy||loading||Boolean(error)} onClick={()=>edit({id:null,version:0,name:'',purpose:template==='enterprise'?'enterprise':'new_business',stages:[newStage('Discovery'),...(template==='simple'?[]:template==='enterprise'?[{...newStage('Qualification','qualification'),probability:35},{...newStage('Solution validation','proposal'),probability:60},{...newStage('Commercial agreement','negotiation'),probability:80}]:[{...newStage('Scope & proposal','proposal'),probability:50},{...newStage('Agreement','negotiation'),probability:80}]),newStage('Won','closed_won'),newStage('Lost','closed_lost')]})}>New pipeline</Button></>}</div>
   {draft?.id&&mayManage&&!dirty&&rows.find(r=>r.id===draft.id)&&<PipelineLifecycle key={`${draft.id}-${rows.find(r=>r.id===draft.id)?.version}`} pipeline={rows.find(r=>r.id===draft.id)!} onSaved={()=>{setDraft(null);setBaseline('');setRevision(r=>r+1);onSaved?.();}}/>}
   {draft&&<form className="space-y-4" onSubmit={e=>{e.preventDefault();void save();}}>
    <fieldset disabled={busy||!mayManage} className="space-y-4 disabled:opacity-70">
     <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-xs font-medium">Pipeline name<Input required maxLength={100} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
      <label className="space-y-1 text-xs font-medium">Purpose<select className={selectClass} value={draft.purpose} onChange={e=>setDraft({...draft,purpose:e.target.value as PipelineInput['purpose']})}>{[['new_business','New business'],['enterprise','Enterprise sales'],['renewals','Renewals'],['partnerships','Partnerships'],['expansion','Service expansion']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label></div>
     {draft.stages.map((stage,index)=><details key={stage.id} className="rounded-lg border border-border" open={draft.version===0||undefined}>
      <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium">{index+1}. {stage.name||'Untitled stage'} <span className="ml-2 text-xs font-normal text-muted-foreground">{stage.probability}% · {stage.requiresApproval?'Approval required':STAGE_LABELS[stage.canonicalStage]}</span></summary>
      <div className="space-y-3 border-t border-border p-3">
       <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-xs">Name<Input value={stage.name} required maxLength={100} onChange={e=>stageChange(index,{name:e.target.value})}/></label>
        <label className="space-y-1 text-xs">Reporting category<select className={selectClass} value={stage.canonicalStage} onChange={e=>stageChange(index,{canonicalStage:e.target.value as PipelineStageInput['canonicalStage'],probability:e.target.value==='closed_won'?100:e.target.value==='closed_lost'?0:stage.probability})}>{canonicalStages.map(s=><option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</select></label>
        <label className="space-y-1 text-xs">Probability (%)<Input type="number" required min={0} max={100} value={stage.probability} onChange={e=>stageChange(index,{probability:Number(e.target.value)})}/></label>
        <label className="space-y-1 text-xs">Inactivity threshold (days)<Input type="number" required min={1} max={3650} value={stage.inactivityDays} onChange={e=>stageChange(index,{inactivityDays:Number(e.target.value)})}/></label>
       </div>
       <div className="grid gap-3 sm:grid-cols-2">{(['entryGuidance','exitGuidance'] as const).map(key=><label key={key} className="space-y-1 text-xs">{key==='entryGuidance'?'Entry guidance':'Exit guidance'}<Textarea rows={2} maxLength={4000} value={stage[key]} onChange={e=>stageChange(index,{[key]:e.target.value})}/></label>)}</div>
       <div className="grid gap-3 sm:grid-cols-2">{(['requiredFields','exitRequiredFields'] as const).map(key=><fieldset key={key} className="rounded-md border p-2"><legend className="px-1 text-xs font-medium">{key==='requiredFields'?'Required in this stage':'Required before leaving'}</legend><div className="flex flex-wrap gap-x-3 gap-y-2">{[...stageFields,...customEvidence.map(f=>`custom:${f.id}` as const)].map(field=><label key={field} className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={stage[key].includes(field)} onChange={e=>stageChange(index,{[key]:e.target.checked?[...stage[key],field]:stage[key].filter(f=>f!==field)})}/>{customEvidence.find(f=>'custom:'+f.id===field)?.label ?? field.replaceAll('_',' ')}</label>)}</div></fieldset>)}</div>
       <fieldset className="rounded-md border p-2"><legend className="px-1 text-xs font-medium">Allowed next stages</legend><p className="mb-2 text-xs text-muted-foreground">Leave all unchecked to allow any destination; destination requirements still apply.</p><div className="flex flex-wrap gap-3">{draft.stages.filter(s=>s.id!==stage.id).map(s=><label key={s.id} className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={stage.allowedNext.includes(s.id)} onChange={e=>stageChange(index,{allowedNext:e.target.checked?[...stage.allowedNext,s.id]:stage.allowedNext.filter(id=>id!==s.id)})}/>{s.name}</label>)}</div></fieldset>
       <div className="grid items-center gap-3 sm:grid-cols-2"><label className="space-y-1 text-xs">Stage owner<select className={selectClass} value={stage.ownerId??''} onChange={e=>stageChange(index,{ownerId:e.target.value||null})}><option value="">No stage owner</option>{stage.ownerId&&!owners.some(o=>o.memberId===stage.ownerId)&&<option value={stage.ownerId}>Current owner</option>}{owners.map(o=><option key={o.memberId} value={o.memberId}>{o.fullName}</option>)}</select></label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={stage.requiresApproval} onChange={e=>stageChange(index,{requiresApproval:e.target.checked})}/>Require administrator approval before entry</label></div>
       <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={index===0} onClick={()=>{const stages=[...draft.stages];[stages[index-1],stages[index]]=[stages[index],stages[index-1]];setDraft({...draft,stages});}}>Move up</Button><Button type="button" variant="outline" size="sm" disabled={index===draft.stages.length-1} onClick={()=>{const stages=[...draft.stages];[stages[index+1],stages[index]]=[stages[index],stages[index+1]];setDraft({...draft,stages});}}>Move down</Button><Button type="button" variant="ghost" size="sm" disabled={draft.stages.length<=2} onClick={()=>setDraft({...draft,stages:draft.stages.filter(s=>s.id!==stage.id).map(s=>({...s,allowedNext:s.allowedNext.filter(id=>id!==stage.id)}))})}>Remove stage</Button></div>
      </div>
     </details>)}
     <Button type="button" variant="outline" size="sm" disabled={draft.stages.length>=40} onClick={()=>setDraft({...draft,stages:[...draft.stages,newStage('New stage')]})}>Add stage</Button>
    </fieldset>
    <div className="flex items-center gap-2">{mayManage&&<Button type="submit" size="sm" disabled={busy||!dirty}>{busy?'Saving…':'Save pipeline'}</Button>}<Button type="button" variant="ghost" size="sm" disabled={busy} onClick={()=>{setDraft(null);setBaseline('');setError('');}}>{dirty?'Discard draft':'Close editor'}</Button><span className="text-xs text-muted-foreground">{draft.version?`Revision ${draft.version}`:'New pipeline'}</span></div>
   </form>}
  </div>
 </section>;
}
