'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  Search, MessageSquare, Video, Mail, X, Building2, Loader2, Users,
  ChevronRight, AtSign,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PersonAvatar } from '@/components/shared/person-avatar';
import { PresenceLabel } from '@/components/shared/presence-dot';
import { type PresenceRow } from '@/hooks/use-presence';
import { cn } from '@/lib/utils';

import { type DirectoryMember } from './types';

/**
 * ===========================================================================
 *  People
 * ===========================================================================
 *
 *  -- What this is, and what it is not --------------------------------------
 *
 *  Not a picker. A picker answers "who am I sending this to" and closes; this
 *  answers "who works here, what do they do, and are they about" - which is a
 *  question new joiners ask constantly and which this product could not answer
 *  anywhere. `/api/directory` has returned names, job titles, departments,
 *  avatars and presence to every people picker in the application for months;
 *  nothing had ever laid them out as a directory.
 *
 *  -- Why it is in Communication -------------------------------------------
 *
 *  Because every useful thing you can do from a person's name is a
 *  communication act: message them, meet them, see whether they are free. An
 *  HR directory is a different screen with a different purpose (employment,
 *  reporting lines, records) and it already exists behind the HR grant. This
 *  one deliberately carries none of that: name, role, department, presence,
 *  email. Nothing here is privileged, which is exactly why it can be open to
 *  everybody who has Communication.
 *
 *  -- Grouped by department, by default -------------------------------------
 *
 *  A flat list of two hundred names is a list nobody reads. Departments are
 *  the shape a company already has, they come free on the directory row, and
 *  they make the list scannable at the size a real organisation reaches.
 */

