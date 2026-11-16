'use client';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { presentationSchema, type ListPresentation, type CrmObject } from '@/lib/crm/customization';
import type { ListState } from './use-list';
import { getOne, post } from './data';
type View = {id:string;name:string;departmentId:string|null;isPersonal:boolean;settings:{presentation?:ListPresentation;search:string;sort:string;sortDir:'asc'|'desc';filters:Record<string,string>}};
type Catalog = {rows:View[];organization:boolean;team:boolean};
export function SharedViews<T>({object,list,presentation,onPresentation}:{object:CrmObject;list:ListState<T>;presentation:ListPresentation;onPresentation:(p:ListPresentation)=>void}) {
 const [catalog,setCatalog]=React.useState<Catalog>({rows:[],organization:false,team:false});
 const [selected,setSelected]=React.useState('');const [name,setName]=React.useState('');const [scope,setScope]=React.useState('personal');
 const [defaultView,setDefaultView]=React.useState<string|null>(null);
 const {setSearch,setSort,setFilter}=list;
 const [notice,setNotice]=React.useState('');const [busy,setBusy]=React.useState(false);
 const url='/api/crm/settings/shared-views?object='+object;
 const reload=React.useCallback(async()=>{const result=await getOne<Catalog>(url);setCatalog(result);setScope('personal');},[url]);
 React.useEffect(()=>{
  const abort=new AbortController();
  Promise.all([getOne<Catalog>(url,abort.signal),getOne<{defaultViewId?:string|null}>(`/api/crm/settings/list-preferences?object=${object}`,abort.signal)]).then(([result,prefs])=>{
   if(abort.signal.aborted)return;setCatalog(result);setDefaultView(prefs.defaultViewId??null);
   const view=result.rows.find(v=>v.id===prefs.defaultViewId);if(view){const snapshot=presentationSchema.safeParse(view.settings.presentation);if(snapshot.success)onPresentation(snapshot.data);setSelected(view.id);setSearch(view.settings.search);setSort(view.settings.sort,view.settings.sortDir);Object.entries(view.settings.filters).forEach(([k,v])=>setFilter(k,v));}
  }).catch(e=>{if(!abort.signal.aborted)setNotice(e.message)});
  return()=>abort.abort();
 },[url,object,setSearch,setSort,setFilter,onPresentation]);
 async function saveDefault(view:string|null){setBusy(true);try{await post('/api/crm/settings/default-view',{object,view});setDefaultView(view);setNotice(view?'Default view saved':'Default view cleared');}catch(e){setNotice((e as Error).message)}finally{setBusy(false)}}
 function apply(id:string){setSelected(id);const view=catalog.rows.find(v=>v.id===id);if(!view)return;const snapshot=presentationSchema.safeParse(view.settings.presentation);if(snapshot.success)onPresentation(snapshot.data);list.setSearch(view.settings.search);Object.keys(list.filters).forEach(k=>list.setFilter(k,''));Object.entries(view.settings.filters).forEach(([k,v])=>list.setFilter(k,v));list.setSort(view.settings.sort,view.settings.sortDir);}
 async function save(){setBusy(true);try{await post(url,{object,name,scope,settings:{presentation,search:list.search,sort:list.sort,sortDir:list.sortDir,filters:list.filters}});await reload();setName('');setNotice('View saved');}catch(e){setNotice((e as Error).message);}finally{setBusy(false);}}
 async function remove(){if(!window.confirm('Remove this saved view?'))return;setBusy(true);try{const r=await fetch(url,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:selected,object})});if(!r.ok)throw Error((await r.json()).error?.message??'Could not remove view');await reload();setSelected('');setNotice('View removed');}catch(e){setNotice((e as Error).message);}finally{setBusy(false);}}
 return <details className="rounded-md border bg-white p-3"><summary className="cursor-pointer text-sm font-medium">Saved views</summary><div className="mt-3 flex flex-wrap items-center gap-2"><select className="rounded border p-2 text-sm" aria-label="Apply shared view" value={selected} onChange={e=>apply(e.target.value)}><option value="">Choose a shared view…</option>{catalog.rows.map(v=><option key={v.id} value={v.id}>{v.name} · {v.isPersonal?'Personal':v.departmentId?'Team':'Organization'}</option>)}</select>{selected&&<Button size="sm" variant="outline" disabled={busy||selected===defaultView} onClick={()=>void saveDefault(selected)}>{selected===defaultView?'Default view':'Make default'}</Button>}{defaultView&&<Button size="sm" variant="ghost" disabled={busy} onClick={()=>void saveDefault(null)}>Clear default</Button>}{selected&&(catalog.rows.find(v=>v.id===selected)?.isPersonal||catalog.organization||catalog.team&&catalog.rows.find(v=>v.id===selected)?.departmentId)&&<Button variant="ghost" size="sm" disabled={busy} onClick={()=>void remove()}>Remove view</Button>}
 {<><Input className="w-44" aria-label="Shared view name" placeholder="View name" maxLength={60} value={name} onChange={e=>setName(e.target.value)} /><select className="rounded border p-2 text-sm" aria-label="View audience" value={scope} onChange={e=>setScope(e.target.value)}><option value="personal">Only me</option>{catalog.organization&&<option value="organization">Organization</option>}{catalog.team&&<option value="team">My department</option>}</select><Button size="sm" variant="outline" disabled={busy||!name.trim()} onClick={()=>void save()}>Save current filters</Button></>}
 </div>{notice&&<p role="status" className="mt-2 text-xs">{notice}</p>}</details>;
}
