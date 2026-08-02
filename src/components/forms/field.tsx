import { Children, cloneElement, isValidElement, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Form field — label, hint, control, error
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Scope ────────────────────────────────────────────────────────────────
 *
 *  Phase 1 only: the public marketing surface and the authentication screens.
 *  It deliberately lives outside `components/ui`, which the application shell
 *  imports from in ~26 places — adding to that set would put a Phase 1 change
 *  inside the Phase 2 blast radius.
 *
 *  ── Why it exists ────────────────────────────────────────────────────────
 *
 *  Every form on the in-scope surface hand-assembled the same four parts, and
 *  disagreed about them:
 *
 *    · Login and signup wrapped fields in `<div className="space-y-2">` and
 *      relied on `<Label htmlFor>` alone — no hint, no error slot at all.
 *      Validation failures arrived as a toast in the corner of the screen,
 *      unattached to the field that caused them, and gone in four seconds.
 *    · Signup put its requirement text in a bare `<p className="text-xs">`
 *      with no `aria-describedby`, so a screen reader read the input and never
 *      the rule it had to satisfy.
 *    · Contact had no hint or error affordance whatsoever.
 *
 *  ── What it guarantees ───────────────────────────────────────────────────
 *
 *  Three things that are easy to get wrong once per form and impossible to get
 *  wrong here:
 *
 *  **The error is announced.** `role="alert"` on the message, so a screen
 *  reader hears it when it appears rather than when the user next tabs past.
 *
 *  **The error and hint are bound to the control.** `aria-describedby` is
 *  computed from whichever of the two is present, so the description a sighted
 *  user reads beside the box is the one a screen reader reads with it.
 *
 *  **The error replaces the hint rather than stacking on it.** Showing "Must
 *  be at least 8 characters" directly above "That password is too short" is
 *  the interface saying the same thing twice in two registers, and it makes
 *  the field jump by a line-height at the exact moment the user is trying to
 *  fix it.
 *
 *  The control is passed as `children` rather than generated here: the inputs
 *  in this codebase are shadcn primitives with their own prop surfaces, and
 *  wrapping them in a component that re-exports a subset is how a field
 *  eventually needs a `renderInput` escape hatch.
 */
export function Field({
  id,
  label,
  hint,
  error,
  optional,
  children,
  className,
}: {
  /** Must match the control's `id`. Binds the label and the descriptions. */
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  /** Falsy when valid. Truthy replaces the hint and marks the field. */
  error?: string | null;
  /**
   * Marks the field as optional rather than marking every other field as
   * required. On these forms nearly everything is required, so asterisks
   * everywhere carry no information — the exception is what is worth saying.
   */
  optional?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {optional && (
          <span className="text-muted-foreground text-[0.75rem]">Optional</span>
        )}
      </div>

      {/*
        `aria-describedby` is injected onto the control, not onto a wrapper.

        Putting it on a surrounding `<div>` is the tempting shortcut and it
        does nothing at all: the association is between the *input* and its
        description, so a wrapper carrying the attribute leaves the field
        undescribed to exactly the users the attribute exists for.

        `cloneElement` is doing real work here rather than being clever — it
        also means a caller cannot forget to thread the id through, which is
        how signup's password rule ended up visible on screen and absent from
        the accessibility tree. A caller that sets its own `aria-describedby`
        keeps it; theirs wins.
      */}
      {Children.map(children, (child) =>
        isValidElement<{ 'aria-describedby'?: string }>(child)
          ? cloneElement(child, {
              'aria-describedby':
                child.props['aria-describedby'] ??
                (error ? errorId : hint ? hintId : undefined),
            })
          : child,
      )}

      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-destructive flex items-start gap-1.5 text-[0.75rem] leading-relaxed"
        >
          <AlertCircle className="mt-[0.15rem] size-3 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-muted-foreground text-[0.75rem] leading-relaxed">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
