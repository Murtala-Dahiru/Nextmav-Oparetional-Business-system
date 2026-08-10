'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, MailCheck, TriangleAlert, LogIn } from 'lucide-react';
import { AuthSubmit } from '@/components/auth/fields';
import { AuthShell, AuthLoading, ASIDES } from '@/components/auth/auth-shell';
import { toast } from 'sonner';

/**
 * The other half of the invitation workflow.
 *
 * `POST /api/auth/invite` has always returned a link to `/accept-invite`, and
 * `POST /api/auth/accept-invite` has always been able to redeem it — but no
 * page ever existed at that path, so every invitation sent led to a 404. An
 * administrator could invite someone and watch it appear as pending forever,
 * with nothing to indicate which half was missing.
 *
 * Redemption is deliberately a button rather than an effect on mount. Joining
 * an organization is a consequential, non-idempotent act (the token is spent),
 * and a link opened by a mail client's URL prescanner would otherwise redeem
 * it before the recipient ever saw the page.
 */

type Phase = 'checking' | 'unauthenticated' | 'ready' | 'joining' | 'joined' | 'failed';

function AcceptInvite() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');

  // A missing token is knowable during render, so it is the initial state
  // rather than something an effect corrects afterwards.
  const [phase, setPhase] = useState<Phase>(token ? 'checking' : 'failed');
  const [message, setMessage] = useState(
    token
      ? ''
      : 'This link is missing its invitation token. Use the link from your invitation email exactly as it was sent.',
  );
  const [organization, setOrganization] = useState<string | null>(null);

  // The token identifies the invitation; the session identifies the person.
  // Both are needed, and accept_invitation() checks the invitation was issued
  // to this account's own address.
  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/session');
        const json = await res.json();
        if (cancelled) return;
        setPhase(json?.data?.user ? 'ready' : 'unauthenticated');
      } catch {
        // An unreachable session endpoint should not masquerade as a bad
        // invitation — let them try, and surface the real error on accept.
        if (!cancelled) setPhase('ready');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function accept() {
    setPhase('joining');
    try {
      const res = await fetch('/api/auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();

      if (!res.ok) {
        // The database raises a written reason for each rejection — expired,
        // already accepted, issued to a different address — and each needs a
        // different response from the reader, so it is shown verbatim.
        setPhase('failed');
        setMessage(json.error?.message || 'This invitation could not be accepted.');
        return;
      }

      setOrganization(json?.data?.organization?.name ?? null);
      setPhase('joined');
      toast.success('You have joined the organization.');

      // Full document navigation: the membership just created changes what
      // every subsequent query is permitted to return, so the dashboard must
      // load from a fresh request rather than the client router's cache.
      window.location.assign('/dashboard');
    } catch {
      setPhase('failed');
      setMessage('Network error. Please try again.');
    }
  }

  const signInHref = `/login?next=${encodeURIComponent(`/accept-invite?token=${token ?? ''}`)}`;

  /**
   * ── Five phases, each given its own screen ────────────────────────────────
   *
   * They previously shared one card, so the heading changed while the frame
   * around it did not — and the "checking" phase was a spinner in an otherwise
   * empty card, which reads as a page that has failed rather than one that is
   * working. Each phase now says what it is and what happens next.
   */
  if (phase === 'checking') {
    return (
      <AuthShell
        title="Checking your invitation"
        description="One moment."
        aside={ASIDES.invite}
      >
        <div
          className="nm-auth-panel"
          style={{ marginTop: 'var(--nm-space-8)', alignItems: 'center' }}
          role="status"
        >
          <Loader2
            className="nm-spin nm-auth-panel-icon"
            size={18}
            aria-hidden="true"
            style={{ color: 'var(--nm-ink-subtle)', marginTop: 0 }}
          />
          <p className="nm-auth-panel-body">Confirming the link is still valid…</p>
        </div>
      </AuthShell>
    );
  }

  if (phase === 'unauthenticated') {
    return (
      <AuthShell
        eyebrow="You’ve been invited"
        title="Sign in to accept"
        description="An invitation can only be accepted by the account it was sent to. Sign in — or create an account with that same address — and you’ll come straight back here."
        aside={ASIDES.invite}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--nm-space-3)',
            marginTop: 'var(--nm-space-8)',
          }}
        >
          <Link
            href={signInHref}
            className="nm-btn nm-btn-primary nm-btn-lg"
            style={{ width: '100%' }}
          >
            <LogIn size={16} aria-hidden="true" />
            Sign in
          </Link>
          {/*
            The token travels with them.

            Without it, signup asks for an organization name and creates one —
            so an invitee had to found a workspace of their own before they
            could join the one that invited them, and then owned it for ever.
            With it, signup recognises the invitation, skips that question, and
            the confirmation email lands back on this page.
          */}
          <Link
            href={`/signup?invite=${encodeURIComponent(token ?? '')}`}
            className="nm-btn nm-btn-secondary nm-btn-lg"
            style={{ width: '100%' }}
          >
            Create an account
          </Link>
        </div>
        <p className="nm-auth-panel-body" style={{ marginTop: 'var(--nm-space-4)' }}>
          Use the address the invitation was sent to. A different one will
          create an account that cannot accept it.
        </p>
      </AuthShell>
    );
  }

  if (phase === 'joined') {
    return (
      <AuthShell
        eyebrow="Done"
        title={organization ? `Welcome to ${organization}` : 'Invitation accepted'}
        description="You now have access with the role you were given."
        aside={ASIDES.invite}
      >
        <div
          className="nm-auth-panel"
          style={{
            marginTop: 'var(--nm-space-8)',
            alignItems: 'center',
            background: 'var(--nm-accent-soft)',
            borderColor: 'transparent',
          }}
          role="status"
        >
          <Loader2
            className="nm-spin nm-auth-panel-icon"
            size={18}
            aria-hidden="true"
            style={{ marginTop: 0 }}
          />
          <p className="nm-auth-panel-body">Taking you to your dashboard…</p>
        </div>
      </AuthShell>
    );
  }

  if (phase === 'failed') {
    return (
      <AuthShell
        title="This invitation didn’t work"
        description={message}
        titleSize="compact"
        aside={ASIDES.invite}
        footer={
          <button
            type="button"
            onClick={() => router.replace('/login')}
            className="nm-link nm-auth-standalone-link"
          >
            Back to sign in
          </button>
        }
      >
        <div className="nm-auth-panel" style={{ marginTop: 'var(--nm-space-8)' }}>
          <TriangleAlert
            className="nm-auth-panel-icon"
            size={20}
            aria-hidden="true"
            style={{ color: 'var(--nm-ink-subtle)' }}
          />
          <p className="nm-auth-panel-body">
            Ask whoever invited you to send a fresh one. Issuing a new
            invitation replaces the old link, so an expired one cannot be
            revived — only replaced.
          </p>
        </div>
      </AuthShell>
    );
  }

  // ready | joining
  return (
    <AuthShell
      eyebrow="You’ve been invited"
      title="Join this workspace"
      description="Accepting adds your account to the organization that invited you, with the role they chose for you."
      aside={ASIDES.invite}
    >
      <AuthSubmit
        onClick={accept}
        busy={phase === 'joining'}
        busyLabel="Joining…"
        style={{ marginTop: 'var(--nm-space-8)' }}
      >
        <MailCheck size={16} aria-hidden="true" />
        Accept invitation
      </AuthSubmit>
    </AuthShell>
  );
}

export default function AcceptInvitePage() {
  // useSearchParams needs a Suspense boundary to keep this route prerenderable.
  return (
    <Suspense
      fallback={
        <AuthLoading />
      }
    >
      <AcceptInvite />
    </Suspense>
  );
}
