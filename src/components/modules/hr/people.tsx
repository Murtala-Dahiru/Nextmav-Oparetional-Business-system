'use client';

import * as React from 'react';
import { Search, SlidersHorizontal, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Card, Head, THead, TRow, Stat } from '@/components/shared/readout/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useModuleRealtime } from '@/hooks/use-realtime';
import {
  MEMBER_STAGES, STAGE_LABELS, EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS,
  labelOf, tenureLabel,
} from '@/lib/hr';
import { roleLabel, normalizeRole } from '@/lib/permissions';

import { getList, getOne, whenWord } from './data';
import { PersonCell, StagePill, Blank, Skeleton, Pill, day } from './ui';
import type { Person, OrgDepartment } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  People - the directory
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this replaces ───────────────────────────────────────────────────
 *
 * A `DataTable` of `/api/admin/users` with nine columns - name, email, phone,
 * job title, department, role, status, presence, actions - and a filter bar
 * whose Department options were a **hard-coded array of eight strings**
 * ('Engineering', 'Sales', 'HR', …) that matched nothing in any organisation
 * that had not happened to name its departments the same way. Filtering by
 * department returned an empty table for every tenant but one.
 *
 * ── The two decisions ────────────────────────────────────────────────────
 *
 * **Rows, not cards.** A directory is a list somebody scans, and forty people
 * as forty bordered cards is four screens of scrolling for what fits in one.
 * The row carries the face, the name, the title, the department, the stage and
 * the tenure, and nothing else - phone and email are on the profile, one click
 * away, and were only ever columns because the table had room.
 *
 * **The filters come from the data.** Departments are fetched from
 * `/api/hr/org`, so the list offers what this organisation actually has. A
 * filter that offers a value the data cannot contain is worse than no filter,
 * because the empty result reads as "nobody works in Engineering".
 */

const PAGE = 25;

