'use client';

import * as React from 'react';
import { ChevronRight, Network, Users2 } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Card, Head, Stat, Meter } from '@/components/shared/readout/primitives';
import { Button } from '@/components/ui/button';
import { PersonAvatar } from '@/components/shared/person-avatar';

import { getOne } from './data';
import { PersonCell, StagePill, Blank, Skeleton, Pill } from './ui';
import type { OrgChart, Person } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Organisation
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The shape of the company, drawn from records it already has:
 * `departments.parent_id` for the department hierarchy,
 * `organization_members.manager_id` for who reports to whom, and `teams` for
 * the cross-department grouping that is deliberately neither.
 *
 * ── The chart is a tree of real people ───────────────────────────────────
 *
 * Not a picture. Every node is a person the caller may see, and clicking one
 * opens their profile - so the chart is a way *into* the directory rather than
 * an illustration beside it. Nobody is invented to fill a level: a company
 * with a flat structure gets a flat chart, which is the truth.
 *
 * ── What an employee sees ────────────────────────────────────────────────
 *
 * Themselves, because `auth_visible_member_ids()` decides which rows come
 * back. That is honest rather than empty, and the screen says whose chart it
 * is instead of drawing one box and calling it the organisation.
 *
 * ── Why the tree is built here ───────────────────────────────────────────
 *
 * A recursive CTE would return the same people with a depth column and the
 * screen would still have to assemble the nodes. Building it from the flat
 * list means the chart can be re-rooted - "show me Engineering from Ada down"
 * - without asking the server again.
 */

interface Node { person: Person; reports: Node[]; depth: number }

function buildTree(people: Person[]): { roots: Node[]; orphaned: number } {
  const byId = new Map(people.map(p => [p.memberId, p]));
  const children = new Map<string, Person[]>();
  const roots: Person[] = [];

  for (const p of people) {
    /* Somebody whose manager is outside the visible set is a root here, not a
       missing node: a manager can see their department without seeing the
       person their own head reports to. */
    if (p.managerId && byId.has(p.managerId)) {
      const list = children.get(p.managerId);
      if (list) list.push(p); else children.set(p.managerId, [p]);
    } else {
      roots.push(p);
    }
  }

  const seen = new Set<string>();
  const build = (person: Person, depth: number): Node => {
    seen.add(person.memberId);
    return {
      person,
      depth,
      /* `apply_employment_change()` refuses a cycle in the reporting line, so
         this cannot loop - but the guard costs nothing and a cycle introduced
         by any other path would hang the browser rather than the database. */
      reports: (children.get(person.memberId) ?? [])
        .filter(c => !seen.has(c.memberId))
        .sort((a, b) => a.fullName.localeCompare(b.fullName))
        .map(c => build(c, depth + 1)),
    };
  };

  const tree = roots
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
    .map(p => build(p, 0));

  return { roots: tree, orphaned: people.length - seen.size };
}

