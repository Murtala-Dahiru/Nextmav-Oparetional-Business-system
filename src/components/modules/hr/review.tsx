'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  MessageSquarePlus, Send, Scale, ListChecks, FileSearch,
  History, Check, X, Loader2,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { formatDate } from '@/lib/format';
import { EvidenceRecord } from '@/components/modules/performance/evidence';

import { Blank, Field, PersonCell } from './ui';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The formal review, in one place
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What 0032 left out, and this fills in ────────────────────────────────
 *
 * The review row has existed since 0032 with an `overall_rating` column that
 * **nothing has ever written**: there was no screen that could set it. So the
 * "review" a manager could actually conduct was a status and two free-text
 * boxes. This is the instrument itself — competencies rated against a
 * framework, feedback from colleagues, a rating whose changes are recorded,
 * and a readiness judgement with a name attached.
 *
 * ── The order of the tabs is the order of the work ───────────────────────
 *
 *   Evidence      what actually happened, before anybody forms a view
 *   Competencies  the framework, rated
 *   Feedback      what colleagues said
 *   Assessment    the rating, the readiness, the words the person will read
 *   History       every time the rating moved, and why
 *
 * Evidence is first deliberately. A reviewer who writes the assessment first
 * and reads the evidence afterwards is looking for support for a conclusion
 * they have already reached, and the tab order is one of the few places a
 * product can push gently against that.
 *
 * ── What this screen will not do ─────────────────────────────────────────
 *
 * It does not compute the overall rating from the competency ratings, and it
 * never will. Averaging five competencies into a number and presenting it as
 * the answer makes the rating a property of the form rather than a judgement
 * somebody is prepared to defend; the moment it exists, the conversation
 * becomes about the arithmetic. The competency ratings inform the rating. A
 * person sets it.
 */

/* -------------------------------------------------------------------------- */
/*  Shared types                                                              */
/* -------------------------------------------------------------------------- */

export interface ReviewRow {
  id: string;
  memberId: string;
  status: 'not_started' | 'self_review' | 'manager_review' | 'shared' | 'closed';
  selfComment: string;
  managerComment: string;
  overallRating: number | null;
  promotionReadiness: 'too_early' | 'developing' | 'ready_within_a_year' | 'ready_now' | null;
  readinessNote: string;
  sharedAt: string | null;
  closedAt: string | null;
  member?: { profiles?: { fullName: string; avatarUrl: string | null; jobTitle: string | null } } | null;
  reviewer?: { profiles?: { fullName: string } } | null;
  cycle?: { id: string; name: string } | null;
}

interface Competency {
  id: string; name: string; description: string; category: string;
  sortOrder: number; isActive: boolean;
}

interface ReviewCompetency {
  id: string;
  competencyId: string;
  selfRating: number | null;
  managerRating: number | null;
  selfComment: string;
  managerComment: string;
  competency?: Competency | null;
}

interface Feedback {
  id: string;
  respondentId: string;
  subjectId: string;
  relationship: 'peer' | 'report' | 'manager' | 'stakeholder';
  status: 'pending' | 'submitted' | 'declined';
  strengths: string;
  improvements: string;
  rating: number | null;
  dueOn: string | null;
  submittedAt: string | null;
  respondent?: { profiles?: { fullName: string; avatarUrl: string | null; jobTitle: string | null } } | null;
  subject?: { profiles?: { fullName: string; avatarUrl: string | null } } | null;
  review?: { id: string; status: string; cycle?: { name: string } | null } | null;
}

interface Calibration {
  id: string;
  previousRating: number | null;
  newRating: number | null;
  reason: string;
  createdAt: string;
  calibrator?: { profiles?: { fullName: string } } | null;
}

export const READINESS_WORD: Record<string, string> = {
  too_early: 'Too early to say',
  developing: 'Developing towards it',
  ready_within_a_year: 'Ready within a year',
  ready_now: 'Ready now',
};

export const RELATIONSHIP_WORD: Record<string, string> = {
  peer: 'Peer',
  report: 'Direct report',
  manager: 'Manager',
  stakeholder: 'Works with them',
};

/* -------------------------------------------------------------------------- */
/*  Small pieces                                                              */
/* -------------------------------------------------------------------------- */

async function send(url: string, init: RequestInit) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' }, ...init,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? 'That did not save.');
  return body?.data;
}

