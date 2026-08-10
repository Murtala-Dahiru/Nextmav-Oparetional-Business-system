'use client';

import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * The interactive parts of the public UI.
 *
 * Kept in one client module so the pages themselves stay server components and
 * keep prerendering static — the uploaded project is a client-rendered SPA, and
 * porting it wholesale as client components would take every marketing route
 * out of static generation for the sake of two effects and a password toggle.
 */

/* ── Scroll reveal ──────────────────────────────────────────────────────── */

export function ScrollReveal({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: 0 | 1 | 2 | 3 | 4 | 5;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setVisible(true);
        observer.unobserve(entry.target);
      },
      { threshold: 0.1, rootMargin: '0px 0px -60px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`nm-reveal ${visible ? 'nm-revealed' : ''} ${
        delay ? `nm-reveal-delay-${delay}` : ''
      } ${className}`.trim()}
    >
      {children}
    </div>
  );
}

/* ── Password input ─────────────────────────────────────────────────────── */

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  hint?: string;
  error?: string;
  help?: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ label, hint, error, help, className = '', id, ...props }, ref) => {
    const [visible, setVisible] = useState(false);
    const inputId = id || props.name;
    const describedBy = error ? `${inputId}-error` : help ? `${inputId}-help` : undefined;

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
            type={visible ? 'text' : 'password'}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={`nm-input ${error ? 'nm-input-error' : ''} ${className}`.trim()}
            {...props}
          />
          <button
            type="button"
            className="nm-input-icon-btn"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            // The uploaded version carried `tabIndex={-1}`, which makes the
            // control unreachable by keyboard. A password toggle exists
            // precisely for people who cannot verify what they typed, and
            // taking it out of the tab order excludes the readers most likely
            // to need it. `aria-pressed` reports the state it is in.
            aria-pressed={visible}
          >
            {visible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
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
PasswordInput.displayName = 'PasswordInput';
