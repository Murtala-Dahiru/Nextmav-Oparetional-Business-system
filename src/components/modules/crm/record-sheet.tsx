'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  Building2, Mail, Phone, Handshake, Trophy, XCircle, Pencil, Plus,
  CornerUpRight, ArrowRight, Trash2, ExternalLink, Sparkles, Clock,
} from 'lucide-react';

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { AddToMyWorkButton } from '@/components/shared/add-to-my-work';
import { formatDate } from '@/lib/format';
import { statusLabel } from '@/lib/constants';

import { getList, getOne, exact, formatDay, relativeDay, daysUntil, listQuery } from './data';
import {
  StageTag, LeadStatusTag, Gauge, OwnerTag, Monogram, personName, sourceLabel,
  Spinner, Broken, Blank,
} from './ui';
import { Facts, Panel, NextActions, Timeline, useDeleteActivity, whenOf } from './record-parts';
import { ActivityDialog } from './activity-dialog';
import { LeadDialog, ContactDialog, DealDialog, CloseDealDialog } from './forms';
import { ConvertLeadDialog } from './convert-dialog';
import { STAGE_LABELS, OPEN_STAGES, type CrmActivity, type Deal, type Lead, type Contact } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A record, as a place to work rather than a form to fill in
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What opening a deal used to do ───────────────────────────────────────
 *
 * Open an edit dialog. Fourteen inputs, a Cancel and an Update. So the answer
 * to "where is this deal, what happened, and what next" was: read the fields
 * and work it out - and the two most useful facts, the history and the next
 * action, were not on the screen at all because nothing rendered them.
 *
 * This is the same record as a workspace. The facts are read, not edited; the
 * timeline is there; the thing owed is at the top where it cannot be missed;
 * and the actions are the five things people actually do next. Editing is
 * still a form, behind a button, because editing is the rarer act.
 *
 * ── Why a sheet and not a page ───────────────────────────────────────────
 *
 * The list is the context. A salesperson works a queue - open, act, close,
 * next - and a full-page navigation loses the queue's scroll position, its
 * filters and its page. On a phone the sheet is full width and behaves like a
 * page, which is the right shape there.
 */

type Kind = 'lead' | 'contact' | 'deal';

const ENDPOINT: Record<Kind, string> = {
  lead: '/api/crm/leads',
  contact: '/api/crm/contacts',
  deal: '/api/crm/deals',
};

const FILTER_KEY: Record<Kind, string> = {
  lead: 'leadId', contact: 'contactId', deal: 'dealId',
};

interface StageEvent {
  id: number;
  fromStage: string | null;
  toStage: string;
  createdAt: string;
  days: number;
  open: boolean;
  member?: { profiles?: { fullName: string } } | null;
}

/* -------------------------------------------------------------------------- */
/*  Stage rail                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Where the deal is, and how long it has taken to get there.
 *
 * ── Why this and not a stage dropdown ────────────────────────────────────
 *
 * A pipeline is a sequence, and a `<select>` renders a sequence as an
 * unordered list of six words. The rail shows the whole route, marks where the
 * deal is on it, and - because `deal_stage_events` now exists - can say how
 * many days each step took. That last part is the difference between a status
 * field and a piece of information: "eleven days in proposal" is the sentence
 * a sales manager is actually looking for.
 *
 * Clicking a step moves the deal there, which is the fastest path there is for
 * the single most common edit anybody makes to a deal.
 */
