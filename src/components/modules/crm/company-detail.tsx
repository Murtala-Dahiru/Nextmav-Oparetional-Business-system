'use client';
import { CustomFields } from './custom-fields';

import * as React from 'react';
import type { RelationshipSignal } from '@/lib/crm/account-signals';
import { RelatedRecords } from './related-records';
import { CommercialRelated } from './commercial-related';
import { AccountCommitments } from './account-commitments';
import { AccountHierarchy } from './account-hierarchy';
import { useModuleRealtime } from '@/hooks/use-realtime';
import { AccountPlanPanel } from './account-plan';
import { RelationshipProfile } from './relationship-profile';
import { RelationshipTimeline } from './relationship-timeline';
import { CrmAttachments } from './attachments';
import { toast } from 'sonner';
import {
  Building2, Users, Handshake, FolderKanban, Receipt, LifeBuoy, CalendarDays,
  Globe, Mail, Phone, MapPin, AlertTriangle, ExternalLink, Plus, CornerUpRight,
  Pencil, Clock, History,
} from 'lucide-react';

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { AddToMyWorkButton } from '@/components/shared/add-to-my-work';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { formatDate, formatRelativeTime, initialsOf, formatNumber } from '@/lib/format';

import { getOne, exact, formatDay, relativeDay, daysUntil } from './data';
import { StageTag, Monogram, Spinner, Broken, Blank, FilterRow } from './ui';
import { Panel, NextActions, Timeline, whenOf, subjectOf } from './record-parts';
import { ActivityDialog } from './activity-dialog';
import { DealDialog, ContactDialog } from './forms';
import type { CrmActivity } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The customer, whole
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Everything the platform knows about one company: the people, the pipeline,
 *  the work in flight and its health, what is owed, what is broken, what is
 *  scheduled, and what anyone has done about it.
 *
 *  Each panel is a live read of the module that owns it - projects come from
 *  `v_project_health`, the same view the project board reads; invoices are the
 *  Finance rows, not a copy. There is no customer table duplicating any of it,
 *  which is why a project marked at risk this morning is at risk here too
 *  without anyone synchronising anything.
 *
 *  Panels the caller's role cannot see are absent from the response entirely,
 *  so this component renders what it is given rather than deciding who may see
 *  what - the access decision belongs on the server.
 *
 *  ── What this pass changed ──────────────────────────────────────────────
 *
 *  The endpoint was already good and is barely touched. The screen was one
 *  long scroll of seven panels, every one of them open, so the answer to "what
 *  is happening with this customer" was somewhere in eleven hundred pixels of
 *  equally weighted lists. Three things changed:
 *
 *    · **A relationship summary that leads.** Six figures, and two of them -
 *      last contact and next follow-up - are the ones somebody about to ring
 *      this customer actually needs. Neither existed before, because nothing
 *      read `crm_activities.due_at`.
 *
 *    · **Sections, not a scroll.** People, Deals, Work, Money, Support and
 *      Activity are tabs. Every one keeps its count in the tab, so the shape of
 *      the relationship is legible without opening any of them.
 *
 *    · **It can be worked from.** Log a call, schedule a follow-up, open a
 *      deal, add a contact - from the customer, without going and finding the
 *      right list first.
 */

