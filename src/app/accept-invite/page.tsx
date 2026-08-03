'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, MailCheck, TriangleAlert, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthShell } from '@/components/auth/auth-shell';
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
      <AuthShell title="Checking your invitation" description="One moment.">
        <div
          className="border-hairline bg-surface flex items-center gap-3 rounded-xl border p-5"
          role="status"
        >
          <Loader2 className="text-muted-foreground size-4 animate-spin" aria-hidden="true" />
          <p className="text-muted-foreground text-[0.875rem]">
            Confirming the link is still valid…
          </p>
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
      >
        <div className="flex flex-col gap-2.5">
          <Button asChild variant="cta" size="xl" className="w-full">
            <Link href={signInHref}>
              <LogIn className="size-4" />
              Sign in
            </Link>
          </Button>
          {/*
            The token travels with them.

            Without it, signup asks for an organization name and creates one —
            so an invitee had to found a workspace of their own before they
            could join the one that invited them, and then owned it for ever.
            With it, signup recognises the invitation, skips that question, and
            the confirmation email lands back on this page.
          */}
          <Button asChild variant="ctaOutline" size="xl" className="w-full">
            <Link href={`/signup?invite=${encodeURIComponent(token ?? '')}`}>
              Create an account
            </Link>
          </Button>
        </div>
        <p className="text-muted-foreground mt-4 text-[0.8125rem] leading-relaxed">
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
      >
        <div
          className="border-brand-line bg-brand-soft flex items-center gap-3 rounded-xl border p-5"
          role="status"
        >
          <Loader2 className="text-brand size-4 animate-spin" aria-hidden="true" />
          <p className="text-foreground/80 text-[0.875rem]">
            Taking you to your dashboard…
          </p>
        </div>
      </AuthShell>
    );
  }

  if (phase === 'failed') {
    return (
      <AuthShell
        title="This invitation didn’t work"
        description={message}
        footer={
          <button
            type="button"
            onClick={() => router.replace('/login')}
            className="hover:text-foreground underline decoration-[1.5px] underline-offset-[3px] transition-colors"
          >
            Back to sign in
          </button>
        }
      >
        <div className="border-hairline bg-surface flex gap-4 rounded-xl border p-5">
          <TriangleAlert
            className="text-muted-foreground mt-0.5 size-5 shrink-0"
            strokeWidth={1.9}
            aria-hidden="true"
          />
          <p className="text-muted-foreground text-[0.875rem] leading-relaxed">
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
    >
      <Button
        onClick={accept}
        disabled={phase === 'joining'}
        variant="cta"
        size="xl"
        className="w-full"
      >
        {phase === 'joining' ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Joining…
          </>
        ) : (
          <>
            <MailCheck className="size-4" />
            Accept invitation
          </>
        )}
      </Button>
    </AuthShell>
  );
}

export default function AcceptInvitePage() {
  // useSearchParams needs a Suspense boundary to keep this route prerenderable.
  return (
    <Suspense
      fallback={
        <div className="bg-background flex min-h-screen items-center justify-center">
          <Loader2 className="size-6 animate-spin text-emerald-500" />
        </div>
      }
    >
      <AcceptInvite />
    </Suspense>
  );
}
