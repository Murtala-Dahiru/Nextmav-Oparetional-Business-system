'use client';
import {useCrmList} from './use-list';
import {NextActions,Panel} from './record-parts';
import {Broken,Spinner} from './ui';
import {Button} from '@/components/ui/button';
import type {CrmActivity} from './types';
export function AccountCommitments({companyId}:{companyId:string}){
 const list=useCrmList<CrmActivity>(`/api/crm/companies/${companyId}/activities`,{channel:`crm-account-commitments-${companyId}`,watch:['crm_activities','contacts','deals'],fixed:{due:'open'},defaultSort:'dueAt',defaultSortDir:'asc'});
 return <Panel title="Open CRM commitments" count={list.meta.total}>
 <p className="mb-3 text-xs text-muted-foreground">Calls, meetings and follow-ups, ordered by due date. Account-plan actions are tracked separately below.</p>
 {list.error?<Broken message={list.error} onRetry={list.reload}/>:list.loading?<Spinner label="Loading commitments"/>:<NextActions items={list.rows} onChanged={list.reload}/>}
 {list.meta.total>list.pageSize&&<div className="mt-3 flex items-center justify-between"><Button size="sm" variant="outline" disabled={!list.page||list.loading} onClick={()=>list.setPage(list.page-1)}>Previous</Button><span className="text-xs">{list.page+1} / {Math.ceil(list.meta.total/list.pageSize)}</span><Button size="sm" variant="outline" disabled={list.loading||(list.page+1)*list.pageSize>=list.meta.total} onClick={()=>list.setPage(list.page+1)}>Next</Button></div>}
 </Panel>;
}
