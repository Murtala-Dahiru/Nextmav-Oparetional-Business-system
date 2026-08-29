'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  Upload, FileSpreadsheet, ArrowRight, ArrowLeft, Check, AlertTriangle,
  Copy, Loader2, Building2, User, Target, X, CheckCircle2, Info,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Card } from '@/components/shared/readout/primitives';

import { post, exact } from './data';
import { SectionHead, FilterRow, Blank, Broken } from './ui';
import type { CrmSection } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Import Center
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The thing this has to earn ───────────────────────────────────────────
 *
 * Trust. An import writes hundreds of records into a system a team relies on,
 * and the reason people paste data in by hand instead is that they have been
 * burnt by a tool that guessed wrong at scale. So the whole design is one
 * idea: **say what will happen, then do exactly that.**
 *
 *   Upload → Map → Review → Import
 *
 * Nothing is written before the third screen has been read and confirmed. The
 * mapping is shown with the confidence behind each guess, so a column the
 * system is unsure about *looks* unsure. The review names every duplicate, and
 * a possible duplicate defaults to being skipped rather than merged, because
 * merging two different customers is the one mistake here with no undo.
 *
 * ── What the intelligence actually is ────────────────────────────────────
 *
 * A list of the names people really use for a field, a check on what the
 * values look like, and a normalising comparison that knows "Acme Ltd" and
 * "Acme Limited" are one company. It is not a model, and the screen does not
 * pretend otherwise - every guess is shown with the reason for it in three
 * words, and every one of them can be overruled.
 *
 * ── Mobile ───────────────────────────────────────────────────────────────
 *
 * Mapping a spreadsheet is a desktop job and this does not pretend otherwise -
 * but the workflow is not blocked on a phone and the review screen is fully
 * legible there, because the person who needs to check what an import did is
 * often not the person who ran it.
 */

type Step = 'upload' | 'map' | 'review' | 'done';

type Confidence = 'certain' | 'likely' | 'unsure';

interface ColumnSuggestion {
  index: number;
  header: string;
  field: string | null;
  confidence: Confidence;
  reason: string;
  sample: string[];
  filled: number;
}

interface Analysis {
  filename: string;
  format: 'csv' | 'xlsx';
  sheetName: string | null;
  columns: ColumnSuggestion[];
  rows: string[][];
  rowCount: number;
  truncated: number;
  maxRows: number;
}

interface Problem { field: string; message: string; severity: 'error' | 'warning' }

interface PlannedRow {
  row: number;
  candidate: {
    company: { name: string; website: string; industry: string } | null;
    person: {
      firstName: string; lastName: string; email: string; phone: string;
      estimatedValue: number | null; status: string;
    } | null;
    problems: Problem[];
  };
  companyMatch: { id: string; label: string; on: string; strength: string } | null;
  companyFromRow: number | null;
  personMatch: { id: string; label: string; on: string; strength: string } | null;
  action: 'create' | 'update' | 'skip';
  note: string;
}

interface Plan {
  rows: PlannedRow[];
  summary: {
    total: number; create: number; update: number; skip: number;
    duplicates: number; linked: number; needsAttention: number; companiesCreated: number;
    exhaustive: boolean;
  };
}

interface Result {
  companiesCreated: number; companiesUpdated: number;
  peopleCreated: number; peopleUpdated: number;
  skipped: number;
  failed: { row: number; message: string }[];
}

/** The fields the mapping select offers, grouped the way the records are made. */
const FIELD_GROUPS: { label: string; fields: { value: string; label: string }[] }[] = [
  {
    label: 'Company',
    fields: [
      { value: 'companyName', label: 'Company' },
      { value: 'website', label: 'Website' },
      { value: 'industry', label: 'Industry' },
      { value: 'companyPhone', label: 'Company phone' },
      { value: 'companyEmail', label: 'Company email' },
      { value: 'city', label: 'City' },
      { value: 'country', label: 'Country' },
      { value: 'employeeCount', label: 'Employees' },
      { value: 'annualRevenue', label: 'Annual revenue' },
    ],
  },
  {
    label: 'Person',
    fields: [
      { value: 'fullName', label: 'Full name' },
      { value: 'firstName', label: 'First name' },
      { value: 'lastName', label: 'Last name' },
      { value: 'email', label: 'Email' },
      { value: 'phone', label: 'Phone' },
      { value: 'jobTitle', label: 'Job title' },
      { value: 'source', label: 'Source' },
      { value: 'status', label: 'Lead status' },
      { value: 'estimatedValue', label: 'Estimated value' },
      { value: 'score', label: 'Score' },
      { value: 'notes', label: 'Notes' },
    ],
  },
];

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  certain: 'text-success',
  likely: 'text-muted-foreground',
  unsure: 'text-warning',
};

