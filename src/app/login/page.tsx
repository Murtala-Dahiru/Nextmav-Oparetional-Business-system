'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Hexagon, Loader2, Eye, EyeOff } from 'lucide-react';
import { PLATFORM } from '@/lib/platform';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          {/*
            The platform's identity, from the one place that defines it.

            Necessarily so: this page is unauthenticated, so there is no session
            and no way to know which workspace the person is about to sign in
            to — a tenant logo here could only ever be a guess. The `branding`
            settings carry a `login_message`, which is why it has never appeared
            anywhere; see the note in `lib/org-settings`.
          */}
          <div className="flex items-center gap-2 mb-2">
            <Hexagon className="size-8 text-emerald-500" />
            <span className="text-2xl font-bold tracking-tight">{PLATFORM.name}</span>
          </div>
          <p className="text-sm text-muted-foreground">Sign in to your account</p>
        </div>

        <Card className="border-gray-200 dark:border-gray-800 shadow-lg">
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl">Welcome back</CardTitle>
            <CardDescription>
              Enter your credentials to access your workspace
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sessionEnded && !linkError && !needsConfirmation && (
              <div
                role="status"
                className="mb-4 rounded-md border border-slate-300 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300"
              >
                {sessionEnded} Sign in to pick up where you left off.
              </div>
            )}

            {linkError && !needsConfirmation && (
              <div
                role="alert"
                className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
              >
                {linkError}
              </div>
            )}

            {needsConfirmation && (
              <div
                role="alert"
                className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
              >
                <p>
                  This account still needs its email address confirmed. Check your
                  inbox for the link we sent.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
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
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
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
                  disabled={isLoading}
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link
                    href="/forgot-password"
                    className="text-xs text-emerald-500 hover:text-emerald-600 font-medium"
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
                    className="h-11 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
              <Button
                type="submit"
                className="w-full h-11 bg-emerald-500 hover:bg-emerald-600 text-white"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  'Sign in'
                )}
              </Button>
            </form>
          </CardContent>
          <CardFooter>
            <div className="text-sm text-center text-muted-foreground w-full">
              Don&apos;t have an account?{' '}
              <Link
                href="/signup"
                className="text-emerald-500 hover:text-emerald-600 font-medium"
              >
                Sign up
              </Link>
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  // `useSearchParams` needs a Suspense boundary to avoid opting the whole
  // route into client-side rendering.
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="size-6 animate-spin text-emerald-500" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}