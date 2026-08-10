'use client';

import {
  Children,
  cloneElement,
  isValidElement,
  forwardRef,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { AlertCircle, Check, Eye, EyeOff, Loader2, Minus } from 'lucide-react';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Auth form kit
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── The problem it exists to end ─────────────────────────────────────────
 *
 *  The auth screens rendered the uploaded public design system as their shell
 *  and the authenticated application's shadcn primitives as their contents.
 *  Two design systems, one viewport, four hundred pixels apart. Measured on
 *  `/login` before this change:
 *
 *    ·  input   44px tall, shadcn focus ring, no hover border
 *       system  46px tall, `--nm-focus-ring`, border darkens on hover
 *    ·  submit  44px, no hover lift, no accent shadow
 *       system  48px, both
 *    ·  label, error and hint sized by the application's type scale rather
 *       than the public one
 *
 *  None of those gaps is individually visible. Together they are exactly the
 *  reason a sign-in page can look "not quite like the rest of the site"
 *  without anybody being able to name what is wrong. The header, the aside and
 *  the footer were the new company; the form — the only part anybody actually
 *  looks at — was the old one.
 *
 *  So these render `.nm-*` and nothing else. There is no Tailwind fallback and
 *  no dual-system hedging, because there is nothing left to hedge for: the
 *  component this replaces was imported by three files, all of them auth
 *  screens, and none by the authenticated application.
 *
 *  ── What is deliberately kept from the old kit ───────────────────────────
 *
 *  Three behaviours that were right and are easy to lose in a visual pass:
 *  the error is announced (`role="alert"`), the error is bound to the control
 *  (`aria-describedby` on the input, never on a wrapper), and the error
 *  replaces the hint rather than stacking on it.
 */

/* ── Field ────────────────────────────────────────────────────────────────── */

export function AuthField({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: {
  /** Must match the control's `id`. Binds the label and the description. */
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
  /**
   * The control. Pass it directly when it is a bare input and the description
   * is threaded on for you. Pass a **function** when the control is wrapped in
   * anything, and spread the argument onto the input itself.
   *
   * The wrapped case cannot be handled implicitly and the reason is not
   * hypothetical: `cloneElement` clones the direct child, so on a password
   * field it lands on the positioning `<div>` and the input beside it
   * announces nothing. That shipped once. Now it can only be got obviously
   * wrong, never subtly.
   */
  children: ReactNode | ((a11y: { 'aria-describedby': string | undefined }) => ReactNode);
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className="nm-field">
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--nm-space-3)',
        }}
      >
        <label htmlFor={id} className="nm-label">
          {label}
        </label>
        {optional && <span className="nm-label-hint">Optional</span>}
      </div>

      {typeof children === 'function'
        ? children({ 'aria-describedby': describedBy })
        : Children.map(children, (child) =>
            isValidElement<{ 'aria-describedby'?: string }>(child)
              ? cloneElement(child, {
                  'aria-describedby': child.props['aria-describedby'] ?? describedBy,
                })
              : child,
          )}

      {/* One slot, one reserved line. See `.nm-field-msg`. */}
      <div className="nm-field-msg">
        {error ? (
          <p id={errorId} role="alert" className="nm-field-error">
            <AlertCircle aria-hidden="true" />
            {error}
          </p>
        ) : hint ? (
          <p id={hintId} className="nm-field-help">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ── Input ────────────────────────────────────────────────────────────────── */

export const AuthInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(({ invalid, className = '', ...props }, ref) => (
  <input
    ref={ref}
    aria-invalid={invalid || undefined}
    className={`nm-input ${invalid ? 'nm-input-error' : ''} ${className}`.trim()}
    {...props}
  />
));
AuthInput.displayName = 'AuthInput';

/* ── Password input ───────────────────────────────────────────────────────── */

/**
 * An input with a reveal toggle.
 *
 * The toggle is a real button in the tab order — see `.nm-input-toggle` in
 * `auth-forms.css` for why it is no longer `tabIndex={-1}`.
 */
export const AuthPasswordInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(({ invalid, className = '', ...props }, ref) => {
  const [shown, setShown] = useState(false);
  return (
    <div className="nm-input-wrap nm-input-wrap-toggle">
      <input
        ref={ref}
        type={shown ? 'text' : 'password'}
        aria-invalid={invalid || undefined}
        className={`nm-input ${invalid ? 'nm-input-error' : ''} ${className}`.trim()}
        {...props}
      />
      <button
        type="button"
        className="nm-input-toggle"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        disabled={props.disabled}
      >
        {shown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </button>
    </div>
  );
});
AuthPasswordInput.displayName = 'AuthPasswordInput';

/* ── Buttons ──────────────────────────────────────────────────────────────── */

/**
 * `busy` rather than `disabled` for a request in flight.
 *
 * Both stop a second submit. Only one of them says which is happening: a
 * disabled button at 0.45 opacity reads as "unavailable", which is the wrong
 * answer to "did my click register".
 */
export function AuthSubmit({
  busy,
  busyLabel,
  children,
  variant = 'primary',
  className = '',
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  busyLabel?: string;
  variant?: 'primary' | 'secondary';
  children: ReactNode;
}) {
  return (
    <button
      className={`nm-btn nm-btn-${variant} nm-btn-lg ${className}`.trim()}
      // Merged, not spread over: a caller passing `style` for a margin must not
      // silently lose the full width that makes this a submit button.
      style={{ width: '100%', ...style }}
      aria-busy={busy || undefined}
      disabled={busy || props.disabled}
      {...props}
    >
      {busy ? (
        <>
          <Loader2 className="nm-spin" size={16} aria-hidden="true" />
          {busyLabel ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/* ── Password requirements ────────────────────────────────────────────────── */

/**
 * The rules and which are met — not a strength score.
 *
 * A score answers "how good is this" with a number nobody can act on. The list
 * answers "what is still missing", which is the only question anybody stuck on
 * this field is asking.
 *
 * `aria-live="polite"`: the list changes under the user's fingers as they
 * type, and a change nobody is told about is a change only sighted users get.
 * Polite, not assertive — it must not interrupt every keystroke.
 */
export function PasswordRules({
  rules,
}: {
  rules: { label: string; met: boolean }[];
}) {
  const id = useId();
  return (
    <div className="nm-auth-rules" aria-live="polite" id={id}>
      {rules.map((rule) => (
        <span
          key={rule.label}
          className={`nm-auth-rule ${rule.met ? 'nm-auth-rule-met' : ''}`.trim()}
        >
          {rule.met ? <Check aria-hidden="true" /> : <Minus aria-hidden="true" />}
          {/* The state is in the icon, which a screen reader does not read.
              Saying it in text is the difference between a list of rules and a
              list of rules with answers. */}
          {/* `nm-sr-only`, not `nm-visually-hidden`: both exist in the public
              system and do the same thing, and this is the one the converted
              pages already use. */}
          <span className="nm-sr-only">{rule.met ? 'Met: ' : 'Not yet met: '}</span>
          {rule.label}
        </span>
      ))}
    </div>
  );
}
