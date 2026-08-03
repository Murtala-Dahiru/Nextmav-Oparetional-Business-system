'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2, Eye, EyeOff, MailCheck, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AuthShell } from '@/components/auth/auth-shell';
import { Notice } from '@/components/auth/notice';
import { Field } from '@/components/forms/field';
import { useFieldErrors } from '@/components/forms/use-field-errors';
import { cn } from '@/lib/utils';

/**
 * The password requirement, acknowledged as it is met.
 *
 * ── Why this replaced "Must be at least 8 characters" ────────────────────
 *
 * That line sat under the field permanently, in muted grey, saying the same
 * thing before you typed, while you typed, and after you had satisfied it. A
 * rule that never acknowledges being met is a rule the reader stops reading.
 *
 * ── Why there is only one item in this list ──────────────────────────────
 *
 * Because the server applies exactly one rule. `api/auth/signup` checks
 * `password.length < 8` and nothing else, and `validations.ts` agrees:
 * `z.string().min(8)`.
 *
 * The obvious thing to do here was add the familiar row of ticks — a capital,
 * a number, a symbol. It would have been a lie told by the interface: three
 * requirements that no part of the system enforces, refusing a password the
 * API would have accepted. A client-side checklist is a claim about the
 * server, and it is only worth showing while it is true of the server. If the
 * policy tightens, it tightens in `validations.ts` first and this follows.
 */
function meetsRequirement(pw: string) {
  return pw.length >= 8;
}

/** Advice, not a rule. Never blocks the button. */
function isWeak(pw: string) {
  return pw.length < 12 && !(/[a-z]/i.test(pw) && /\d/.test(pw));
}

type FormError =
  | { kind: 'duplicate' }
  | { kind: 'rateLimited'; message: string }
  | { kind: 'offline' }
  | { kind: 'server'; message: string };

const FIELDS = ['firstName', 'lastName', 'email', 'password', 'organization'] as const;
type FieldName = (typeof FIELDS)[number];