const CONFIDENCE_WORD: Record<Confidence, string> = {
  certain: 'Confident',
  likely: 'Probably',
  unsure: 'Check this',
};

/* -------------------------------------------------------------------------- */

export function ImportCenter({ onGo }: { onGo: (section: CrmSection) => void }) {
  const [step, setStep] = React.useState<Step>('upload');
  const [target, setTarget] = React.useState<'leads' | 'contacts'>('leads');

  const [analysis, setAnalysis] = React.useState<Analysis | null>(null);
  const [mapping, setMapping] = React.useState<Record<string, number>>({});
  const [plan, setPlan] = React.useState<Plan | null>(null);
  const [decisions, setDecisions] = React.useState<Record<string, 'create' | 'update' | 'skip'>>({});
  const [result, setResult] = React.useState<Result | null>(null);

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [filter, setFilter] = React.useState<'all' | 'duplicates' | 'problems'>('all');

  const fileRef = React.useRef<HTMLInputElement>(null);

  /* ── Upload ────────────────────────────────────────────────────────────── */

  const read = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/crm/import/analyze', {
        method: 'POST',
        headers: { 'x-filename': file.name },
        body: file,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message ?? `That file could not be read (${res.status})`);

      const data = json.data as Analysis;
      setAnalysis(data);
      setMapping(Object.fromEntries(
        data.columns.filter(c => c.field).map(c => [c.field as string, c.index]),
      ));
      setStep('map');
    } catch (e: any) {
      setError(e.message || 'That file could not be read');
    } finally {
      setBusy(false);
    }
  };

  /* ── Preview ───────────────────────────────────────────────────────────── */

  const preview = async () => {
    if (!analysis) return;
    if (!Object.keys(mapping).length) {
      toast.error('Say what at least one column means');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const p = await post<Plan>('/api/crm/import/preview', {
        rows: analysis.rows, mapping, target,
      });
      setPlan(p);
      setDecisions({});
      setStep('review');
    } catch (e: any) {
      setError(e.message || 'That import could not be checked');
    } finally {
      setBusy(false);
    }
  };

  /* ── Commit ────────────────────────────────────────────────────────────── */

  const run = async () => {
    if (!analysis) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post<Result>('/api/crm/import/commit', {
        rows: analysis.rows, mapping, target, decisions,
      });
      setResult(r);
      setStep('done');
    } catch (e: any) {
      setError(e.message || 'That import could not be completed');
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    setStep('upload');
    setAnalysis(null);
    setMapping({});
    setPlan(null);
    setDecisions({});
    setResult(null);
    setError(null);
  };

  /* ── The mapping select ────────────────────────────────────────────────── */

  const setColumn = (index: number, field: string) => {
    setMapping(prev => {
      const next: Record<string, number> = {};
      // A field belongs to one column. Assigning it to a second releases the
      // first, which is what somebody correcting a wrong guess means.
      for (const [key, value] of Object.entries(prev)) {
        if (value === index) continue;
        if (key === field) continue;
        next[key] = value;
      }
      if (field !== '__skip') next[field] = index;
      return next;
    });
  };

  const fieldOf = (index: number): string =>
    Object.entries(mapping).find(([, i]) => i === index)?.[0] ?? '__skip';

  const decide = (row: number, action: 'create' | 'update' | 'skip') =>
    setDecisions(prev => ({ ...prev, [String(row)]: action }));

  const actionOf = (p: PlannedRow) => decisions[String(p.row)] ?? p.action;

  const visibleRows = React.useMemo(() => {
    if (!plan) return [];
    if (filter === 'duplicates') return plan.rows.filter(p => p.personMatch);
    if (filter === 'problems') return plan.rows.filter(p => p.candidate.problems.length > 0);
    return plan.rows;
  }, [plan, filter]);

  /* ── Live counts, so the button says what it will do ───────────────────── */

  const live = React.useMemo(() => {
    if (!plan) return { create: 0, update: 0, skip: 0 };
    let create = 0, update = 0, skip = 0;
    for (const p of plan.rows) {
      const a = actionOf(p);
      if (a === 'create') create++;
      else if (a === 'update') update++;
      else skip++;
    }
    return { create, update, skip };
  }, [plan, decisions]);

  return (
    <div className="flex flex-col gap-4">
      <SectionHead title="Import Center" note="Bring leads, contacts and companies in from a spreadsheet">
        {step !== 'upload' && (
          <Button size="sm" variant="ghost" className="h-9 gap-1.5" onClick={restart}>
            <X className="size-4" /> Start again
          </Button>
        )}
      </SectionHead>

      <Steps step={step} />

      {error && <Broken message={error} onRetry={() => setError(null)} />}

      {/* ═══ Upload ══════════════════════════════════════════════════════════ */}
      {step === 'upload' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Card className="p-4">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Label className="text-[12.5px] font-medium">What is in this file</Label>
              <FilterRow
                ariaLabel="What kind of records are in this file"
                value={target}
                onChange={v => setTarget(v as 'leads' | 'contacts')}
                options={[
                  { value: 'leads', label: 'Leads' },
                  { value: 'contacts', label: 'Contacts' },
                ]}
              />
            </div>

            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void read(file);
              }}
              className={cn(
                'flex flex-col items-center rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors',
                dragOver ? 'border-[var(--chart-1)] bg-[color-mix(in_srgb,var(--chart-1)_6%,transparent)]' : 'border-border',
              )}
            >
              {busy ? (
                <>
                  <Loader2 className="mb-3 size-6 animate-spin text-muted-foreground" />
                  <p className="text-[13.5px] font-medium">Reading the file</p>
                </>
              ) : (
                <>
                  <span className="mb-3 flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Upload className="size-5" />
                  </span>
                  <p className="text-[14px] font-medium text-foreground">
                    Drop a CSV or XLSX here
                  </p>
                  <p className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">
                    Nothing is saved until you have seen what it would do.
                  </p>
                  <p className="mt-1 text-[11.5px] text-muted-foreground/80">
                    First sheet, first row as headings, up to 5,000 rows.
                  </p>
                  <Button
                    size="sm" className="mt-4 gap-1.5"
                    onClick={() => fileRef.current?.click()}
                  >
                    <FileSpreadsheet className="size-4" /> Choose a file
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,.tsv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) void read(file);
                      e.target.value = '';
                    }}
                  />
                </>
              )}
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="text-[13px] font-semibold">How it works</h3>
            <ol className="mt-3 flex flex-col gap-3">
              <Explain n="1" title="Reads the columns">
                "Business Name", "Web Address" and "Mobile" are recognised on their own.
              </Explain>
              <Explain n="2" title="Shows what it guessed">
                Anything it is unsure about is marked. Change any of it.
              </Explain>
              <Explain n="3" title="Finds duplicates">
                By email, web domain and company name. "Acme Ltd" finds "Acme Limited".
              </Explain>
              <Explain n="4" title="Never overwrites">
                Updates fill empty fields only. Nothing you already have is replaced.
              </Explain>
            </ol>
          </Card>
        </div>
      )}

      {/* ═══ Map ════════════════════════════════════════════════════════════ */}
      {step === 'map' && analysis && (
        <>
          <Card className="p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-semibold text-foreground">
                  {analysis.filename}
                </p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {analysis.rowCount} {analysis.rowCount === 1 ? 'row' : 'rows'}
                  {' · '}{analysis.columns.length} columns
                  {analysis.sheetName ? ` · sheet "${analysis.sheetName}"` : ''}
                  {' · '}{analysis.format.toUpperCase()}
                </p>
              </div>
              <p className="text-[12px] text-muted-foreground">
                Importing as <span className="font-medium text-foreground">{target}</span>
              </p>
            </div>

            {analysis.truncated > 0 && (
              <p className="mt-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/[0.06] px-3 py-2 text-[12.5px] text-foreground">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                <span>
                  The first {analysis.maxRows} rows were read. {analysis.truncated} more
                  are in the file and will not be imported - split it and run the rest
                  separately.
                </span>
              </p>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-[13px] font-semibold">What each column means</h3>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Change anything that looks wrong. A column set to "Do not import" is
                ignored.
              </p>
            </div>

            <ul className="divide-y divide-border">
              {analysis.columns.map(col => {
                const chosen = fieldOf(col.index);
                const unsure = chosen !== '__skip' && col.confidence === 'unsure';

                return (
                  <li key={col.index} className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_200px] md:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-foreground">{col.header}</p>
                      <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                        {col.filled} of {analysis.rowCount} filled
                        {chosen !== '__skip' && (
                          <>
                            {' · '}
                            <span className={CONFIDENCE_STYLE[col.confidence]}>
                              {CONFIDENCE_WORD[col.confidence]}
                            </span>
                            {' · '}{col.reason}
                          </>
                        )}
                      </p>
                    </div>

                    <div className="min-w-0">
                      <p className="truncate text-[12px] text-muted-foreground">
                        {col.sample.length
                          ? col.sample.join(' · ')
                          : <span className="text-muted-foreground/60">Every value is empty</span>}
                      </p>
                    </div>

                    <Select value={chosen} onValueChange={v => setColumn(col.index, v)}>
                      <SelectTrigger className={cn('h-9 text-[13px]', unsure && 'border-warning/50')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__skip" className="text-[13px] text-muted-foreground">
                          Do not import
                        </SelectItem>
                        {FIELD_GROUPS.map(group => (
                          <React.Fragment key={group.label}>
                            <div className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/85">
                              {group.label}
                            </div>
                            {group.fields.map(f => (
                              <SelectItem key={f.value} value={f.value} className="text-[13px]">
                                {f.label}
                              </SelectItem>
                            ))}
                          </React.Fragment>
                        ))}
                      </SelectContent>
                    </Select>
                  </li>
                );
              })}
            </ul>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12.5px] text-muted-foreground">
              {Object.keys(mapping).length} of {analysis.columns.length} columns will be imported
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={restart} className="gap-1.5">
                <ArrowLeft className="size-4" /> Choose another file
              </Button>
              <Button onClick={preview} disabled={busy} className="gap-1.5">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
                Check it
              </Button>
            </div>
          </div>
        </>
      )}

      {/* ═══ Review ═════════════════════════════════════════════════════════ */}
      {step === 'review' && plan && analysis && (
        <>
          <div className="grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-e1 sm:grid-cols-4 sm:divide-y-0">
            <Count label="Rows read" value={plan.summary.total} />
            {/* Named, so it reads as the promise the receipt then keeps. */}
            <Count
              label={target === 'leads' ? 'Leads to add' : 'Contacts to add'}
              value={live.create}
              tone="good"
            />
            <Count label="Will be updated" value={live.update} />
            <Count
              label="Skipped"
              value={live.skip}
              tone={live.skip > 0 ? 'warn' : 'default'}
            />
          </div>

          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/*
                Only the facts that are true of this file.

                "0 joining a customer you have" is not information, it is a
                slot with nothing in it - and four of them in a row taught the
                reader to skip the line that carries the one number that
                matters.
              */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12.5px] text-muted-foreground">
                {plan.summary.companiesCreated > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="size-3.5" />
                    {plan.summary.companiesCreated} new {plan.summary.companiesCreated === 1 ? 'company' : 'companies'}
                  </span>
                )}
                {plan.summary.linked > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="size-3.5" />
                    {plan.summary.linked} joining a customer you have
                  </span>
                )}
                {plan.summary.duplicates > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <Copy className="size-3.5" />
                    {plan.summary.duplicates} already in the CRM
                  </span>
                )}
                {plan.summary.needsAttention > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-warning">
                    <AlertTriangle className="size-3.5" />
                    {plan.summary.needsAttention} {plan.summary.needsAttention === 1 ? 'needs' : 'need'} attention
                  </span>
                )}
                {plan.summary.companiesCreated + plan.summary.linked
                  + plan.summary.duplicates + plan.summary.needsAttention === 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5 text-success" />
                    Nothing here needs a decision
                  </span>
                )}
              </div>

              <FilterRow
                ariaLabel="Which rows to show"
                value={filter}
                onChange={v => setFilter(v as typeof filter)}
                options={[
                  { value: 'all', label: 'All', count: plan.rows.length },
                  { value: 'duplicates', label: 'Duplicates', count: plan.summary.duplicates },
                  { value: 'problems', label: 'Attention', count: plan.summary.needsAttention },
                ]}
              />
            </div>

            {!plan.summary.exhaustive && (
              <p className="mt-3 flex items-start gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-[12px] text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  More records here than the duplicate check loads at once. Compared against the
                  first 5,000, so a duplicate beyond that may be missed.
                </span>
              </p>
            )}
          </Card>

          <Card className="overflow-hidden">
            <ul className="divide-y divide-border">
              {visibleRows.length === 0 ? (
                <li>
                  <Blank
                    icon={CheckCircle2}
                    title={filter === 'duplicates' ? 'No duplicates' : 'Nothing needs attention'}
                    body={
                      filter === 'duplicates'
                        ? 'Nothing in this file matches a record you already have.'
                        : 'Every row has what it needs.'
                    }
                  />
                </li>
              ) : visibleRows.slice(0, 200).map(p => {
                const action = actionOf(p);
                const blocked = p.candidate.problems.some(x => x.severity === 'error');
                const person = p.candidate.person;
                const company = p.candidate.company;

                return (
                  <li key={p.row} className="grid grid-cols-1 gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_230px] lg:items-center">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
                          {p.row + 2}
                        </span>
                        <span className="truncate">
                          {person
                            ? `${person.firstName} ${person.lastName}`.trim() || person.email || 'Unnamed'
                            : company?.name ?? 'Empty row'}
                        </span>
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 truncate text-[11.5px] text-muted-foreground">
                        {company?.name && (
                          <span className="inline-flex items-center gap-1">
                            <Building2 className="size-3" />{company.name}
                          </span>
                        )}
                        {person?.email && (
                          <span className="truncate">{person.email}</span>
                        )}
                        {person?.estimatedValue ? (
                          <span className="tabular-nums">{exact(person.estimatedValue)}</span>
                        ) : null}
                      </p>
                    </div>

                    <div className="min-w-0">
                      {p.candidate.problems.length > 0 ? (
                        <ul className="flex flex-col gap-0.5">
                          {p.candidate.problems.map((x, i) => (
                            <li
                              key={i}
                              className={cn(
                                'flex items-start gap-1.5 text-[11.5px]',
                                x.severity === 'error' ? 'text-destructive' : 'text-warning',
                              )}
                            >
                              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                              <span>{x.message}</span>
                            </li>
                          ))}
                        </ul>
                      ) : p.personMatch ? (
                        <p className="flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
                          <Copy className="mt-0.5 size-3 shrink-0" />
                          <span>{p.note}</span>
                        </p>
                      ) : (
                        <p className="text-[11.5px] text-muted-foreground">{p.note}</p>
                      )}
                    </div>

                    <div className="flex items-center justify-start lg:justify-end">
                      {blocked ? (
                        <span className="text-[12px] text-muted-foreground">Nothing to import</span>
                      ) : (
                        <FilterRow
                          ariaLabel={`What to do with row ${p.row + 2}`}
                          value={action}
                          onChange={v => decide(p.row, v as 'create' | 'update' | 'skip')}
                          /*
                            Update is offered only where there is something to
                            update *this row against*. A company match is not
                            one: the person on the row is new and will be
                            attached to that company either way, so an Update
                            button there promised a merge that would not happen.
                          */
                          options={[
                            { value: 'create', label: 'Create' },
                            ...((p.candidate.person ? p.personMatch : p.companyMatch)
                              ? [{ value: 'update', label: 'Update' }]
                              : []),
                            { value: 'skip', label: 'Skip' },
                          ]}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {visibleRows.length > 200 && (
              <p className="border-t border-border px-4 py-2.5 text-center text-[12px] text-muted-foreground">
                Showing the first 200 of {visibleRows.length}. All of them will be
                imported.
              </p>
            )}
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12.5px] text-muted-foreground">
              {live.create + live.update} {live.create + live.update === 1 ? 'record' : 'records'} will be written.
              {live.skip > 0 && ` ${live.skip} skipped.`}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setStep('map')} className="gap-1.5">
                <ArrowLeft className="size-4" /> Back to mapping
              </Button>
              <Button onClick={run} disabled={busy || live.create + live.update === 0} className="gap-1.5">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Import {live.create + live.update}
              </Button>
            </div>
          </div>
        </>
      )}

      {/* ═══ Done ═══════════════════════════════════════════════════════════ */}
      {step === 'done' && result && (
        <>
          <Card className="p-6">
            <div className="flex flex-col items-center text-center">
              <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-success/12 text-success">
                <CheckCircle2 className="size-5" />
              </span>
              <h3 className="text-[16px] font-semibold">Imported</h3>
              {/*
                The same count the review screen promised, which means people
                and not people plus the companies they were attached to. The
                headline said "5 records created" where the review had said 3,
                and a receipt that disagrees with the estimate is worse than no
                receipt. Companies get their own sentence, because creating one
                is a real thing to know about and not a line item.
              */}
              <p className="mt-1 max-w-md text-[12.5px] leading-relaxed text-muted-foreground">
                {result.peopleCreated} {target === 'leads'
                  ? (result.peopleCreated === 1 ? 'lead' : 'leads')
                  : (result.peopleCreated === 1 ? 'contact' : 'contacts')} created,
                {' '}{result.peopleUpdated + result.companiesUpdated} updated,
                {' '}{result.skipped} skipped.
                {result.companiesCreated > 0 && (
                  <>
                    {' '}{result.companiesCreated === 1
                      ? 'One company was created to link them to.'
                      : `${result.companiesCreated} companies were created to link them to.`}
                  </>
                )}
              </p>
            </div>

            <div className="mt-5 grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-lg border border-border sm:grid-cols-4 sm:divide-y-0">
              <Count label={target === 'leads' ? 'Leads added' : 'Contacts added'} value={result.peopleCreated} tone="good" />
              <Count label="Companies added" value={result.companiesCreated} tone="good" />
              <Count label="Records updated" value={result.peopleUpdated + result.companiesUpdated} />
              <Count label="Skipped" value={result.skipped} />
            </div>

            {result.failed.length > 0 && (
              <div className="mt-4 rounded-md border border-destructive/25 bg-destructive/[0.04] p-3">
                <p className="text-[12.5px] font-medium text-foreground">
                  {result.failed.length} {result.failed.length === 1 ? 'row' : 'rows'} could not be saved
                </p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {result.failed.slice(0, 8).map((f, i) => (
                    <li key={i} className="text-[11.5px] text-muted-foreground">
                      Row {f.row}: {f.message}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11.5px] text-muted-foreground">
                  Everything else went in. Fix these rows in the spreadsheet and import
                  them separately.
                </p>
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => onGo(target === 'leads' ? 'leads' : 'contacts')}
              >
                {target === 'leads' ? <Target className="size-4" /> : <User className="size-4" />}
                Open {target === 'leads' ? 'Leads' : 'Contacts'}
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={restart}>
                <Upload className="size-4" /> Import another file
              </Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Pieces                                                                    */
/* -------------------------------------------------------------------------- */

function Steps({ step }: { step: Step }) {
  const order: { id: Step; label: string }[] = [
    { id: 'upload', label: 'Upload' },
    { id: 'map', label: 'Map' },
    { id: 'review', label: 'Review' },
    { id: 'done', label: 'Import' },
  ];
  const at = order.findIndex(s => s.id === step);

  return (
    <ol className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {order.map((s, i) => {
        const done = i < at;
        const here = i === at;
        return (
          <li key={s.id} className="flex shrink-0 items-center gap-1.5">
            <span className={cn(
              'flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium',
              here ? 'bg-foreground text-background'
                : done ? 'text-foreground' : 'text-muted-foreground/70',
            )}>
              <span className={cn(
                'flex size-[15px] items-center justify-center rounded-full text-[9.5px] tabular-nums',
                here ? 'bg-background/20' : done ? 'bg-success/15 text-success' : 'bg-muted',
              )}>
                {done ? <Check className="size-2.5" /> : i + 1}
              </span>
              {s.label}
            </span>
            {i < order.length - 1 && (
              <span aria-hidden="true" className="h-px w-4 bg-border sm:w-6" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Count({
  label, value, tone = 'default',
}: {
  label: string; value: number; tone?: 'default' | 'good' | 'warn';
}) {
  return (
    <div className="px-4 py-3.5">
      <p className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground/85">
        {label}
      </p>
      <p className={cn(
        'mt-1.5 text-[21px] font-semibold leading-none tabular-nums tracking-[-0.02em]',
        tone === 'good' ? 'text-success' : tone === 'warn' ? 'text-warning' : 'text-foreground',
      )}>
        {value}
      </p>
    </div>
  );
}

function Explain({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10.5px] font-semibold tabular-nums text-muted-foreground">
        {n}
      </span>
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}
