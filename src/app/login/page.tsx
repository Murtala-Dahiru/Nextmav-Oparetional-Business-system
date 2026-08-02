'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthShell } from '@/components/auth/auth-shell';
import { Notice } from '@/components/auth/notice';
import { toast } from 'sonner';

/**
 * Only accept same-origin relative paths from `?next=`. An absolute URL here
 * would turn the login form into an open redirect.
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  return raw;
}

function LoginForm() {
  const searchParams = useSearchParams();
  const nextPath = safeNext(searchParams.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  /** Set when the account exists but has never been confirmed. */
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [resending, setResending] = useState(false);

  // /auth/callback sends people here with a reason when an emailed link could
  // not be redeemed — expired, already used, or missing its token. Shown on
  // arrival, because otherwise they are looking at an ordinary sign-in form
  // with no hint that the link they just followed failed.
  const linkError = searchParams.get('error');

  /**
   * Why they are back at this form.
   *
   * `proxy.ts` ends expired sessions with a redirect, and without a reason the
   * arrival is indistinguishable from having been signed out by someone else
   * or from a bug — the page they were working on simply becomes a login form.
   * Saying which clock ran out is the difference between "that is the policy"
   * and "something went wrong".
   *
   * Not a toast: they may have been away from the screen when it happened, and
   * a toast that timed out while nobody was looking explains nothing.
   */
  const endedReason = searchParams.get('reason');
  const sessionEnded =
    endedReason === 'timeout'
      ? 'You were signed out after a period of inactivity.'
      : endedReason === 'session-limit'
        ? 'Your session reached its maximum length and ended.'
        : null;

  async function resendConfirmation() {
    setResending(true);
    try {
      const res = await fetch('/api/auth/resend-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error?.message || 'Could not resend the confirmation email');
        return;
      }
      toast.success(data.data?.message ?? 'Confirmation email sent.');
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setResending(false);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsLoading(true);
    setNeedsConfirmation(false);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.error?.code === 'EMAIL_NOT_CONFIRMED') {
          setNeedsConfirmation(true);
        }
        toast.error(data.error?.message || 'Invalid email or password');
        return;
      }

      toast.success('Welcome back!');
      // A confirmed account with no membership has nowhere to land: every
      // dashboard query would fail authorization and strand them on an error
      // with no way forward. Onboarding is the only useful destination.
      const destination = data.data?.needsOrganization ? '/onboarding' : nextPath;
      // Full document navigation, not router.push: the session cookie is
      // httpOnly and was set by the response above, so middleware must
      // re-evaluate it on a fresh request. A client-side push would reuse the
      // router cache, which still holds the "redirect to /login" result for
      // this path from before we were signed in.
      window.location.assign(destination);
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthShell
      title="Sign in"
      description="Welcome back. Enter your details to reach your workspace."
      footer={
        <p>
          New here?{' '}
          <Link
            href="/signup"
            className="text-foreground font-medium underline decoration-[1.5px] underline-offset-[3px] hover:no-underline"
          >
            Create an account
          </Link>
        </p>
      }
    >
      {sessionEnded && !linkError && !needsConfirmation && (
        <Notice tone="neutral">
          {sessionEnded} Sign in to pick up where you left off.
        </Notice>
      )}

      {linkError && !needsConfirmation && <Notice tone="warning">{linkError}</Notice>}

      {needsConfirmation && (
        <Notice tone="warning" title="This account still needs confirming">
          <p>Check your inbox for the link we sent when the account was created.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={resendConfirmation}
            disabled={resending || !email}
          >
            {resending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Sending…
              </>
            ) : (
              'Send a new link'
            )}
          </Button>
        </Notice>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            // The first field on a page whose only purpose is this form.
            // Nobody arrives here to read.
            autoFocus
            disabled={isLoading}
            className="h-11"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="password">Password</Label>
            {/*
              Was `text-emerald-500` — 2.54:1 on white, well under the 4.5:1
              that AA requires. The one link on this page a person needs when
              they are already frustrated was the least legible thing on it.
            */}
            <Link
              href="/forgot-password"
              className="text-muted-foreground hover:text-foreground text-[0.8125rem] underline decoration-[1.5px] underline-offset-[3px] transition-colors"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              disabled={isLoading}
              className="h-11 pr-11"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 transition-colors"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        <Button
          type="submit"
          variant="cta"
          size="xl"
          className="w-full"
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Signing in…
            </>
          ) : (
            'Sign in'
          )}
        </Button>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  // `useSearchParams` needs a Suspense boundary to avoid opting the whole
  // route into client-side rendering.
  return (
    <Suspense
      fallback={
        <div className="bg-background flex min-h-screen items-center justify-center">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
