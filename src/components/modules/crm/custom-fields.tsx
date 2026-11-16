'use client';
import * as React from 'react';
import { standardLayoutId } from '@/lib/crm/customization';
import { LinkPicker } from './link-picker';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { CrmObject, CustomValues, FieldDefinition, RecordLayout } from '@/lib/crm/customization';
import { getList, getOne } from './data';

export function useCustomValues(open: boolean, editing: { customValues?: CustomValues } | null) {
  const [values, setValues] = React.useState<CustomValues>({});
  React.useEffect(() => { if (open) setValues(editing?.customValues ?? {}); }, [open, editing]);
  return [values, setValues] as const;
}

export function CustomFields({ object, values, onChange, standardFields = [] }: { object: CrmObject; values: CustomValues; onChange?: (values: CustomValues) => void; standardFields?: {label:string;value:React.ReactNode;full?:boolean}[] }) {
  const [fields, setFields] = React.useState<FieldDefinition[]>([]);
  const [layout, setLayout] = React.useState<RecordLayout | null>(null);
  const [failure, setFailure] = React.useState('');
  React.useEffect(() => {
    const abort = new AbortController();
    Promise.all([getList<FieldDefinition>(`/api/crm/settings/fields?object=${object}`, abort.signal), getOne<{published: RecordLayout | null} | null>(`/api/crm/settings/layouts?object=${object}`, abort.signal)]).then(([r, config]) => { setFields(r.data); setLayout(config?.published ?? null); }).catch(e => { if (!abort.signal.aborted) setFailure(e.message); });
    return () => abort.abort();
  }, [object]);
  if (failure) return <p role="alert" className="text-sm text-destructive">Custom fields could not load: {failure}</p>;
  return <CustomFieldDisplay fields={fields} values={values} onChange={onChange} layout={layout} standardFields={standardFields} />;
}

export function CustomFieldDisplay({ fields, values, onChange, layout, standardFields = [] }: { fields: FieldDefinition[]; values: CustomValues; onChange?: (values: CustomValues) => void; layout: RecordLayout | null; standardFields?: {label:string;value:React.ReactNode;full?:boolean}[] }) {
  const visible = fields.filter(f => !f.archived || values[f.id] != null);

  const [members,setMembers]=React.useState<{memberId:string;fullName:string}[]>([]);
  const needsMembers=visible.some(f=>f.type==='member');
  React.useEffect(()=>{if(!needsMembers)return;const c=new AbortController();getList<{memberId:string;fullName:string}>('/api/directory?pageSize=200',c.signal).then(r=>{if(!c.signal.aborted)setMembers(r.data)}).catch(()=>{});return()=>c.abort()},[needsMembers]);
  const renderField = (f: FieldDefinition) => {
    const v = values[f.id]; const change = (value: CustomValues[string]) => onChange?.({ ...values, [f.id]: value });
    const id = `custom-${f.id}`; const readonly = !onChange || f.archived;
    return <div key={f.id} className={f.type === 'multiline' ? 'space-y-1 sm:col-span-2' : 'space-y-1'}><label htmlFor={id} className="text-xs font-medium">{f.label}{f.required && !f.archived ? ' *' : ''}{f.archived ? ' (archived)' : ''}</label>{readonly
      ? <p className="break-words text-sm text-muted-foreground">{Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? v ? 'Yes' : 'No' : v == null || v === '' ? '—' : String(v)}</p>
      : f.type==='member' ? <select id={id} className="w-full rounded border p-2" value={String(v??'')} onChange={e=>change(e.target.value||null)}><option value="">Choose member…</option>{v&&!members.some(m=>m.memberId===v)&&<option value={String(v)}>Current member</option>}{members.map(m=><option key={m.memberId} value={m.memberId}>{m.fullName}</option>)}</select>
      : f.type==='company'||f.type==='contact' ? <LinkPicker kinds={[f.type]} value={typeof v==='string'&&v?{kind:f.type,id:v,label:v}:null} onChange={record=>change(record?.id??null)} />
      : f.type === 'checkbox' ? <input id={id} className="ml-2" type="checkbox" checked={v === true} onChange={e => change(e.target.checked)} />
      : f.type === 'dropdown' || f.type === 'multiselect' ? <select id={id} className="w-full rounded-md border p-2 text-sm" multiple={f.type === 'multiselect'} value={f.type === 'multiselect' ? (Array.isArray(v) ? v : []) : String(v ?? '')} onChange={e => change(f.type === 'multiselect' ? Array.from(e.target.selectedOptions, o => o.value) : e.target.value || null)}>{f.type === 'dropdown' && <option value="">Select…</option>}{f.options.map(o => <option key={o} value={o}>{o}</option>)}</select>
      : f.type === 'multiline' ? <Textarea id={id} value={String(v ?? '')} maxLength={12000} onChange={e => change(e.target.value)} />
      : <Input id={id} type={['number', 'currency', 'percentage'].includes(f.type) ? 'number' : ['date', 'email', 'url'].includes(f.type) ? f.type : f.type === 'datetime' ? 'datetime-local' : 'text'} step="any" value={f.type === 'datetime' && v ? new Date(String(v)).toISOString().slice(0, 16) : String(v ?? '')} onChange={e => change(!e.target.value ? null : ['number', 'currency', 'percentage'].includes(f.type) ? Number(e.target.value) : f.type === 'datetime' ? `${e.target.value}:00Z` : e.target.value)} />}
      {f.type === 'datetime' && !readonly && <p className="text-xs text-muted-foreground">UTC</p>}
    </div>;
  };
  const renderStandard=(field:{label:string;value:React.ReactNode;full?:boolean})=><div key={field.label} className={field.full?'sm:col-span-2':''}><h4 className="text-xs text-muted-foreground">{field.label}</h4><div className="mt-1 break-words text-sm">{field.value || '—'}</div></div>;
  if (!visible.length && !standardFields.length) return null;
  if (!layout) return <section className="space-y-4 rounded-lg border bg-white p-4"><h3 className="text-sm font-semibold">Organization fields</h3><div className="grid gap-4 sm:grid-cols-2">{standardFields.map(renderStandard)}{visible.map(renderField)}</div></section>;
  const assigned = new Set(layout.flatMap(s => s.fields));
  // Published layouts created before standard fields were configurable must
  // retain the existing record details when upgraded.
  const legacyStandard = standardFields.length > 0 && ![...assigned].some(id => id.startsWith('standard:'));
  const extra = visible.filter(f => !assigned.has(f.id) && (f.required || f.archived));
  return <div className="space-y-3">{legacyStandard && <section className="grid gap-4 rounded-lg border bg-white p-4 sm:grid-cols-2">{standardFields.map(renderStandard)}</section>}{layout.map(section => <details key={section.id} open={!section.collapsed} className="rounded-lg border bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">{section.title}</summary><div className={section.columns === 2 ? "mt-4 grid gap-4 sm:grid-cols-2" : "mt-4 grid gap-4"}>{section.fields.map(id => {const standard=standardFields.find(f=>standardLayoutId(f.label)===id);if(standard)return renderStandard(standard);const custom=visible.find(f=>f.id===id);return custom?renderField(custom):null;})}</div></details>)}{extra.length > 0 && <section className="space-y-4 rounded-lg border p-4"><h3 className="text-sm font-semibold">Required and historical fields</h3>{extra.map(renderField)}</section>}</div>;
}