function StageRail({
  deal, events, onMove, busy,
}: {
  deal: Deal;
  events: StageEvent[];
  onMove: (stage: string) => void;
  busy: boolean;
}) {
  const closed = deal.stage === 'closed_won' || deal.stage === 'closed_lost';
  const at = OPEN_STAGES.indexOf(deal.stage);

  /** The most recent arrival at each stage, for the duration labels. */
  const arrivedAt = new Map<string, StageEvent>();
  for (const e of events) arrivedAt.set(e.toStage, e);

  return (
    <div>
      <div className="flex items-stretch gap-1">
        {OPEN_STAGES.map((stage, i) => {
          const reached = closed ? deal.stage === 'closed_won' : i <= at;
          const here = stage === deal.stage;
          const event = arrivedAt.get(stage);

          return (
            <button
              key={stage}
              type="button"
              disabled={busy || here}
              onClick={() => onMove(stage)}
              title={here ? `Currently in ${STAGE_LABELS[stage]}` : `Move to ${STAGE_LABELS[stage]}`}
              className={cn(
                'group min-w-0 flex-1 rounded-md px-1.5 py-1.5 text-left transition-colors',
                !here && !busy && 'hover:bg-accent',
              )}
            >
              <span
                aria-hidden="true"
                className="mb-1.5 block h-[3px] rounded-full transition-colors"
                style={{
                  background: reached
                    ? `color-mix(in srgb, var(--chart-1) ${here ? 100 : 55}%, var(--muted))`
                    : 'var(--border)',
                }}
              />
              <span className={cn(
                'block truncate text-[11px] leading-tight',
                here ? 'font-semibold text-foreground' : 'text-muted-foreground',
              )}>
                {STAGE_LABELS[stage]}
              </span>
              <span className="block truncate text-[10.5px] tabular-nums text-muted-foreground/70">
                {here && event ? `${event.days}d here` : event ? `${event.days}d` : ''}
              </span>
            </button>
          );
        })}
      </div>

      {closed && (
        <p className={cn(
          'mt-2 flex items-center gap-1.5 text-[12px] font-medium',
          deal.stage === 'closed_won' ? 'text-success' : 'text-destructive',
        )}>
          {deal.stage === 'closed_won'
            ? <Trophy className="size-3.5" />
            : <XCircle className="size-3.5" />}
          {deal.stage === 'closed_won' ? 'Won' : 'Lost'}
          {deal.closedAt ? ` on ${formatDate(deal.closedAt)}` : ''}
          {deal.lostReason ? ` · ${deal.lostReason}` : ''}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  The sheet                                                                 */
/* -------------------------------------------------------------------------- */

export function RecordSheet({
  kind, id, open, onOpenChange, onChanged,
}: {
  kind: Kind;
  id: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** The list behind this sheet should refetch. */
  onChanged: () => void;
}) {
  const openRecord = useAppStore(s => s.openRecord);

  const [record, setRecord] = React.useState<any>(null);
  const [activities, setActivities] = React.useState<CrmActivity[]>([]);
  const [events, setEvents] = React.useState<StageEvent[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [moving, setMoving] = React.useState(false);

  const [logOpen, setLogOpen] = React.useState(false);
  const [followOpen, setFollowOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [convertOpen, setConvertOpen] = React.useState(false);
  const [closing, setClosing] = React.useState<null | 'closed_won' | 'closed_lost'>(null);
  const [editingActivity, setEditingActivity] = React.useState<CrmActivity | null>(null);

  const load = React.useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [row, acts] = await Promise.all([
        getOne<any>(`${ENDPOINT[kind]}/${id}`),
        getList<CrmActivity>(
          `/api/crm/activities?${listQuery({ [FILTER_KEY[kind]]: id, pageSize: 100, sort: 'created_at', sortDir: 'desc' })}`,
        ),
      ]);
      setRecord(row);
      setActivities(acts.data);

      if (kind === 'deal') {
        try {
          const history = await getOne<{ events: StageEvent[] }>(`/api/crm/deals/${id}/history`);
          setEvents(history.events ?? []);
        } catch {
          // The history is a nicety. A deal panel without it still works, and
          // a deployment that has not run 0028 should not lose the whole sheet.
          setEvents([]);
        }
      }
    } catch (e: any) {
      setError(e.message || 'This record could not be loaded');
      setRecord(null);
    } finally {
      setLoading(false);
    }
  }, [id, kind]);

  React.useEffect(() => {
    if (open && id) void load();
    if (!open) { setRecord(null); setActivities([]); setEvents([]); setError(null); }
  }, [open, id, load]);

  const refresh = React.useCallback(() => { void load(); onChanged(); }, [load, onChanged]);
  const deleteActivity = useDeleteActivity(refresh);

  const owed = activities.filter(a => a.dueAt && !a.completedAt);
  const history = activities.filter(a => !a.dueAt || a.completedAt);

  /* ── Moving a deal from the rail ─────────────────────────────────────── */

  const move = async (stage: string) => {
    if (!record) return;
    setMoving(true);
    try {
      await fetch(`/api/crm/deals/${record.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, probability: PROBABILITY[stage] ?? record.probability }),
      }).then(async r => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error?.message ?? 'That did not work');
      });
      toast.success(`Moved to ${STAGE_LABELS[stage]}`);
      refresh();
    } catch (e: any) {
      toast.error(e.message || 'That could not be moved');
    } finally {
      setMoving(false);
    }
  };

  /* ── Header ──────────────────────────────────────────────────────────── */

  const title = record
    ? kind === 'deal' ? record.name : personName(record) || record.email || 'Unnamed'
    : loading ? 'Loading' : 'Record';

  const workSource = record
    ? {
      module: 'crm' as const,
      type: kind,
      id: record.id,
      label: kind === 'deal'
        ? sourceLabel(record.company?.name, record.name)
        : sourceLabel(record.company?.name ?? record.companyName, personName(record)),
    }
    : null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        {/*
          The same width as Company 360, deliberately.

          At `max-w-xl` the six header actions - log, follow up, won, lost, add
          to My Work, edit - wrapped onto two rows with Edit alone on the
          second. A deal is a workspace and it earns the same width as a
          customer.
        */}
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
          <SheetHeader className="border-b border-border py-4 pl-5 pr-12 text-left">
            <div className="flex items-start gap-3">
              {kind === 'deal'
                ? (
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Handshake className="size-4" />
                  </span>
                )
                : <Monogram name={title} className="size-9 text-[12px]" />}

              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate text-[16px] leading-tight">{title}</SheetTitle>
                <SheetDescription className="mt-0.5 text-[12.5px]">
                  {record
                    ? kind === 'deal'
                      ? [record.company?.name, personName(record.contact)].filter(Boolean).join(' · ') || 'No customer linked'
                      : [record.jobTitle, record.company?.name ?? record.companyName].filter(Boolean).join(' · ') || 'No company recorded'
                    : ' '}
                </SheetDescription>
              </div>

              {record && (
                <div className="shrink-0 text-right">
                  {kind === 'deal' ? (
                    <>
                      <p className="text-[17px] font-semibold leading-none tabular-nums text-foreground">
                        {exact(record.value)}
                      </p>
                      <p className="mt-1 text-[11.5px] text-muted-foreground">
                        {record.probability}% · {exact(record.value * record.probability / 100)}
                      </p>
                    </>
                  ) : kind === 'lead' ? (
                    <LeadStatusTag status={record.status} />
                  ) : null}
                </div>
              )}
            </div>

            {/* ── The five things people do next ──────────────────────────── */}
            {record && (
              <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12.5px]" onClick={() => setLogOpen(true)}>
                  <Plus className="size-3.5" /> Log activity
                </Button>
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12.5px]" onClick={() => setFollowOpen(true)}>
                  <CornerUpRight className="size-3.5" /> Follow up
                </Button>

                {kind === 'lead' && !record.convertedContactId && (
                  <Button size="sm" className="h-8 gap-1.5 text-[12.5px]" onClick={() => setConvertOpen(true)}>
                    <ArrowRight className="size-3.5" /> Convert
                  </Button>
                )}

                {kind === 'deal' && record.stage !== 'closed_won' && record.stage !== 'closed_lost' && (
                  <>
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12.5px]" onClick={() => setClosing('closed_won')}>
                      <Trophy className="size-3.5" /> Won
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12.5px]" onClick={() => setClosing('closed_lost')}>
                      <XCircle className="size-3.5" /> Lost
                    </Button>
                  </>
                )}

                {workSource && (
                  <AddToMyWorkButton
                    source={workSource}
                    title={owed[0]?.subject || (kind === 'deal' ? `Move ${record.name} forward` : `Follow up with ${title}`)}
                    size="sm"
                    variant="ghost"
                    className="h-8 text-[12.5px]"
                  />
                )}

                <Button
                  size="sm" variant="ghost" className="h-8 gap-1.5 text-[12.5px]"
                  onClick={() => setEditOpen(true)}
                >
                  <Pencil className="size-3.5" /> Edit
                </Button>
              </div>
            )}
          </SheetHeader>

          {loading && !record ? (
            <Spinner label="Loading this record" />
          ) : error ? (
            <div className="p-5"><Broken message={error} onRetry={load} /></div>
          ) : !record ? null : (
            <div className="flex flex-col gap-4 p-5">
              {/* ── Where it is ─────────────────────────────────────────── */}
              {kind === 'deal' && (
                <Panel title="Stage">
                  <StageRail deal={record as Deal} events={events} onMove={move} busy={moving} />
                </Panel>
              )}

              {/* ── What is owed ────────────────────────────────────────── */}
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
                    Nothing scheduled.
                  </p>
                )}
              </Panel>

              {/* ── The facts ───────────────────────────────────────────── */}
              <Panel title="Details">
                <Facts items={factsFor(kind, record, events)} />
              </Panel>

              {/* ── What happened ───────────────────────────────────────── */}
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
                  onDelete={deleteActivity}
                  empty={
                    <p className="py-1 text-[12.5px] text-muted-foreground">
                      Nothing logged yet. Record the first call and it appears here and on
                      the customer.
                    </p>
                  }
                />
              </Panel>

              {/* ── Where else this record lives ────────────────────────── */}
              {(record.company?.id || record.contact?.id || record.convertedContactId) && (
                <Panel title="Linked">
                  <div className="flex flex-col divide-y divide-border">
                    {record.company?.id && (
                      <LinkOut
                        label={record.company.name}
                        hint="Customer"
                        onOpen={() => { onOpenChange(false); openRecord('crm', 'company', record.company.id); }}
                      />
                    )}
                    {record.contact?.id && (
                      <LinkOut
                        label={personName(record.contact)}
                        hint="Contact"
                        onOpen={() => { onOpenChange(false); openRecord('crm', 'contact', record.contact.id); }}
                      />
                    )}
                    {record.convertedContactId && (
                      <LinkOut
                        label="The contact this lead became"
                        hint={record.convertedAt ? `Converted ${formatDate(record.convertedAt)}` : 'Converted'}
                        onOpen={() => { onOpenChange(false); openRecord('crm', 'contact', record.convertedContactId); }}
                      />
                    )}
                  </div>
                </Panel>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Dialogs ─────────────────────────────────────────────────────── */}

      {record && (
        <>
          <ActivityDialog
            open={logOpen}
            onOpenChange={setLogOpen}
            mode="log"
            link={linkFor(kind, record)}
            onSaved={refresh}
          />
          <ActivityDialog
            open={followOpen}
            onOpenChange={o => { setFollowOpen(o); if (!o) setEditingActivity(null); }}
            mode="followup"
            link={linkFor(kind, record)}
            editing={editingActivity}
            onSaved={refresh}
          />

          {kind === 'lead' && (
            <>
              <LeadDialog open={editOpen} onOpenChange={setEditOpen} editing={record as Lead} onSaved={refresh} />
              <ConvertLeadDialog
                open={convertOpen} onOpenChange={setConvertOpen}
                lead={record as Lead}
                onConverted={() => { refresh(); onOpenChange(false); }}
              />
            </>
          )}
          {kind === 'contact' && (
            <ContactDialog open={editOpen} onOpenChange={setEditOpen} editing={record as Contact} onSaved={refresh} />
          )}
          {kind === 'deal' && (
            <>
              <DealDialog open={editOpen} onOpenChange={setEditOpen} editing={record as Deal} onSaved={refresh} />
              <CloseDealDialog
                open={closing !== null}
                onOpenChange={o => { if (!o) setClosing(null); }}
                deal={record as Deal}
                outcome={closing ?? 'closed_won'}
                onDone={refresh}
              />
            </>
          )}
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

/** Where a deal's probability lands when it is moved by a control, not typed. */
const PROBABILITY: Record<string, number> = {
  prospecting: 20, qualification: 40, proposal: 60, negotiation: 80,
  closed_won: 100, closed_lost: 0,
};

function LinkOut({ label, hint, onOpen }: { label: string; hint: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex items-center gap-3 py-2 text-left transition-colors hover:bg-accent/50"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-foreground">{label}</p>
        <p className="text-[11.5px] text-muted-foreground">{hint}</p>
      </div>
      <ExternalLink className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

/**
 * What an activity logged from this panel is about.
 *
 * The company travels with it, so a call logged against a deal also appears on
 * that customer's own timeline. See `LinkValue.companyId`.
 */
function linkFor(kind: Kind, record: any) {
  return {
    kind,
    id: record.id,
    label: kind === 'deal' ? record.name : personName(record),
    companyId: record.company?.id ?? record.companyId ?? null,
  } as const;
}

function factsFor(kind: Kind, r: any, events: StageEvent[]) {
  const mail = r.email
    ? <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1.5 hover:underline">
      <Mail className="size-3.5 text-muted-foreground" />{r.email}
    </a>
    : '';
  const tel = r.phone
    ? <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1.5 hover:underline">
      <Phone className="size-3.5 text-muted-foreground" />{r.phone}
    </a>
    : '';

  if (kind === 'deal') {
    const settled = r.stage === 'closed_won' || r.stage === 'closed_lost';
    const close = settled || !r.expectedClose ? null : daysUntil(r.expectedClose);
    const opened = events[0]?.createdAt ?? r.createdAt;

    return [
      { label: 'Value', value: exact(r.value) },
      { label: 'Weighted', value: settled ? '' : exact(r.value * r.probability / 100) },
      /**
       * One date, and which one depends on whether it is over.
       *
       * Showing an expected close on a deal that has already been won is a
       * forecast for the past, and the relative phrasing made it read as one:
       * "15 Dec, in 15 weeks" on something signed in December.
       */
      settled
        ? { label: r.stage === 'closed_won' ? 'Won on' : 'Lost on', value: formatDay(r.closedAt) }
        : {
          label: 'Expected close',
          value: r.expectedClose
            ? (
              <span className={cn(close !== null && close < 0 ? 'font-medium text-destructive' : '')}>
                {formatDay(r.expectedClose)}
                <span className="ml-1.5 text-muted-foreground">{relativeDay(r.expectedClose)}</span>
              </span>
            )
            : '',
        },
      { label: 'Owner', value: <OwnerTag member={r.owner} /> },
      {
        label: 'Age',
        value: (
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3.5 text-muted-foreground" />
            {Math.max(0, Math.round((Date.now() - Date.parse(opened)) / 86_400_000))} days
          </span>
        ),
      },
      { label: 'Notes', value: r.notes || '', full: true },
    ];
  }

  if (kind === 'lead') {
    return [
      { label: 'Email', value: mail },
      { label: 'Phone', value: tel },
      { label: 'Company', value: r.companyName || '' },
      { label: 'Job title', value: r.jobTitle || '' },
      { label: 'Source', value: r.source ? statusLabel(r.source) : '' },
      { label: 'Estimated value', value: r.estimatedValue ? exact(r.estimatedValue) : '' },
      { label: 'Score', value: <Gauge value={r.score ?? 0} label="Score" /> },
      { label: 'Owner', value: <OwnerTag member={r.owner} /> },
      { label: 'Added', value: formatDate(r.createdAt) },
      { label: 'Notes', value: r.notes || '', full: true },
    ];
  }

  return [
    { label: 'Email', value: mail },
    { label: 'Phone', value: tel },
    {
      label: 'Company',
      value: r.company?.name
        ? <span className="inline-flex items-center gap-1.5"><Building2 className="size-3.5 text-muted-foreground" />{r.company.name}</span>
        : '',
    },
    { label: 'Job title', value: r.jobTitle || '' },
    { label: 'Source', value: r.source ? statusLabel(r.source) : '' },
    { label: 'Status', value: r.isActive ? 'Active' : 'No longer here' },
    { label: 'Added', value: formatDate(r.createdAt) },
    { label: 'Notes', value: r.notes || '', full: true },
  ];
}
