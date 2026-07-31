'use client';

import * as React from 'react';
import {
  Building2, Users, Handshake, FolderKanban, Receipt, LifeBuoy, CalendarDays,
  Activity, Globe, Mail, Phone, MapPin, AlertTriangle, Loader2, ExternalLink,
  Plus, PhoneCall, Send, StickyNote, CalendarClock,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/shared/empty-state';
import { useAppStore } from '@/store/app-store';
import { formatCurrency, formatDate, formatRelativeTime, initialsOf } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The customer, whole.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Everything the platform knows about one company, on one screen: the people,
 *  the pipeline, the work in flight and its health, what is owed, what is
 *  broken, what is scheduled, and what anyone has done about it.
 *
 *  Each panel is a live read of the module that owns it — projects come from
 *  `v_project_health`, the same view the project board reads; invoices are the
 *  Finance rows, not a copy. There is no customer table duplicating any of it,
 *  which is why a project marked at risk this morning is at risk here too,
 *  without anyone synchronising anything.
 *
 *  Panels the caller's role cannot see are absent from the response entirely,
 *  so this component renders what it is given rather than deciding who may see
 *  what — the access decision belongs on the server.
 */

interface Overview {
  company: {
    id: string; name: string; industry: string | null; website: string | null;
    email: string | null; phone: string | null; address: string | null;
    city: string | null; country: string | null; notes: string;
    employeeCount: number | null; annualRevenue: number | null;
    owner: { fullName: string; avatar: string } | null;
  };
  contacts: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; jobTitle: string | null; isActive: boolean }[];
  deals: { id: string; name: string; stage: string; value: number; probability: number; expectedClose: string | null; owner: { fullName: string } | null }[];
  projects?: { id: string; name: string; status: string; priority: string; endDate: string | null; progressPct: number; totalTasks: number; completedTasks: number; overdueTasks: number; daysRemaining: number | null; isAtRisk: boolean }[];
  invoices?: { id: string; invoiceNumber: string; status: string; issueDate: string; dueDate: string; total: number; amountPaid: number; currency: string }[];
  tickets?: { id: string; ticketNumber: string; subject: string; status: string; priority: string; createdAt: string; resolvedAt: string | null }[];
  meetings?: { id: string; title: string; startsAt: string; endsAt: string; allDay: boolean; location: string | null }[];
  activities: { id: string; activityType: string; subject: string; body: string; createdAt: string; user: { fullName: string } | null }[];
  timeline: { id: number; module: string; action: string; title: string; createdAt: string; user: { fullName: string } | null }[];
  summary: {
    contacts: number; openDeals: number; openDealValue: number; wonDealValue: number;
    activeProjects: number; projectsAtRisk: number; outstandingInvoiced: number;
    overdueInvoices: number; openTickets: number; currency: string;
  };
}

const ACTIVITY_ICONS: Record<string, React.ElementType> = {
  call: PhoneCall, email: Send, meeting: CalendarClock, note: StickyNote,
};

function StatTile({
  label, value, icon: Icon, tone = 'default',
}: {
  label: string; value: string; icon: React.ElementType; tone?: 'default' | 'warn';
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className={cn('size-3.5', tone === 'warn' && 'text-amber-600')} />
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className={cn('mt-1 text-lg font-semibold tabular-nums', tone === 'warn' && 'text-amber-600')}>
        {value}
      </p>
    </div>
  );
}

function Panel({
  title, icon: Icon, count, action, children,
}: {
  title: string; icon: React.ElementType; count?: number;
  action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card">
      <header className="flex items-center gap-2 border-b px-3.5 py-2.5">
        <Icon className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">{title}</h3>
        {count !== undefined && count > 0 && (
          <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">{count}</Badge>
        )}
        {action && <div className="ml-auto">{action}</div>}
      </header>
      <div className="p-3.5">{children}</div>
    </section>
  );
}

/** A row that opens the record it names, in the module that owns it. */
function LinkRow({
  onOpen, children,
}: {
  onOpen?: () => void; children: React.ReactNode;
}) {
  if (!onOpen) return <div className="flex items-center gap-3 py-1.5">{children}</div>;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-3 rounded-md py-1.5 text-left hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none"
    >
      {children}
      <ExternalLink className="ml-auto size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
    </button>
  );
}

