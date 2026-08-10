'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { MailCheck, ArrowRight } from 'lucide-react';
import { AuthShell } from '@/components/auth/auth-shell';
import { Notice } from '@/components/auth/notice';
import { buttonClass } from '@/components/public/ui';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  /verify — "check your email"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Why this route exists now, and what it deliberately is not ───────────
 *
 *  It was logged as a product gap: sign-up's inline "check your email" state
 *  was the only coverage, so anyone who navigated away had no way back to that
 *  message, and `/auth/callback` had nowhere to send someone whose link had
 *  already been redeemed.
 *
 *  It is **not** an OTP screen. A six-digit code needs the server to issue and
 *  verify one, and nothing here does — `/api/auth/resend-confirmation` sends a
 *  link. Building the code input against a guess would have produced a form
 *  that cannot succeed, which is worse than not having it.
 *
 *  ── The resend is the existing endpoint, with its existing behaviour ──────
 *
 *  Same route sign-in already calls. It is rate-limited server-side and
 *  deliberately non-enumerating: the response does not reveal whether the
 *  address has an account, so this screen must not either. Every outcome that
 *  is not an error reads the same way, on purpose.
 */

function VerifyBody() {
  const params = useSearchParams();
  const email = params.get('email') ?? '';

  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    if (!email) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/resend-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error?.message || 'Could not send another link. Please try again shortly.',
        );
        return;
      }
      setSent(true);
    } catch {
      setError('We could not reach the server. Check your connection and try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <AuthShell
      title="Check your email"
      description={
        email
          ? `We've sent a verification link to ${email}. Open it to confirm your account.`
          : "We've sent a verification link to your inbox. Open it to confirm your account."
      }
      aside={{
        eyebrow: 'Verify',
        title: 'Confirming the address is the first step of a secure workspace.',
        body: 'Verification is what stops somebody else claiming an address they do not control — which matters more here than usual, because the address is what an invitation is sent to.',
        points: [
          {
            title: 'The link expires',
            desc: 'If it has, sign in and we will send another.',
          },
          {
            title: 'One address, one account',
            desc: 'Your email identifies you across every workspace you belong to.',
          },
          {
            title: 'Nothing is lost',
            desc: 'Your account already exists. This only confirms the address.',
          },
        ],
      }}
      footer={
        <p>
          Need help? <Link href="/contact">Contact us</Link>
        </p>
      }
    >
      <div className="nm-auth-state-icon" style={{ marginTop: 'var(--nm-space-6)' }}>
        <MailCheck size={28} aria-hidden="true" />
      </div>

      {error && <Notice tone="warning">{error}</Notice>}

      {/* Non-committal on purpose: the endpoint does not disclose whether the
          address has an account, and neither does this. */}
      {sent && !error && (
        <Notice tone="success">
          If that address needs confirming, another link is on its way.
        </Notice>
      )}

      <div
        className="nm-auth-alert nm-auth-alert-info"
        style={{ marginTop: 'var(--nm-space-6)' }}
      >
        <span>
          Nothing arrived? Check your spam folder
          {email ? ', or send another link.' : '. Sign in and we will send another.'}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--nm-space-3)',
          marginTop: 'var(--nm-space-6)',
        }}
      >
        {email && (
          <button
            type="button"
            onClick={resend}
            disabled={sending || sent}
            aria-busy={sending || undefined}
            className={buttonClass('primary', 'lg')}
          >
            {sending ? 'Sending…' : sent ? 'Link sent' : 'Send another link'}
            {!sending && !sent && <ArrowRight size={16} aria-hidden="true" />}
          </button>
        )}
        <Link href="/login" className={buttonClass('secondary', 'lg')}>
          Continue to sign in
        </Link>
      </div>
    </AuthShell>
  );
}

/** `useSearchParams` needs a Suspense boundary to keep the route prerenderable. */
export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <AuthShell
          title="Check your email"
          description="We've sent a verification link to your inbox."
        >
          <div />
        </AuthShell>
      }
    >
      <VerifyBody />
    </Suspense>
  );
}