export function People({
  directory, presence, inCall, currentMemberId, loading,
  onMessage, onMeet,
}: {
  directory: DirectoryMember[];
  presence: Record<string, PresenceRow>;
  /** Membership ids joined to a live meeting right now. */
  inCall: string[];
  currentMemberId: string | null;
  loading: boolean;
  onMessage: (memberId: string) => void;
  onMeet: (member: DirectoryMember) => void;
}) {
  const [query, setQuery] = React.useState('');
  const [only, setOnly] = React.useState<'all' | 'online'>('all');
  const [open, setOpen] = React.useState<DirectoryMember | null>(null);

  const presenceOf = React.useCallback(
    (id: string) => presence[id]?.presence ?? 'offline', [presence]);

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return directory
      .filter(d => d.memberId !== currentMemberId)
      .filter(d => !q
        || d.fullName.toLowerCase().includes(q)
        || (d.jobTitle ?? '').toLowerCase().includes(q)
        || (d.departmentName ?? '').toLowerCase().includes(q)
        || d.email.toLowerCase().includes(q))
      .filter(d => only === 'all' || presenceOf(d.memberId) !== 'offline');
  }, [directory, query, only, currentMemberId, presenceOf]);

  /**
   * Departments, in order of size, with the unassigned last.
   *
   * By size rather than alphabetically because the shape of a company is
   * information: the biggest team first tells a new joiner where most of the
   * work happens, and "Unassigned" at the bottom is where it belongs.
   */
  const groups = React.useMemo(() => {
    const byDept = new Map<string, DirectoryMember[]>();
    for (const person of matches) {
      const key = person.departmentName || 'No department';
      const list = byDept.get(key) ?? [];
      list.push(person);
      byDept.set(key, list);
    }
    return [...byDept.entries()]
      .map(([name, people]) => ({
        name,
        people: people.sort((a, b) => a.fullName.localeCompare(b.fullName)),
      }))
      .sort((a, b) => {
        if (a.name === 'No department') return 1;
        if (b.name === 'No department') return -1;
        return b.people.length - a.people.length || a.name.localeCompare(b.name);
      });
  }, [matches]);

  const onlineNow = directory.filter(
    d => d.memberId !== currentMemberId && presenceOf(d.memberId) !== 'offline').length;

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-8 lg:px-10">
          <header className="pb-6">
            <h2 className="text-[22px] font-semibold tracking-[-0.01em]">People</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {directory.length - 1} colleagues
              {onlineNow > 0 ? `, ${onlineNow} around right now` : ''}.
            </p>

            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, role or department"
                  className="h-10 pl-9"
                  aria-label="Search people"
                />
              </div>
              <div className="flex shrink-0 items-center gap-1 rounded-lg bg-muted p-1">
                {([['all', 'Everyone'], ['online', 'Around now']] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setOnly(id)}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                      only === id
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </header>

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : matches.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {query.trim()
                ? `Nobody matches "${query.trim()}".`
                : only === 'online'
                  ? 'Nobody is around at the moment.'
                  : 'The directory is empty.'}
            </p>
          ) : (
            groups.map(group => (
              <section key={group.name} className="pb-8">
                <div className="flex items-baseline gap-2 border-b pb-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                    {group.name}
                  </h3>
                  <span className="text-[11px] tabular-nums text-muted-foreground/70">
                    {group.people.length}
                  </span>
                </div>

                {group.people.map(person => (
                  <button
                    key={person.memberId}
                    onClick={() => setOpen(person)}
                    className="flex w-full items-center gap-3 border-b py-2.5 text-left transition-colors hover:bg-accent/50"
                  >
                    <PersonAvatar
                      id={person.memberId}
                      name={person.fullName}
                      src={person.avatarUrl}
                      size="sm"
                      presence={presenceOf(person.memberId)}
                      lastSeenAt={presence[person.memberId]?.lastSeenAt}
                      inCall={inCall.includes(person.memberId)}
                      decorative
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{person.fullName}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {person.jobTitle || person.email}
                      </span>
                    </span>
                    <span className="hidden shrink-0 text-xs sm:block">
                      {inCall.includes(person.memberId) ? (
                        <span className="text-destructive">In a meeting</span>
                      ) : (
                        <PresenceLabel
                          presence={presenceOf(person.memberId)}
                          lastSeenAt={presence[person.memberId]?.lastSeenAt}
                        />
                      )}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </section>
            ))
          )}
        </div>
      </div>

      {open && (
        <ProfileSheet
          person={open}
          presence={presenceOf(open.memberId)}
          lastSeenAt={presence[open.memberId]?.lastSeenAt ?? null}
          inCall={inCall.includes(open.memberId)}
          onClose={() => setOpen(null)}
          onMessage={() => { onMessage(open.memberId); setOpen(null); }}
          onMeet={() => { onMeet(open); setOpen(null); }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------- */

/**
 * One person, and the three things you can do about them.
 *
 * -- What it deliberately does not show ------------------------------------
 *
 * Employment type, hire date, reporting line, salary, last-seen timestamp.
 * Every one of those is on `v_org_directory` behind the HR and admin grants,
 * and none of it belongs on a screen every colleague can open. `/api/directory`
 * was written to carry exactly this much and no more; this panel renders what
 * that endpoint returns and asks for nothing else.
 */
function ProfileSheet({
  person, presence, lastSeenAt, inCall, onClose, onMessage, onMeet,
}: {
  person: DirectoryMember;
  presence: 'online' | 'away' | 'offline';
  lastSeenAt: string | null;
  inCall: boolean;
  onClose: () => void;
  onMessage: () => void;
  onMeet: () => void;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40 lg:relative lg:inset-auto lg:z-auto lg:block lg:bg-transparent"
      onClick={onClose}
    >
      <aside
        className="flex h-full w-full max-w-sm flex-col border-l bg-card shadow-xl lg:w-80 lg:shadow-none"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`${person.fullName} profile`}
      >
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Profile</h2>
          <Button variant="ghost" size="icon" className="size-8" onClick={onClose}
            aria-label="Close profile">
            <X className="size-4" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col items-center px-6 py-8 text-center">
            <PersonAvatar
              id={person.memberId}
              name={person.fullName}
              src={person.avatarUrl}
              size="xl"
              decorative
            />
            <h3 className="mt-4 text-lg font-semibold">{person.fullName}</h3>
            {person.jobTitle && (
              <p className="mt-0.5 text-sm text-muted-foreground">{person.jobTitle}</p>
            )}
            <p className="mt-2 text-xs">
              {inCall
                ? <span className="text-destructive">In a meeting</span>
                : <PresenceLabel presence={presence} lastSeenAt={lastSeenAt} />}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 px-4 pb-6">
            <Button className="gap-1.5" onClick={onMessage}>
              <MessageSquare className="size-4" /> Message
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={onMeet}>
              <Video className="size-4" /> Meet
            </Button>
          </div>

          <dl className="space-y-3 border-t px-5 py-5 text-sm">
            {person.departmentName && (
              <Detail icon={<Building2 className="size-3.5" />} term="Department">
                {person.departmentName}
              </Detail>
            )}
            <Detail icon={<Mail className="size-3.5" />} term="Email">
              <a href={`mailto:${person.email}`} className="underline-offset-2 hover:underline">
                {person.email}
              </a>
            </Detail>
            <Detail icon={<AtSign className="size-3.5" />} term="Mention them as">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                @{person.fullName}
              </span>
            </Detail>
          </dl>

          <p className="border-t px-5 py-4 text-xs text-muted-foreground">
            <Users className="mr-1 inline size-3" />
            Employment details live in HR, and are shown only to the people who
            administer them.
          </p>
        </div>
      </aside>
    </div>
  );
}

function Detail({
  icon, term, children,
}: {
  icon: React.ReactNode;
  term: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {icon}{term}
      </dt>
      <dd className="mt-0.5 break-words text-sm">{children}</dd>
    </div>
  );
}

/** Reported by the module when a profile action needs a toast. */
export function profileActionFailed(message?: string) {
  toast.error(message || 'That could not be done');
}