function SignupForm() {
  /**
   * Arriving from an invitation.
   *
   * The acceptance screen sends the token along when someone has to register
   * first. With it, the server resolves the invitation and stops requiring an
   * organization name — which is what an invitee had to invent before they
   * could join the company that invited them, ending up as the owner of a
   * workspace nobody asked for.
   */
  const inviteToken = useSearchParams().get('invite');
  const joining = !!inviteToken;

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    organization: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);

  const { blur, revealAll, showing } = useFieldErrors<FieldName>();

  const errors: Partial<Record<FieldName, string | null>> = {
    firstName: formData.firstName.trim() ? null : 'We need something to call you.',
    lastName: formData.lastName.trim() ? null : 'Please add a surname.',
    email: !formData.email.trim()
      ? 'We need an address to send the confirmation link to.'
      : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())
        ? null
        : 'That address is missing an @ or a domain.',
    password: meetsRequirement(formData.password)
      ? null
      : 'Passwords need at least 8 characters.',
    // Not asked of an invitee: the workspace they are joining already exists.
    // This field is how they used to end up owning a second one, which then
    // followed them around for ever.
    organization: joining
      ? null
      : formData.organization.trim()
        ? null
        : 'This names your workspace — your company name is usually right.',
  };

  // Invitees never see the organization field, so it must not be able to hold
  // the submit button hostage from off-screen.
  const activeFields = joining
    ? (FIELDS.filter((f) => f !== 'organization') as readonly FieldName[])
    : FIELDS;

  function updateField(field: FieldName, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!revealAll(activeFields, errors, 'signup-')) return;

    setIsLoading(true);
    setFormError(null);

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
          password: formData.password,
          organizationName: joining ? undefined : formData.organization,
          inviteToken,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        const message: string = data.error?.message ?? '';
        if (res.status === 429) {
          // Signup is rate limited hourly per address and per account. Saying
          // so beats "signup failed", which reads as a bug and invites the
          // retries that extend the window.
          setFormError({
            kind: 'rateLimited',
            message: message || 'Too many attempts from here in the last hour.',
          });
        } else if (/already|exists|registered/i.test(message)) {
          setFormError({ kind: 'duplicate' });
        } else if (res.status >= 500) {
          setFormError({
            kind: 'server',
            message: 'Something failed on our side. Nothing was created.',
          });
        } else {
          setFormError({ kind: 'server', message: message || 'That didn’t work.' });
        }
        return;
      }

      // With email confirmation enabled the response carries no session, so
      // navigating to /dashboard would bounce straight back to /login with
      // nothing explaining why. Show what actually has to happen next.
      if (data.data?.requiresEmailConfirmation) {
        setConfirmationSent(true);
        setIsLoading(false);
        return;
      }

      // Full document navigation so middleware re-evaluates the httpOnly
      // session cookie set by the response above (see login for detail).
      //
      // An invitee goes back to the invitation rather than to the dashboard:
      // they have an account and still belong nowhere, so the dashboard would
      // bounce them to onboarding — the screen they were sent here to avoid.
      //
      // `isLoading` stays true through the navigation; see login.
      window.location.assign(
        joining ? `/accept-invite?token=${encodeURIComponent(inviteToken!)}` : '/dashboard',
      );
    } catch {
      setFormError({ kind: 'offline' });
      setIsLoading(false);
    }
  }

  /**
   * ── Email verification ──────────────────────────────────────────────────
   *
   * A state, not a route. It is reachable only as the result of a submission
   * that just happened, so it has no URL of its own to be linked, bookmarked
   * or refreshed into — and giving it one would produce a page that says "we
   * sent a link to " with nothing after it.
   */
  if (confirmationSent) {
    return (
      <AuthShell
        eyebrow="One step left"
        title="Confirm your email address"
        description={
          <>
            We sent a link to{' '}
            <span className="text-foreground font-medium">{formData.email}</span>.
            {joining
              ? ' Opening it brings you straight back to your invitation.'
              : ' Open it to activate the account, then sign in to finish setting up your workspace.'}
          </>
        }
        footer={
          <p>
            Wrong address?{' '}
            <button
              type="button"
              onClick={() => setConfirmationSent(false)}
              className="text-foreground font-medium underline decoration-[1.5px] underline-offset-[3px] hover:no-underline"
            >
              Go back and change it
            </button>
          </p>
        }
      >
        <div className="border-hairline bg-surface flex gap-4 rounded-xl border p-5">
          <MailCheck
            className="text-brand mt-0.5 size-5 shrink-0"
            strokeWidth={1.9}
            aria-hidden="true"
          />
          <div className="space-y-1.5 text-[0.875rem] leading-relaxed">
            <p className="font-medium">The link is valid for one use.</p>
            <p className="text-muted-foreground">
              If nothing arrives within a few minutes, check the spam folder —
              confirmation mail from a new domain is filtered more often than
              anything else we send.
            </p>
          </div>
        </div>

        <Button asChild variant="cta" size="xl" className="mt-6 w-full">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={joining ? 'Accept your invitation' : 'Create your workspace'}
      description={
        joining
          ? 'Create an account to join. Use the email address the invitation was sent to.'
          : 'Free for 14 days. Every module included, and no card required.'
      }
      footer={
        <p>
          Already have an account?{' '}
          <Link
            href="/login"
            className="text-foreground font-medium underline decoration-[1.5px] underline-offset-[3px] hover:no-underline"
          >
            Sign in
          </Link>
        </p>
      }
    >
      {formError?.kind === 'duplicate' && (
        <Notice tone="warning" title="That address already has an account">
          {/*
            Signup cannot avoid disclosing this — the server has to refuse a
            duplicate — so the useful thing is to route them rather than leave
            them re-reading the form.
          */}
          <p>
            <Link href="/login" className="font-medium underline underline-offset-2">
              Sign in instead
            </Link>
            , or{' '}
            <Link
              href="/forgot-password"
              className="font-medium underline underline-offset-2"
            >
              set a new password
            </Link>{' '}
            if you’ve forgotten it.
          </p>
        </Notice>
      )}

      {formError?.kind === 'rateLimited' && (
        <Notice tone="warning" title="Too many attempts">
          {formError.message} Trying again immediately extends the wait.
        </Notice>
      )}

      {formError?.kind === 'offline' && (
        <Notice tone="warning" title="We couldn’t reach the server">
          No account was created and nothing was sent. Check your connection and
          try again.
        </Notice>
      )}

      {formError?.kind === 'server' && (
        <Notice tone="warning" title="That didn’t work">
          {formError.message}
        </Notice>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <Field
            id="signup-firstName"
            label="First name"
            error={showing('firstName', errors.firstName)}
          >
            <Input
              id="signup-firstName"
              placeholder="Alex"
              value={formData.firstName}
              onChange={(e) => updateField('firstName', e.target.value)}
              onBlur={() => blur('firstName')}
              autoComplete="given-name"
              autoFocus
              disabled={isLoading}
              aria-invalid={!!showing('firstName', errors.firstName)}
              className="h-11"
            />
          </Field>

          <Field
            id="signup-lastName"
            label="Last name"
            error={showing('lastName', errors.lastName)}
          >
            <Input
              id="signup-lastName"
              placeholder="Morgan"
              value={formData.lastName}
              onChange={(e) => updateField('lastName', e.target.value)}
              onBlur={() => blur('lastName')}
              autoComplete="family-name"
              disabled={isLoading}
              aria-invalid={!!showing('lastName', errors.lastName)}
              className="h-11"
            />
          </Field>
        </div>

        <Field id="signup-email" label="Work email" error={showing('email', errors.email)}>
          <Input
            id="signup-email"
            type="email"
            inputMode="email"
            placeholder="you@company.com"
            value={formData.email}
            onChange={(e) => updateField('email', e.target.value)}
            onBlur={() => blur('email')}
            autoComplete="email"
            disabled={isLoading}
            aria-invalid={!!showing('email', errors.email)}
            className="h-11"
          />
        </Field>

        <Field
          id="signup-password"
          label="Password"
          error={showing('password', errors.password)}
        >
          {/* Function form: the input is wrapped for the show/hide button, so
              the description has to be threaded onto the control. See `Field`. */}
          {(a11y) => (
            <div className="relative">
              <Input
                id="signup-password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Create a strong password"
                value={formData.password}
                onChange={(e) => updateField('password', e.target.value)}
                onBlur={() => blur('password')}
                autoComplete="new-password"
                disabled={isLoading}
                aria-invalid={!!showing('password', errors.password)}
                {...a11y}
                className="h-11 pr-12"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 grid size-10 -translate-y-1/2 place-items-center rounded-md transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          )}
        </Field>

        {/*
          Sits outside `Field` on purpose. It is neither a hint nor an error:
          it is live acknowledgement, and it must remain visible *while* the
          error is showing rather than being replaced by it.
        */}
        {!showing('password', errors.password) && (
          <div className="-mt-3 space-y-1">
            <p
              className={cn(
                'flex items-center gap-1.5 text-[0.75rem] transition-colors',
                meetsRequirement(formData.password) ? 'text-brand' : 'text-muted-foreground',
              )}
            >
              <Check
                className={cn(
                  'size-3 transition-opacity',
                  meetsRequirement(formData.password) ? 'opacity-100' : 'opacity-30',
                )}
                strokeWidth={3}
                aria-hidden="true"
              />
              At least 8 characters
            </p>
            {meetsRequirement(formData.password) && isWeak(formData.password) && (
              <p className="text-muted-foreground text-[0.75rem]">
                Accepted — though a longer passphrase, or a number in the mix,
                would be considerably harder to guess.
              </p>
            )}
          </div>
        )}

        {!joining && (
          <Field
            id="signup-organization"
            label="Company name"
            hint="This names your workspace. You can change it later."
            error={showing('organization', errors.organization)}
          >
            <Input
              id="signup-organization"
              placeholder="Harlow Manufacturing"
              value={formData.organization}
              onChange={(e) => updateField('organization', e.target.value)}
              onBlur={() => blur('organization')}
              autoComplete="organization"
              disabled={isLoading}
              aria-invalid={!!showing('organization', errors.organization)}
              className="h-11"
            />
          </Field>
        )}

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
              Creating account…
            </>
          ) : joining ? (
            'Create account and join'
          ) : (
            'Create account'
          )}
        </Button>

        <p className="text-muted-foreground text-center text-[0.75rem] leading-relaxed">
          By creating an account you agree to our{' '}
          <Link href="/terms" className="hover:text-foreground underline underline-offset-2">
            Terms
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="hover:text-foreground underline underline-offset-2">
            Privacy Policy
          </Link>
          .
        </p>
      </form>
    </AuthShell>
  );
}

/**
 * `useSearchParams` needs a Suspense boundary to keep this route
 * prerenderable — the same shape `/accept-invite` and `/login` already use.
 */
export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="bg-background flex min-h-screen items-center justify-center">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </div>
      }
    >
      <SignupForm />
    </Suspense>
  );
}
