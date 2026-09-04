'use client';

import * as React from 'react';
import {
  Users, CheckSquare, FolderKanban, ClipboardCheck, MessageSquarePlus,
  LifeBuoy, CalendarDays, ListChecks, ChevronDown, Loader2,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';

import { getOne } from './data';
import { Blank } from './ui';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  What somebody is still carrying
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * Offboarding recorded the exit, started a checklist and correctly refused to
 * close the account. What none of it said was what the person was in the
 * middle of — so eleven tasks stayed assigned to a former employee, three
 * people woke up reporting to nobody, and two reviews they were the named
 * reviewer for could never be shared.
 *
 * Every one of those facts already existed in a module that knew it. Nothing
 * asked them all at once.
 *
 * ── Why nothing here has a "reassign" button ─────────────────────────────
 *
 * Handing somebody's work on is a decision with a name attached, made by
 * somebody who knows what the work is. A single control that redistributed it
 * would make that decision on a person's last day, in bulk, when nobody is
 * looking closely — and it would be the control everybody clicked. This lists
 * and links; a person decides.
 *
 * ── Where it appears ─────────────────────────────────────────────────────
 *
 * In the exit dialog, before the exit is recorded, because that is the moment
 * the question is actually live. It is keyed on a person rather than an exit,
 * so the same panel answers "what is this person carrying" for a transfer, a
 * long absence, or a manager who simply wants to know.
 */

interface Group {
  key: string;
  label: string;
  count: number;
  why: string;
  module: string;
  items: { id: string; title: string; detail: string | null }[];
}

interface Handover {
  member: { id: string; name: string; jobTitle: string | null; department: string | null };
  outstanding: number;
  groups: Group[];
  note: string;
}

const ICON: Record<string, React.ElementType> = {
  reports: Users,
  tasks: CheckSquare,
  projects: FolderKanban,
  reviewing: ClipboardCheck,
  feedback: MessageSquarePlus,
  cases: LifeBuoy,
  leave: CalendarDays,
  checklists: ListChecks,
};

/**
 * Which groups can be opened to a record, and where.
 *
 * Only the two whose target modules understand a focus request for that record
 * type. A row that looks clickable and does nothing is worse than one that
 * plainly is not — the same rule the performance timeline follows.
 */
const OPENS: Record<string, { module: string; type: string }> = {
  tasks: { module: 'projects', type: 'task' },
  projects: { module: 'projects', type: 'project' },
};

export function HandoverPanel({
  memberId,
  className,
}: {
  memberId: string;
  className?: string;
}) {
  const [data, setData] = React.useState<Handover | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [failed, setFailed] = React.useState(false);
  const [open, setOpen] = React.useState<string | null>(null);
  const openRecord = useAppStore(s => s.openRecord);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    setFailed(false);
    getOne<Handover>(`/api/hr/people/${memberId}/handover`)
      .then(d => { if (live) setData(d); })
      .catch(() => { if (live) setFailed(true); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [memberId]);

  if (loading) {
    return (
      <p className={cn('flex items-center gap-2 py-4 text-[12.5px] text-muted-foreground', className)}>
        <Loader2 className="size-3.5 animate-spin" /> Checking what they are carrying
      </p>
    );
  }

  /**
   * A failure is silence, not an error banner.
   *
   * This panel is advisory and sits inside a dialog whose actual job is to
   * record an exit. A red box about a secondary read would make somebody
   * abandon a form that would have worked perfectly well.
   */
  if (failed || !data) return null;

  const groups = data.groups.filter(g => g.count > 0);

  if (groups.length === 0) {
    return (
      <div className={cn('rounded-xl border border-border', className)}>
        <Blank
          title="Nothing outstanding"
          note="No open tasks, direct reports, reviews or cases are attached to them. Nothing has to be handed over."
        />
      </div>
    );
  }

  return (
    <div className={cn('rounded-xl border border-border bg-card', className)}>
      <div className="border-b border-border px-4 py-3">
        <p className="text-[13px] font-medium text-foreground">
          Still attached to {data.member.name}
        </p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
          {data.outstanding} thing{data.outstanding === 1 ? '' : 's'} across {groups.length}{' '}
          {groups.length === 1 ? 'area' : 'areas'}. {data.note}
        </p>
      </div>

      <ul className="divide-y divide-border">
        {groups.map(g => {
          const Icon = ICON[g.key] ?? CheckSquare;
          const expanded = open === g.key;
          const target = OPENS[g.key];

          return (
            <li key={g.key}>
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : g.key)}
                aria-expanded={expanded}
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent"
              >
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Icon className="size-[14px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-foreground">
                    {g.count} {g.label.toLowerCase()}
                  </span>
                  <span className="block text-[11.5px] leading-relaxed text-muted-foreground">
                    {g.why}
                  </span>
                </span>
                <ChevronDown
                  className={cn(
                    'mt-1 size-4 shrink-0 text-muted-foreground transition-transform',
                    expanded && 'rotate-180',
                  )}
                />
              </button>

              {expanded && (
                <ul className="border-t border-border bg-muted/30 px-4 py-2">
                  {g.items.map(item => (
                    <li key={item.id} className="py-1">
                      {target ? (
                        <button
                          type="button"
                          onClick={() => openRecord(target.module as never, target.type, item.id)}
                          className="w-full truncate text-left text-[12.5px] text-foreground underline-offset-2 hover:underline"
                        >
                          {item.title}
                          {item.detail && (
                            <span className="ml-1.5 text-muted-foreground">· {item.detail}</span>
                          )}
                        </button>
                      ) : (
                        <p className="truncate text-[12.5px] text-foreground">
                          {item.title}
                          {item.detail && (
                            <span className="ml-1.5 text-muted-foreground">· {item.detail}</span>
                          )}
                        </p>
                      )}
                    </li>
                  ))}
                  {g.count > g.items.length && (
                    <li className="py-1 text-[11.5px] text-muted-foreground">
                      and {g.count - g.items.length} more
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