export function PeopleDirectory({
  onOpenPerson,
  canManage,
  onAddPerson,
}: {
  onOpenPerson: (memberId: string) => void;
  canManage: boolean;
  onAddPerson?: () => void;
}) {
  const [people, setPeople] = React.useState<Person[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [department, setDepartment] = React.useState('all');
  const [stage, setStage] = React.useState('all');
  const [type, setType] = React.useState('all');
  const [showFilters, setShowFilters] = React.useState(false);

  const [departments, setDepartments] = React.useState<OrgDepartment[]>([]);

  /* 250ms, which is about the gap between two keystrokes and short enough that
     the list never feels like it is lagging the field. */
  React.useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(0); }, 250);
    return () => clearTimeout(t);
  }, [search]);

  /**
   * The department filter's options, from this organisation's own records.
   *
   * `/api/hr/org` answers with departments, people and teams; only the first
   * is needed here and it is one request either way. A filter offering values
   * the data cannot contain is worse than no filter - the empty result reads
   * as "nobody works in Engineering" rather than "we have no such department".
   */
  React.useEffect(() => {
    getOne<{ departments: OrgDepartment[] }>('/api/hr/org')
      .then(d => setDepartments(d.departments ?? []))
      .catch(() => setDepartments([]));
  }, []);

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page + 1),
        pageSize: String(PAGE),
      });
      if (debounced) params.set('search', debounced);
      if (department !== 'all') params.set('department_id', department);
      if (stage !== 'all') params.set('lifecycle_stage', stage);
      if (type !== 'all') params.set('employment_type', type);
      /* Former colleagues are asked for by name rather than mixed in: a
         directory that opens on everybody who has ever worked here is
         answering a question nobody arrived with. */
      if (stage === 'former') params.set('include', 'former');

      const res = await getList<Person>(`/api/hr/people?${params}`);
      setPeople(res.data);
      setTotal(res.meta?.total ?? res.data.length);
    } catch (e: any) {
      if (!silent) toast.error(e.message || 'Could not load the directory');
    } finally {
      setLoading(false);
    }
  }, [page, debounced, department, stage, type]);

  React.useEffect(() => { load(); }, [load]);

  useModuleRealtime('hr-people', ['organization_members', 'employment_events'], () => load(true));

  const filtered = department !== 'all' || stage !== 'all' || type !== 'all';
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const counts = React.useMemo(() => ({
    onboarding: people.filter(p => p.lifecycleStage === 'onboarding').length,
    leaving: people.filter(p => ['notice_period', 'offboarding'].includes(p.lifecycleStage)).length,
    probation: people.filter(p => p.probationEndsOn).length,
  }), [people]);

  return (
    <div className="nm-enter space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search people by name, email, title or department"
            className="h-9 pl-8 text-[13px]"
            aria-label="Search people"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

        <Button
          size="sm"
          variant={showFilters || filtered ? 'secondary' : 'outline'}
          className="h-9 text-[13px]"
          onClick={() => setShowFilters(v => !v)}
          aria-expanded={showFilters}
        >
          <SlidersHorizontal className="mr-1.5 size-3.5" />
          Filters
          {filtered ? (
            <span className="ml-1.5 rounded bg-foreground/10 px-1 text-[10.5px] tabular-nums">
              {[department, stage, type].filter(v => v !== 'all').length}
            </span>
          ) : null}
        </Button>

        {canManage && onAddPerson ? (
          <Button size="sm" className="h-9 text-[13px]" onClick={onAddPerson}>
            <UserPlus className="mr-1.5 size-3.5" />
            Add person
          </Button>
        ) : null}
      </div>

      {showFilters ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2.5">
          <Select value={department} onValueChange={v => { setDepartment(v); setPage(0); }}>
            <SelectTrigger className="h-8 w-[190px] text-[12.5px]">
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {/* Real departments, from this organisation. The list this
                  replaces was eight hard-coded names. */}
              {departments.map(d => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name} ({d.memberCount})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={stage} onValueChange={v => { setStage(v); setPage(0); }}>
            <SelectTrigger className="h-8 w-[170px] text-[12.5px]">
              <SelectValue placeholder="Stage" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everybody here now</SelectItem>
              {MEMBER_STAGES.map(s => (
                <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={type} onValueChange={v => { setType(v); setPage(0); }}>
            <SelectTrigger className="h-8 w-[160px] text-[12.5px]">
              <SelectValue placeholder="Employment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any employment type</SelectItem>
              {EMPLOYMENT_TYPES.map(t => (
                <SelectItem key={t} value={t}>{EMPLOYMENT_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {filtered ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-[12.5px]"
              onClick={() => { setDepartment('all'); setStage('all'); setType('all'); setPage(0); }}
            >
              Clear
            </Button>
          ) : null}
        </div>
      ) : null}

      {!loading && people.length > 0 && !debounced && !filtered ? (
        <div className="grid grid-cols-3 divide-x divide-border rounded-xl border border-border bg-card">
          <Stat label="People" value={total} />
          <Stat label="Onboarding" value={counts.onboarding} />
          <Stat
            label="Serving notice"
            value={counts.leaving}
            tone={counts.leaving ? 'warning' : 'default'}
          />
        </div>
      ) : null}

      <Card>
        <div className="flex items-center justify-between px-4 pt-3.5">
          <Head
            title={stage === 'former' ? 'Former employees' : 'Directory'}
            count={total}
            note={debounced ? `matching “${debounced}”` : undefined}
          />
        </div>

        {loading ? (
          <Skeleton rows={6} className="mt-2" />
        ) : people.length === 0 ? (
          <Blank
            title={debounced || filtered ? 'Nobody matches' : 'No people yet'}
            note={
              debounced || filtered
                ? 'Try a different search, or clear the filters.'
                : 'People appear here once they are invited or provisioned. Hiring a candidate creates one too.'
            }
            action={
              debounced || filtered ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setSearch(''); setDepartment('all'); setStage('all'); setType('all'); }}
                >
                  Clear everything
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="mt-2.5 px-2 pb-2">
            {/*
              One grid template, shared by the head and every row, so the
              columns form a straight edge. Three of the five collapse below
              `lg`: a phone shows the person and their stage, which is the pair
              somebody is actually scanning for on a phone.
            */}
            <THead columns="grid-cols-[minmax(0,2fr)_auto] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
              <span>Person</span>
              <span className="hidden lg:block">Department</span>
              <span className="hidden lg:block">Role</span>
              <span className="hidden lg:block">Tenure</span>
              <span className="text-right">Stage</span>
            </THead>

            {people.map(p => (
              <TRow
                key={p.memberId}
                columns="grid-cols-[minmax(0,2fr)_auto] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto]"
                onClick={() => onOpenPerson(p.memberId)}
                ariaLabel={`Open ${p.fullName}`}
              >
                <PersonCell
                  id={p.memberId}
                  name={p.fullName}
                  avatarUrl={p.avatarUrl}
                  secondary={p.jobTitle ?? p.email}
                />
                <span className="hidden truncate text-[12.5px] text-muted-foreground lg:block">
                  {p.departmentName ?? '—'}
                </span>
                <span className="hidden truncate text-[12.5px] text-muted-foreground lg:block">
                  {roleLabel(normalizeRole(p.role))}
                </span>
                <span className="hidden whitespace-nowrap text-[12.5px] tabular-nums text-muted-foreground lg:block">
                  {tenureLabel(p.tenureMonths)}
                </span>
                <span className="flex justify-end">
                  <StagePill stage={p.lifecycleStage} />
                </span>
              </TRow>
            ))}
          </div>
        )}

        {pages > 1 ? (
          <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
            <p className="text-[12px] tabular-nums text-muted-foreground">
              {page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} of {total}
            </p>
            <div className="flex gap-1.5">
              <Button
                size="sm" variant="outline" className="h-7 text-[12px]"
                disabled={page === 0} onClick={() => setPage(p => p - 1)}
              >
                Previous
              </Button>
              <Button
                size="sm" variant="outline" className="h-7 text-[12px]"
                disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