interface Overview {
  accountTeam?:{id:string;name:string}[];
  intelligence: { status: string; signals: RelationshipSignal[] };
  collectedPayments?: {currency:string;collected:number}[];
  company: {
    customValues?: import('@/lib/crm/customization').CustomValues; crmProfile?: {segment?:string;tags?:string[]}; accountTeamIds?:string[];
    id: string; name: string; industry: string | null; website: string | null;
    email: string | null; phone: string | null; address: string | null;
    city: string | null; country: string | null; notes: string;
    employeeCount: number | null; annualRevenue: number | null;
    owner: { fullName: string; avatar: string } | null;
  };
  contacts: {
    id: string; firstName: string; lastName: string; email: string | null;
    phone: string | null; jobTitle: string | null; isActive: boolean; crmProfile?:{relationshipRole?:string};
  }[];
  deals: {
    id: string; name: string; stage: string; value: number; currency:string; probability: number;
    expectedClose: string | null; closedAt: string | null; owner: { fullName: string } | null;
  }[];
  projects?: {
    id: string; name: string; status: string; priority: string; endDate: string | null;
    progressPct: number; totalTasks: number; completedTasks: number; overdueTasks: number;
    daysRemaining: number | null; isAtRisk: boolean;
  }[];
  invoices?: {
    id: string; invoiceNumber: string; status: string; issueDate: string;
    dueDate: string; total: number; amountPaid: number; currency: string;
  }[];
  tickets?: {
    id: string; ticketNumber: string; subject: string; status: string;
    priority: string; createdAt: string; resolvedAt: string | null;
  }[];
  meetings?: {
    id: string; title: string; startsAt: string; endsAt: string;
    allDay: boolean; location: string | null;
  }[];
  activities: CrmActivity[]; commitments: CrmActivity[];
  timeline: {
    id: number; module: string; action: string; title: string;
    createdAt: string; user: { fullName: string } | null;
  }[];
  summary: {
    dealCurrencies?:{currency:string;openCount:number;openValue:number;wonValue:number}[];
    contacts: number; openDeals: number; openDealValue: number; wonDealValue: number;
    activeProjects: number; projectsAtRisk: number; outstandingInvoiced: number;
    overdueInvoices: number; openTickets: number; currency: string;
    invoiceBalances: { currency: string; outstanding: number; overdue: number }[];
    lastContact: string | null; nextFollowUp: string | null;
  };
}

type Tab = 'overview' | 'people' | 'deals' | 'work' | 'money' | 'support' | 'activity' | 'plan' | 'profile' | 'documents';

/* -------------------------------------------------------------------------- */
/*  Summary                                                                   */
/* -------------------------------------------------------------------------- */

