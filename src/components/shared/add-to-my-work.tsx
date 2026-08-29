'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { ListPlus, Check, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { intakeBody, type WorkSource } from '@/lib/mywork';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Add to My Work
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── One action, in every module that produces work ────────────────────────
 *
 * A task assigned to you in Projects, a ticket escalated to you in Support, a
 * deal that has gone quiet in CRM: all three are work you owe, and none of
 * them is a plan for your afternoon. Before this, moving one onto a personal
 * list meant retyping the title - so most people did not, and the two systems
 * drifted until the personal list was fiction.
 *
 * This is that action, and it is deliberately the *same* component everywhere.
 * Thirteen modules each writing their own "add to my list" is thirteen
 * opportunities to send a different payload, forget the label, or create a
 * duplicate - and the point of intake is that the personal item and the record
 * agree about what they are.
 *
 * ── What it creates, and what it does not ─────────────────────────────────
 *
 * A personal to-do that *points at* the record. The record stays the source of
 * truth: ticking the personal item off does not close the ticket, does not
 * move a burndown and does not appear on anybody else's screen. That is the
 * guarantee `todos` has carried since 0016, and it is why this is an
 * improvement on copying the row rather than a way of doing the same thing.
 *
 * ── Pressing it twice ─────────────────────────────────────────────────────
 *
 * People will. From the row, and again from the detail panel, and again
 * tomorrow having forgotten. A unique index refuses the second write and the
 * endpoint answers with the item that already exists, so the honest response
 * is "this is already on your list" - not a second copy, and not an error.
 *
 * ── Two shapes, one behaviour ─────────────────────────────────────────────
 *
 * `AddToMyWorkItem` is a `DropdownMenuItem`, for the row-action menus that
 * every table in this product already has. `AddToMyWorkButton` is a button,
 * for a detail panel or a toolbar. Both call the same hook, so the wording,
 * the duplicate handling and the confirmation cannot drift apart.
 */

type Outcome = 'idle' | 'saving' | 'added' | 'already';

function useAddToMyWork(source: WorkSource, title: string) {
  const [state, setState] = React.useState<Outcome>('idle');
  const allows = useAppStore(s => s.allows);
  const setActiveModule = useAppStore(s => s.setActiveModule);

  const add = React.useCallback(async () => {
    const clean = title.trim();
    if (!clean || state === 'saving') return;

    setState('saving');
    try {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(intakeBody(clean, source)),
      });
      const json = await res.json().catch(() => null);

      if (json?.error) throw new Error(json.error.message || 'Could not add it');
      if (!res.ok) throw new Error(`Could not add it (${res.status})`);

      const already = json?.meta?.alreadyOnList === true;
      setState(already ? 'already' : 'added');

      /**
       * The confirmation offers the one thing somebody wants next, and only
       * when they can actually go there - `mywork` is held by every internal
       * role and by no client, so a portal user sees the sentence without a
       * button that would take them nowhere.
       */
      toast.success(
        already ? 'Already on your list' : 'Added to My Work',
        {
          description: already
            ? 'You added this before, and it is still open.'
            : 'Private to you. Completing it changes nothing for the team.',
          action: allows('mywork')
            ? { label: 'Open My Work', onClick: () => setActiveModule('mywork') }
            : undefined,
        },
      );
    } catch (e: any) {
      setState('idle');
      toast.error(e.message || 'Could not add it to My Work');
    }
  }, [source, title, state, allows, setActiveModule]);

  return { state, add };
}

/** The row-action menu entry. Renders nothing for a role without My Work. */
export function AddToMyWorkItem({
  source, title, onDone,
}: {
  source: WorkSource;
  title: string;
  /** Called after a successful add, for a caller that wants to close a panel. */
  onDone?: () => void;
}) {
  const allows = useAppStore(s => s.allows);
  const { state, add } = useAddToMyWork(source, title);

  if (!allows('mywork')) return null;

  return (
    <DropdownMenuItem
      // The menu stays open while the request is in flight, so the row does
      // not appear to do nothing and then close.
      onSelect={e => {
        e.preventDefault();
        void add().then(onDone);
      }}
      disabled={state === 'saving'}
    >
      {state === 'saving' ? (
        <Loader2 className="mr-2 size-4 animate-spin" />
      ) : state === 'idle' ? (
        <ListPlus className="mr-2 size-4" />
      ) : (
        <Check className="mr-2 size-4 text-[var(--chart-1)]" />
      )}
      {state === 'already' ? 'Already on My Work'
        : state === 'added' ? 'On My Work'
        : 'Add to My Work'}
    </DropdownMenuItem>
  );
}

/** The standalone control, for a detail panel or a toolbar. */
export function AddToMyWorkButton({
  source, title, size = 'sm', variant = 'outline', className, onDone,
}: {
  source: WorkSource;
  title: string;
  size?: 'sm' | 'default';
  variant?: 'outline' | 'ghost' | 'secondary';
  className?: string;
  onDone?: () => void;
}) {
  const allows = useAppStore(s => s.allows);
  const { state, add } = useAddToMyWork(source, title);

  if (!allows('mywork')) return null;

  const done = state === 'added' || state === 'already';

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      disabled={state === 'saving' || done}
      onClick={() => void add().then(onDone)}
      className={cn('gap-1.5', className)}
    >
      {state === 'saving' ? (
        <Loader2 className="size-4 animate-spin" />
      ) : done ? (
        <Check className="size-4 text-[var(--chart-1)]" />
      ) : (
        <ListPlus className="size-4" />
      )}
      {state === 'already' ? 'Already on My Work'
        : state === 'added' ? 'On My Work'
        : 'Add to My Work'}
    </Button>
  );
}
