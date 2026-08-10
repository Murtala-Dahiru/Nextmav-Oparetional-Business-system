'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2, Eye, EyeOff, MailCheck, Check } from 'lucide-react';
import { AuthShell, AuthLoading, ASIDES } from '@/components/auth/auth-shell';
import { Notice } from '@/components/auth/notice';
import {
  AuthField,
  AuthInput,
  AuthPasswordInput,
  AuthSubmit,
  PasswordRules,
} from '@/components/auth/fields';
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
            <strong style={{ color: 'var(--nm-ink)' }}>{formData.email}</strong>.
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
              className="nm-link"
            >
              Go back and change it
            </button>
          </p>
        }
      >
        <div className="nm-auth-panel" style={{ marginTop: 'var(--nm-space-8)' }}>
          <MailCheck className="nm-auth-panel-icon" size={20} aria-hidden="true" />
          <div className="nm-auth-panel-body">
            <strong>The link is valid for one use.</strong>
            <p>
              If nothing arrives within a few minutes, check the spam folder —
              confirmation mail from a new domain is filtered more often than
              anything else we send.
            </p>
          </div>
        </div>

        {/* An anchor, not a button inside a link: nesting the two gives the
            control two conflicting roles in the accessibility tree. */}
        <Link
          href="/login"
          className="nm-btn nm-btn-primary nm-btn-lg"
          style={{ width: '100%', marginTop: 'var(--nm-space-6)' }}
        >
          Go to sign in
        </Link>
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
      // An invitee is joining an organisation that already exists, so the
      // trial pitch — which is for somebody founding one — is the wrong panel
      // to put beside their form.
      aside={joining ? ASIDES.invite : ASIDES.signUp}
      footer={
        <p>
          Already have an account? <Link href="/login">Sign in</Link>
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
            <Link href="/login" className="nm-link">
              Sign in instead
            </Link>
            , or{' '}
            <Link href="/forgot-password" className="nm-link">
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

      <form onSubmit={handleSubmit} noValidate className="nm-auth-form">
        <div className="nm-auth-row-2">
          <AuthField
            id="signup-firstName"
            label="First name"
            error={showing('firstName', errors.firstName)}
          >
            <AuthInput
              id="signup-firstName"
              value={formData.firstName}
              onChange={(e) => updateField('firstName', e.target.value)}
              onBlur={() => blur('firstName')}
              autoComplete="given-name"
              autoFocus
              disabled={isLoading}
              invalid={!!showing('firstName', errors.firstName)}
            />
          </AuthField>

          <AuthField
            id="signup-lastName"
            label="Last name"
            error={showing('lastName', errors.lastName)}
          >
            <AuthInput
              id="signup-lastName"
              value={formData.lastName}
              onChange={(e) => updateField('lastName', e.target.value)}
              onBlur={() => blur('lastName')}
              autoComplete="family-name"
              disabled={isLoading}
              invalid={!!showing('lastName', errors.lastName)}
            />
          </AuthField>
        </div>

        <AuthField id="signup-email" label="Work email" error={showing('email', errors.email)}>
          <AuthInput
            id="signup-email"
            type="email"
            inputMode="email"
            value={formData.email}
            onChange={(e) => updateField('email', e.target.value)}
            onBlur={() => blur('email')}
            autoComplete="email"
            disabled={isLoading}
            invalid={!!showing('email', errors.email)}
          />
        </AuthField>

        <AuthField
          id="signup-password"
          label="Password"
          error={showing('password', errors.password)}
        >
          {/* Function form: the input is wrapped for the reveal toggle, so the
              description has to be threaded onto the control. See `AuthField`. */}
          {(a11y) => (
            <AuthPasswordInput
              id="signup-password"
              value={formData.password}
              onChange={(e) => updateField('password', e.target.value)}
              onBlur={() => blur('password')}
              autoComplete="new-password"
              disabled={isLoading}
              invalid={!!showing('password', errors.password)}
              {...a11y}
            />
          )}
        </AuthField>

        {/*
          Sits outside `Field` on purpose. It is neither a hint nor an error:
          it is live acknowledgement, and it must remain visible *while* the
          error is showing rather than being replaced by it.
        */}
        {!showing('password', errors.password) && (
          <div
            style={{
              marginTop: 'calc(var(--nm-space-3) * -1)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--nm-space-1)',
            }}
          >
            <PasswordRules
              rules={[
                { label: 'At least 8 characters', met: meetsRequirement(formData.password) },
              ]}
            />
            {meetsRequirement(formData.password) && isWeak(formData.password) && (
              <p className="nm-field-help">
                Accepted — though a longer passphrase, or a number in the mix,
                would be considerably harder to guess.
              </p>
            )}
          </div>
        )}

        {!joining && (
          <AuthField
            id="signup-organization"
            label="Company name"
            hint="This names your workspace. You can change it later."
            error={showing('organization', errors.organization)}
          >
            <AuthInput
              id="signup-organization"
              value={formData.organization}
              onChange={(e) => updateField('organization', e.target.value)}
              onBlur={() => blur('organization')}
              autoComplete="organization"
              disabled={isLoading}
              invalid={!!showing('organization', errors.organization)}
            />
          </AuthField>
        )}

        <AuthSubmit
          type="submit"
          className="nm-auth-submit"
          busy={isLoading}
          busyLabel="Creating account…"
        >
          {joining ? 'Create account and join' : 'Create account'}
        </AuthSubmit>

        <p className="nm-auth-legal">
          By creating an account you agree to our <Link href="/terms">Terms</Link> and{' '}
          <Link href="/privacy">Privacy Policy</Link>.
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
        <AuthLoading />
      }
    >
      <SignupForm />
    </Suspense>
  );
}
