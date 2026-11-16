'use client';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { objectLayoutFields, standardLayoutId, type CrmObject, type FieldDefinition, type RecordLayout } from '@/lib/crm/customization';
import { getOne, post } from './data';
import { CustomFieldDisplay } from './custom-fields';

type LayoutState = { version: number; draft: RecordLayout; published: RecordLayout | null; previous: RecordLayout | null };
export function LayoutEditor({ object, fields }: { object: CrmObject; fields: FieldDefinition[] }) {
  const [state, setState] = React.useState<LayoutState | null>(null);
  const [sections, setSections] = React.useState<RecordLayout>([]);
  const [past, setPast] = React.useState<RecordLayout[]>([]);
  const [future, setFuture] = React.useState<RecordLayout[]>([]);
  const [preview, setPreview] = React.useState(false);
  const [busy, setBusy] = React.useState(true);
  const [failure, setFailure] = React.useState('');
  const dragged = React.useRef<{ section: number; field: string } | null>(null);
  React.useEffect(() => {
    const abort = new AbortController();
    getOne<LayoutState | null>(`/api/crm/settings/layouts?object=${object}`, abort.signal).then(result => {
      if (abort.signal.aborted) return;
      const next = result ?? { version: 0, draft: [], published: null, previous: null };
      setState(next); setSections(next.draft); setPast([]); setFuture([]);
    }).catch(e => { if (!abort.signal.aborted) setFailure(e.message); }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [object]);
  function change(next: RecordLayout) { setPast(p => [...p.slice(-29), sections]); setFuture([]); setSections(next); }
  function sectionChange(index: number, patch: Partial<RecordLayout[number]>) { change(sections.map((s, i) => i === index ? { ...s, ...patch } : s)); }
  function moveField(section: number, field: string, delta: number) {
    const next = [...sections[section].fields]; const at = next.indexOf(field); const to = at + delta;
    if (to < 0 || to >= next.length) return;
    [next[at], next[to]] = [next[to], next[at]]; sectionChange(section, { fields: next });
  }
  async function save(action: 'draft' | 'publish' | 'revert') {
    if (!state) return;
    if (action !== 'draft' && !window.confirm(action === 'publish' ? 'Publish this field layout for everyone in your organization?' : 'Restore the previous published field layout?')) return;
    setBusy(true); setFailure('');
    try {
      await post('/api/crm/settings/layouts', { object, version: state.version, action, sections });
      const next = await getOne<LayoutState>(`/api/crm/settings/layouts?object=${object}`);
      setState(next); setSections(next.draft); setPast([]); setFuture([]); toast.success(action === 'draft' ? 'Draft saved' : 'Published layout updated');
    } catch (e) { setFailure((e as Error).message); } finally { setBusy(false); }
  }
  const standardLayoutFields = objectLayoutFields[object];
  const assigned = new Set(sections.flatMap(s => s.fields));
  return <section className="space-y-4 rounded-xl border bg-white p-5"><header><h2 className="font-semibold">Organization field layout</h2><p className="mt-1 text-sm text-muted-foreground">Arrange custom fields into responsive sections. Standard detail fields use the same layout on record detail pages. Unassigned optional fields are hidden after publishing.</p></header>
    {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !past.length} onClick={() => { setFuture(f => [sections, ...f]); setSections(past[past.length - 1]); setPast(past.slice(0, -1)); }}>Undo</Button><Button variant="outline" disabled={busy || !future.length} onClick={() => { setPast(p => [...p, sections]); setSections(future[0]); setFuture(future.slice(1)); }}>Redo</Button><Button variant="outline" disabled={busy} onClick={() => setPreview(!preview)}>{preview ? 'Edit layout' : 'Preview layout'}</Button><Button disabled={busy || !state} variant="outline" onClick={() => void save('draft')}>Save draft</Button><Button disabled={busy || !state} onClick={() => void save('publish')}>Publish</Button>{state?.previous && <Button disabled={busy} variant="outline" onClick={() => void save('revert')}>Revert publication</Button>}</div>
    {preview ? <div aria-label="Layout preview"><CustomFieldDisplay fields={fields} values={{}} layout={sections} standardFields={standardLayoutFields.map(label=>({label,value:'Preview value'}))} /></div> : <>
      {sections.map((section, index) => <section className="space-y-3 rounded-lg border p-4" key={section.id} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const from = dragged.current; if (!from) return; dragged.current = null; change(sections.map((s, i) => ({ ...s, fields: i === index ? [...s.fields.filter(id => id !== from.field), from.field] : s.fields.filter(id => id !== from.field) }))); }}>
        <div className="flex flex-wrap items-center gap-3"><label className="text-xs">Section title<Input value={section.title} maxLength={100} onChange={e => sectionChange(index, { title: e.target.value })} /></label><label className="text-xs">Columns<select className="ml-2 rounded border p-2" value={section.columns} onChange={e => sectionChange(index, { columns: Number(e.target.value) as 1 | 2 })}><option value={1}>1</option><option value={2}>2</option></select></label><label className="text-xs"><input type="checkbox" checked={section.collapsed} onChange={e => sectionChange(index, { collapsed: e.target.checked })} /> Initially collapsed</label><Button variant="ghost" size="sm" onClick={() => change(sections.filter((_, i) => i !== index))}>Remove section</Button></div>
        <ul className="space-y-2">{section.fields.map((id, position) => <li draggable onDragStart={() => { dragged.current = { section: index, field: id }; }} onDragEnd={() => { dragged.current = null; }} key={id} className="flex flex-wrap items-center justify-between gap-2 rounded border bg-slate-50 p-2"><span className="text-sm">{fields.find(f => f.id === id)?.label ?? standardLayoutFields.find(label=>standardLayoutId(label)===id) ?? 'Unavailable field'}</span><div className="flex gap-1"><Button size="sm" variant="ghost" disabled={position === 0} onClick={() => moveField(index, id, -1)}>Move up</Button><Button size="sm" variant="ghost" disabled={position === section.fields.length - 1} onClick={() => moveField(index, id, 1)}>Move down</Button><Button size="sm" variant="ghost" onClick={() => sectionChange(index, { fields: section.fields.filter(f => f !== id) })}>Remove</Button></div></li>)}</ul>
        <label className="text-xs">Field library<select aria-label={`Add field to ${section.title}`} className="ml-2 max-w-full rounded border p-2" value="" onChange={e => { if (e.target.value) sectionChange(index, { fields: [...section.fields, e.target.value] }); }}><option value="">Add a field…</option>{standardLayoutFields.filter(label=>!assigned.has(standardLayoutId(label))).map(label=><option key={label} value={standardLayoutId(label)}>{label} · Standard</option>)}{fields.filter(f => !f.archived && !assigned.has(f.id)).map(f => <option value={f.id} key={f.id}>{f.label}{f.required ? ' (required)' : ''}</option>)}</select></label>
      </section>)}
      <Button variant="outline" disabled={busy || sections.length >= 10} onClick={() => change([...sections, { id: crypto.randomUUID(), title: 'New section', columns: 2, collapsed: false, fields: [] }])}>Add section</Button>
    </>}
    <p className="text-xs text-muted-foreground">{JSON.stringify(sections) === JSON.stringify(state?.draft) ? `Saved revision ${state?.version ?? 0}` : 'Unsaved layout changes'} · Drag fields between sections, or use Move up / Move down to reorder.</p>
  </section>;
}
