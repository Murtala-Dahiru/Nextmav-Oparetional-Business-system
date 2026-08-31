'use client';

import * as React from 'react';
import { Hash, Lock, Megaphone, User, AtSign, CornerDownRight, MessageSquare } from 'lucide-react';

import { cn } from '@/lib/utils';
import { type ChannelRow, type InboxItem } from './types';

/**
 * ===========================================================================
 *  Communication's own vocabulary
 * ===========================================================================
 *
 *  -- Why the module has one at all ----------------------------------------
 *
 *  `shared/readout` gives a dark plate and a strip of instruments; the
 *  workspace answered with a catalogue of ruled rows. Communication needs a
 *  third answer for a reason that is easy to state: **a conversation is not a
 *  record**. It has no status, no owner, no figure worth putting in a tile,
 *  and the thing a person is looking for is almost always a sentence somebody
 *  said. Cards are the wrong container for that; a line of text with a face
 *  beside it is the right one.
 *
 *  So: ruled rows, one hairline between them, type doing the hierarchy, and
 *  colour used exactly twice in the whole module - the brand for being named,
 *  and destructive for something happening live. Everything else is ink and
 *  the neutral ramp.
 *
 *  -- The one rule about the accent ----------------------------------------
 *
 *  A saturated badge on every row is a screen with no focal point, which is
 *  the fault the design system names first. An unread count is ink; a mention
 *  is the brand. Being named is the fact that should carry the colour, because
 *  it is the one thing muting cannot silence.
 */

/* ------------------------------------------------------------------------- */
/*  Glyphs                                                                    */
/* ------------------------------------------------------------------------- */

export function ChannelGlyph({
  type, className,
}: {
  type: ChannelRow['type'] | string;
  className?: string;
}) {
  const cls = cn('size-4 shrink-0 text-muted-foreground', className);
  switch (type) {
    case 'private': return <Lock className={cls} />;
    case 'direct': return <User className={cls} />;
    case 'announcement': return <Megaphone className={cls} />;
    default: return <Hash className={cls} />;
  }
}

/** What kind of thing put an item in the inbox. */
export function InboxGlyph({ kind, className }: { kind: InboxItem['kind']; className?: string }) {
  const cls = cn('size-3.5 shrink-0', className);
  if (kind === 'mention') return <AtSign className={cn(cls, 'text-brand')} />;
  if (kind === 'reply') return <CornerDownRight className={cls} />;
  if (kind === 'announcement') return <Megaphone className={cls} />;
  return <MessageSquare className={cls} />;
}

export const INBOX_WORDS: Record<InboxItem['kind'], string> = {
  mention: 'mentioned you',
  reply: 'replied to you',
  direct: 'messaged you',
  announcement: 'announced',
};

/* ------------------------------------------------------------------------- */
/*  Counts                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * The unread count, and the mention count, as one control.
 *
 * They are one component because they are one decision: a mention outranks a
 * count, always, and writing that twice is how two surfaces end up disagreeing
 * about which badge a row should wear. Muted conversations keep a count and
 * lose its weight, which is what muting means.
 */
export function UnreadPill({
  unread, mentions, muted, className,
}: {
  unread: number;
  mentions: number;
  muted?: boolean;
  className?: string;
}) {
  if (mentions > 0) {
    return (
      <span
        className={cn(
          'inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center gap-0.5',
          'rounded-full bg-brand px-1.5 text-[10px] font-semibold text-brand-fg tabular-nums',
          className,
        )}
        aria-label={`${mentions} ${mentions === 1 ? 'mention' : 'mentions'}`}
      >
        <AtSign className="size-2.5" aria-hidden />
        {mentions > 99 ? '99+' : mentions}
      </span>
    );
  }
  if (unread > 0) {
    return (
      <span
        className={cn(
          'inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1.5',
          'text-[10px] font-semibold tabular-nums',
          muted
            ? 'bg-muted text-muted-foreground'
            : 'bg-primary text-primary-foreground',
          className,
        )}
        aria-label={`${unread} unread`}
      >
        {unread > 99 ? '99+' : unread}
      </span>
    );
  }
  return null;
}

/** A conversation with a meeting running in it. */
export function LivePip({ className }: { className?: string }) {
  return (
    <span className={cn('relative flex size-1.5 shrink-0', className)} aria-label="Live now">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-60" />
      <span className="relative inline-flex size-1.5 rounded-full bg-destructive" />
    </span>
  );
}

/* ------------------------------------------------------------------------- */
/*  Structure                                                                 */
/* ------------------------------------------------------------------------- */

/**
 * A titled band of rows.
 *
 * The heading is small, uppercase and quiet; the rows carry the page. An
 * action sits at the right of the heading rather than under the section,
 * because a button after a list reads as belonging to the last row.
 */
export function Section({
  title, count, action, children, className, description,
}: {
  title: string;
  count?: number | null;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('min-w-0', className)}>
      <header className="flex items-baseline justify-between gap-3 pb-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {title}
          </h3>
          {typeof count === 'number' && count > 0 && (
            <span className="text-[11px] tabular-nums text-muted-foreground/70">{count}</span>
          )}
        </div>
        {action}
      </header>
      {description && (
        <p className="pb-2 text-xs text-muted-foreground">{description}</p>
      )}
      <div className="overflow-hidden rounded-lg border bg-card">{children}</div>
    </section>
  );
}

/**
 * A row in a band.
 *
 * `divide-y` on the container would be tidier and cannot be used: the rows are
 * buttons and the hover fill has to reach the row's own edges, which a divider
 * drawn by the parent sits on top of.
 */
export function Row({
  onClick, children, className, active, first,
}: {
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  active?: boolean;
  first?: boolean;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={cn(
        'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
        !first && 'border-t',
        onClick && 'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
        active && 'bg-accent',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** What a band says when it has nothing in it. One sentence, no illustration. */
export function Nothing({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 py-6 text-center text-sm text-muted-foreground">{children}</p>
  );
}
