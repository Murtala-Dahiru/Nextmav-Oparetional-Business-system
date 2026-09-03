'use client';

import * as React from 'react';
import { ArrowLeft, Plus, CalendarPlus, UserCheck } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Card, Head, Stat, Bar, THead, TRow, Meter } from '@/components/shared/readout/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  APPLICATION_STAGES, APPLICATION_STAGE_LABELS, OPENING_STATUS_LABELS,
  CANDIDATE_SOURCES, CANDIDATE_SOURCE_LABELS, WORK_MODES, WORK_MODE_LABELS,
  EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS, INTERVIEW_KINDS, INTERVIEW_KIND_LABELS,
  RECOMMENDATION_LABELS, HIRE_RECOMMENDATIONS, OFFER_STATUS_LABELS,
  PAY_PERIODS, PAY_PERIOD_LABELS, labelOf,
} from '@/lib/hr';

import { getOne, getList, post, patch, money, whenWord, todayISO } from './data';
import { PersonCell, Blank, Skeleton, Pill, Restricted, day } from './ui';
import type { Opening, Application, Candidate, Person, OrgDepartment } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Recruitment
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this replaces ───────────────────────────────────────────────────
 *
 * Three cards - Marcus Vance, Emily Chen, David Ross - from a `useState`
 * array, with progress bars that were integers somebody typed and an "Add
 * Candidate" button wired to nothing. Every organisation on the platform saw
 * the same three names.
 *
 * ── The shape ────────────────────────────────────────────────────────────
 *
 *   openings    the roles being filled, with their pipeline counts
 *   opening     one role's board: candidates by stage, drag-free
 *   candidates  people, across every role they have applied for
 *
 * A board rather than a table for a single opening, because a pipeline is
 * read by stage and the question is always "who is where". A table for the
 * openings list, because that one is read by row.
 *
 * ── The offer is somewhere else on purpose ───────────────────────────────
 *
 * `job_offers` is the only recruitment table gated on role, so a hiring
 * manager reading their own pipeline gets an empty array. `canSeeOffers` is
 * what lets this screen say "offers are managed by HR" rather than "no offer",
 * which are different facts and only HR can tell them apart.
 */