/**
 * One to five, or nothing.
 *
 * "Nothing" is a state the control can return to, because a rating set by
 * mis-clicking has to be undoable — and because an unrated competency is a
 * legitimate answer for somebody a reviewer has not seen do that thing.
 */
function Rating({
  value, onChange, disabled, label,
}: {
  value: number | null;
  onChange?: (v: number | null) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          disabled={disabled || !onChange}
          aria-pressed={value === n}
          onClick={() => onChange?.(value === n ? null : n)}
          className={cn(
            'size-7 rounded-md border text-[12.5px] font-medium tabular-nums transition-colors',
            value === n
              ? 'border-foreground bg-foreground text-background'
              : 'border-border text-muted-foreground',
            !disabled && onChange && value !== n && 'hover:border-foreground/40 hover:text-foreground',
            (disabled || !onChange) && 'opacity-60',
          )}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function TabBar({
  tabs, active, onChange,
}: {
  tabs: { id: string; label: string; icon: React.ElementType; count?: number }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    /*
      Horizontally scrollable rather than wrapped.

      Five tabs wrap to two lines at 360px and the dialog header then changes
      height when you switch tab, which moves the content under the reader's
      thumb. Scrolling keeps the row one line at every width.
    */
    <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {tabs.map(t => {
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            aria-current={active === t.id ? 'true' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
              active === t.id
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" />
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className={cn(
                'rounded px-1 text-[11px] tabular-nums',
                active === t.id ? 'bg-background/20' : 'bg-muted',
              )}>
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  The review workspace                                                      */
/* -------------------------------------------------------------------------- */

export function ReviewDialog({
  review, cycleDates, canAssess, onOpenChange, onSaved,
}: {
  review: ReviewRow | null;
  cycleDates: { start: string; end: string } | null;
  /** Whether this viewer may write the manager's half. */
  canAssess: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = React.useState('evidence');
  const [comps, setComps] = React.useState<ReviewCompetency[]>([]);
  const [feedback, setFeedback] = React.useState<Feedback[]>([]);
  const [changes, setChanges] = React.useState<Calibration[]>([]);
  const [loading, setLoading] = React.useState(false);

  const [rating, setRating] = React.useState<number | null>(null);
  const [readiness, setReadiness] = React.useState<string>('');
  const [readinessNote, setReadinessNote] = React.useState('');
  const [managerComment, setManagerComment] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const id = review?.id;
  const settled = review ? !['not_started', 'self_review'].includes(review.status) : false;
  /** The database refuses a rating change on a settled review without a reason. */
  const needsReason = settled && review?.overallRating != null && rating !== review.overallRating;

  React.useEffect(() => {
    if (!review) return;
    setTab('evidence');
    setRating(review.overallRating);
    setReadiness(review.promotionReadiness ?? '');
    setReadinessNote(review.readinessNote ?? '');
    setManagerComment(review.managerComment ?? '');
    setReason('');
  }, [review]);

  const load = React.useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      /*
        The competency sheet is POSTed rather than GOT.

        That endpoint is idempotent and adds only the competencies the review
        is missing, which is what makes a review opened after the framework
        grew show the new competency instead of silently omitting it. It
        returns the full sheet either way, so this is one request, not two.
      */
      const [sheet, fb, cal] = await Promise.all([
        send(`/api/hr/reviews/${id}/competencies`, { method: 'POST' }).catch(() => []),
        fetch(`/api/hr/review-feedback?reviewId=${id}`, { cache: 'no-store' })
          .then(r => r.json()).then(b => b?.data ?? []).catch(() => []),
        fetch(`/api/hr/calibration?reviewId=${id}`, { cache: 'no-store' })
          .then(r => r.json()).then(b => b?.data?.changes ?? []).catch(() => []),
      ]);
      setComps(sheet ?? []);
      setFeedback(fb ?? []);
      setChanges(cal ?? []);
    } finally {
      setLoading(false);
    }
  }, [id]);

  React.useEffect(() => { void load(); }, [load]);

  const rateCompetency = async (row: ReviewCompetency, patch: Partial<ReviewCompetency>) => {
    setComps(cs => cs.map(c => (c.id === row.id ? { ...c, ...patch } : c)));
    try {
      await send(`/api/hr/review-competencies/${row.id}`, {
        method: 'PATCH', body: JSON.stringify(patch),
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That rating did not save.');
      void load();
    }
  };

  const saveAssessment = async () => {
    if (!id) return;
    if (needsReason && !reason.trim()) {
      setTab('assessment');
      return toast.error('Say why the rating is changing.');
    }
    setSaving(true);
    try {
      await send(`/api/hr/reviews/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          overallRating: rating,
          promotionReadiness: readiness || null,
          readinessNote,
          managerComment,
          ...(needsReason ? { calibrationReason: reason } : {}),
        }),
      });
      toast.success('Assessment saved');
      setReason('');
      onSaved();
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not save.');
    } finally {
      setSaving(false);
    }
  };

  const answered = feedback.filter(f => f.status === 'submitted');

  const tabs = [
    { id: 'evidence', label: 'Evidence', icon: FileSearch },
    { id: 'competencies', label: 'Competencies', icon: ListChecks, count: comps.length },
    { id: 'feedback', label: 'Feedback', icon: MessageSquarePlus, count: answered.length },
    { id: 'assessment', label: 'Assessment', icon: Scale },
    { id: 'history', label: 'History', icon: History, count: changes.length },
  ];

  return (
    <Dialog open={Boolean(review)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-4 overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {review?.member?.profiles?.fullName ?? 'Review'}
            {review?.cycle?.name ? ` · ${review.cycle.name}` : ''}
          </DialogTitle>
          <DialogDescription>
            {review?.status === 'closed'
              ? 'This review is closed. It is kept as it was.'
              : 'Read the evidence first. The rating is a judgement you make, not a figure this screen calculates.'}
          </DialogDescription>
        </DialogHeader>

        <div className="shrink-0">
          <TabBar tabs={tabs} active={tab} onChange={setTab} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {loading && (
            <p className="flex items-center gap-2 py-6 text-[12.5px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Reading the record
            </p>
          )}

          {tab === 'evidence' && review && (
            <EvidenceRecord
              memberId={review.memberId}
              from={cycleDates?.start ?? null}
              to={cycleDates?.end ?? null}
            />
          )}

          {tab === 'competencies' && (
            <CompetencySheet
              rows={comps}
              canAssess={canAssess}
              locked={review?.status === 'closed'}
              onRate={rateCompetency}
            />
          )}

          {tab === 'feedback' && review && (
            <FeedbackPanel
              reviewId={review.id}
              subjectId={review.memberId}
              rows={feedback}
              canRequest={canAssess && review.status !== 'closed'}
              onChanged={load}
            />
          )}

          {tab === 'assessment' && review && (
            <div className="flex flex-col gap-5">
              {!canAssess && (
                <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-[12.5px] text-muted-foreground">
                  You can read this assessment but not write it. Only the named reviewer and HR can.
                </p>
              )}

              <div className="flex flex-col gap-2">
                <Label>Overall rating</Label>
                <Rating
                  label="Overall rating"
                  value={rating}
                  onChange={canAssess && review.status !== 'closed' ? setRating : undefined}
                />
                <p className="text-[11.5px] text-muted-foreground">
                  Not calculated from the competencies above. Those inform it; you decide it.
                </p>
              </div>

              {needsReason && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cal-reason">Why is the rating changing?</Label>
                  <Input
                    id="cal-reason" value={reason} onChange={e => setReason(e.target.value)}
                    placeholder="Agreed in calibration — consistency with the rest of the department"
                  />
                  <p className="text-[11.5px] text-muted-foreground">
                    Kept for good, and visible to {review.member?.profiles?.fullName ?? 'this person'} once
                    the review is shared. A rating that moved without a reason cannot be explained.
                  </p>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Label htmlFor="readiness">Promotion readiness</Label>
                <select
                  id="readiness"
                  value={readiness}
                  disabled={!canAssess || review.status === 'closed'}
                  onChange={e => setReadiness(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-[13px] disabled:opacity-60"
                >
                  <option value="">Not assessed</option>
                  {Object.entries(READINESS_WORD).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <p className="text-[11.5px] text-muted-foreground">
                  “Not assessed” is different from “not ready”, and the record keeps them apart.
                </p>
                <Textarea
                  value={readinessNote}
                  disabled={!canAssess || review.status === 'closed'}
                  onChange={e => setReadinessNote(e.target.value)}
                  placeholder="What would need to be true for the next step?"
                  rows={2}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mgr-comment">
                  The assessment {review.member?.profiles?.fullName ?? 'this person'} will read
                </Label>
                <Textarea
                  id="mgr-comment"
                  value={managerComment}
                  disabled={!canAssess || review.status === 'closed'}
                  onChange={e => setManagerComment(e.target.value)}
                  rows={6}
                  placeholder="What they did, what it meant, and what comes next."
                />
                <p className="text-[11.5px] text-muted-foreground">
                  Colleagues’ feedback is not shown to them directly — this is where it reaches
                  them, in your words and with your name on it.
                </p>
              </div>

              {review.selfComment && (
                <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                  <p className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
                    Their own account
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground">
                    {review.selfComment}
                  </p>
                </div>
              )}

              {canAssess && review.status !== 'closed' && (
                <div className="flex justify-end">
                  <Button size="sm" onClick={saveAssessment} disabled={saving} className="gap-1.5">
                    {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                    Save assessment
                  </Button>
                </div>
              )}
            </div>
          )}

          {tab === 'history' && (
            <CalibrationHistory changes={changes} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Competencies                                                              */
/* -------------------------------------------------------------------------- */

function CompetencySheet({
  rows, canAssess, locked, onRate,
}: {
  rows: ReviewCompetency[];
  canAssess: boolean;
  locked: boolean;
  onRate: (row: ReviewCompetency, patch: Partial<ReviewCompetency>) => void;
}) {
  if (rows.length === 0) {
    return (
      <Blank
        title="No competency framework yet"
        note="HR defines what this organisation assesses people on. Until somebody writes that
              down, this review has goals and an assessment but nothing to rate against — which
              is honest, and better than fifteen generic competencies nobody chose."
      />
    );
  }

  /* Grouped by the organisation's own category, in the framework's order. */
  const groups = [...new Map(
    rows.map(r => [r.competency?.category || '', r.competency?.category || 'General']),
  )];

  return (
    <div className="flex flex-col gap-5">
      {groups.map(([key, name]) => (
        <section key={key} className="flex flex-col gap-2">
          <h4 className="text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
            {name}
          </h4>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {rows.filter(r => (r.competency?.category || '') === key).map(r => (
              <li key={r.id} className="flex flex-col gap-2 px-3 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-foreground">
                      {r.competency?.name ?? 'Competency'}
                      {r.competency?.isActive === false && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-normal text-muted-foreground">
                          retired
                        </span>
                      )}
                    </p>
                    {r.competency?.description && (
                      <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                        {r.competency.description}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-[52px] text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                      Self
                    </span>
                    {/* Read-only here: the self-rating belongs to the person, on their own screen. */}
                    <Rating label="Self rating" value={r.selfRating} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-[52px] text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                      Manager
                    </span>
                    <Rating
                      label="Manager rating"
                      value={r.managerRating}
                      onChange={canAssess && !locked
                        ? v => onRate(r, { managerRating: v })
                        : undefined}
                    />
                  </div>
                </div>

                {/*
                  The gap, named rather than averaged.

                  Where the two ratings differ by two or more there is a
                  conversation to have, and saying so is more useful than
                  splitting the difference into a number that describes
                  neither view.
                */}
                {r.selfRating != null && r.managerRating != null
                  && Math.abs(r.selfRating - r.managerRating) >= 2 && (
                  <p className="text-[11.5px] text-warning">
                    Two points apart — worth talking about before this is shared.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  360 feedback                                                              */
/* -------------------------------------------------------------------------- */

function FeedbackPanel({
  reviewId, subjectId, rows, canRequest, onChanged,
}: {
  reviewId: string;
  subjectId: string;
  rows: Feedback[];
  canRequest: boolean;
  onChanged: () => void;
}) {
  const [people, setPeople] = React.useState<{ id: string; name: string }[]>([]);
  const [who, setWho] = React.useState('');
  const [relationship, setRelationship] = React.useState('peer');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!canRequest) return;
    fetch('/api/hr/people?pageSize=200', { cache: 'no-store' })
      .then(r => r.json())
      .then(b => setPeople((b?.data ?? [])
        .filter((p: any) => p.memberId !== subjectId)
        .map((p: any) => ({ id: p.memberId, name: p.fullName }))))
      .catch(() => setPeople([]));
  }, [canRequest, subjectId]);

  const ask = async () => {
    if (!who) return toast.error('Choose who to ask.');
    setBusy(true);
    try {
      await send('/api/hr/review-feedback', {
        method: 'POST',
        body: JSON.stringify({ reviewId, respondentId: who, relationship }),
      });
      toast.success('Asked. They will see it in their notifications.');
      setWho('');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That request did not send.');
    } finally { setBusy(false); }
  };

  const withdraw = async (f: Feedback) => {
    try {
      await send(`/api/hr/review-feedback/${f.id}`, { method: 'DELETE' });
      toast.success('Request withdrawn');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not work.');
    }
  };

  const asked = rows.filter(f => f.status === 'pending');
  const answered = rows.filter(f => f.status === 'submitted');
  const declined = rows.filter(f => f.status === 'declined');

  return (
    <div className="flex flex-col gap-5">
      <p className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
        The person being reviewed cannot read these answers. In a team of six, “anonymous”
        is a promise the data cannot keep — one detail identifies the author, and people who
        work that out stop writing anything worth reading. What colleagues say reaches them
        through your assessment, in your words.
      </p>

      {canRequest && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-[180px] flex-1 flex-col gap-1.5">
            <Label htmlFor="fb-who">Ask someone</Label>
            <select
              id="fb-who" value={who} onChange={e => setWho(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-[13px]"
            >
              <option value="">Choose a colleague</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fb-rel">They are a</Label>
            <select
              id="fb-rel" value={relationship} onChange={e => setRelationship(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-[13px]"
            >
              {Object.entries(RELATIONSHIP_WORD).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <Button size="sm" onClick={ask} disabled={busy} className="h-9 gap-1.5">
            <Send className="size-3.5" /> Ask
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <Blank
          title="Nobody has been asked yet"
          note="A manager sees a fraction of what somebody does. Two or three colleagues who
                work with them closely will tell you things this record cannot."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {answered.length > 0 && (
            <section className="flex flex-col gap-2">
              <h4 className="text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
                Answered
              </h4>
              <ul className="flex flex-col gap-2">
                {answered.map(f => (
                  <li key={f.id} className="rounded-xl border border-border px-3 py-3">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <PersonCell
                        id={f.respondentId}
                        name={f.respondent?.profiles?.fullName ?? 'A colleague'}
                        avatarUrl={f.respondent?.profiles?.avatarUrl ?? null}
                        secondary={RELATIONSHIP_WORD[f.relationship] ?? f.relationship}
                      />
                      {f.rating != null && (
                        <span className="ml-auto text-[12.5px] tabular-nums text-muted-foreground">
                          {f.rating}/5
                        </span>
                      )}
                    </div>
                    {f.strengths && (
                      <div className="mt-2">
                        <p className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
                          Keep doing
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] leading-relaxed">
                          {f.strengths}
                        </p>
                      </div>
                    )}
                    {f.improvements && (
                      <div className="mt-2">
                        <p className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
                          Would make the biggest difference
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] leading-relaxed">
                          {f.improvements}
                        </p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(asked.length > 0 || declined.length > 0) && (
            <section className="flex flex-col gap-2">
              <h4 className="text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
                Outstanding
              </h4>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                {[...asked, ...declined].map(f => (
                  <li key={f.id} className="flex items-center gap-3 px-3 py-2.5">
                    <PersonCell
                      id={f.respondentId}
                      name={f.respondent?.profiles?.fullName ?? 'A colleague'}
                      avatarUrl={f.respondent?.profiles?.avatarUrl ?? null}
                      secondary={RELATIONSHIP_WORD[f.relationship] ?? f.relationship}
                    />
                    <span className="ml-auto shrink-0 text-[11.5px] text-muted-foreground">
                      {f.status === 'declined' ? 'Declined' : 'Not answered yet'}
                    </span>
                    {canRequest && (
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 shrink-0 px-2 text-[12px] text-muted-foreground"
                        onClick={() => withdraw(f)}
                      >
                        <X className="size-3.5" />
                        <span className="sr-only">Withdraw the request</span>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Calibration history                                                       */
/* -------------------------------------------------------------------------- */

function CalibrationHistory({ changes }: { changes: Calibration[] }) {
  if (changes.length === 0) {
    return (
      <Blank
        title="The rating has not been changed"
        note="If it is ever moved after this review reaches the manager’s desk, what it was,
              what it became, who moved it and why are kept here — and stay visible to the
              person the review is about."
      />
    );
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
      {changes.map(c => (
        <li key={c.id} className="px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium tabular-nums text-foreground">
              {c.previousRating ?? '—'} → {c.newRating ?? '—'}
            </span>
            <span className="text-[11.5px] text-muted-foreground">
              {c.calibrator?.profiles?.fullName ?? 'Someone'} · {formatDate(c.createdAt)}
            </span>
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-foreground">{c.reason}</p>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/*  The respondent's side                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Feedback somebody has been asked to give.
 *
 * A separate surface from the review, because the respondent has no business
 * inside the review — they cannot see the rating, the other answers, or
 * anything else about it. All they need is who, and the two questions.
 */
export function FeedbackInbox({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = React.useState<Feedback[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [open, setOpen] = React.useState<Feedback | null>(null);

  const load = React.useCallback(() => {
    setLoading(true);
    fetch('/api/hr/review-feedback?mine=true', { cache: 'no-store' })
      .then(r => r.json())
      .then(b => setRows(b?.data ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(load, [load]);

  const pending = rows.filter(f => f.status === 'pending');

  if (loading) return null;
  /* Nothing to do is nothing to show: this is not a section, it is an errand. */
  if (pending.length === 0) return null;

  return (
    <>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 className="text-[15px] font-semibold tracking-[-0.015em]">Feedback asked of you</h3>
          <p className="text-[12.5px] text-muted-foreground">
            What you write is read by their reviewer, not by them
          </p>
        </div>
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-e1">
          {pending.map(f => (
            <li key={f.id} className="flex items-center gap-3 px-4 py-3">
              <PersonCell
                id={f.subjectId}
                name={f.subject?.profiles?.fullName ?? 'A colleague'}
                avatarUrl={f.subject?.profiles?.avatarUrl ?? null}
                secondary={[f.review?.cycle?.name, f.dueOn ? `by ${formatDate(f.dueOn)}` : null]
                  .filter(Boolean).join(' · ')}
              />
              <Button
                size="sm" variant="outline"
                className="ml-auto h-7 shrink-0 gap-1 px-2 text-[12px]"
                onClick={() => setOpen(f)}
              >
                Answer
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <AnswerDialog
        request={open}
        onOpenChange={o => { if (!o) setOpen(null); }}
        onSaved={() => { load(); onChanged?.(); }}
      />
    </>
  );
}

function AnswerDialog({
  request, onOpenChange, onSaved,
}: {
  request: Feedback | null;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [strengths, setStrengths] = React.useState('');
  const [improvements, setImprovements] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setStrengths(request?.strengths ?? '');
    setImprovements(request?.improvements ?? '');
  }, [request]);

  const submit = async (status: 'submitted' | 'declined') => {
    if (!request) return;
    if (status === 'submitted' && !strengths.trim() && !improvements.trim()) {
      return toast.error('Write something, or decline the request instead.');
    }
    setBusy(true);
    try {
      await send(`/api/hr/review-feedback/${request.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, strengths, improvements }),
      });
      toast.success(status === 'submitted' ? 'Thank you — sent' : 'Declined');
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not send.');
    } finally { setBusy(false); }
  };

  const who = request?.subject?.profiles?.fullName ?? 'your colleague';

  return (
    <Dialog open={Boolean(request)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Feedback on {who}</DialogTitle>
          <DialogDescription>
            Two questions. Their reviewer reads this; {who} does not see it directly, so write
            what would actually be useful to whoever is assessing them.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fb-strengths">What should they keep doing?</Label>
            <Textarea
              id="fb-strengths" rows={4} value={strengths}
              onChange={e => setStrengths(e.target.value)}
              placeholder="Something specific you have actually seen."
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fb-improve">What would make the biggest difference?</Label>
            <Textarea
              id="fb-improve" rows={4} value={improvements}
              onChange={e => setImprovements(e.target.value)}
              placeholder="One thing, not five."
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              size="sm" variant="ghost" disabled={busy}
              className="text-muted-foreground"
              onClick={() => submit('declined')}
            >
              I have not worked with them
            </Button>
            <Button size="sm" disabled={busy} onClick={() => submit('submitted')} className="gap-1.5">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              Send
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  The framework itself                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What this organisation assesses people on.
 *
 * Starts empty and says so. The temptation is to ship five plausible
 * competencies — "Communication", "Ownership", "Collaboration" — so the screen
 * looks finished on the first day. A framework nobody chose is one nobody will
 * defend in a review, and it is worse than an empty state because it looks
 * like a decision somebody made.
 *
 * Retiring rather than deleting: a competency rated in a closed review is part
 * of what that review means, and the foreign key is `ON DELETE RESTRICT` to
 * make sure of it. So the control offered is a switch, not a bin.
 */
export function CompetencyFramework({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = React.useState<Competency[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [name, setName] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [adding, setAdding] = React.useState(false);

  const load = React.useCallback(() => {
    setLoading(true);
    fetch('/api/hr/competencies?pageSize=200', { cache: 'no-store' })
      .then(r => r.json())
      .then(b => setRows(b?.data ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(load, [load]);

  const add = async () => {
    if (!name.trim()) return toast.error('Give the competency a name.');
    setBusy(true);
    try {
      await send('/api/hr/competencies', {
        method: 'POST',
        body: JSON.stringify({
          name, category, description,
          sortOrder: rows.length,
        }),
      });
      setName(''); setCategory(''); setDescription(''); setAdding(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not save.');
    } finally { setBusy(false); }
  };

  const toggle = async (c: Competency) => {
    setRows(rs => rs.map(r => (r.id === c.id ? { ...r, isActive: !r.isActive } : r)));
    try {
      await send(`/api/hr/competencies/${c.id}`, {
        method: 'PATCH', body: JSON.stringify({ isActive: !c.isActive }),
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not save.');
      load();
    }
  };

  const active = rows.filter(r => r.isActive);
  const retired = rows.filter(r => !r.isActive);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="text-[15px] font-semibold tracking-[-0.015em]">Competency framework</h3>
        <p className="text-[12.5px] text-muted-foreground">
          What reviews ask about, in every department
        </p>
        {canManage && !adding && (
          <Button
            size="sm" variant="outline" className="ml-auto h-8 gap-1.5"
            onClick={() => setAdding(true)}
          >
            <ListChecks className="size-3.5" /> Add one
          </Button>
        )}
      </div>

      {canManage && adding && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="comp-name">Name</Label>
              <Input
                id="comp-name" value={name} onChange={e => setName(e.target.value)}
                placeholder="Gives clear written updates"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="comp-cat">Group</Label>
              <Input
                id="comp-cat" value={category} onChange={e => setCategory(e.target.value)}
                placeholder="Communication"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="comp-desc">What good looks like</Label>
            <Textarea
              id="comp-desc" rows={2} value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe the behaviour, so two managers rate the same thing."
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" onClick={add} disabled={busy} className="gap-1.5">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Add
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="h-16 animate-pulse rounded-xl bg-muted" />
      ) : rows.length === 0 ? (
        <Blank
          title="No framework yet"
          note={canManage
            ? 'Reviews can run without one — they will have goals and an assessment. A framework adds the questions every review asks, so two managers rate the same thing.'
            : 'HR has not defined what reviews assess against yet.'}
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-e1">
          {[...active, ...retired].map(c => (
            <li key={c.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className={cn(
                  'text-[13.5px] font-medium',
                  !c.isActive && 'text-muted-foreground line-through',
                )}>
                  {c.name}
                </p>
                <p className="text-[11.5px] text-muted-foreground">
                  {[c.category || null, c.description || null].filter(Boolean).join(' · ')
                    || 'No description'}
                </p>
              </div>
              {canManage && (
                <Button
                  size="sm" variant="ghost"
                  className="h-7 shrink-0 px-2 text-[12px] text-muted-foreground"
                  onClick={() => toggle(c)}
                >
                  {c.isActive ? 'Retire' : 'Restore'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {retired.length > 0 && (
        <p className="text-[11.5px] text-muted-foreground">
          Retired competencies stay on the reviews that already rated them — that rating is part
          of what those reviews mean. They are simply not asked about again.
        </p>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Calibration                                                               */
/* -------------------------------------------------------------------------- */

interface CalibrationData {
  cycle: { id: string; name: string; periodStart: string; periodEnd: string; status: string };
  scope: 'organization' | 'visible';
  counts: { reviews: number; rated: number; unrated: number; shared: number; closed: number; adjusted: number };
  mean: number | null;
  distribution: { rating: number; count: number }[];
  byDepartment: {
    departmentId: string | null; department: string; reviewed: number; rated: number;
    mean: number | null; distribution: { rating: number; count: number }[];
  }[];
  reviews: {
    id: string; status: string; overallRating: number | null;
    promotionReadiness: string | null; timesAdjusted: number;
    member: { id: string; name: string; jobTitle: string | null; avatarUrl: string | null; department: string | null };
    reviewer: string | null;
  }[];
}

/**
 * The whole cycle at once.
 *
 * Counts, and nothing else. There is no suggested distribution and nothing is
 * flagged as out of line — see the route's header for why a product that ships
 * a curve has chosen forced ranking on the organisation's behalf. What this
 * does is put two managers' numbers next to each other so they can find out
 * they mean different things by "4".
 */
export function CalibrationPanel({ cycleId }: { cycleId: string | null }) {
  const [data, setData] = React.useState<CalibrationData | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!cycleId) { setData(null); return; }
    setLoading(true);
    fetch(`/api/hr/calibration?cycleId=${cycleId}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(b => setData(b?.data ?? null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [cycleId]);

  if (!cycleId) {
    return <Blank title="Choose a cycle" note="Calibration compares reviews inside one cycle." />;
  }
  if (loading) {
    return (
      <p className="flex items-center gap-2 py-6 text-[12.5px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Reading the cycle
      </p>
    );
  }
  if (!data) return <Blank title="Nothing to calibrate yet" note="No reviews have been opened in this cycle." />;

  const max = Math.max(1, ...data.distribution.map(d => d.count));

  return (
    <div className="flex flex-col gap-5">
      {data.scope === 'visible' && (
        <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-[12.5px] text-muted-foreground">
          These are the reviews you can see, not the whole organisation. The distribution below
          is your people’s, so read it as a department figure rather than a company one.
        </p>
      )}

      <div className="grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-4 sm:divide-y-0">
        <div className="px-4 py-3">
          <Field label="Reviews" value={data.counts.reviews} hint={`${data.counts.unrated} not yet rated`} />
        </div>
        <div className="px-4 py-3">
          <Field label="Mean rating" value={data.mean ?? '—'} hint={`over ${data.counts.rated} rated`} />
        </div>
        <div className="px-4 py-3">
          <Field label="Shared" value={data.counts.shared} hint={`${data.counts.closed} closed`} />
        </div>
        <div className="px-4 py-3">
          <Field label="Ratings moved" value={data.counts.adjusted} hint="after reaching the manager" />
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <h4 className="text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
          Distribution
        </h4>
        <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-4">
          {data.distribution.map(d => (
            <div key={d.rating} className="flex items-center gap-3">
              <span className="w-4 shrink-0 text-[12px] tabular-nums text-muted-foreground">{d.rating}</span>
              {/*
                A plain bar, in the foreground colour.

                Not red for low and green for high: a colour on a rating is an
                instruction about what the shape ought to be, and this screen
                is deliberately not giving one.
              */}
              <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-foreground/70"
                  style={{ width: `${(d.count / max) * 100}%` }}
                />
              </div>
              <span className="w-6 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">
                {d.count}
              </span>
            </div>
          ))}
        </div>
      </section>

      {data.byDepartment.length > 1 && (
        <section className="flex flex-col gap-2">
          <h4 className="text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
            By department
          </h4>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[420px] text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Department</th>
                  <th className="px-3 py-2 font-medium">Reviewed</th>
                  <th className="px-3 py-2 font-medium">Rated</th>
                  <th className="px-3 py-2 font-medium">Mean</th>
                </tr>
              </thead>
              <tbody>
                {data.byDepartment.map(d => (
                  <tr key={d.departmentId ?? 'none'} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">{d.department}</td>
                    <td className="px-3 py-2 tabular-nums">{d.reviewed}</td>
                    <td className="px-3 py-2 tabular-nums">{d.rated}</td>
                    <td className="px-3 py-2 tabular-nums">{d.mean ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
