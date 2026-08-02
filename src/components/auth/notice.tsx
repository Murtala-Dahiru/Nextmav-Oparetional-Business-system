import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * An inline message above a form.
 *
 * ── Why it exists ────────────────────────────────────────────────────────
 *
 * The same block was hand-written on every auth page with slightly different
 * colours each time — amber-300/amber-50/amber-900 on login, slate-300/slate-50
 * for the session notice beside it, another pair on accept-invite. Three
 * palettes for what are, semantically, two states.
 *
 * ── On `role` ────────────────────────────────────────────────────────────
 *
 * `alert` is assertive: it interrupts a screen reader mid-sentence. That is
 * correct for "the link you followed has expired", which the reader needs
 * before they touch the form, and wrong for "you were signed out earlier",
 * which is context. The old code used `role="alert"` for both and `role="status"`
 * for one, chosen by which line was written first. Here the tone decides it,
 * so the two cannot drift apart again.
 */
export function Notice({
  tone = 'neutral',
  title,
  children,
  className,
}: {
  tone?: 'neutral' | 'warning' | 'success';
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'warning' ? 'alert' : 'status'}
      className={cn(
        'mb-6 rounded-lg border px-4 py-3.5 text-[0.875rem] leading-relaxed',
        tone === 'neutral' && 'border-hairline bg-surface text-muted-foreground',
        tone === 'warning' &&
          'border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200',
        tone === 'success' && 'border-brand-line bg-brand-soft text-brand',
        className,
      )}
    >
      {/* Inherits the tone's colour rather than forcing `foreground`, which
          would put near-black text on the amber panel and break it. */}
      {title && <p className="mb-1 font-semibold">{title}</p>}
      {children}
    </div>
  );
}
