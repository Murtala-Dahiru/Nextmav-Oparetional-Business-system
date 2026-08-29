'use client';

import * as React from 'react';
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
  company: {
    id: string; name: string; industry: string | null; website: string | null;
    email: string | null; phone: string | null; address: string | null;
    city: string | null; country: string | null; notes: string;
    employeeCount: number | null; annualRevenue: number | null;
    owner: { fullName: string; avatar: string } | null;
  };
  contacts: {
    id: string; firstName: string; lastName: string; email: string | null;
    phone: string | null; jobTitle: string | null; isActive: boolean;
  }[];
  deals: {
    id: string; name: string; stage: string; value: number; probability: number;
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
  activities: CrmActivity[];
  timeline: {
    id: number; module: string; action: string; title: string;
    createdAt: string; user: { fullName: string } | null;
  }[];
  summary: {
    contacts: number; openDeals: number; openDealValue: number; wonDealValue: number;
    activeProjects: number; projectsAtRisk: number; outstandingInvoiced: number;
    overdueInvoices: number; openTickets: number; currency: string;
  };
}

type Tab = 'overview' | 'people' | 'deals' | 'work' | 'money' | 'support' | 'activity';

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

  const [data, setData] = React.useState<Overview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<Tab>('overview');

  const [logOpen, setLogOpen] = React.useState(false);
  const [followOpen, setFollowOpen] = React.useState(false);
  const [dealOpen, setDealOpen] = React.useState(false);
  const [contactOpen, setContactOpen] = React.useState(false);
  const [editingActivity, setEditingActivity] = React.useState<CrmActivity | null>(null);

  const load = React.useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      setData(await getOne<Overview>(`/api/crm/companies/${companyId}/overview`));
    } catch (e: any) {
      setError(e.message || 'This customer could not be loaded');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  React.useEffect(() => {
    if (open && companyId) void load();
    if (!open) { setData(null); setTab('overview'); setError(null); }
  }, [open, companyId, load]);

  const refresh = React.useCallback(() => { void load(); onChanged?.(); }, [load, onChanged]);

  const c = data?.company;
  const s = data?.summary;

  /** Opening a record from here closes the panel: the destination is a module. */
  const go = (module: Parameters<typeof openRecord>[0], type: string, id: string) => {
    onOpenChange(false);
    openRecord(module, type, id);
  };

  /* ── The two facts nothing used to show ────────────────────────────────── */

  const owed = React.useMemo(
    () => (data?.activities ?? []).filter(a => a.dueAt && !a.completedAt)
      .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? '')),
    [data],
  );
  const history = React.useMemo(
    () => (data?.activities ?? []).filter(a => !a.dueAt || a.completedAt),
    [data],
  );
  const lastContact = history[0]?.completedAt ?? history[0]?.createdAt ?? null;
  const nextFollowUp = owed[0]?.dueAt ?? null;
  const overdueCount = owed.filter(a => whenOf(a.dueAt) === 'overdue').length;

  const link = c ? { kind: 'company' as const, id: c.id, label: c.name } : null;

  const tabs: { id: Tab; label: string; count?: number; shown: boolean }[] = [
    { id: 'overview', label: 'Overview', shown: true },
    { id: 'people', label: 'People', count: data?.contacts.length, shown: true },
    { id: 'deals', label: 'Deals', count: data?.deals.length, shown: true },
    { id: 'work', label: 'Work', count: data?.projects?.length, shown: Boolean(data?.projects) },
    { id: 'money', label: 'Money', count: data?.invoices?.length, shown: Boolean(data?.invoices) },
    { id: 'support', label: 'Support', count: data?.tickets?.length, shown: Boolean(data?.tickets) },
    { id: 'activity', label: 'Activity', count: data?.activities.length, shown: true },
  ];

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
          <SheetHeader className="border-b border-border px-5 py-4 text-left">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Building2 className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate text-[17px] leading-tight">
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

            {c && (
              <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12.5px]" onClick={() => setLogOpen(true)}>
                  <Plus className="size-3.5" /> Log activity
                </Button>
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12.5px]" onClick={() => setFollowOpen(true)}>
                  <CornerUpRight className="size-3.5" /> Follow up
                </Button>
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12.5px]" onClick={() => setDealOpen(true)}>
                  <Handshake className="size-3.5" /> New deal
                </Button>
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12.5px]" onClick={() => setContactOpen(true)}>
                  <Users className="size-3.5" /> Add contact
                </Button>
                <AddToMyWorkButton
                  source={{ module: 'crm', type: 'company', id: c.id, label: c.name }}
                  title={owed[0]?.subject || `Check in with ${c.name}`}
                  size="sm" variant="ghost" className="h-8 text-[12.5px]"
                />
                {onEdit && (
                  <Button
                    size="sm" variant="ghost" className="ml-auto h-8 gap-1.5 text-[12.5px]"
                    onClick={() => { onOpenChange(false); onEdit(c.id); }}
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
                  value={exact(s.openDealValue, s.currency)}
                  note={`${s.openDeals} ${s.openDeals === 1 ? 'deal' : 'deals'}`}
                />
                <Fig
                  label="Won to date"
                  value={exact(s.wonDealValue, s.currency)}
                  tone={s.wonDealValue > 0 ? 'good' : 'default'}
                />
                <Fig
                  label="Last contact"
                  value={lastContact ? relativeDay(lastContact) : 'Never'}
                  note={lastContact ? formatDate(lastContact) : 'Nothing has been logged'}
                  tone={!lastContact ? 'warn' : 'default'}
                />
                <Fig
                  label="Next follow-up"
                  value={nextFollowUp ? relativeDay(nextFollowUp) : 'None'}
                  note={owed[0]?.subject}
                  tone={overdueCount ? 'warn' : 'default'}
                />
                {data.invoices && (
                  <Fig
                    label="Outstanding"
                    value={exact(s.outstandingInvoiced, s.currency)}
                    note={s.overdueInvoices ? `${s.overdueInvoices} overdue` : 'Nothing overdue'}
                    tone={s.overdueInvoices ? 'warn' : 'default'}
                  />
                )}
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
                <FilterRow
                  ariaLabel="Section"
                  value={tab}
                  onChange={v => setTab(v as Tab)}
                  options={tabs.filter(t => t.shown).map(t => ({
                    value: t.id, label: t.label, count: t.count,
                  }))}
                />
              </div>

              <div className="flex flex-col gap-4 p-5">
                {tab === 'overview' && (
                  <>
                    <Panel
                      title="Next"
                      count={owed.length}
                      action={
                        <Button size="sm" variant="ghost" className="h-7 gap-1 text-[12px]" onClick={() => setFollowOpen(true)}>
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
                          Nothing scheduled with this customer.
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
                          See all {history.length}
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

                {tab === 'people' && (
                  <Panel
                    title="Contacts"
                    count={data.contacts.length}
                    action={
                      <Button size="sm" variant="ghost" className="h-7 gap-1 text-[12px]" onClick={() => setContactOpen(true)}>
                        <Plus className="size-3" /> Add
                      </Button>
                    }
                  >
                    {data.contacts.length === 0 ? (
                      <p className="py-1 text-[12.5px] text-muted-foreground">
                        Nobody is recorded at this customer yet. Without a contact there is no
                        one to send a proposal to.
                      </p>
                    ) : (
                      <div className="flex flex-col divide-y divide-border">
                        {data.contacts.map(p => (
                          <Row key={p.id} onOpen={() => go('crm', 'contact', p.id)}>
                            <Monogram name={`${p.firstName} ${p.lastName}`} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] text-foreground">
                                {`${p.firstName} ${p.lastName}`.trim()}
                                {!p.isActive && (
                                  <span className="ml-2 text-[11.5px] text-muted-foreground">no longer here</span>
                                )}
                              </p>
                              <p className="truncate text-[11.5px] text-muted-foreground">
                                {[p.jobTitle, p.email].filter(Boolean).join(' · ') || 'No title or email'}
                              </p>
                            </div>
                          </Row>
                        ))}
                      </div>
                    )}
                  </Panel>
                )}

                {tab === 'deals' && (
                  <Panel
                    title="Deals"
                    count={data.deals.length}
                    action={
                      <Button size="sm" variant="ghost" className="h-7 gap-1 text-[12px]" onClick={() => setDealOpen(true)}>
                        <Plus className="size-3" /> Add
                      </Button>
                    }
                  >
                    {data.deals.length === 0 ? (
                      <p className="py-1 text-[12.5px] text-muted-foreground">
                        No deals with this customer yet.
                      </p>
                    ) : (
                      <div className="flex flex-col divide-y divide-border">
                        {data.deals.map(d => {
                          const left = daysUntil(d.expectedClose);
                          const late = left !== null && left < 0
                            && d.stage !== 'closed_won' && d.stage !== 'closed_lost';
                          return (
                            <Row key={d.id} onOpen={() => go('crm', 'deal', d.id)}>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] text-foreground">{d.name}</p>
                                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted-foreground">
                                  <StageTag stage={d.stage} />
                                  {d.expectedClose && (
                                    <span className={cn(late && 'font-medium text-destructive')}>
                                      closes {formatDay(d.expectedClose)}
                                    </span>
                                  )}
                                </p>
                              </div>
                              <div className="shrink-0 text-right">
                                <p className="text-[13px] font-medium tabular-nums">
                                  {exact(d.value, s.currency)}
                                </p>
                                <p className="text-[11.5px] text-muted-foreground">{d.probability}%</p>
                              </div>
                            </Row>
                          );
                        })}
                      </div>
                    )}
                  </Panel>
                )}

                {tab === 'work' && data.projects && (
                  <Panel title="Projects" count={data.projects.length}>
                    {data.projects.length === 0 ? (
                      <p className="py-1 text-[12.5px] text-muted-foreground">
                        No projects are linked to this customer.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {data.projects.map(p => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => go('projects', 'project', p.id)}
                            className="group rounded-md p-1.5 text-left transition-colors hover:bg-accent/60"
                          >
                            <div className="flex items-center gap-2">
                              <span className="truncate text-[13px] font-medium">{p.name}</span>
                              {p.isAtRisk && (
                                <span className="inline-flex items-center gap-1 rounded border border-warning/40 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                                  <AlertTriangle className="size-3" /> At risk
                                </span>
                              )}
                              <span className="ml-auto shrink-0 text-[12px] tabular-nums text-muted-foreground">
                                {p.progressPct}%
                              </span>
                            </div>
                            <Progress value={p.progressPct} className="mt-1.5 h-1.5" />
                            <p className="mt-1 text-[11.5px] text-muted-foreground">
                              {p.completedTasks}/{p.totalTasks} tasks
                              {p.overdueTasks > 0 && ` · ${p.overdueTasks} overdue`}
                              {p.endDate && ` · due ${formatDay(p.endDate)}`}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}

                    {data.meetings && data.meetings.length > 0 && (
                      <div className="mt-4 border-t border-border pt-3">
                        <p className="mb-2 text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground/85">
                          Coming up
                        </p>
                        <div className="flex flex-col divide-y divide-border">
                          {data.meetings.map(m => (
                            <Row key={m.id}>
                              <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px]">{m.title}</p>
                                <p className="text-[11.5px] text-muted-foreground">
                                  {formatDate(m.startsAt)}
                                  {m.location ? ` · ${m.location}` : ''}
                                </p>
                              </div>
                            </Row>
                          ))}
                        </div>
                      </div>
                    )}
                  </Panel>
                )}

                {tab === 'money' && data.invoices && (
                  <Panel title="Invoices" count={data.invoices.length}>
                    {data.invoices.length === 0 ? (
                      <p className="py-1 text-[12.5px] text-muted-foreground">Nothing has been invoiced yet.</p>
                    ) : (
                      <div className="flex flex-col divide-y divide-border">
                        {data.invoices.map(i => {
                          const overdue = i.dueDate && i.dueDate < new Date().toISOString().slice(0, 10);
                          const unpaid = i.status !== 'paid' && i.status !== 'cancelled';
                          return (
                            <Row key={i.id} onOpen={() => go('finance', 'invoice', i.id)}>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] text-foreground">{i.invoiceNumber}</p>
                                <p className={cn(
                                  'text-[11.5px]',
                                  unpaid && overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
                                )}>
                                  Issued {formatDay(i.issueDate)} · due {formatDay(i.dueDate)}
                                  {unpaid && overdue ? ' · overdue' : ''}
                                </p>
                              </div>
                              <div className="shrink-0 text-right">
                                <p className="text-[13px] font-medium tabular-nums">
                                  {exact(i.total, i.currency || s.currency)}
                                </p>
                                <p className="text-[11.5px] capitalize text-muted-foreground">
                                  {i.status.replace(/_/g, ' ')}
                                </p>
                              </div>
                            </Row>
                          );
                        })}
                      </div>
                    )}
                  </Panel>
                )}

                {tab === 'support' && data.tickets && (
                  <Panel title="Tickets" count={data.tickets.length}>
                    {data.tickets.length === 0 ? (
                      <p className="py-1 text-[12.5px] text-muted-foreground">
                        This customer has raised nothing.
                      </p>
                    ) : (
                      <div className="flex flex-col divide-y divide-border">
                        {data.tickets.map(t => (
                          <Row key={t.id} onOpen={() => go('support', 'ticket', t.id)}>
                            <LifeBuoy className="size-3.5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] text-foreground">{t.subject}</p>
                              <p className="text-[11.5px] capitalize text-muted-foreground">
                                {t.ticketNumber} · {t.status.replace(/_/g, ' ')} · {t.priority}
                              </p>
                            </div>
                            <span className="shrink-0 text-[11.5px] text-muted-foreground">
                              {formatRelativeTime(t.createdAt)}
                            </span>
                          </Row>
                        ))}
                      </div>
                    )}
                  </Panel>
                )}

                {tab === 'activity' && (
                  <>
                    <Panel
                      title="History"
                      count={history.length}
                      action={
                        <Button size="sm" variant="ghost" className="h-7 gap-1 text-[12px]" onClick={() => setLogOpen(true)}>
                          <Plus className="size-3" /> Log
                        </Button>
                      }
                    >
                      <Timeline
                        items={history}
                        empty={
                          <p className="py-1 text-[12.5px] text-muted-foreground">
                            Nothing has been logged against this customer. Record the first
                            call and it appears here.
                          </p>
                        }
                      />
                    </Panel>

                    {data.timeline.length > 0 && (
                      <Panel title="Changes" count={data.timeline.length}>
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
                      </Panel>
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
