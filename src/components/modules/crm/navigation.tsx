'use client';

import type { ElementType } from 'react';
import { ChevronDown, Building2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { CrmSection } from './types';

type Destination = { id: CrmSection; label: string; icon: ElementType };
export function CrmNavigation({ sections, active, onChange, children }: {
  sections: Destination[]; active: CrmSection; onChange: (id: CrmSection) => void; children?: React.ReactNode;
}) {
  const primary = sections.filter(s => !['activities', 'partners', 'import'].includes(s.id));
  const secondary = sections.filter(s => ['activities', 'partners', 'import'].includes(s.id));
  const current = sections.find(s => s.id === active);
  return <header className="@container sticky top-0 z-20 border-b border-slate-200 bg-white">
    <div className="flex min-w-0 items-center justify-between gap-3 px-4 py-3 md:px-6">
      <div className="flex min-w-0 items-center gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-700"><Building2 className="size-4"/></span><div><p className="text-sm font-semibold tracking-tight text-slate-900">NextMav CRM</p><p className="hidden text-[11px] text-slate-500 sm:block">Revenue & relationships</p></div></div>
      <div className="shrink-0">{children}</div>
    </div>
    <nav aria-label="CRM sections" className="px-4 md:px-6">
      <label className="mb-3 flex items-center gap-3 text-xs font-medium text-slate-500 @[68rem]:hidden">Workspace
        <select aria-label="CRM destination" value={active} onChange={e => onChange(e.target.value as CrmSection)} className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600">
          {sections.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      <div className="hidden min-w-0 items-center gap-1 @[68rem]:flex">
        {primary.map(s => {const Icon=s.icon;return <button key={s.id} type="button" onClick={() => onChange(s.id)} aria-current={active===s.id?'page':undefined} className={cn('relative inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-blue-600',active===s.id?'text-blue-700':'text-slate-500 hover:bg-slate-50 hover:text-slate-900')}><Icon aria-hidden="true" className="size-3.5"/>{s.label}<span aria-hidden="true" className={cn('absolute inset-x-3 bottom-0 h-0.5 rounded-t',active===s.id?'bg-blue-600':'bg-transparent')}/></button>})}
        {secondary.length>0&&<DropdownMenu><DropdownMenuTrigger className={cn('ml-2 inline-flex items-center gap-2 border-l border-slate-200 px-4 py-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-blue-600',secondary.some(s=>s.id===active)?'text-blue-700':'text-slate-500')} aria-label="More CRM destinations">{secondary.some(s=>s.id===active)?current?.label:'More'}<ChevronDown className="size-3"/></DropdownMenuTrigger><DropdownMenuContent align="end">{secondary.map(s=><DropdownMenuItem key={s.id} onSelect={()=>onChange(s.id)} aria-current={active===s.id?'page':undefined}><s.icon className="mr-2 size-4"/>{s.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>}
      </div>
    </nav>
  </header>;
}
