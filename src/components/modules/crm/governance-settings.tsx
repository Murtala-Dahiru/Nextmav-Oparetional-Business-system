'use client';
import { useAppStore } from '@/store/app-store';
import type { CrmSection } from './types';
import { AssignmentPanel } from './assignment-panel';
import { LayoutEditor } from './layout-editor';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fieldTypes, type CrmObject, type FieldDefinition } from '@/lib/crm/customization';
import { getList, getOne, post } from './data';

export function GovernanceSettings({ onGo }: { onGo: (section: CrmSection) => void }) {
  const [panel, setPanel] = React.useState<'general'|'fields'|'layouts'|'audit'>('fields');
  const organization = useAppStore(s=>s.organization);
  const setActiveModule = useAppStore(s => s.setActiveModule);
  const [object, setObject] = React.useState<CrmObject>('leads');
  const [fields, setFields] = React.useState<FieldDefinition[]>([]);
  const [draft, setDraft] = React.useState<Omit<FieldDefinition, 'id'> & { id: string | null } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState('');
  const [audit, setAudit] = React.useState<{id:number;actor:string;action:string;object:string;label?:string;createdAt:string}[]>([]);
  const [usage,setUsage]=React.useState<{label:string;records:number;dependencies:{kind:string;name:string}[]}|null>(null);
  const [showAudit,setShowAudit] = React.useState(false);
  async function loadUsage(field:FieldDefinition) {try{const result=await getOne<{records:number;dependencies:{kind:string;name:string}[]}>(`/api/crm/settings/field-usage?id=${field.id}`);setUsage({...result,label:field.label});}catch(e){toast.error((e as Error).message)}}
  async function loadAudit() {
    try { setAudit((await getList<typeof audit[number]>('/api/crm/settings/audit')).data); setShowAudit(true); }
    catch (e) { toast.error((e as Error).message); }
  }
  function suggest(label: string, key: string, type: FieldDefinition['type'], options: string[]) {
    setDraft({ id:null, version:0, object, key, label, type, required:false, archived:false, options, position:fields.length });
  }
  const loadSequence = React.useRef(0);
  const reload = React.useCallback(async () => {
    const sequence = ++loadSequence.current;
    try { const result = await getList<FieldDefinition>(`/api/crm/settings/fields?object=${object}`); if (sequence === loadSequence.current) { setFields(result.data); setFailure(''); } }
    catch (e) { if (sequence === loadSequence.current) setFailure((e as Error).message); }
  }, [object]);
  React.useEffect(() => { void reload(); }, [reload]);
  async function save() {
    if (!draft) return;
    setBusy(true);
    try { await post('/api/crm/settings/fields', draft); setDraft(null); await reload(); toast.success('Field configuration saved'); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="mx-auto max-w-5xl space-y-6"><header><h1 className="text-2xl font-semibold tracking-tight">CRM settings</h1><p className="mt-2 text-sm text-muted-foreground">Configure your CRM with organization fields, published layouts and auditable changes.</p></header>
    <nav aria-label="CRM configuration" className="flex flex-wrap gap-2">{(['general','fields','layouts','audit'] as const).map(value=><Button key={value} variant={panel===value?'default':'outline'} onClick={()=>setPanel(value)}>{value==='general'?'General':value==='fields'?'Fields':value==='layouts'?'Layouts':'Audit history'}</Button>)}<Button variant="outline" onClick={()=>onGo('pipeline')}>Pipelines</Button><Button variant="outline" onClick={()=>onGo('automations')}>Automation</Button><Button variant="outline" onClick={()=>onGo('import')}>Data management</Button><Button variant="outline" onClick={()=>setActiveModule('admin')}>Organization &amp; permissions</Button></nav>
    <p className="text-xs text-muted-foreground">Organization preferences and user roles use the shared BOS administration controls. Personal and shared views are configured from each record list.</p>
    {panel==='general' && <section className="space-y-4"><div className="rounded-xl border bg-white p-5"><h2 className="font-semibold">Organization preferences</h2><dl className="my-4 grid gap-4 text-sm sm:grid-cols-3">{[['Currency',organization?.currency],['Timezone',organization?.timezone],['Locale',organization?.locale]].map(([label,value])=><div key={label}><dt className="text-muted-foreground">{label}</dt><dd>{value}</dd></div>)}</dl><Button size="sm" variant="outline" onClick={()=>setActiveModule('admin')}>Open organization administration</Button></div><AssignmentPanel /></section>}
    {(panel==='fields'||panel==='layouts') && <div className="flex flex-wrap items-center justify-between gap-3"><label className="text-sm">Record type <select className="ml-3 rounded-md border p-2" value={object} disabled={busy} onChange={e => { ++loadSequence.current; setFields([]); setUsage(null); setObject(e.target.value as CrmObject); setDraft(null); }}>{['leads', 'contacts', 'companies', 'deals'].map(o => <option key={o}>{o}</option>)}</select></label><Button disabled={busy || fields.length >= 100} onClick={() => { setPanel('fields'); setDraft({ id: null, version: 0, object, key: '', label: '', type: 'text', required: false, archived: false, options: [], position: fields.length }); }}>Create field</Button></div>}
    {failure && <p role="alert" className="text-destructive">{failure}</p>}
    {panel==='fields' && <><details className="rounded-lg border bg-white p-4"><summary className="cursor-pointer text-sm font-medium">Start from an industry field</summary><p className="my-3 text-xs text-muted-foreground">Review the suggested definition before saving it to {object}.</p><div className="flex flex-wrap gap-2">{([
      ['Real estate','Property Type','property_type','dropdown',['Residential','Commercial','Land']],
      ['IT services','Service Category','service_category','dropdown',['Implementation','Support','Consulting']],
      ['Construction','Tender Deadline','tender_deadline','date',[]],
      ['Agency','Campaign Budget','campaign_budget','currency',[]],
      ['Consulting','Engagement Type','engagement_type','dropdown',['Advisory','Delivery','Retainer']],
    ] as [string,string,string,FieldDefinition['type'],string[]][]).map(([industry,label,key,type,options]) => <Button key={key} variant="outline" size="sm" disabled={busy || fields.some(f=>f.key===key)} onClick={()=>suggest(label,key,type,options)}>{industry}</Button>)}</div></details>
    {draft && <section className="space-y-4 rounded-xl border bg-white p-5"><h2 className="font-semibold">{draft.id ? 'Edit field' : 'Create organization field'}</h2><p className="text-xs text-muted-foreground">Available to users with access to this record. Required fields apply to new records and edits to custom values; existing records remain usable.</p><div className="grid gap-4 sm:grid-cols-2">
      <label className="space-y-1 text-sm">Label<Input value={draft.label} maxLength={100} onChange={e => setDraft({ ...draft, label: e.target.value })} /></label>
      <label className="space-y-1 text-sm">Internal identifier<Input disabled={!!draft.id} placeholder="property_type" value={draft.key} onChange={e => setDraft({ ...draft, key: e.target.value })} /></label>
      <label className="space-y-1 text-sm">Field type<select className="block w-full rounded-md border p-2" disabled={!!draft.id} value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value as FieldDefinition['type'],validation:{},defaultValue:null })}>{fieldTypes.map(t => <option key={t}>{t}</option>)}</select></label>
      <label className="space-y-1 text-sm">Display position<Input type="number" min={0} max={100} value={draft.position} onChange={e => setDraft({ ...draft, position: Number(e.target.value) })} /></label>
    </div>{['dropdown', 'multiselect'].includes(draft.type) && <label className="block text-sm">Options (one per line; existing options are retained)<textarea className="mt-1 block min-h-24 w-full rounded-md border p-2" value={draft.options.join('\n')} onChange={e => setDraft({ ...draft, options: e.target.value.split('\n') })} /></label>}
    {['number','currency','percentage','text','multiline','email','phone','url'].includes(draft.type) && <fieldset className="rounded border p-3"><legend className="px-1 text-sm">Validation for new or changed values</legend><div className="flex gap-3">{(['number','currency','percentage'].includes(draft.type)?['min','max']:['maxLength']).map(rule=><label className="text-xs" key={rule}>{rule==='maxLength'?'Maximum characters':rule==='min'?'Minimum':'Maximum'}<Input type="number" value={draft.validation?.[rule as 'min'|'max'|'maxLength']??''} onChange={e=>{const validation={...draft.validation};if(e.target.value==='')delete validation[rule as 'min'];else validation[rule as 'min']=Number(e.target.value);setDraft({...draft,validation})}} /></label>)}</div></fieldset>}
    <label className="block text-sm">Default for new records<Input placeholder={draft.type==='multiselect'?'Options separated by |':draft.type==='checkbox'?'true or false':'No default'} value={Array.isArray(draft.defaultValue)?draft.defaultValue.join('|'):String(draft.defaultValue??'')} onChange={e=>{const v=e.target.value;setDraft({...draft,defaultValue:v===''?null:draft.type==='multiselect'?v.split('|'):['number','currency','percentage'].includes(draft.type)&&Number.isFinite(Number(v))?Number(v):draft.type==='checkbox'&&['true','false'].includes(v)?v==='true':v})}} /></label>
    <div className="flex gap-6 text-sm"><label><input type="checkbox" checked={draft.required} onChange={e => setDraft({ ...draft, required: e.target.checked })} /> Required</label><label><input type="checkbox" checked={draft.archived} onChange={e => setDraft({ ...draft, archived: e.target.checked })} /> Archived</label></div>
    {draft.archived && <p className="text-sm text-muted-foreground">Archiving preserves existing values and makes them read-only. The field is removed from new record entry.</p>}
    <div className="flex gap-2"><Button disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save field'}</Button><Button variant="outline" disabled={busy} onClick={() => setDraft(null)}>Cancel</Button></div></section>}
    <div className="divide-y rounded-xl border bg-white">{fields.length ? fields.map(f => <div className="flex items-center justify-between gap-3 p-4" key={f.id}><div><p className="text-sm font-medium">{f.label} {f.archived && <span className="text-muted-foreground">· Archived</span>}</p><p className="mt-1 text-xs text-muted-foreground">{f.key} · {f.type} · {f.required ? 'Required' : 'Optional'} · Revision {f.version}</p></div><Button variant="ghost" size="sm" onClick={()=>void loadUsage(f)}>Usage</Button><Button variant="outline" size="sm" onClick={() => { const { id, version, key, label, type, required, archived, options, position } = f; setDraft({ id, version, object, key, label, type, required, archived, options, position, defaultValue:f.defaultValue, validation:f.validation }); }}>Edit</Button></div>) : <p className="p-8 text-sm text-muted-foreground">Your standard CRM is ready to use. Add organization fields when your process needs them.</p>}</div>
    {usage && <section className="rounded-lg border bg-white p-4"><div className="flex justify-between"><h2 className="font-semibold">{usage.label} usage</h2><Button variant="ghost" size="sm" onClick={()=>setUsage(null)}>Close usage</Button></div><p className="my-2 text-sm">{usage.records} records retain a value.</p>{usage.dependencies.length?<ul className="space-y-1 text-sm">{usage.dependencies.map((d,i)=><li key={i}>{d.kind} · {d.name}</li>)}</ul>:<p className="text-sm text-muted-foreground">No saved configuration references this field.</p>}</section>}
    </>}
    {panel==='layouts' && <LayoutEditor key={object} object={object} fields={fields} />}
    {panel==='audit' && <section className="space-y-3 rounded-xl border bg-white p-5"><div className="flex items-center justify-between"><h2 className="font-semibold">Configuration history</h2><Button size="sm" variant="outline" onClick={()=>void loadAudit()}>{showAudit?'Refresh history':'View history'}</Button></div>{showAudit && (audit.length ? <ul className="divide-y">{audit.map(event=><li key={event.id} className="py-2 text-sm"><strong>{event.action}</strong> · {event.label ?? event.object}<p className="text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString()} · Member {event.actor}</p></li>)}</ul> : <p className="text-sm text-muted-foreground">No recorded configuration changes.</p>)}</section>}
  </div>;
}
