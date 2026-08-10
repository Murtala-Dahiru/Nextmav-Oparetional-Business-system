import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
  type CSSProperties,
} from 'react';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Public UI primitives
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Ported from the uploaded public-experience project's `src/components/ui/*`
 *  with its class names and markup intact, so the stylesheets in
 *  `src/styles/public/` apply exactly as they were written.
 *
 *  These are deliberately **separate from `@/components/ui/*`**, which the
 *  authenticated application imports across dozens of files. Nothing here is
 *  shared with it, and nothing here should be — the two design systems are
 *  meant to be independent until the application gets its own pass.
 */

/* ── Button ─────────────────────────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

const sizeClass: Record<ButtonSize, string> = {
  sm: 'nm-btn-sm',
  md: '',
  lg: 'nm-btn-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', children, ...props }, ref) => (
    <button
      ref={ref}
      className={`nm-btn nm-btn-${variant} ${sizeClass[size]} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

/**
 * The same treatment on an anchor.
 *
 * The uploaded project wrapped `<Button>` in a router `<Link>`, which nests a
 * `<button>` inside an `<a>` — invalid HTML, and it gives the control two
 * conflicting roles in the accessibility tree. Next's `<Link>` renders the
 * anchor, so the styling goes on the anchor and the nesting disappears.
 */
export function ButtonLinkClass({
  variant = 'primary',
  size = 'md',
  className = '',
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  return `nm-btn nm-btn-${variant} ${sizeClass[size]} ${className}`.trim();
}

export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className = '',
) {
  return `nm-btn nm-btn-${variant} ${sizeClass[size]} ${className}`.trim();
}

/* ── Layout ─────────────────────────────────────────────────────────────── */

export function Container({
  children,
  width = 'default',
  className = '',
  style,
}: {
  children: ReactNode;
  width?: 'default' | 'narrow' | 'wide';
  className?: string;
  style?: CSSProperties;
}) {
  const widthClass =
    width === 'narrow'
      ? 'nm-container-narrow'
      : width === 'wide'
        ? 'nm-container-wide'
        : 'nm-container';
  return (
    <div className={`${widthClass} ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}

export function Section({
  children,
  size = 'md',
  className = '',
  id,
  style,
  'aria-labelledby': labelledBy,
}: {
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  id?: string;
  style?: CSSProperties;
  'aria-labelledby'?: string;
}) {
  const sizeClass =
    size === 'lg' ? 'nm-section-lg' : size === 'sm' ? 'nm-section-sm' : 'nm-section';
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={`${sizeClass} ${className}`.trim()}
      style={style}
    >
      {children}
    </section>
  );
}

export function Eyebrow({
  children,
  className = '',
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={`nm-eyebrow ${className}`.trim()} style={style}>
      {children}
    </span>
  );
}

export function SectionHeading({
  children,
  className = '',
  as: Tag = 'h2',
  id,
}: {
  children: ReactNode;
  className?: string;
  as?: 'h2' | 'h3';
  id?: string;
}) {
  return (
    <Tag id={id} className={`nm-heading ${className}`.trim()}>
      {children}
    </Tag>
  );
}

export function Badge({
  children,
  variant = 'default',
  dot = false,
  className = '',
}: {
  children: ReactNode;
  variant?: 'default' | 'accent' | 'success';
  dot?: boolean;
  className?: string;
}) {
  return (
    <span className={`nm-badge nm-badge-${variant} ${className}`.trim()}>
      {dot && <span className="nm-badge-dot" />}
      {children}
    </span>
  );
}

/* ── Fields ─────────────────────────────────────────────────────────────── */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  help?: string;
  icon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, hint, error, help, icon, className = '', id, ...props }, ref) => {
    const inputId = id || props.name;
    const describedBy = error
      ? `${inputId}-error`
      : help
        ? `${inputId}-help`
        : undefined;
    return (
      <div className="nm-field">
        {label && (
          <label htmlFor={inputId} className="nm-label">
            {label}
            {hint && <span className="nm-label-hint"> — {hint}</span>}
          </label>
        )}
        <div className="nm-input-wrap">
          <input
            ref={ref}
            id={inputId}
            // The uploaded version wired neither of these. An error rendered
            // in a sibling `<span>` with no `aria-describedby` and no
            // `aria-invalid` is invisible to a screen reader: the field
            // announces as valid and the message is never read out.
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={`nm-input ${error ? 'nm-input-error' : ''} ${className}`.trim()}
            {...props}
          />
          {icon && <span className="nm-input-icon-btn">{icon}</span>}
        </div>
        {error && (
          <span id={`${inputId}-error`} role="alert" className="nm-field-error">
            {error}
          </span>
        )}
        {help && !error && (
          <span id={`${inputId}-help`} className="nm-field-help">
            {help}
          </span>
        )}
      </div>
    );
  },
);
Input.displayName = 'Input';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  help?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, hint, error, help, className = '', id, ...props }, ref) => {
    const inputId = id || props.name;
    const describedBy = error
      ? `${inputId}-error`
      : help
        ? `${inputId}-help`
        : undefined;
    return (
      <div className="nm-field">
        {label && (
          <label htmlFor={inputId} className="nm-label">
            {label}
            {hint && <span className="nm-label-hint"> — {hint}</span>}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`nm-textarea ${error ? 'nm-input-error' : ''} ${className}`.trim()}
          {...props}
        />
        {error && (
          <span id={`${inputId}-error`} role="alert" className="nm-field-error">
            {error}
          </span>
        )}
        {help && !error && (
          <span id={`${inputId}-help`} className="nm-field-help">
            {help}
          </span>
        )}
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';

/* ── Logo ───────────────────────────────────────────────────────────────── */

export function Logo({
  size = 28,
  withMark = true,
  className = '',
}: {
  size?: number;
  withMark?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`nm-logo ${className}`.trim()}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}
    >
      {withMark && (
        <svg
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* Four connected quadrants, implying one system. */}
          <rect x="3" y="3" width="11" height="11" rx="2" fill="var(--nm-accent)" />
          <rect x="18" y="3" width="11" height="11" rx="2" stroke="var(--nm-accent)" strokeWidth="2" />
          <rect x="3" y="18" width="11" height="11" rx="2" stroke="var(--nm-accent)" strokeWidth="2" />
          <rect x="18" y="18" width="11" height="11" rx="2" fill="var(--nm-accent)" />
        </svg>
      )}
      <span
        style={{
          fontFamily: 'var(--nm-font-sans)',
          fontWeight: 600,
          fontSize: `${size * 0.62}px`,
          letterSpacing: '-0.02em',
          color: 'currentColor',
          lineHeight: 1,
        }}
      >
        NextMav
      </span>
    </span>
  );
}
