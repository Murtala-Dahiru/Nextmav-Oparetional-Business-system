'use client';

import * as React from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { PresenceDot, type Presence } from '@/components/shared/presence-dot';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { initialsOf } from '@/lib/format';
import { avatarStyle } from '@/lib/avatar';
import { cn } from '@/lib/utils';

/**
 * ===========================================================================
 *  A person, drawn once
 * ===========================================================================
 *
 *  -- The fault this exists to fix -----------------------------------------
 *
 *  `profiles.avatar_url` has been uploaded through the account screen since
 *  the product's first migration. The sidebar renders it, CRM renders it,
 *  Projects and Workspace render it - and Communication, the one module that
 *  is entirely about who is speaking, rendered coloured initials for everybody
 *  on every surface. Forty-two avatar call sites in that module, not one
 *  `AvatarImage` among them. So a person uploads a photograph and sees it in
 *  five places, never in the place their colleagues actually look at them.
 *
 *  The cause is worth naming because it will happen again: an avatar is three
 *  lines of JSX, so every screen writes its own, and the one that forgets the
 *  image looks fine in isolation. One component is the fix.
 *
 *  -- What it guarantees ----------------------------------------------------
 *
 *  · The photograph when there is one, the same tinted initials when there is
 *    not, and the same tint for the same person in every module.
 *  · A presence dot that is the shared `PresenceDot`, so "online" means one
 *    thing product-wide.
 *  · An accessible name. An avatar with no text is a decoration a screen
 *    reader passes over in silence, which in a message list means the author
 *    is simply missing.
 */

export type PersonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const BOX: Record<PersonSize, string> = {
  xs: 'size-6',
  sm: 'size-7',
  md: 'size-9',
  lg: 'size-11',
  xl: 'size-16',
};

const TEXT: Record<PersonSize, string> = {
  xs: 'text-[10px]',
  sm: 'text-[11px]',
  md: 'text-xs',
  lg: 'text-sm',
  xl: 'text-lg',
};

export interface PersonAvatarProps {
  /**
   * The membership id, which is what the tint is derived from.
   *
   * Membership rather than account, because that is the id every module
   * already holds on a row: a message's `sender_id`, a task's `assignee_id`, a
   * participant's `member_id`. Using the account id in some places and the
   * membership id in others would give the same person two colours.
   */
  id: string;
  name?: string | null;
  src?: string | null;
  size?: PersonSize;
  /** Draws the shared presence dot over the corner when given. */
  presence?: Presence | null;
  lastSeenAt?: string | null;
  /**
   * On a call right now.
   *
   * Communication derives this from `meeting_participants`, which is a fact
   * rather than a guess, and it outranks the presence dot: somebody in a
   * meeting is at their desk and unavailable, and "online" would be true and
   * misleading.
   */
  inCall?: boolean;
  className?: string;
  /**
   * Hides the name from assistive technology.
   *
   * For the case where the name is already rendered beside the avatar, which
   * is most of them: announcing it twice makes a message list read as "Ada
   * Okonkwo Ada Okonkwo said".
   */
  decorative?: boolean;
}

export function PersonAvatar({
  id, name, src, size = 'md', presence, lastSeenAt, inCall, className, decorative,
}: PersonAvatarProps) {
  const label = name?.trim() || 'Unknown member';

  const avatar = (
    <Avatar className={cn(BOX[size], 'shrink-0', className)}>
      {/* Radix falls back on its own when the image is absent or fails to
          load, so a broken URL degrades to initials rather than to a hole. */}
      {src ? <AvatarImage src={src} alt="" /> : null}
      <AvatarFallback
        className={cn('font-medium', TEXT[size])}
        style={avatarStyle(id)}
      >
        {initialsOf(label)}
      </AvatarFallback>
    </Avatar>
  );

  if (!presence && !inCall) {
    return decorative
      ? <span aria-hidden="true">{avatar}</span>
      : <span role="img" aria-label={label}>{avatar}</span>;
  }

  return (
    <span
      className="relative inline-flex shrink-0"
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      {avatar}
      {/* The ring is the surface behind it, so the dot reads as sitting on top
          of the avatar rather than as part of the photograph. */}
      <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-background p-[1.5px]">
        {inCall ? <InCallPip /> : (
          <PresenceDot presence={presence} lastSeenAt={lastSeenAt} size="sm" />
        )}
      </span>
    </span>
  );
}

/**
 * In a meeting.
 *
 * A filled square rather than a fourth colour of dot: the three presence
 * states differ by shape as well as by hue on purpose, and a fourth circle
 * would be a colour somebody has to memorise. A square reads as "busy" at
 * eight pixels and stays distinguishable in greyscale.
 */
function InCallPip() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-block size-2 rounded-[2px] bg-destructive ring-2 ring-destructive/30"
          role="img"
          aria-label="In a meeting"
        />
      </TooltipTrigger>
      <TooltipContent>In a meeting</TooltipContent>
    </Tooltip>
  );
}

/**
 * A short row of faces, for "who is in this".
 *
 * Overlapped rather than spaced, capped, with the remainder counted. The cap
 * is a parameter because a channel header has room for three and a meeting
 * card has room for six.
 */
export function PersonStack({
  people, max = 5, size = 'xs', className,
}: {
  people: { id: string; name?: string | null; src?: string | null }[];
  max?: number;
  size?: PersonSize;
  className?: string;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;

  return (
    <div className={cn('flex items-center', className)}>
      <div className="flex -space-x-1.5">
        {shown.map(person => (
          <PersonAvatar
            key={person.id}
            id={person.id}
            name={person.name}
            src={person.src}
            size={size}
            decorative
            className="ring-2 ring-background"
          />
        ))}
      </div>
      {rest > 0 && (
        <span className="ml-1.5 text-[11px] tabular-nums text-muted-foreground">
          +{rest}
        </span>
      )}
    </div>
  );
}