function Fig({
  label, value, note, tone = 'default',
}: {
  label: string; value: string; note?: string; tone?: 'default' | 'warn' | 'good';
}) {
  return (
    <div className="min-w-0 px-3.5 py-3">
      <p className="truncate text-[10px] font-medium uppercase tracking-[0.09em] text-muted-foreground/85">
        {label}
      </p>
      <p className={cn(
        'mt-1.5 truncate text-[15px] font-semibold leading-none tabular-nums tracking-[-0.02em]',
        tone === 'warn' ? 'text-warning' : tone === 'good' ? 'text-success' : 'text-foreground',
      )}>
        {value}
      </p>
      {note && <p className="mt-1 truncate text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

function Row({
  onOpen, children, className,
}: {
  onOpen?: () => void; children: React.ReactNode; className?: string;
}) {
  if (!onOpen) return <div className={cn('flex items-center gap-3 py-2', className)}>{children}</div>;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group flex w-full items-center gap-3 rounded-md px-1 py-2 text-left transition-colors hover:bg-accent/60',
        className,
      )}
    >
      {children}
      <ExternalLink className="ml-auto size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

/* -------------------------------------------------------------------------- */

export function CompanyDetail({
  companyId, open, onOpenChange, onEdit, onChanged,
}: {
  companyId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (companyId: string) => void;
  onChanged?: () => void;
}) {
  const openRecord = useAppStore(s => s.openRecord);
  const mayCreate = useAppStore(s=>s.allows('crm','create'));
  const mayEdit = useAppStore(s=>s.allows('crm','edit'));

  const [data, setData] = React.useState<Overview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<Tab>('overview');

  const [logOpen, setLogOpen] = React.useState(false);
  const [followOpen, setFollowOpen] = React.useState(false);
  const [dealOpen, setDealOpen] = React.useState(false);
  const [contactOpen, setContactOpen] = React.useState(false);
  const [editingActivity, setEditingActivity] = React.useState<CrmActivity | null>(null);
  const pending = React.useRef<AbortController | null>(null);

  const load = React.useCallback(async () => {
    if (!companyId) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError(null);
    try {
      const result = await getOne<Overview>(`/api/crm/companies/${companyId}/overview`, controller.signal);
      if (!controller.signal.aborted) setData(result);
    } catch (e: any) {
      if (controller.signal.aborted) return;
      setError(e.message || 'This customer could not be loaded');
      setData(null);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [companyId]);

  React.useEffect(() => {
    setData(null);
    if (open && companyId) void load();
    if (!open) { setData(null); setTab('overview'); setError(null); }
    return () => pending.current?.abort();
  }, [open, companyId, load]);

  const refresh = React.useCallback(() => { void load(); onChanged?.(); }, [load, onChanged]);

  useModuleRealtime(`crm-company-${companyId}`, ['companies','contacts','deals','crm_activities','projects','invoices','payments','support_tickets','milestones','crm_account_plans'], load, open && Boolean(companyId));

  const c = data?.company;
  const s = data?.summary;

  /** Opening a record from here closes the panel: the destination is a module. */
  const go = (module: Parameters<typeof openRecord>[0], type: string, id: string) => {
    onOpenChange(false);
    openRecord(module, type, id);
  };

  /* ── The two facts nothing used to show ────────────────────────────────── */

  const owed = React.useMemo(
    () => (data?.commitments ?? []).filter(a => a.dueAt && !a.completedAt)
      .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? '')),
    [data],
  );
  const history = React.useMemo(
    () => (data?.activities ?? []).filter(a => !a.dueAt || a.completedAt),
    [data],
  );
  const lastContact = s?.lastContact ?? null;
  const nextFollowUp = s?.nextFollowUp ?? null;
  const overdueCount = owed.filter(a => whenOf(a.dueAt) === 'overdue').length;

  const link = c ? { kind: 'company' as const, id: c.id, label: c.name } : null;

  const tabs: { id: Tab; label: string; count?: number; shown: boolean }[] = [
    { id: 'overview', label: 'Overview', shown: true },
    { id: 'people', label: 'Contacts', count: data?.contacts.length, shown: true },
    { id: 'deals', label: 'Opportunities', count: data?.deals.length, shown: true },
    { id: 'work', label: 'Projects', count: data?.projects?.length, shown: Boolean(data?.projects) },
    { id: 'money', label: 'Finance', count: data?.invoices?.length, shown: Boolean(data?.invoices) },
    { id: 'support', label: 'Support', count: data?.tickets?.length, shown: Boolean(data?.tickets) },
    { id: 'activity', label: 'Timeline', count: data?.activities.length, shown: true },
    { id: 'plan', label: 'Account plan', shown: true },
    { id: 'profile', label: 'Relationships', shown: true },
    { id: 'documents', label: 'Documents', shown: true },
  ];

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[95vw] xl:max-w-6xl">
          <SheetHeader className="border-b border-border bg-slate-50/70 py-6 pl-6 pr-12 text-left">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Account 360</p>
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-700">
                <span className="text-sm font-semibold">{c?initialsOf(c.name):<Building2 className="size-5"/>}</span>
              </span>
              <div className="min-w-0 flex-1">
                <SheetTitle className="break-words text-xl font-semibold leading-tight tracking-tight">
                  {c?.name ?? (loading ? 'Loading' : 'Customer')}
                </SheetTitle>
                <SheetDescription className="mt-0.5 text-[12.5px]">
                  {c
                    ? [c.industry, [c.city, c.country].filter(Boolean).join(', ')]
                      .filter(Boolean).join(' · ') || 'No industry or location recorded'
                    : ' '}
                </SheetDescription>
              </div>
            </div>

            {c && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-muted-foreground">
                {c.website && (
                  <a
                    href={c.website.startsWith('http') ? c.website : `https://${c.website}`}
                    target="_blank" rel="noreferrer noopener"
                    className="flex items-center gap-1 hover:text-foreground hover:underline"
                  >
                    <Globe className="size-3.5" /> {c.website.replace(/^https?:\/\//, '')}
                  </a>
                )}
                {c.email && (
                  <a href={`mailto:${c.email}`} className="flex items-center gap-1 hover:text-foreground hover:underline">
                    <Mail className="size-3.5" /> {c.email}
                  </a>
                )}
                {c.phone && (
                  <a href={`tel:${c.phone}`} className="flex items-center gap-1 hover:text-foreground hover:underline">
                    <Phone className="size-3.5" /> {c.phone}
                  </a>
                )}
                {(c.address || c.city) && (
                  <span className="flex items-center gap-1">
                    <MapPin className="size-3.5" /> {[c.address, c.city].filter(Boolean).join(', ')}
                  </span>
                )}
                {c.owner?.fullName && (
                  <span className="flex items-center gap-1.5">
                    <Avatar className="size-4">
                      <AvatarFallback className="bg-muted text-[8px]">{initialsOf(c.owner.fullName)}</AvatarFallback>
                    </Avatar>
                    {c.owner.fullName}
                  </span>
                )}
              </div>
            )}

            {c && <div className="mt-4 flex flex-wrap gap-2 text-[11px]"><span className="rounded-full border bg-white px-2.5 py-1 font-medium">{data?.intelligence?.status ?? 'Insufficient information'}</span>{c.crmProfile?.segment&&<span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-blue-800">{c.crmProfile.segment}</span>}{c.crmProfile?.tags?.map(tag=><span key={tag} className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{tag}</span>)}{!c.owner&&<span className="px-2 py-1 text-slate-500">Owner unassigned</span>}{Boolean(c.accountTeamIds?.length)&&<span className="px-2 py-1 text-slate-500">Team: {data?.accountTeam?.map(m=>m.name).join(', ') || `${c.accountTeamIds!.length} members`}</span>}</div>}
            {c && (
              <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12.5px]" disabled={!mayCreate} onClick={() => setLogOpen(true)}>
                  <Plus className="size-3.5" /> Log activity
                </Button>
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12.5px]" disabled={!mayCreate} onClick={() => setFollowOpen(true)}>
                  <CornerUpRight className="size-3.5" /> Follow up
                </Button>
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12.5px]" disabled={!mayCreate} onClick={() => setDealOpen(true)}>
                  <Handshake className="size-3.5" /> New deal
                </Button>
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12.5px]" disabled={!mayCreate} onClick={() => setContactOpen(true)}>
                  <Users className="size-3.5" /> Add contact
                </Button>
                <AddToMyWorkButton
                  source={{ module: 'crm', type: 'company', id: c.id, label: c.name }}
                  title={owed[0]?.subject || `Check in with ${c.name}`}
                  size="sm" variant="ghost" className="h-8 text-[12.5px]"
                />
                {onEdit && (
                  <Button
                    size="sm" variant="ghost" className="h-8 gap-1.5 text-[12.5px]"
                    disabled={!mayEdit} onClick={() => { onOpenChange(false); onEdit(c.id); }}
                  >
                    <Pencil className="size-3.5" /> Edit
                  </Button>
                )}
              </div>
            )}
          </SheetHeader>

          {loading && !data ? (
            <Spinner label="Loading this customer" />
          ) : error ? (
            <div className="p-5"><Broken message={error} onRetry={load} /></div>
          ) : !data || !s ? (
            <div className="p-5">
              <Blank icon={Building2} title="Nothing to show" body="This customer could not be loaded." />
            </div>
          ) : (
            <>
              {/* ── The relationship, in six figures ───────────────────────── */}
              <div className="grid grid-cols-2 divide-x divide-y divide-border border-b border-border sm:grid-cols-3">
                <Fig
                  label="Open pipeline"
                  value={s.dealCurrencies?.length?s.dealCurrencies.filter(c=>c.openCount>0).map(c=>exact(c.openValue,c.currency)).join(' · ')||exact(0,s.currency):exact(s.openDealValue,s.currency)}
                  note={`${s.openDeals} ${s.openDeals === 1 ? 'deal' : 'deals'}`}
                />
                <Fig
                  label="Won to date"
                  value={s.dealCurrencies?.length?s.dealCurrencies.filter(c=>c.wonValue>0).map(c=>exact(c.wonValue,c.currency)).join(' · ')||exact(0,s.currency):exact(s.wonDealValue,s.currency)}
                  tone={s.wonDealValue > 0 ? 'good' : 'default'}
                />
                <Fig
                  label="Last engagement"
                  value={lastContact ? relativeDay(lastContact) : 'Not recorded'}
                  note={lastContact ? formatDate(lastContact) : 'Completed calls, emails and meetings'}
                  tone={!lastContact ? 'warn' : 'default'}
                />
                <Fig
                  label="Next follow-up"
                  value={nextFollowUp ? relativeDay(nextFollowUp) : 'None'}
                  note={nextFollowUp ? formatDate(nextFollowUp) : undefined}
                  tone={nextFollowUp && whenOf(nextFollowUp) === 'overdue' ? 'warn' : 'default'}
                />
                {data.invoices && (s.invoiceBalances.length ? s.invoiceBalances : [{ currency: s.currency, outstanding: 0, overdue: 0 }]).map(balance => (
                  <Fig
                    key={balance.currency}
                    label={`Outstanding (${balance.currency})`}
                    value={exact(balance.outstanding, balance.currency)}
                    note={balance.overdue ? `${balance.overdue} overdue` : 'Nothing overdue'}
                    tone={balance.overdue ? 'warn' : 'default'}
                  />
                ))}
                {data.tickets && (
                  <Fig
                    label="Open tickets"
                    value={String(s.openTickets)}
                    note={s.openTickets ? 'Being worked on' : 'Nothing open'}
                    tone={s.openTickets ? 'warn' : 'default'}
                  />
                )}
              </div>

              {/* ── Sections ──────────────────────────────────────────────── */}
              <div className="border-b border-border px-5 py-2.5">
                <p className="mb-2 text-xs text-muted-foreground">Totals cover all accessible records. Related lists below show recent records; tab counts describe those previews.</p>
                <nav aria-label="Account sections" className="flex flex-wrap gap-1">
                  {tabs.filter(t => t.shown).map(t => <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id as Tab)} className={cn('inline-flex min-h-9 items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary', tab === t.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
                    {t.label}{t.count !== undefined && <span className="rounded bg-background/70 px-1.5 py-0.5 text-[10px] tabular-nums">{t.count}</span>}
                  </button>)}
                </nav>
              </div>

              <div className="flex flex-col gap-4 p-5">
                {tab === 'overview' && (
                  <>
                    <section className="rounded-xl border border-slate-200 bg-white p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-base font-semibold tracking-tight">Relationship briefing</h3><p className="mt-1 text-xs leading-5 text-slate-500">Verified account context and explainable follow-up priorities.</p></div><span className="rounded-full border bg-slate-50 px-3 py-1 text-xs font-medium">{data.intelligence?.status ?? 'Insufficient information'}</span></div>
                      <div className="mt-4 grid gap-3 md:grid-cols-2">{data.intelligence?.signals.map(signal=><div key={signal.key} className="rounded-lg border bg-slate-50/40 p-3"><div className="flex items-start gap-2"><span className={cn('mt-1 size-1.5 shrink-0 rounded-full',signal.severity==='risk'?'bg-amber-600':signal.severity==='attention'?'bg-blue-600':'bg-slate-400')}/><div><h4 className="text-xs font-semibold">{signal.title}</h4><p className="mt-1 text-xs leading-5 text-slate-500">{signal.evidence}</p><button className="mt-2 text-xs font-medium text-blue-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-blue-600" onClick={()=>setTab(signal.section)}>{signal.action} →</button></div></div></div>)}</div>
                      <p className="mt-3 text-[11px] leading-5 text-slate-500">Status reflects the visible records and rules above. Healthy means no current rule is flagged; it does not predict retention or future revenue.</p>
                    </section>
                    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
                      <Panel title="Current opportunities" count={s.openDeals}>{data.deals.filter(d=>!['closed_won','closed_lost'].includes(d.stage)).slice(0,4).map(d=><Row key={d.id} onOpen={()=>go('crm','deal',d.id)}><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{d.name}</p><StageTag stage={d.stage}/></div><span className="text-xs tabular-nums">{exact(d.value,d.currency)}</span></Row>)}{!s.openDeals&&<p className="text-xs leading-5 text-muted-foreground">No open opportunities recorded. Create an opportunity when a verified customer need emerges.</p>}<button className="mt-3 text-xs font-medium text-blue-700" onClick={()=>setTab('deals')}>Review opportunities →</button></Panel>
                      <Panel title="Key relationships" count={s.contacts}>{data.contacts.filter(p=>p.isActive).slice(0,4).map(p=><Row key={p.id} onOpen={()=>go('crm','contact',p.id)}><Monogram name={`${p.firstName} ${p.lastName}`}/><div className="min-w-0"><p className="truncate text-sm font-medium">{p.firstName} {p.lastName}</p><p className="truncate text-xs text-muted-foreground">{p.crmProfile?.relationshipRole || p.jobTitle || 'Role not recorded'}</p></div></Row>)}{!s.contacts&&<p className="text-xs leading-5 text-muted-foreground">No contacts recorded. Add the people involved in this relationship.</p>}<button className="mt-3 text-xs font-medium text-blue-700" onClick={()=>setTab('people')}>Review contacts →</button></Panel>
                    </div>
                    <div className="grid gap-4 md:grid-cols-3">
                      <Panel title="Delivery">{data.projects?<><p className="text-xl font-semibold tabular-nums">{s.activeProjects}</p><p className="mt-1 text-xs text-muted-foreground">Active or planning projects · {s.projectsAtRisk} flagged at risk</p><button className="mt-3 text-xs font-medium text-blue-700" onClick={()=>setTab('work')}>Review projects →</button></>:<p className="text-xs text-muted-foreground">Project context is unavailable with your current access.</p>}</Panel>
                      <Panel title="Collections">{data.invoices?<>{data.collectedPayments?.length?data.collectedPayments.map(p=><div key={p.currency}><p className="text-lg font-semibold tabular-nums">{exact(p.collected,p.currency)}</p><p className="text-xs text-muted-foreground">Recorded payments · {p.currency}</p></div>):<p className="text-xs text-muted-foreground">No payments recorded.</p>}<button className="mt-3 text-xs font-medium text-blue-700" onClick={()=>setTab('money')}>Review finance →</button></>:<p className="text-xs text-muted-foreground">Financial context is unavailable with your current access.</p>}</Panel>
                      <Panel title="Customer support">{data.tickets?<><p className="text-xl font-semibold tabular-nums">{s.openTickets}</p><p className="mt-1 text-xs text-muted-foreground">Unresolved tickets</p><button className="mt-3 text-xs font-medium text-blue-700" onClick={()=>setTab('support')}>Review support →</button></>:<p className="text-xs text-muted-foreground">Support context is unavailable with your current access.</p>}</Panel>
                    </div>
                    <Panel
                      title="Next"
                      count={owed.length}
                      action={
                        <Button size="sm" variant="ghost" className="h-7 gap-1 text-[12px]" disabled={!mayCreate} onClick={() => setFollowOpen(true)}>
                          <Plus className="size-3" /> Add
                        </Button>
                      }
                    >
                      {owed.length ? (
                        <NextActions
                          items={owed}
                          onChanged={refresh}
                          onEdit={a => { setEditingActivity(a); setFollowOpen(true); }}
                        />
                      ) : (
                        <p className="py-1 text-[12.5px] text-muted-foreground">
                          No open CRM follow-ups. Account-plan actions are managed in Account Plan.
                        </p>
                      )}
                    </Panel>

                    <Panel title="Recent" count={history.length}>
                      <Timeline items={history.slice(0, 8)} />
                      {history.length > 8 && (
                        <button
                          type="button"
                          onClick={() => setTab('activity')}
                          className="mt-2 text-[12.5px] font-medium text-foreground hover:underline"
                        >
                          Open full timeline
                        </button>
                      )}
                    </Panel>

                    {c?.notes && (
                      <Panel title="Notes">
                        <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
                          {c.notes}
                        </p>
                      </Panel>
                    )}

                    {(c?.employeeCount || c?.annualRevenue) && (
                      <Panel title="About">
                        <dl className="grid grid-cols-2 gap-4">
                          {c.employeeCount ? (
                            <div>
                              <dt className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground/85">People</dt>
                              <dd className="mt-1 text-[13px] tabular-nums">{formatNumber(c.employeeCount)}</dd>
                            </div>
                          ) : null}
                          {c.annualRevenue ? (
                            <div>
                              <dt className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground/85">Annual revenue</dt>
                              <dd className="mt-1 text-[13px] tabular-nums">
                                {exact(c.annualRevenue, s.currency)}
                              </dd>
                            </div>
                          ) : null}
                        </dl>
                      </Panel>
                    )}
                  </>
                )}

                {c && tab==='people' && <RelatedRecords key={`contacts-${c.id}`} companyId={c.id} kind="contacts"/>}
                {c && tab==='deals' && <><RelatedRecords key={`deals-${c.id}`} companyId={c.id} kind="deals"/><CommercialRelated companyId={c.id}/></>}
                {c && tab==='work' && data.projects && <><RelatedRecords companyId={c.id} kind="projects"/><RelatedRecords companyId={c.id} kind="milestones"/></>}
                {c && tab==='money' && data.invoices && <><RelatedRecords companyId={c.id} kind="invoices"/><RelatedRecords companyId={c.id} kind="payments"/></>}
                {c && tab==='support' && data.tickets && <RelatedRecords companyId={c.id} kind="tickets"/>}

                {c && <><div hidden={tab !== 'profile'}><CustomFields object="companies" values={c.customValues ?? {}} standardFields={[{label:"Company",value:c.name},{label:"Industry",value:c.industry},{label:"Email",value:c.email},{label:"Phone",value:c.phone},{label:"Website",value:c.website},{label:"Notes",value:c.notes}]} /><RelationshipProfile key={c.id} kind="company" id={c.id} onChanged={refresh}/>{tab === 'profile' && <AccountHierarchy companyId={c.id}/>}</div><div hidden={tab !== 'plan'}>{tab==='plan'&&<AccountCommitments companyId={c.id}/>}<AccountPlanPanel key={c.id} companyId={c.id}/></div>{tab === 'documents' && <CrmAttachments key={c.id} kind="company" id={c.id}/>}</>}
                {tab === 'activity' && (
                  <>
                    {c&&<Panel title="Unified relationship timeline"><RelationshipTimeline companyId={c.id}/></Panel>}
                    {data.timeline.length > 0 && (
                      <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">Record change history</summary>
                        <ul className="flex flex-col divide-y divide-border">
                          {data.timeline.map(t => (
                            <li key={t.id} className="flex items-center gap-3 py-2">
                              <History className="size-3.5 shrink-0 text-muted-foreground" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[12.5px] text-foreground">{t.title}</p>
                                <p className="text-[11.5px] text-muted-foreground">
                                  {t.user?.fullName ?? 'Someone'} · {formatRelativeTime(t.createdAt)}
                                </p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {link && (
        <>
          <ActivityDialog
            open={logOpen} onOpenChange={setLogOpen}
            mode="log" link={link} onSaved={refresh}
          />
          <ActivityDialog
            open={followOpen}
            onOpenChange={o => { setFollowOpen(o); if (!o) setEditingActivity(null); }}
            mode="followup" link={link} editing={editingActivity} onSaved={refresh}
          />
          <DealDialog
            open={dealOpen} onOpenChange={setDealOpen}
            editing={null}
            defaultCompany={c ? { id: c.id, name: c.name } : null}
            onSaved={refresh}
          />
          <ContactDialog
            open={contactOpen} onOpenChange={setContactOpen}
            editing={null}
            defaultCompany={c ? { id: c.id, name: c.name } : null}
            onSaved={refresh}
          />
        </>
      )}
    </>
  );
}
