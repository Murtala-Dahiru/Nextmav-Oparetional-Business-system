'use client';
import * as React from 'react';
import { getOne } from './data';
export type DirectoryFact={id:string;lastEngagement:string|null;nextAction:string|null;openOpportunities:number;decisionMakers:number};
export function useDirectoryFacts(kind:'company'|'contact',rows:{id:string}[]) {
 const [facts,setFacts]=React.useState<Record<string,DirectoryFact>>({});
 const [error,setError]=React.useState('');
 React.useEffect(()=>{setFacts({});if(!rows.length)return;const c=new AbortController();getOne<DirectoryFact[]>(`/api/crm/relationships/directory?kind=${kind}&ids=${rows.map(r=>r.id).join(',')}`,c.signal).then(data=>{if(!c.signal.aborted){setFacts(Object.fromEntries(data.map(r=>[r.id,r])));setError('')}}).catch(e=>{if(!c.signal.aborted)setError(e.message)});return()=>c.abort()},[kind,rows]);
 return {facts,error};
}
