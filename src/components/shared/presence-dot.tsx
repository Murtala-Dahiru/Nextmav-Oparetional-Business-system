'use client';

import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/format';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * The presence indicator, in one component.
 *
 * Every screen that shows whether somebody is around renders this, for the same
 * reason every screen reads `v_presence` for the verdict: a dot that means
 * "online" in the chat sidebar and "logged in at some point" in the directory
 * is worse than no dot at all.
 *
 * Three states, and the third is not an absence:
 *
 *   online   emerald, filled
 *   away     amber, filled
 *   offline  hollow, muted — a ring rather than a dot, so it reads as "not
 *            here" rather than as a colour somebody has to remember
 *
 * The hollow ring matters for accessibility too: the three states differ by
 * shape as well as by hue, so they remain distinguishable to a colour-blind
 * reader and in the greyscale of a printed screenshot.
 */

export type Presence = 'online' | 'away' | 'offline';

const STYLES: Record<Presence, { dot: string; label: string }> = {
  online:  { dot: 'bg-emerald-500 ring-emerald-500/30', label: 'Online' },
  away:    { dot: 'bg-amber-500 ring-amber-500/30', label: 'Away' },
  offline: { dot: 'bg-transparent border-2 border-muted-foreground/50 ring-transparent', label: 'Offline' },
};

export function PresenceDot({
  presence, lastSeenAt, className, size = 'md', withTooltip = true,
}: {
  presence: Presence | null | undefined;
  /** Shown in the tooltip when they are not here now. */
  lastSeenAt?: string | null;
  className?: string;
  size?: 'sm' | 'md';
  withTooltip?: boolean;
}) {
  const state = STYLES[presence ?? 'offline'] ?? STYLES.offline;

  const dot = (
    <span
      className={cn(
        'inline-block shrink-0 rounded-full ring-2',
        size === 'sm' ? 'size-2' : 'size-2.5',
        state.dot,
        className,
      )}
      /*
        The state is announced rather than left to colour alone. A screen reader
        otherwise encounters an empty span and reports nothing at all.
      */
      role="img"
      aria-label={state.label}
    />
  );

  if (!withTooltip) return dot;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{dot}</TooltipTrigger>
      <TooltipContent>
        {state.label}
        {/*
          "Offline" on its own invites the next question. When the answer is
          known, give it — and say "Never seen" rather than nothing for an
          account that has been provisioned and never used, which is a real and
          different state an administrator needs to be able to see.
        */}
        {presence !== 'online' && (
          <span className="ml-1 text-muted-foreground">
            · {lastSeenAt ? formatRelativeTime(lastSeenAt) : 'never seen'}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The dot positioned over an avatar's corner.
 *
 * Wrap an `<Avatar>`: the ring is the page background, so the dot reads as
 * sitting on top of the avatar rather than being part of it.
 */
export function AvatarPresence({
  presence, lastSeenAt, children, className,
}: {
  presence: Presence | null | undefined;
  lastSeenAt?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('relative shrink-0', className)}>
      {children}
      <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-background p-[1.5px]">
        <PresenceDot presence={presence} lastSeenAt={lastSeenAt} size="sm" />
      </span>
    </div>
  );
}

/** "Online" / "Away" / "Last seen 2 hours ago", for a list row or a header. */
export function PresenceLabel({
  presence, lastSeenAt, className,
}: {
  presence: Presence | null | undefined;
  lastSeenAt?: string | null;
  className?: string;
}) {
  const state = presence ?? 'offline';
  if (state === 'online') {
    return <span className={cn('text-xs text-emerald-600 dark:text-emerald-400', className)}>Online</span>;
  }
  if (state === 'away') {
    return <span className={cn('text-xs text-amber-600 dark:text-amber-400', className)}>Away</span>;
  }
  return (
    <span className={cn('text-xs text-muted-foreground', className)}>
      {lastSeenAt ? `Last seen ${formatRelativeTime(lastSeenAt)}` : 'Never seen'}
    </span>
  );
}
