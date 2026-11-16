'use client';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseCustomFilter } from '@/lib/crm/custom-filter';
import type { CrmObject, CustomValues, FieldDefinition } from '@/lib/crm/customization';
import { getList } from './data';
export function CustomFieldFilter({ object, value, onChange }: { object: CrmObject; value?: string; onChange: (value: string) => void }) {
  const [fields, setFields] = React.useState<FieldDefinition[]>([]);
  const [field, setField] = React.useState('');
  const [match, setMatch] = React.useState('');
  React.useEffect(() => {
    const abort = new AbortController();
    getList<FieldDefinition>(`/api/crm/settings/fields?object=${object}`, abort.signal).then(r => { if (!abort.signal.aborted) setFields(r.data.filter(f => !f.archived)); }).catch(() => {});
    return () => abort.abort();
  }, [object]);
  let applied: CustomValues = {};
  try { if (value) applied = parseCustomFilter(value); } catch { /* A legacy saved filter can be cleared below. */ }
  const appliedFields = Object.entries(applied);
  if (!fields.length && !value) return null;
  const selected = fields.find(f => f.id === field);
  return <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-3"><label className="text-xs">Custom field <select aria-label="Filter custom field" className="ml-2 rounded border p-2" value={field} onChange={e => { setField(e.target.value); setMatch(''); }}><option value="">Choose field…</option>{fields.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label>
    {selected && <>{['dropdown', 'multiselect', 'checkbox'].includes(selected.type) ? <select aria-label="Custom field match" className="rounded border p-2 text-sm" value={match} onChange={e => setMatch(e.target.value)}><option value="">Choose value…</option>{(selected.type === 'checkbox' ? ['true', 'false'] : selected.options).map(o => <option key={o}>{o}</option>)}</select> : <Input aria-label="Custom field match" placeholder="Exact value" className="w-48" type={['number', 'currency', 'percentage'].includes(selected.type) ? 'number' : selected.type === 'date' ? 'date' : 'text'} value={match} onChange={e => setMatch(e.target.value)} />}
    <Button size="sm" variant="outline" disabled={!match || (appliedFields.length >= 10 && !Object.hasOwn(applied,field))} onClick={() => onChange(JSON.stringify({ ...applied, [field]: ['number', 'currency', 'percentage'].includes(selected.type) ? Number(match) : selected.type === 'checkbox' ? match === 'true' : selected.type === 'multiselect' ? [match] : match }))}>Apply filter</Button></>}
    {appliedFields.map(([id,condition]) => <Button key={id} size="sm" variant="outline" title="Remove condition" onClick={() => { const remaining = {...applied}; delete remaining[id]; onChange(Object.keys(remaining).length ? JSON.stringify(remaining) : ''); }}>{fields.find(f=>f.id===id)?.label ?? 'Unavailable field'} = {Array.isArray(condition) ? condition.join(', ') : String(condition)} ×</Button>)}
    {value && <Button size="sm" variant="ghost" onClick={() => onChange('')}>Clear custom filter</Button>}
  </div>;
}