export function CompanyDetail({
  companyId,
  open,
  onOpenChange,
  onEdit,
}: {
  companyId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (companyId: string) => void;
}) {
  const [data, setData] = React.useState<Overview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [logOpen, setLogOpen] = React.useState(false);

  const openRecord = useAppStore(s => s.openRecord);

  const load = React.useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/crm/companies/${companyId}/overview`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || 'Could not load this customer');
      setData(json.data);
    } catch (err: any) {
      toast.error(err.message || 'Could not load this customer');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  React.useEffect(() => {
    if (open && companyId) void load();
    if (!open) setData(null);
  }, [open, companyId, load]);

  const c = data?.company;
  const s = data?.summary;

  /** Opening a record from here closes the panel: the destination is a module. */
  const go = (module: Parameters<typeof openRecord>[0], type: string, id: string) => {
    onOpenChange(false);
    openRecord(module, type, id);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-2xl">
          <SheetHeader className="border-b px-5 py-4">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                <Building2 className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate text-left text-base">
                  {c?.name ?? (loading ? 'Loading…' : 'Customer')}
                </SheetTitle>
                <SheetDescription className="text-left text-xs">
                  {[c?.industry, [c?.city, c?.country].filter(Boolean).join(', ')]
                    .filter(Boolean).join(' · ') || 'No industry or location recorded'}
                </SheetDescription>
              </div>
              {companyId && onEdit && (
                <Button size="sm" variant="outline" onClick={() => onEdit(companyId)}>
                  Edit
                </Button>
              )}
            </div>

            {c && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                {c.website && (
                  <a
                    href={c.website.startsWith('http') ? c.website : `https://${c.website}`}
                    target="_blank" rel="noreferrer noopener"
                    className="flex items-center gap-1 hover:text-foreground hover:underline"
                  >
                    <Globe className="size-3.5" /> {c.website}
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
                {c.address && (
                  <span className="flex items-center gap-1"><MapPin className="size-3.5" /> {c.address}</span>
                )}
                {c.owner?.fullName && (
                  <span className="flex items-center gap-1">
                    <Avatar className="size-4">
                      <AvatarFallback className="bg-muted text-[8px]">{initialsOf(c.owner.fullName)}</AvatarFallback>
                    </Avatar>
                    {c.owner.fullName}
                  </span>
                )}
              </div>
            )}
          </SheetHeader>

          {loading && !data ? (
            <div className="space-y-4 p-5">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
              </div>
              <Skeleton className="h-40 rounded-lg" />
              <Skeleton className="h-40 rounded-lg" />
            </div>
          ) : !data ? (
            <div className="p-5">
              <EmptyState
                icon={Building2}
                title="Nothing to show"
                description="This customer could not be loaded."
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4 p-5">
              {/* ── The relationship at a glance ─────────────────────────── */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatTile
                  label="Open pipeline" icon={Handshake}
                  value={formatCurrency(s!.openDealValue, s!.currency)}
                />
                {data.projects && (
                  <StatTile
                    label="Active work" icon={FolderKanban}
                    value={`${s!.activeProjects}${s!.projectsAtRisk ? ` · ${s!.projectsAtRisk} at risk` : ''}`}
                    tone={s!.projectsAtRisk ? 'warn' : 'default'}
                  />
                )}
                {data.invoices && (
                  <StatTile
                    label="Outstanding" icon={Receipt}
                    value={formatCurrency(s!.outstandingInvoiced, s!.currency)}
                    tone={s!.overdueInvoices ? 'warn' : 'default'}
                  />
                )}
                {data.tickets && (
                  <StatTile
                    label="Open tickets" icon={LifeBuoy}
                    value={String(s!.openTickets)}
                    tone={s!.openTickets ? 'warn' : 'default'}
                  />
                )}
              </div>

              {/* ── People ───────────────────────────────────────────────── */}
              <Panel title="Contacts" icon={Users} count={data.contacts.length}>
                {data.contacts.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">No contacts recorded for this customer yet.</p>
                ) : (
                  <div className="flex flex-col divide-y">
                    {data.contacts.map(p => (
                      <LinkRow key={p.id} onOpen={() => go('crm', 'contact', p.id)}>
                        <Avatar className="size-7 shrink-0">
                          <AvatarFallback className="bg-emerald-500/10 text-[10px] text-emerald-700">
                            {initialsOf(`${p.firstName} ${p.lastName}`)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{p.firstName} {p.lastName}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[p.jobTitle, p.email].filter(Boolean).join(' · ') || 'No title or email'}
                          </p>
                        </div>
                      </LinkRow>
                    ))}
                  </div>
                )}
              </Panel>

              {/* ── Pipeline ─────────────────────────────────────────────── */}
              <Panel title="Deals" icon={Handshake} count={data.deals.length}>
                {data.deals.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">No deals with this customer.</p>
                ) : (
                  <div className="flex flex-col divide-y">
                    {data.deals.map(d => (
                      <LinkRow key={d.id} onOpen={() => go('crm', 'deal', d.id)}>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{d.name}</p>
                          <p className="text-xs text-muted-foreground">
                            <span className="capitalize">{d.stage.replace(/_/g, ' ')}</span>
                            {d.expectedClose && ` · closes ${formatDate(d.expectedClose)}`}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-medium tabular-nums">
                            {formatCurrency(d.value, s!.currency)}
                          </p>
                          <p className="text-xs text-muted-foreground">{d.probability}%</p>
                        </div>
                      </LinkRow>
                    ))}
                  </div>
                )}
              </Panel>

              {/* ── Delivery ─────────────────────────────────────────────── */}
              {data.projects && (
                <Panel title="Projects" icon={FolderKanban} count={data.projects.length}>
                  {data.projects.length === 0 ? (
                    <p className="py-2 text-sm text-muted-foreground">
                      No projects are linked to this customer.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {data.projects.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => go('projects', 'project', p.id)}
                          className="group rounded-md p-1.5 text-left hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none"
                        >
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">{p.name}</span>
                            {p.isAtRisk && (
                              <Badge variant="outline" className="h-5 gap-1 border-amber-500/40 px-1.5 text-[10px] text-amber-600">
                                <AlertTriangle className="size-3" /> At risk
                              </Badge>
                            )}
                            <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                              {p.progressPct}%
                            </span>
                          </div>
                          <Progress value={p.progressPct} className="mt-1.5 h-1.5" />
                          <p className="mt-1 text-xs text-muted-foreground">
                            {p.completedTasks}/{p.totalTasks} tasks
                            {p.overdueTasks > 0 && ` · ${p.overdueTasks} overdue`}
                            {p.endDate && ` · due ${formatDate(p.endDate)}`}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </Panel>
              )}

              {/* ── Money ────────────────────────────────────────────────── */}
              {data.invoices && (
                <Panel title="Invoices" icon={Receipt} count={data.invoices.length}>
                  {data.invoices.length === 0 ? (
                    <p className="py-2 text-sm text-muted-foreground">Nothing has been invoiced yet.</p>
                  ) : (
                    <div className="flex flex-col divide-y">
                      {data.invoices.map(i => {
                        const due = i.dueDate && i.dueDate < new Date().toISOString().slice(0, 10);
                        const unpaid = i.status !== 'paid' && i.status !== 'cancelled';
                        return (
                          <LinkRow key={i.id} onOpen={() => go('finance', 'invoice', i.id)}>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm">{i.invoiceNumber}</p>
                              <p className="text-xs text-muted-foreground">
                                Issued {formatDate(i.issueDate)} · due {formatDate(i.dueDate)}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-sm font-medium tabular-nums">
                                {formatCurrency(i.total, i.currency || s!.currency)}
                              </p>
                              <Badge
                                variant="outline"
                                className={cn(
                                  'h-5 px-1.5 text-[10px] capitalize',
                                  due && unpaid && 'border-red-500/40 text-red-600',
                                )}
                              >
                                {due && unpaid ? 'Overdue' : i.status}
                              </Badge>
                            </div>
                          </LinkRow>
                        );
                      })}
                    </div>
                  )}
                </Panel>
              )}

              {/* ── Service ──────────────────────────────────────────────── */}
              {data.tickets && (
                <Panel title="Support tickets" icon={LifeBuoy} count={data.tickets.length}>
                  {data.tickets.length === 0 ? (
                    <p className="py-2 text-sm text-muted-foreground">No support tickets from this customer.</p>
                  ) : (
                    <div className="flex flex-col divide-y">
                      {data.tickets.map(t => (
                        <LinkRow key={t.id} onOpen={() => go('support', 'ticket', t.id)}>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm">{t.subject}</p>
                            <p className="text-xs text-muted-foreground">
                              {t.ticketNumber} · {formatRelativeTime(t.createdAt)}
                            </p>
                          </div>
                          <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px] capitalize">
                            {t.status.replace(/_/g, ' ')}
                          </Badge>
                        </LinkRow>
                      ))}
                    </div>
                  )}
                </Panel>
              )}

              {/* ── Diary ────────────────────────────────────────────────── */}
              {data.meetings && data.meetings.length > 0 && (
                <Panel title="Upcoming meetings" icon={CalendarDays} count={data.meetings.length}>
                  <div className="flex flex-col divide-y">
                    {data.meetings.map(m => (
                      <div key={m.id} className="flex items-center gap-3 py-1.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{m.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(m.startsAt)}{m.location ? ` · ${m.location}` : ''}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}

              {/* ── What anyone has done about it ────────────────────────── */}
              <Panel
                title="Activity" icon={Activity} count={data.activities.length}
                action={
                  <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => setLogOpen(true)}>
                    <Plus className="size-3.5" /> Log
                  </Button>
                }
              >
                {data.activities.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">
                    No calls, emails or notes logged against this customer yet.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {data.activities.map(a => {
                      const Icon = ACTIVITY_ICONS[a.activityType] ?? StickyNote;
                      return (
                        <li key={a.id} className="flex items-start gap-2.5">
                          <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                            <Icon className="size-3.5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm">{a.subject}</p>
                            {a.body && <p className="text-xs text-muted-foreground">{a.body}</p>}
                            <p className="text-[11px] text-muted-foreground">
                              {a.user?.fullName ? `${a.user.fullName} · ` : ''}
                              {formatRelativeTime(a.createdAt)}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {data.timeline.length > 0 && (
                  <>
                    <Separator className="my-3" />
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Record history
                    </p>
                    <ul className="flex flex-col gap-2">
                      {data.timeline.map(t => (
                        <li key={t.id} className="flex items-baseline gap-2 text-xs">
                          <span className="truncate text-muted-foreground">{t.title}</span>
                          <span className="ml-auto shrink-0 text-muted-foreground/70">
                            {formatRelativeTime(t.createdAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Panel>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <LogActivityDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        companyId={companyId}
        companyName={c?.name ?? ''}
        onLogged={() => { setLogOpen(false); void load(); }}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Log a call, email, meeting or note                                        */
/* -------------------------------------------------------------------------- */

function LogActivityDialog({
  open, onOpenChange, companyId, companyName, onLogged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  companyId: string | null;
  companyName: string;
  onLogged: () => void;
}) {
  const [activityType, setActivityType] = React.useState('call');
  const [subject, setSubject] = React.useState('');
  const [body, setBody] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) { setActivityType('call'); setSubject(''); setBody(''); }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !subject.trim()) {
      toast.error('A subject is required');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/crm/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityType, subject: subject.trim(), body: body.trim(), companyId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || 'Could not log this activity');
      toast.success('Activity logged');
      onLogged();
    } catch (err: any) {
      toast.error(err.message || 'Could not log this activity');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log activity</DialogTitle>
          <DialogDescription>
            Record a call, email, meeting or note against {companyName || 'this customer'}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Type</label>
            <Select value={activityType} onValueChange={setActivityType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="call">Call</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="meeting">Meeting</SelectItem>
                <SelectItem value="note">Note</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Subject</label>
            <Input
              value={subject} onChange={e => setSubject(e.target.value)}
              placeholder="Discovery call with the CTO" autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Outcome</label>
            <Textarea
              value={body} onChange={e => setBody(e.target.value)} rows={3}
              placeholder="What was agreed, and what happens next"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving} className="bg-emerald-600 text-white hover:bg-emerald-700">
              {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Log activity
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
