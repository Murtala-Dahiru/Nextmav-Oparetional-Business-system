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
      // The uploaded design system's alert, so these read as part of the auth
      // screens they sit on rather than as a survivor of the previous one.
      // `nm-auth-alert-*` are defined in `styles/public/auth.css`; the semantics
      // above are unchanged, because they were never presentation.
      className={cn(
        'nm-auth-alert',
        tone === 'warning' && 'nm-auth-alert-error',
        tone === 'success' && 'nm-auth-alert-success',
        className,
      )}
    >
      <div>
        {title && <strong style={{ display: 'block' }}>{title}</strong>}
        {children}
      </div>
    </div>
  );
}