export function Recruitment({
  canManage,
  selfMemberId,
}: {
  canManage: boolean;
  selfMemberId: string;
}) {
  const [openings, setOpenings] = React.useState<Opening[]>([]);
  const [candidates, setCandidates] = React.useState<Candidate[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [view, setView] = React.useState<'openings' | 'candidates'>('openings');
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [newOpening, setNewOpening] = React.useState(false);
  const [newCandidate, setNewCandidate] = React.useState(false);
  const [showClosed, setShowClosed] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [o, c] = await Promise.all([
        getList<Opening>(`/api/hr/recruitment/openings${showClosed ? '?include=all' : ''}`),
        getList<Candidate>('/api/hr/recruitment/candidates'),
      ]);
      setOpenings(o.data);
      setCandidates(c.data);
    } catch (e: any) {
      toast.error(e.message || 'Could not load recruitment');
    } finally {
      setLoading(false);
    }
  }, [showClosed]);

  React.useEffect(() => { load(); }, [load]);

  if (openId) {
    return (
      <OpeningBoard
        openingId={openId}
        canManage={canManage}
        selfMemberId={selfMemberId}
        candidates={candidates}
        onBack={() => { setOpenId(null); load(); }}
        onCandidatesChanged={load}
      />
    );
  }

  if (loading) return <Card><Skeleton rows={5} /></Card>;

  const open = openings.filter(o => o.status === 'open');
  const positions = open.reduce((s, o) => s + o.positions, 0);
  const inPlay = openings.reduce((s, o) => s + (o.pipeline?.active ?? 0), 0);

  return (
    <div className="nm-enter space-y-4">
      <div className="grid grid-cols-2 divide-x divide-y divide-border rounded-xl border border-border bg-card sm:grid-cols-4 sm:divide-y-0">
        <Stat label="Open roles" value={open.length} />
        <Stat label="Positions" value={positions} />
        <Stat label="Candidates in play" value={inPlay} />
        <Stat label="People on file" value={candidates.length} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {([['openings', 'Openings'], ['candidates', 'Candidates']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              aria-pressed={view === id}
              className={cn(
                'rounded-md border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
                view === id
                  ? 'border-foreground/20 bg-accent text-foreground'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {view === 'openings' ? (
            <Button
              size="sm" variant="ghost" className="h-8 text-[12px]"
              onClick={() => setShowClosed(v => !v)}
            >
              {showClosed ? 'Hide closed' : 'Show closed'}
            </Button>
          ) : null}
          {canManage ? (
            <Button
              size="sm" className="h-8 text-[12.5px]"
              onClick={() => view === 'openings' ? setNewOpening(true) : setNewCandidate(true)}
            >
              <Plus className="mr-1.5 size-3.5" />
              {view === 'openings' ? 'New opening' : 'Add candidate'}
            </Button>
          ) : null}
        </div>
      </div>

      {view === 'openings' ? (
        <Card>
          <div className="px-4 pt-3.5">
            <Head title="Openings" count={openings.length} />
          </div>
          {openings.length ? (
            <div className="mt-2.5 px-2 pb-2">
              <THead columns="grid-cols-[minmax(0,2fr)_auto] md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.1fr)_auto]">
                <span>Role</span>
                <span className="hidden md:block">Hiring manager</span>
                <span className="hidden md:block">Pipeline</span>
                <span className="text-right">Status</span>
              </THead>
              {openings.map(o => (
                <TRow
                  key={o.id}
                  columns="grid-cols-[minmax(0,2fr)_auto] md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.1fr)_auto]"
                  onClick={() => setOpenId(o.id)}
                  ariaLabel={`Open ${o.title}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-foreground">
                      {o.title}
                    </span>
                    <span className="block truncate text-[11.5px] text-muted-foreground">
                      {o.reference} · {o.department?.name ?? 'No department'} ·{' '}
                      {labelOf(WORK_MODE_LABELS, o.workMode)}
                      {o.positions > 1 ? ` · ${o.positions} positions` : ''}
                    </span>
                  </span>

                  <span className="hidden truncate text-[12.5px] text-muted-foreground md:block">
                    {o.hiringManager?.profiles?.fullName ?? '—'}
                  </span>

                  <span className="hidden md:block">
                    {o.pipeline?.total ? (
                      <>
                        <span className="text-[12px] tabular-nums text-muted-foreground">
                          {o.pipeline.active} active
                          {o.pipeline.hired ? ` · ${o.pipeline.hired} hired` : ''}
                        </span>
                        <Bar
                          className="mt-1"
                          height={3}
                          segments={[
                            { value: o.pipeline.active, tone: 'accent', title: 'Active' },
                            { value: o.pipeline.hired, tone: 'claim', title: 'Hired' },
                            {
                              value: o.pipeline.total - o.pipeline.active - o.pipeline.hired,
                              tone: 'quiet', title: 'Closed',
                            },
                          ]}
                        />
                      </>
                    ) : (
                      <span className="text-[12px] text-muted-foreground">No candidates yet</span>
                    )}
                  </span>

                  <span className="flex justify-end">
                    <Pill tone={
                      o.status === 'open' ? 'accent'
                        : o.status === 'filled' ? 'good'
                          : o.status === 'on_hold' ? 'warn' : 'quiet'
                    }>
                      {labelOf(OPENING_STATUS_LABELS, o.status)}
                    </Pill>
                  </span>
                </TRow>
              ))}
            </div>
          ) : (
            <Blank
              title="No openings"
              note="An opening is a job you are trying to fill. Candidates apply to it, interviews hang off it, and hiring one closes it."
              action={canManage ? (
                <Button size="sm" onClick={() => setNewOpening(true)}>Open a role</Button>
              ) : undefined}
            />
          )}
        </Card>
      ) : (
        <Card>
          <div className="px-4 pt-3.5">
            <Head title="Candidates" count={candidates.length} note="people, not applications" />
          </div>
          {candidates.length ? (
            <div className="mt-2.5 px-2 pb-2">
              <THead columns="grid-cols-[minmax(0,2fr)_auto] md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]">
                <span>Person</span>
                <span className="hidden md:block">Source</span>
                <span className="hidden md:block">Applied to</span>
                <span className="text-right">Added</span>
              </THead>
              {candidates.map(c => (
                <TRow
                  key={c.id}
                  columns="grid-cols-[minmax(0,2fr)_auto] md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]"
                  onClick={() => {
                    const active = c.applications?.find(a => a.status === 'active');
                    if (active?.openingId) setOpenId(active.openingId);
                  }}
                  ariaLabel={`Open ${c.fullName}`}
                >
                  <PersonCell
                    id={c.id}
                    name={c.fullName}
                    secondary={c.headline || c.email}
                  />
                  <span className="hidden truncate text-[12.5px] text-muted-foreground md:block">
                    {labelOf(CANDIDATE_SOURCE_LABELS, c.source)}
                    {c.referrer?.profiles?.fullName ? ` · ${c.referrer.profiles.fullName}` : ''}
                  </span>
                  <span className="hidden truncate text-[12.5px] text-muted-foreground md:block">
                    {/* The whole reason a candidate is not an application: this
                        person may have applied three times over two years. */}
                    {c.applications?.length
                      ? c.applications.map(a => a.opening?.title).filter(Boolean).join(', ')
                      : 'No applications'}
                  </span>
                  <span className="text-right text-[11.5px] text-muted-foreground">
                    {c.hiredMemberId
                      ? <Pill tone="good">Hired</Pill>
                      : whenWord(c.createdAt.slice(0, 10))}
                  </span>
                </TRow>
              ))}
            </div>
          ) : (
            <Blank
              title="Nobody on file"
              note="A candidate is a person, and they stay on file across every role they apply for - which is what makes “have we spoken to them before” answerable."
              action={canManage ? (
                <Button size="sm" onClick={() => setNewCandidate(true)}>Add somebody</Button>
              ) : undefined}
            />
          )}
        </Card>
      )}

      {newOpening ? (
        <OpeningDialog
          open={newOpening}
          onClose={() => setNewOpening(false)}
          onSaved={() => { setNewOpening(false); load(); }}
        />
      ) : null}

      {newCandidate ? (
        <CandidateDialog
          open={newCandidate}
          onClose={() => setNewCandidate(false)}
          onSaved={() => { setNewCandidate(false); load(); }}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  One opening's board                                                       */
/* -------------------------------------------------------------------------- */

function OpeningBoard({
  openingId,
  canManage,
  selfMemberId,
  candidates,
  onBack,
  onCandidatesChanged,
}: {
  openingId: string;
  canManage: boolean;
  selfMemberId: string;
  candidates: Candidate[];
  onBack: () => void;
  onCandidatesChanged: () => void;
}) {
  const [opening, setOpening] = React.useState<Opening | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [openApplication, setOpenApplication] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setOpening(await getOne<Opening>(`/api/hr/recruitment/openings/${openingId}`));
    } catch (e: any) {
      toast.error(e.message || 'Could not load this opening');
    } finally {
      setLoading(false);
    }
  }, [openingId]);

  React.useEffect(() => { load(); }, [load]);

  async function move(applicationId: string, stage: string) {
    try {
      await patch(`/api/hr/recruitment/applications/${applicationId}`, { stage });
      load();
    } catch (e: any) {
      toast.error(e.message || 'Could not move the candidate');
    }
  }

  if (loading) return <Card><Skeleton rows={5} /></Card>;
  if (!opening) {
    return (
      <Card>
        <Blank title="Not available" action={<Button size="sm" variant="outline" onClick={onBack}>Back</Button>} />
      </Card>
    );
  }

  const applications = (opening.applications ?? []).filter(a => a.status === 'active');
  const closed = (opening.applications ?? []).filter(a => a.status !== 'active');

  /* The five pipeline stages, minus `hired` - which is not a column somebody
     drags into, it is what the hire endpoint produces. */
  const stages = APPLICATION_STAGES.filter(s => s !== 'hired');

  return (
    <div className="nm-enter space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Recruitment
      </button>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[17px] font-semibold tracking-[-0.018em] text-foreground">
                {opening.title}
              </h2>
              <Pill tone={opening.status === 'open' ? 'accent' : 'quiet'}>
                {labelOf(OPENING_STATUS_LABELS, opening.status)}
              </Pill>
            </div>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              {opening.reference} · {opening.department?.name ?? 'No department'} ·{' '}
              {labelOf(EMPLOYMENT_TYPE_LABELS, opening.employmentType)} ·{' '}
              {labelOf(WORK_MODE_LABELS, opening.workMode)}
              {opening.location ? ` · ${opening.location}` : ''}
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {opening.positions} position{opening.positions === 1 ? '' : 's'}
              {opening.hiringManager?.profiles?.fullName
                ? ` · ${opening.hiringManager.profiles.fullName} is hiring`
                : ''}
              {opening.openedOn ? ` · opened ${whenWord(opening.openedOn)}` : ''}
            </p>
          </div>

          {canManage ? (
            <Button size="sm" className="h-8 text-[12.5px]" onClick={() => setAdding(true)}>
              <Plus className="mr-1.5 size-3.5" />
              Add candidate
            </Button>
          ) : null}
        </div>

        {opening.description ? (
          <div className="border-t border-border px-4 py-3">
            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
              {opening.description}
            </p>
          </div>
        ) : null}
      </Card>

      {/* The pipeline, as columns. Each card carries the one action that moves
          it, rather than a drag target - a keyboard user and a phone both need
          the button, and a board that only works by dragging is a board half
          the company cannot use. */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {stages.map(stage => {
          const inStage = applications.filter(a => a.stage === stage);
          const nextStage = stages[stages.indexOf(stage) + 1];
          return (
            <div key={stage} className="min-w-0">
              <div className="flex items-baseline justify-between px-1 pb-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {APPLICATION_STAGE_LABELS[stage]}
                </span>
                <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
                  {inStage.length}
                </span>
              </div>
              <div className="space-y-2">
                {inStage.map(a => (
                  <div
                    key={a.id}
                    className="rounded-lg border border-border bg-card p-2.5 shadow-e1"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenApplication(a.id)}
                      className="block w-full min-w-0 text-left"
                    >
                      <span className="block truncate text-[12.5px] font-medium text-foreground">
                        {a.candidate?.fullName ?? 'A candidate'}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {a.candidate?.headline || labelOf(CANDIDATE_SOURCE_LABELS, a.candidate?.source ?? 'direct')}
                      </span>
                    </button>

                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-[10.5px] text-muted-foreground">
                        {a.interviews?.length
                          ? `${a.interviews.length} interview${a.interviews.length === 1 ? '' : 's'}`
                          : `Applied ${whenWord(a.appliedOn)}`}
                      </span>
                      {nextStage ? (
                        <button
                          type="button"
                          onClick={() => move(a.id, nextStage)}
                          className="shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          → {APPLICATION_STAGE_LABELS[nextStage]}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}

                {inStage.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-2.5 py-4 text-center">
                    <span className="text-[11px] text-muted-foreground">Nobody here</span>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {closed.length ? (
        <Card>
          <div className="px-4 pt-3.5">
            <Head title="Closed" count={closed.length} />
          </div>
          <ul className="divide-y divide-border">
            {closed.map(a => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-foreground">
                    {a.candidate?.fullName}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {a.outcomeReason || labelOf(APPLICATION_STAGE_LABELS, a.stage)}
                  </span>
                </span>
                <Pill tone={a.status === 'hired' ? 'good' : 'quiet'}>{a.status}</Pill>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {openApplication ? (
        <ApplicationDialog
          applicationId={openApplication}
          canManage={canManage}
          selfMemberId={selfMemberId}
          onClose={() => setOpenApplication(null)}
          onChanged={() => { load(); onCandidatesChanged(); }}
        />
      ) : null}

      {adding ? (
        <AddToPipelineDialog
          openingId={openingId}
          candidates={candidates}
          existing={new Set((opening.applications ?? []).map(a => a.candidateId))}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); load(); onCandidatesChanged(); }}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  One application                                                           */
/* -------------------------------------------------------------------------- */

function ApplicationDialog({
  applicationId,
  canManage,
  selfMemberId,
  onClose,
  onChanged,
}: {
  applicationId: string;
  canManage: boolean;
  selfMemberId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [app, setApp] = React.useState<Application | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [rejecting, setRejecting] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [scheduling, setScheduling] = React.useState(false);
  const [hiring, setHiring] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setApp(await getOne<Application>(`/api/hr/recruitment/applications/${applicationId}`));
    } catch (e: any) {
      toast.error(e.message || 'Could not load the application');
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  React.useEffect(() => { load(); }, [load]);

  async function reject() {
    if (!reason.trim()) { toast.error('Say why'); return; }
    setBusy(true);
    try {
      await patch(`/api/hr/recruitment/applications/${applicationId}`, {
        status: 'rejected', outcome_reason: reason.trim(),
      });
      toast.success('Application closed');
      onChanged();
      onClose();
    } catch (e: any) {
      toast.error(e.message || 'Could not close the application');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {loading || !app ? (
          <Skeleton rows={5} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{app.candidate?.fullName}</DialogTitle>
              <DialogDescription>
                {app.candidate?.headline || 'No headline'}
                {app.candidate?.email ? ` · ${app.candidate.email}` : ''}
                {' · '}{labelOf(APPLICATION_STAGE_LABELS, app.stage)}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Interviews and what the panel said */}
              <section>
                <div className="flex items-center justify-between">
                  <h3 className="text-[13px] font-semibold text-foreground">Interviews</h3>
                  {canManage ? (
                    <Button
                      size="sm" variant="outline" className="h-7 text-[12px]"
                      onClick={() => setScheduling(true)}
                    >
                      <CalendarPlus className="mr-1.5 size-3.5" />
                      Schedule
                    </Button>
                  ) : null}
                </div>

                {app.interviews?.length ? (
                  <ul className="mt-2 space-y-2">
                    {app.interviews.map(iv => (
                      <li key={iv.id} className="rounded-lg border border-border p-2.5">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-[12.5px] font-medium text-foreground">
                            {labelOf(INTERVIEW_KIND_LABELS, iv.kind)}
                          </span>
                          <span className="text-[11.5px] text-muted-foreground">
                            {new Date(iv.startsAt).toLocaleString(undefined, {
                              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {(iv.participants ?? [])
                            .map(p => p.member?.profiles?.fullName)
                            .filter(Boolean).join(', ') || 'No panel'}
                          {iv.calendarEventId ? ' · in the calendar' : ''}
                        </p>

                        {iv.feedback?.length ? (
                          <ul className="mt-2 space-y-1.5 border-t border-border pt-2">
                            {iv.feedback.filter(f => f.submittedAt).map(f => (
                              <li key={f.id} className="flex items-baseline justify-between gap-3">
                                <span className="truncate text-[11.5px] text-muted-foreground">
                                  {f.member?.profiles?.fullName ?? 'An interviewer'}
                                  {f.strengths ? ` — ${f.strengths}` : ''}
                                </span>
                                {f.recommendation ? (
                                  <Pill tone={
                                    f.recommendation.includes('yes') ? 'good' : 'bad'
                                  }>
                                    {RECOMMENDATION_LABELS[f.recommendation]}
                                  </Pill>
                                ) : null}
                              </li>
                            ))}
                            {iv.feedback.some(f => !f.submittedAt) ? (
                              <li className="text-[11px] text-muted-foreground">
                                {iv.feedback.filter(f => !f.submittedAt).length} still drafting.
                                Feedback is private until it is submitted.
                              </li>
                            ) : null}
                          </ul>
                        ) : null}

                        <FeedbackForm
                          interviewId={iv.id}
                          mine={iv.feedback?.find(f => f.memberId === selfMemberId) ?? null}
                          onSaved={load}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    No interviews yet. Scheduling one puts a real event in everybody&rsquo;s calendar.
                  </p>
                )}
              </section>

              {/* Offers */}
              <section>
                <h3 className="text-[13px] font-semibold text-foreground">Offer</h3>
                {app.canSeeOffers === false ? (
                  <Restricted what="Offers are managed by HR. The amount is not visible to the hiring manager." />
                ) : app.offers?.length ? (
                  <ul className="mt-2 space-y-2">
                    {app.offers.map(o => (
                      <li key={o.id} className="rounded-lg border border-border p-2.5">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-[12.5px] font-medium text-foreground">
                            {o.jobTitle}
                          </span>
                          <Pill tone={
                            o.status === 'accepted' ? 'good'
                              : o.status === 'declined' ? 'bad'
                                : o.status === 'sent' ? 'accent' : 'quiet'
                          }>
                            {labelOf(OFFER_STATUS_LABELS, o.status)}
                          </Pill>
                        </div>
                        <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                          {o.baseAmount !== null
                            ? `${money(o.baseAmount, o.currency)} ${PAY_PERIOD_LABELS[o.payPeriod]}`
                            : 'No amount'}
                          {o.startOn ? ` · starts ${day(o.startOn)}` : ''}
                        </p>
                        <OfferActions offer={o} onChanged={load} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    No offer drafted.
                  </p>
                )}
                {app.canSeeOffers !== false && canManage && app.status === 'active' ? (
                  <OfferDialogTrigger application={app} onSaved={load} />
                ) : null}
              </section>

              {/* Movement */}
              {app.movement?.length ? (
                <section>
                  <h3 className="text-[13px] font-semibold text-foreground">Movement</h3>
                  <ol className="mt-2 space-y-1">
                    {app.movement.map(m => (
                      <li key={m.id} className="flex items-baseline justify-between gap-3 text-[11.5px]">
                        <span className="text-muted-foreground">
                          {m.fromStage
                            ? `${labelOf(APPLICATION_STAGE_LABELS, m.fromStage)} → ${labelOf(APPLICATION_STAGE_LABELS, m.toStage)}`
                            : `Entered at ${labelOf(APPLICATION_STAGE_LABELS, m.toStage)}`}
                          {m.member?.profiles?.fullName ? ` · ${m.member.profiles.fullName}` : ''}
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {whenWord(m.createdAt.slice(0, 10))}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}
            </div>

            <DialogFooter className="gap-2 sm:justify-between">
              {canManage && app.status === 'active' ? (
                rejecting ? (
                  <div className="flex w-full flex-col gap-2 sm:flex-row">
                    <Input
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                      placeholder="Why are they not going forward?"
                      className="h-8 text-[12.5px]"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setRejecting(false)}>
                        Cancel
                      </Button>
                      <Button size="sm" variant="destructive" onClick={reject} disabled={busy}>
                        Close application
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setRejecting(true)}>
                      Not going forward
                    </Button>
                    <Button size="sm" onClick={() => setHiring(true)}>
                      <UserCheck className="mr-1.5 size-3.5" />
                      Hire
                    </Button>
                  </>
                )
              ) : (
                <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
              )}
            </DialogFooter>

            {scheduling ? (
              <InterviewDialog
                applicationId={applicationId}
                onClose={() => setScheduling(false)}
                onSaved={() => { setScheduling(false); load(); }}
              />
            ) : null}

            {hiring ? (
              <HireDialog
                application={app}
                onClose={() => setHiring(false)}
                onHired={() => { setHiring(false); onChanged(); onClose(); }}
              />
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Feedback                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Your own feedback on an interview you sat.
 *
 * A draft until submitted, and submitting is a one-way door - which the form
 * says before you press it rather than after. An author who could revise after
 * reading the panel makes the record of what the panel thought worthless.
 */
function FeedbackForm({
  interviewId,
  mine,
  onSaved,
}: {
  interviewId: string;
  mine: { recommendation: string | null; strengths: string; submittedAt: string | null } | null;
  onSaved: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [recommendation, setRecommendation] = React.useState(mine?.recommendation ?? '');
  const [strengths, setStrengths] = React.useState(mine?.strengths ?? '');
  const [busy, setBusy] = React.useState(false);

  if (mine?.submittedAt) {
    return (
      <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
        You submitted your feedback. It cannot be changed.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 border-t border-border pt-2 text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {mine ? 'Finish your feedback' : 'Add your feedback'}
      </button>
    );
  }

  async function save(submit: boolean) {
    if (submit && !recommendation) {
      toast.error('Say whether you would hire them');
      return;
    }
    setBusy(true);
    try {
      await post(`/api/hr/recruitment/interviews/${interviewId}/feedback`, {
        recommendation: recommendation || undefined,
        strengths: strengths.trim(),
        submit,
      });
      toast.success(submit ? 'Feedback submitted' : 'Draft saved');
      setOpen(false);
      onSaved();
    } catch (e: any) {
      toast.error(e.message || 'Could not save your feedback');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-2 border-t border-border pt-2.5">
      <Select value={recommendation} onValueChange={setRecommendation}>
        <SelectTrigger className="h-8 text-[12px]">
          <SelectValue placeholder="Would you hire them?" />
        </SelectTrigger>
        <SelectContent>
          {HIRE_RECOMMENDATIONS.map(r => (
            <SelectItem key={r} value={r}>{RECOMMENDATION_LABELS[r]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Textarea
        value={strengths}
        onChange={e => setStrengths(e.target.value)}
        rows={2}
        placeholder="What stood out, and what concerned you."
        className="text-[12.5px]"
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10.5px] leading-tight text-muted-foreground">
          Nobody else sees this until you submit it, and submitting is final.
        </p>
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="ghost" className="h-7 text-[11.5px]" onClick={() => save(false)} disabled={busy}>
            Save draft
          </Button>
          <Button size="sm" className="h-7 text-[11.5px]" onClick={() => save(true)} disabled={busy}>
            Submit
          </Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Offers                                                                    */
/* -------------------------------------------------------------------------- */

function OfferActions({ offer, onChanged }: { offer: any; onChanged: () => void }) {
  const [busy, setBusy] = React.useState(false);

  async function set(status: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      await patch(`/api/hr/recruitment/offers/${offer.id}`, { status, ...extra });
      onChanged();
    } catch (e: any) {
      toast.error(e.message || 'Could not update the offer');
    } finally {
      setBusy(false);
    }
  }

  /* The ladder the database enforces: an offer cannot be sent before somebody
     approved it, and cannot be accepted here at all - accepting happens by
     completing the hire, which creates the colleague. */
  const next =
    offer.status === 'draft' ? { label: 'Approve', status: 'approved' }
      : offer.status === 'approved' ? { label: 'Mark as sent', status: 'sent' }
        : null;

  if (!next) return null;

  return (
    <div className="mt-2 flex gap-1.5">
      <Button size="sm" variant="outline" className="h-7 text-[11.5px]" disabled={busy}
              onClick={() => set(next.status)}>
        {next.label}
      </Button>
      {offer.status === 'sent' ? null : (
        <Button size="sm" variant="ghost" className="h-7 text-[11.5px]" disabled={busy}
                onClick={() => set('withdrawn', { decline_reason: 'Withdrawn' })}>
          Withdraw
        </Button>
      )}
    </div>
  );
}

function OfferDialogTrigger({ application, onSaved }: { application: Application; onSaved: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [jobTitle, setJobTitle] = React.useState(application.opening?.title ?? '');
  const [amount, setAmount] = React.useState('');
  const [payPeriod, setPayPeriod] = React.useState('annual');
  const [startOn, setStartOn] = React.useState('');
  const [probation, setProbation] = React.useState('3');
  const [busy, setBusy] = React.useState(false);

  if (!open) {
    return (
      <Button
        size="sm" variant="outline" className="mt-2 h-7 text-[12px]"
        onClick={() => setOpen(true)}
      >
        Draft an offer
      </Button>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!jobTitle.trim()) { toast.error('An offer must name the job'); return; }
    setBusy(true);
    try {
      await post('/api/hr/recruitment/offers', {
        application_id: application.id,
        job_title: jobTitle.trim(),
        base_amount: amount ? Number(amount) : undefined,
        pay_period: payPeriod,
        start_on: startOn || undefined,
        probation_months: probation ? Number(probation) : undefined,
        department_id: application.opening?.departmentId ?? undefined,
      });
      toast.success('Offer drafted');
      setOpen(false);
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Could not draft the offer');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-2 space-y-2 rounded-lg border border-border p-2.5">
      <Input
        value={jobTitle} onChange={e => setJobTitle(e.target.value)}
        placeholder="Job title" className="h-8 text-[12.5px]"
      />
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)}
          placeholder="Base amount" className="h-8 text-[12.5px]"
        />
        <Select value={payPeriod} onValueChange={setPayPeriod}>
          <SelectTrigger className="h-8 text-[12px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PAY_PERIODS.map(p => (
              <SelectItem key={p} value={p}>{PAY_PERIOD_LABELS[p].replace('per ', '')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="date" value={startOn} onChange={e => setStartOn(e.target.value)}
          className="h-8 text-[12.5px]" aria-label="Start date"
        />
        <Input
          type="number" min={0} max={24} value={probation}
          onChange={e => setProbation(e.target.value)}
          placeholder="Probation months" className="h-8 text-[12.5px]"
        />
      </div>
      <div className="flex justify-end gap-1.5">
        <Button type="button" size="sm" variant="ghost" className="h-7 text-[11.5px]"
                onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" className="h-7 text-[11.5px]" disabled={busy}>
          Draft offer
        </Button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/*  Hiring                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Turning a candidate into a colleague.
 *
 * One request that creates the account, closes the pipeline and optionally
 * starts the onboarding. The temporary password comes back exactly once and
 * there is nowhere to read it again, so the dialogue holds it until the person
 * dismisses it rather than closing on success.
 */
function HireDialog({
  application,
  onClose,
  onHired,
}: {
  application: Application;
  onClose: () => void;
  onHired: () => void;
}) {
  const [hiredOn, setHiredOn] = React.useState(todayISO());
  const [templateId, setTemplateId] = React.useState('');
  const [templates, setTemplates] = React.useState<{ id: string; name: string; items?: unknown[] }[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [issued, setIssued] = React.useState<{ password: string | null; email: string; nextStep: string } | null>(null);

  React.useEffect(() => {
    getOne<{ templates: { id: string; name: string; items?: unknown[] }[] }>('/api/hr/templates?kind=onboarding')
      .then(d => setTemplates(d.templates ?? []))
      .catch(() => setTemplates([]));
  }, []);

  async function hire(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await post<any>(
        `/api/hr/recruitment/applications/${application.id}/hire`,
        { hired_on: hiredOn, onboarding_template_id: templateId || undefined },
      );
      setIssued({
        password: result?.temporaryPassword ?? null,
        email: application.candidate?.email ?? '',
        nextStep: result?.nextStep ?? '',
      });
      toast.success(`${application.candidate?.fullName} is now an employee`);
    } catch (err: any) {
      toast.error(err.message || 'Could not complete the hire');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={v => !v && (issued ? onHired() : onClose())}>
      <DialogContent className="sm:max-w-md">
        {issued ? (
          <>
            <DialogHeader>
              <DialogTitle>{application.candidate?.fullName} has been hired</DialogTitle>
              <DialogDescription>{issued.nextStep}</DialogDescription>
            </DialogHeader>
            {issued.password ? (
              <div className="rounded-lg border border-warning/30 bg-warning/[0.07] p-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Temporary password — shown once
                </p>
                <p className="mt-1 select-all font-mono text-[15px] font-semibold text-foreground">
                  {issued.password}
                </p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  Nothing stores this and no endpoint can return it again. If it is
                  missed, issue a new one from their employee record.
                </p>
              </div>
            ) : null}
            <DialogFooter>
              <Button onClick={onHired}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Hire {application.candidate?.fullName}</DialogTitle>
              <DialogDescription>
                This creates their account and membership, closes the pipeline, and
                accepts the outstanding offer. They start at onboarding, not active.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={hire} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-[12.5px] font-medium">First day</Label>
                <Input type="date" value={hiredOn} onChange={e => setHiredOn(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[12.5px] font-medium">Onboarding checklist</Label>
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger>
                    <SelectValue placeholder={templates.length ? 'None' : 'No templates yet'} />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Optional. Every step becomes a to-do in the right person&rsquo;s My Work.
                </p>
              </div>

              {!application.candidate?.email ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-[11.5px] text-destructive">
                  This candidate has no email address, so no account can be created.
                  Add one to their record first.
                </p>
              ) : null}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                <Button type="submit" disabled={busy || !application.candidate?.email}>
                  {busy ? 'Hiring…' : 'Hire'}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Small dialogues                                                           */
/* -------------------------------------------------------------------------- */

function OpeningDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = React.useState('');
  const [departmentId, setDepartmentId] = React.useState('');
  const [employmentType, setEmploymentType] = React.useState('full_time');
  const [workMode, setWorkMode] = React.useState('onsite');
  const [positions, setPositions] = React.useState('1');
  const [description, setDescription] = React.useState('');
  const [departments, setDepartments] = React.useState<OrgDepartment[]>([]);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    getOne<{ departments: OrgDepartment[] }>('/api/hr/org')
      .then(d => setDepartments(d.departments ?? []))
      .catch(() => undefined);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { toast.error('A job title is required'); return; }
    setBusy(true);
    try {
      await post('/api/hr/recruitment/openings', {
        title: title.trim(),
        department_id: departmentId || undefined,
        employment_type: employmentType,
        work_mode: workMode,
        positions: Number(positions) || 1,
        description: description.trim(),
        status: 'open',
      });
      toast.success('Opening created');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Could not create the opening');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New opening</DialogTitle>
          <DialogDescription>A role you are trying to fill.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[12.5px] font-medium">Job title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Systems Engineer" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[12.5px] font-medium">Department</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12.5px] font-medium">Positions</Label>
              <Input type="number" min={1} value={positions} onChange={e => setPositions(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[12.5px] font-medium">Employment type</Label>
              <Select value={employmentType} onValueChange={setEmploymentType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EMPLOYMENT_TYPES.map(t => (
                    <SelectItem key={t} value={t}>{EMPLOYMENT_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12.5px] font-medium">Where</Label>
              <Select value={workMode} onValueChange={setWorkMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WORK_MODES.map(m => (
                    <SelectItem key={m} value={m}>{WORK_MODE_LABELS[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[12.5px] font-medium">Description</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CandidateDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [fullName, setFullName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [headline, setHeadline] = React.useState('');
  const [source, setSource] = React.useState('direct');
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) { toast.error('A name is required'); return; }
    setBusy(true);
    try {
      const result = await post<any>('/api/hr/recruitment/candidates', {
        full_name: fullName.trim(),
        email: email.trim() || undefined,
        headline: headline.trim(),
        source,
      });
      /* The endpoint returns the existing person rather than a 409 when the
         address is already on file - so the message says which happened. */
      toast.success(result?._existing
        ? 'We already had them on file — opening that record'
        : 'Candidate added');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Could not add the candidate');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a candidate</DialogTitle>
          <DialogDescription>
            A person, not an application. They stay on file across every role they apply for.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[12.5px] font-medium">Full name</Label>
            <Input value={fullName} onChange={e => setFullName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12.5px] font-medium">Email</Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">
              Needed to create their account if they are hired.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12.5px] font-medium">Headline</Label>
            <Input value={headline} onChange={e => setHeadline(e.target.value)} placeholder="Backend engineer, 6 years" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12.5px] font-medium">Source</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CANDIDATE_SOURCES.map(s => (
                  <SelectItem key={s} value={s}>{CANDIDATE_SOURCE_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddToPipelineDialog({
  openingId,
  candidates,
  existing,
  onClose,
  onSaved,
}: {
  openingId: string;
  candidates: Candidate[];
  existing: Set<string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [candidateId, setCandidateId] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const available = candidates.filter(c => !existing.has(c.id) && !c.hiredMemberId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!candidateId) { toast.error('Choose somebody'); return; }
    setBusy(true);
    try {
      await post('/api/hr/recruitment/applications', {
        opening_id: openingId, candidate_id: candidateId,
      });
      toast.success('Added to the pipeline');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Could not add them');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to this pipeline</DialogTitle>
          <DialogDescription>
            Somebody already on file. Add a new person from the Candidates list first.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Select value={candidateId} onValueChange={setCandidateId}>
            <SelectTrigger>
              <SelectValue placeholder={available.length ? 'Choose a candidate' : 'Everybody on file is already here'} />
            </SelectTrigger>
            <SelectContent>
              {available.map(c => (
                <SelectItem key={c.id} value={c.id}>
                  {c.fullName}{c.headline ? ` · ${c.headline}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !available.length}>Add</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InterviewDialog({
  applicationId,
  onClose,
  onSaved,
}: {
  applicationId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = React.useState('screening');
  const [date, setDate] = React.useState(todayISO());
  const [time, setTime] = React.useState('10:00');
  const [minutes, setMinutes] = React.useState('60');
  const [location, setLocation] = React.useState('');
  const [participants, setParticipants] = React.useState<string[]>([]);
  const [people, setPeople] = React.useState<Person[]>([]);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    getOne<{ people: Person[] }>('/api/hr/org')
      .then(d => setPeople(d.people ?? []))
      .catch(() => undefined);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const start = new Date(`${date}T${time}`);
    if (Number.isNaN(start.getTime())) { toast.error('Pick a date and time'); return; }
    const end = new Date(start.getTime() + (Number(minutes) || 60) * 60_000);
    setBusy(true);
    try {
      await post('/api/hr/recruitment/interviews', {
        application_id: applicationId,
        kind,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        location: location.trim(),
        participants: participants.length ? participants : undefined,
      });
      toast.success('Interview scheduled and added to the calendar');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Could not schedule the interview');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Schedule an interview</DialogTitle>
          <DialogDescription>
            This creates a real calendar event and puts the panel on it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[12.5px] font-medium">Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INTERVIEW_KINDS.map(k => (
                    <SelectItem key={k} value={k}>{INTERVIEW_KIND_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12.5px] font-medium">Minutes</Label>
              <Input type="number" min={15} step={15} value={minutes} onChange={e => setMinutes(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[12.5px] font-medium">Date</Label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12.5px] font-medium">Time</Label>
              <Input type="time" value={time} onChange={e => setTime(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[12.5px] font-medium">Where</Label>
            <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="Meeting room, or a link" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[12.5px] font-medium">Panel</Label>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
              {people.map(p => (
                <label key={p.memberId} className="flex items-center gap-2 rounded px-1.5 py-1 text-[12.5px] hover:bg-accent/50">
                  <input
                    type="checkbox"
                    checked={participants.includes(p.memberId)}
                    onChange={e => setParticipants(prev =>
                      e.target.checked
                        ? [...prev, p.memberId]
                        : prev.filter(id => id !== p.memberId))}
                    className="size-3.5 accent-[var(--chart-1)]"
                  />
                  <span className="truncate">{p.fullName}</span>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Leave empty and you are the interviewer. Each one is told, and gets the meeting.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Scheduling…' : 'Schedule'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
