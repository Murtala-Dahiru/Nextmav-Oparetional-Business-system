'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { AuthShell, AuthLoading, ASIDES } from '@/components/auth/auth-shell';
import { Notice } from '@/components/auth/notice';
import {
  AuthField,
  AuthInput,
  AuthPasswordInput,
  AuthSubmit,
} from '@/components/auth/fields';
import { useFieldErrors } from '@/components/forms/use-field-errors';

/**
 * Only accept same-origin relative paths from `?next=`. An absolute URL here
 * would turn the login form into an open redirect.
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  return raw;
}

type FormError =
  | { kind: 'credentials' }
  | { kind: 'unconfirmed' }
  | { kind: 'rateLimited'; message: string }
  | { kind: 'offline' }
  | { kind: 'server'; message: string };

function LoginForm() {
  const searchParams = useSearchParams();
  const nextPath = safeNext(searchParams.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  /**
   * ── Why failures are state rather than toasts ─────────────────────────────
   *
   * Every failure on this form used to be `toast.error(...)`: wrong password,
   * unconfirmed account, rate limit, network loss — four different problems
   * needing four different responses, all rendered as the same grey rectangle
   * in the corner, all gone after four seconds.
   *
   * A toast is for something that succeeded. A sign-in failure is the entire
   * content of the screen at that moment: it has to persist, it has to sit
   * where the person is already looking, and it has to say which of the four
   * things happened, because "try again" is right for one of them and useless
   * for the other three.
   */
  const [formError, setFormError] = useState<FormError | null>(null);

  const fields = ['email', 'password'] as const;
  const { blur, revealAll, showing } = useFieldErrors<(typeof fields)[number]>();

  const errors = {
    email: !email.trim()
      ? 'Enter the email address you signed up with.'
      : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
        ? null
        : 'That address is missing an @ or a domain.',
    password: password ? null : 'Enter your password.',
  };

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
        setFormError({
          kind: 'server',
          message: data.error?.message || 'Could not resend the confirmation email.',
        });
        return;
      }
      setResent(true);
    } catch {
      setFormError({ kind: 'offline' });
    } finally {
      setResending(false);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!revealAll(fields, errors, 'login-')) return;

    setIsLoading(true);
    setFormError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.error?.code === 'EMAIL_NOT_CONFIRMED') {
          setFormError({ kind: 'unconfirmed' });
        } else if (res.status === 429) {
          // The rate limiter exists and says something specific and useful —
          // it knows when the window resets. Flattening that into "invalid
          // email or password" told people to keep retrying, which is the one
          // action guaranteed to extend the lockout.
          setFormError({
            kind: 'rateLimited',
            message:
              data.error?.message ||
              'Too many attempts. Please wait a moment before trying again.',
          });
        } else if (res.status >= 500) {
          setFormError({
            kind: 'server',
            message: 'Something failed on our side. Your details were not the problem.',
          });
        } else {
          setFormError({ kind: 'credentials' });
        }
        return;
      }

      // A confirmed account with no membership has nowhere to land: every
      // dashboard query would fail authorization and strand them on an error
      // with no way forward. Onboarding is the only useful destination.
      const destination = data.data?.needsOrganization ? '/onboarding' : nextPath;
      // Full document navigation, not router.push: the session cookie is
      // httpOnly and was set by the response above, so middleware must
      // re-evaluate it on a fresh request. A client-side push would reuse the
      // router cache, which still holds the "redirect to /login" result for
      // this path from before we were signed in.
      //
      // `isLoading` is deliberately left true — the spinner stays until the
      // new document paints. Restoring the button to "Sign in" during a
      // successful navigation reads as the attempt having failed, and invites
      // a second submit.
      window.location.assign(destination);
    } catch {
      // Distinguished from a server error, because the recovery differs
      // entirely: one is "check your connection", the other is "it is us".
      setFormError({ kind: 'offline' });
      setIsLoading(false);
    }
  }

  return (
    <AuthShell
      title="Sign in"
      description="Welcome back. Enter your details to reach your workspace."
      aside={ASIDES.signIn}
      footer={
        <p>
          New here? <Link href="/signup">Create an account</Link>
        </p>
      }
    >
      {sessionEnded && !linkError && !formError && (
        <Notice tone="neutral">
          {sessionEnded} Sign in to pick up where you left off.
        </Notice>
      )}

      {linkError && !formError && <Notice tone="warning">{linkError}</Notice>}

      {formError?.kind === 'credentials' && (
        <Notice tone="warning" title="That combination didn’t work">
          {/*
            Deliberately does not say which of the two was wrong. Telling
            somebody the address is fine and the password is not confirms an
            account exists at that address to anyone who types one in.
          */}
          Check the password, and that this is the address you signed up with.
          If you’ve forgotten it, you can{' '}
          <Link href="/forgot-password" className="font-medium underline underline-offset-2">
            set a new one
          </Link>
          .
        </Notice>
      )}

      {formError?.kind === 'rateLimited' && (
        <Notice tone="warning" title="Too many attempts">
          {formError.message} Trying again immediately extends the wait — give
          it a minute.
        </Notice>
      )}

      {formError?.kind === 'offline' && (
        <Notice tone="warning" title="We couldn’t reach the server">
          Your details weren’t sent anywhere. Check your connection and try
          again — nothing has been changed.
        </Notice>
      )}

      {formError?.kind === 'server' && (
        <Notice tone="warning" title="Something went wrong on our side">
          {formError.message}
        </Notice>
      )}

      {formError?.kind === 'unconfirmed' &&
        (resent ? (
          <Notice tone="success" title="New link sent">
            Check your inbox — the link is valid once. Look in spam if it isn’t
            there in a few minutes.
          </Notice>
        ) : (
          <Notice tone="warning" title="This account still needs confirming">
            <p>
              We sent a link when the account was created. Opening it activates
              the account, then you can sign in.
            </p>
            <button
              type="button"
              className="nm-btn nm-btn-secondary nm-btn-sm"
              style={{ marginTop: 'var(--nm-space-3)' }}
              onClick={resendConfirmation}
              disabled={resending || !email}
              aria-busy={resending || undefined}
            >
              {resending ? (
                <>
                  <Loader2 className="nm-spin" size={14} aria-hidden="true" />
                  Sending…
                </>
              ) : (
                'Send a new link'
              )}
            </button>
          </Notice>
        ))}

      {/* `noValidate`: the browser's own bubbles are unstyled, unlocalised,
          and disappear on the next click. The form validates itself. */}
      <form onSubmit={handleSubmit} noValidate className="nm-auth-form">
        <AuthField
          id="login-email"
          label="Email address"
          error={showing('email', errors.email)}
        >
          <AuthInput
            id="login-email"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => blur('email')}
            autoComplete="email"
            // The first field on a page whose only purpose is this form.
            // Nobody arrives here to read.
            autoFocus
            disabled={isLoading}
            invalid={!!showing('email', errors.email)}
          />
        </AuthField>

        <AuthField
          id="login-password"
          label="Password"
          error={showing('password', errors.password)}
        >
          {/* Function form: the input is wrapped by the reveal toggle, so the
              description has to be threaded onto the control explicitly.
              See `AuthField`. */}
          {(a11y) => (
            <AuthPasswordInput
              id="login-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => blur('password')}
              autoComplete="current-password"
              disabled={isLoading}
              invalid={!!showing('password', errors.password)}
              {...a11y}
            />
          )}
        </AuthField>

        {/* Below the password field, not beside its label: at 360px a link
            sharing a row with the label crowds it, and this is the control
            somebody reaches for when they are already frustrated. */}
        <div style={{ marginTop: 'calc(var(--nm-space-3) * -1)' }}>
          {/* A class rather than an inline size, so the touch-target rule in
              `refinements.css` can reach it — it measured 18px tall, and it is
              a link standing on its own rather than one inside a sentence. */}
          <Link href="/forgot-password" className="nm-link nm-auth-standalone-link">
            Forgot your password?
          </Link>
        </div>

        <AuthSubmit
          type="submit"
          className="nm-auth-submit"
          busy={isLoading}
          busyLabel="Signing in…"
        >
          Sign in
        </AuthSubmit>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  // `useSearchParams` needs a Suspense boundary to avoid opting the whole
  // route into client-side rendering.
  return (
    <Suspense fallback={<AuthLoading />}>
      <LoginForm />
    </Suspense>
  );
}
