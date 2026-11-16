'use client';
import * as React from 'react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {patch} from './data';
export type PipelineLifecycleData={id:string;version:number;description?:string;active?:boolean;isDefault?:boolean};
export function PipelineLifecycle({pipeline,onSaved}:{pipeline:PipelineLifecycleData;onSaved:()=>void}){
 const [description,setDescription]=React.useState(pipeline.description??'');const [active,setActive]=React.useState(pipeline.active!==false);const [isDefault,setDefault]=React.useState(Boolean(pipeline.isDefault));const [error,setError]=React.useState('');const [busy,setBusy]=React.useState(false);
 async function save(archive=false){setBusy(true);setError('');try{await patch(`/api/crm/pipelines/${pipeline.id}/lifecycle`,{version:pipeline.version,description,active:archive?false:active,isDefault:archive?false:isDefault,archive});onSaved();}catch(e){setError(e instanceof Error?e.message:'Could not save settings');}finally{setBusy(false);}}
 return <fieldset disabled={busy} className="space-y-3 rounded-lg border p-3"><legend className="px-1 text-xs font-medium">Availability and purpose</legend><label className="grid gap-1 text-xs">Description<Textarea rows={2} maxLength={4000} value={description} onChange={e=>setDescription(e.target.value)}/></label><div className="flex flex-wrap gap-4 text-xs"><label><input type="checkbox" checked={active} onChange={e=>{setActive(e.target.checked);if(!e.target.checked)setDefault(false);}}/> Accept new deals</label><label><input type="checkbox" disabled={!active} checked={isDefault} onChange={e=>setDefault(e.target.checked)}/> Default pipeline</label></div><p className="text-xs text-muted-foreground">Inactive pipelines retain existing deals. Archiving is allowed only when no live deal records remain.</p>{error&&<p role="alert" className="text-xs text-destructive">{error}</p>}<div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={()=>void save()}>Save availability</Button><Button type="button" size="sm" variant="ghost" onClick={()=>void save(true)}>Archive empty pipeline</Button></div></fieldset>;
}