export function Organisation({
  onOpenPerson,
}: {
  onOpenPerson: (memberId: string) => void;
}) {
  const [data, setData] = React.useState<OrgChart | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [view, setView] = React.useState<'chart' | 'departments' | 'teams'>('chart');
  const [rootId, setRootId] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    getOne<OrgChart>('/api/hr/org')
      .then(setData)
      .catch((e: any) => toast.error(e.message || 'Could not load the organisation'))
      .finally(() => setLoading(false));
  }, []);

  const tree = React.useMemo(() => {
    if (!data) return { roots: [], orphaned: 0 };
    const scoped = rootId
      ? data.people.filter(p => descendsFrom(p, rootId, data.people))
      : data.people;
    return buildTree(scoped);
  }, [data, rootId]);

  if (loading) {
    return <Card><Skeleton rows={6} /></Card>;
  }

  if (!data || data.people.length === 0) {
    return (
      <Card>
        <Blank
          title="Nothing to chart yet"
          note="The organisation chart is drawn from real departments and real reporting lines. Assign a manager to somebody and they appear here."
        />
      </Card>
    );
  }

  const root = rootId ? data.people.find(p => p.memberId === rootId) : null;
  const withoutManager = data.people.filter(p => !p.managerId).length;

  return (
    <div className="nm-enter space-y-4">
      <div className="grid grid-cols-2 divide-x divide-y divide-border rounded-xl border border-border bg-card sm:grid-cols-4 sm:divide-y-0">
        <Stat label="People" value={data.people.length} />
        <Stat label="Departments" value={data.departments.length} />
        <Stat
          label="No department"
          value={data.unassignedCount}
          tone={data.unassignedCount ? 'warning' : 'default'}
        />
        <Stat
          label="No manager"
          value={withoutManager}
          tone={withoutManager > 1 ? 'warning' : 'default'}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {([
          ['chart', 'Reporting line', Network],
          ['departments', 'Departments', Users2],
          ['teams', 'Teams', Users2],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            aria-pressed={view === id}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
              view === id
                ? 'border-foreground/20 bg-accent text-foreground'
                : 'border-border bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}

        {root ? (
          <Button
            size="sm" variant="ghost" className="ml-auto h-7 text-[12px]"
            onClick={() => setRootId(null)}
          >
            Show the whole organisation
          </Button>
        ) : null}
      </div>

      {view === 'chart' ? (
        <Card>
          <div className="px-4 pt-3.5">
            <Head
              title={root ? `${root.fullName} and their team` : 'Reporting line'}
              count={tree.roots.length > 1 ? `${tree.roots.length} at the top` : undefined}
              note={tree.orphaned ? `${tree.orphaned} not shown` : undefined}
            />
          </div>
          <div className="overflow-x-auto px-2 py-3">
            <ul className="min-w-[320px]">
              {tree.roots.map(node => (
                <TreeNode
                  key={node.person.memberId}
                  node={node}
                  collapsed={collapsed}
                  onToggle={id => setCollapsed(prev => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id); else next.add(id);
                    return next;
                  })}
                  onOpen={onOpenPerson}
                  onFocus={setRootId}
                />
              ))}
            </ul>
          </div>
        </Card>
      ) : null}

      {view === 'departments' ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.departments.map(d => {
            const members = data.people.filter(p => p.departmentId === d.id);
            return (
              <Card key={d.id}>
                <div className="px-4 pt-3.5">
                  <Head title={d.name} count={d.memberCount} />
                  {d.headName ? (
                    <p className="mt-1 text-[11.5px] text-muted-foreground">
                      Led by {d.headName}
                    </p>
                  ) : (
                    <p className="mt-1 text-[11.5px] text-muted-foreground">No department head</p>
                  )}
                </div>
                {members.length ? (
                  <ul className="mt-2 divide-y divide-border">
                    {members.slice(0, 6).map(m => (
                      <li key={m.memberId} className="flex items-center justify-between gap-3 px-4 py-2">
                        <PersonCell
                          id={m.memberId} name={m.fullName} avatarUrl={m.avatarUrl}
                          secondary={m.jobTitle}
                          onClick={() => onOpenPerson(m.memberId)}
                        />
                        <StagePill stage={m.lifecycleStage} />
                      </li>
                    ))}
                    {members.length > 6 ? (
                      <li className="px-4 py-2 text-[11.5px] text-muted-foreground">
                        and {members.length - 6} more
                      </li>
                    ) : null}
                  </ul>
                ) : (
                  <Blank title="Nobody assigned" />
                )}
              </Card>
            );
          })}

          {data.unassignedCount ? (
            <Card>
              <div className="px-4 pt-3.5">
                <Head title="No department" count={data.unassignedCount} />
              </div>
              <ul className="mt-2 divide-y divide-border">
                {data.people.filter(p => !p.departmentId).slice(0, 6).map(m => (
                  <li key={m.memberId} className="flex items-center justify-between gap-3 px-4 py-2">
                    <PersonCell
                      id={m.memberId} name={m.fullName} avatarUrl={m.avatarUrl}
                      secondary={m.jobTitle}
                      onClick={() => onOpenPerson(m.memberId)}
                    />
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      ) : null}

      {view === 'teams' ? (
        data.teams.length ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {data.teams.map(t => {
              const memberIds = new Set(t.members.map(m => m.memberId));
              const members = data.people.filter(p => memberIds.has(p.memberId));
              return (
                <Card key={t.id}>
                  <div className="px-4 pt-3.5">
                    <Head title={t.name} count={t.members.length} />
                    {t.description ? (
                      <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                        {t.description}
                      </p>
                    ) : null}
                  </div>
                  {members.length ? (
                    <ul className="mt-2 divide-y divide-border">
                      {members.slice(0, 6).map(m => (
                        <li key={m.memberId} className="px-4 py-2">
                          <PersonCell
                            id={m.memberId} name={m.fullName} avatarUrl={m.avatarUrl}
                            secondary={m.jobTitle}
                            onClick={() => onOpenPerson(m.memberId)}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Blank title="No members you can see" />
                  )}
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <Blank
              title="No teams"
              note="A department is where somebody reports; a team is what they work on. Teams are created in Admin, and a person can be in several."
            />
          </Card>
        )
      ) : null}
    </div>
  );
}

/** Whether `p` is `rootId` or reports to them, at any depth. */
function descendsFrom(p: Person, rootId: string, all: Person[]): boolean {
  if (p.memberId === rootId) return true;
  const byId = new Map(all.map(x => [x.memberId, x]));
  let hop = p.managerId;
  let guard = 0;
  while (hop && guard < 64) {
    if (hop === rootId) return true;
    hop = byId.get(hop)?.managerId ?? null;
    guard++;
  }
  return false;
}

function TreeNode({
  node,
  collapsed,
  onToggle,
  onOpen,
  onFocus,
}: {
  node: Node;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onFocus: (id: string) => void;
}) {
  const hasReports = node.reports.length > 0;
  const isCollapsed = collapsed.has(node.person.memberId);

  return (
    <li>
      <div
        className="group flex items-center gap-2 rounded-md py-1 pr-2 transition-colors hover:bg-accent/40"
        style={{ paddingLeft: node.depth * 22 + 4 }}
      >
        {hasReports ? (
          <button
            type="button"
            onClick={() => onToggle(node.person.memberId)}
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? 'Show reports' : 'Hide reports'}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronRight className={cn('size-3.5 transition-transform', !isCollapsed && 'rotate-90')} />
          </button>
        ) : (
          <span className="size-5 shrink-0" aria-hidden="true" />
        )}

        <button
          type="button"
          onClick={() => onOpen(node.person.memberId)}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <PersonAvatar
            id={node.person.memberId}
            name={node.person.fullName}
            src={node.person.avatarUrl}
            size="xs"
            decorative
          />
          <span className="min-w-0">
            <span className="block truncate text-[12.5px] font-medium text-foreground">
              {node.person.fullName}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {[node.person.jobTitle, node.person.departmentName].filter(Boolean).join(' · ') || '—'}
            </span>
          </span>
        </button>

        {hasReports ? (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {node.reports.length}
          </span>
        ) : null}

        {hasReports ? (
          <button
            type="button"
            onClick={() => onFocus(node.person.memberId)}
            className="shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          >
            Focus
          </button>
        ) : null}
      </div>

      {hasReports && !isCollapsed ? (
        <ul>
          {node.reports.map(child => (
            <TreeNode
              key={child.person.memberId}
              node={child}
              collapsed={collapsed}
              onToggle={onToggle}
              onOpen={onOpen}
              onFocus={onFocus}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
