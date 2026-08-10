'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { AuthShell, ASIDES } from '@/components/auth/auth-shell';
import { AuthField, AuthInput, AuthSubmit } from '@/components/auth/fields';
import { toast } from 'sonner';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error?.message || 'Something went wrong. Please try again.');
        return;
      }

      setIsSubmitted(true);
      // The toast said "Password reset link sent to your email", which is a
      // claim the response deliberately does not make: this endpoint answers
      // identically whether or not the address has an account, so that the
      // form cannot be used to discover who has one. Announcing a send that
      // may not have happened undoes that in the interface.
      toast.success('If that address has an account, a link is on its way.');
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  /**
   * ── The confirmation state ────────────────────────────────────────────
   *
   * Worded carefully. The old copy — "We've sent a password reset link to
   * alex@acme.com" — asserts that an account exists at that address to anyone
   * who types one in, which is precisely the enumeration the API is written to
   * prevent. The screen was quietly leaking what the endpoint refused to.
   */
  if (isSubmitted) {
    return (
      <AuthShell
        eyebrow="Check your inbox"
        title="If that address has an account, the link is on its way"
        // A sentence, not a label — see `.nm-auth-title-sm`.
        titleSize="compact"
        aside={ASIDES.recovery}
        description={
          <>
            {/* No expiry stated. The lifetime is Supabase's setting, not this
                application's, so any duration printed here would be a number
                the page cannot actually know. */}
            We sent it to <strong style={{ color: 'var(--nm-ink)' }}>{email}</strong>. The
            link can be used once.
          </>
        }
        footer={
          <Link href="/login" className="nm-arrow-link">
            <ArrowLeft size={14} aria-hidden="true" />
            Back to sign in
          </Link>
        }
      >
        <div className="nm-auth-panel" style={{ marginTop: 'var(--nm-space-8)' }}>
          <MailCheck className="nm-auth-panel-icon" size={20} aria-hidden="true" />
          <p className="nm-auth-panel-body">
            Nothing after a few minutes? Check the spam folder, then confirm the
            address is the one you signed up with — a typo produces exactly this
            screen.
          </p>
        </div>

        <AuthSubmit
          type="button"
          variant="secondary"
          style={{ marginTop: 'var(--nm-space-6)' }}
          onClick={() => {
            setIsSubmitted(false);
            setEmail('');
          }}
        >
          Try a different address
        </AuthSubmit>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      description="Enter the address you sign in with and we'll send a link to set a new password."
      aside={ASIDES.recovery}
      footer={
        <Link href="/login" className="nm-arrow-link">
          <ArrowLeft size={14} aria-hidden="true" />
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="nm-auth-form">
        <AuthField id="reset-email" label="Email address">
          <AuthInput
            id="reset-email"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            autoFocus
            disabled={isLoading}
          />
        </AuthField>

        <AuthSubmit
          type="submit"
          className="nm-auth-submit"
          busy={isLoading}
          busyLabel="Sending…"
        >
          Send reset link
        </AuthSubmit>
      </form>
    </AuthShell>
  );
}
