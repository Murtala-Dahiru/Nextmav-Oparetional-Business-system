'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Hexagon, Loader2, MailCheck, TriangleAlert, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center gap-2 mb-2">
            <Hexagon className="size-8 text-emerald-500" />
            <span className="text-2xl font-bold tracking-tight">NexusCorp</span>
          </div>
          <p className="text-sm text-muted-foreground">You&apos;ve been invited</p>
        </div>

        <Card className="border-gray-200 dark:border-gray-800 shadow-lg">
          {phase === 'checking' && (
            <CardContent className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-emerald-500" />
            </CardContent>
          )}

          {phase === 'unauthenticated' && (
            <>
              <CardHeader className="space-y-1">
                <CardTitle className="text-xl">Sign in to accept</CardTitle>
                <CardDescription>
                  An invitation can only be accepted by the account it was sent
                  to. Sign in — or create an account with that same email
                  address — and you&apos;ll come straight back here.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Button asChild className="h-11 w-full bg-emerald-500 hover:bg-emerald-600 text-white">
                  <Link href={signInHref}><LogIn className="size-4" /> Sign in</Link>
                </Button>
                <Button asChild variant="outline" className="h-11 w-full">
                  <Link href="/signup">Create an account</Link>
                </Button>
              </CardContent>
            </>
          )}

          {(phase === 'ready' || phase === 'joining') && (
            <>
              <CardHeader className="space-y-1">
                <CardTitle className="text-xl">Join this workspace</CardTitle>
                <CardDescription>
                  Accepting adds your account to the organization that invited
                  you, with the role they chose for you.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={accept}
                  disabled={phase === 'joining'}
                  className="h-11 w-full bg-emerald-500 hover:bg-emerald-600 text-white"
                >
                  {phase === 'joining' ? (
                    <><Loader2 className="size-4 animate-spin" /> Joining…</>
                  ) : (
                    <><MailCheck className="size-4" /> Accept invitation</>
                  )}
                </Button>
              </CardContent>
            </>
          )}

          {phase === 'joined' && (
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <MailCheck className="size-8 text-emerald-500" />
              <p className="text-sm font-medium">
                {organization ? `Welcome to ${organization}.` : 'Invitation accepted.'}
              </p>
              <p className="text-xs text-muted-foreground">Taking you to your dashboard…</p>
            </CardContent>
          )}

          {phase === 'failed' && (
            <>
              <CardHeader className="space-y-1">
                <div className="flex items-center gap-2">
                  <TriangleAlert className="size-5 text-amber-500" />
                  <CardTitle className="text-xl">Invitation not accepted</CardTitle>
                </div>
                <CardDescription>{message}</CardDescription>
              </CardHeader>
              <CardFooter className="flex flex-col gap-2">
                <p className="text-xs text-center text-muted-foreground">
                  Ask whoever invited you to send a fresh invitation — issuing a
                  new one replaces the old link.
                </p>
                <Button variant="ghost" className="h-9 w-full text-muted-foreground" onClick={() => router.replace('/login')}>
                  Back to sign in
                </Button>
              </CardFooter>
            </>
          )}
        </Card>
      </div>
    </div>
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
