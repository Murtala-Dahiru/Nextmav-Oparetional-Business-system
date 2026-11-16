'use client';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/store/app-store';
import type { CrmObject, CustomValues, FieldDefinition } from '@/lib/crm/customization';
import { CustomFieldDisplay } from './custom-fields';
import { getList, post } from './data';

type Row = { id: string; updatedAt?: string; name?: string; firstName?: string; lastName?: string };
export function BulkFields({ object, rows, onChanged }: { object: CrmObject; rows: Row[]; onChanged: () => void }) {
  const mayEdit = useAppStore(s => s.allows('crm', 'edit'));
  const [fields, setFields] = React.useState<FieldDefinition[]>([]);
  const [field, setField] = React.useState('');
  const [values, setValues] = React.useState<CustomValues>({});
  const [selected, setSelected] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  React.useEffect(() => {
    const abort = new AbortController();
    if (mayEdit) getList<FieldDefinition>(`/api/crm/settings/fields?object=${object}`, abort.signal)
      .then(result => { if (!abort.signal.aborted) setFields(result.data.filter(f => !f.archived)); })
      .catch(() => { if (!abort.signal.aborted) setNotice('Custom fields could not be loaded.'); });
    return () => abort.abort();
  }, [object, mayEdit]);
  const eligible = rows.filter(r => r.updatedAt).slice(0, 100);
  const selection = eligible.filter(r => selected.includes(r.id));
  async function apply() {
    if (!selection.length || !field || !Object.hasOwn(values, field)) return;
    if (!window.confirm(`Update ${fields.find(f => f.id === field)?.label} on ${selection.length} records? Existing values for this field will be replaced.`)) return;
    setBusy(true); setNotice('');
    try {
      const results = await post<{ id: string; updated: boolean; message?: string }[]>('/api/crm/settings/bulk-fields', {
        object, values: { [field]: values[field] }, records: selection.map(r => ({ id: r.id, updatedAt: r.updatedAt })),
      });
      const failed = results.filter(r => !r.updated);
      setSelected(failed.map(r => r.id));
      setNotice(`${results.length - failed.length} updated. ${failed.length} rejected.${failed.length ? ' Reload and review rejected records before retrying.' : ''}`);
      onChanged();
    } catch (cause) { setNotice((cause as Error).message); }
    finally { setBusy(false); }
  }
  if (!mayEdit || (!fields.length && !notice)) return null;
  return <details className="rounded-lg border bg-white p-3"><summary className="cursor-pointer text-sm font-medium">Bulk field update</summary>
    <fieldset disabled={busy} className="mt-3 space-y-3">
      <p className="text-xs text-muted-foreground">Choose records from the current page. Updates preserve other fields and reject records changed since this page loaded.</p>
      <label className="block text-xs">Field<select className="ml-2 rounded border p-2" value={field} onChange={e => { setField(e.target.value); setValues({}); }}><option value="">Choose a field…</option>{fields.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label>
      {field && <CustomFieldDisplay fields={fields.filter(f => f.id === field)} values={values} onChange={setValues} layout={null} />}
      <div className="max-h-48 space-y-2 overflow-auto">{eligible.map(row => <label key={row.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(row.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, row.id] : ids.filter(id => id !== row.id))} />{row.name || [row.firstName, row.lastName].filter(Boolean).join(' ') || 'Unnamed record'}</label>)}</div>
      <div className="flex gap-2"><Button size="sm" disabled={!selection.length || !field || !Object.hasOwn(values, field)} onClick={() => void apply()}>{busy ? 'Updating…' : `Update ${selection.length} records`}</Button><Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear selection</Button></div>
    </fieldset>{notice && <p className="mt-2 text-sm" role="status">{notice}</p>}
  </details>;
}
