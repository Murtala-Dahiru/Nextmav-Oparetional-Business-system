'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2, Eye, EyeOff, MailCheck, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthShell } from '@/components/auth/auth-shell';
import { toast } from 'sonner';
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
 *
 * The advisory line below is separate, and worded as advice, for exactly that
 * reason: it never blocks the button.
 */
function meetsRequirement(pw: string) {
  return pw.length >= 8;
}

/** Advice, not a rule. Shown only once the actual requirement is satisfied. */
function isWeak(pw: string) {
  return pw.length < 12 && !(/[a-z]/i.test(pw) && /\d/.test(pw));
}

function SignupForm() {
  /**
   * Arriving from an invitation.
   *
   * The acceptance screen sends the token along when someone has to register
   * first. With it, the server resolves the invitation and stops requiring an
   * organization name — which is what an invitee had to invent before they
   * could join the company that invited them, ending up as the owner of a
   * workspace nobody asked for. Without it this page behaves exactly as before.
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

  function updateField(field: string, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsLoading(true);

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
        toast.error(data.error?.message || 'Signup failed. Please try again.');
        return;
      }

      // With email confirmation enabled the response carries no session, so
      // navigating to /dashboard would bounce straight back to /login with
      // nothing explaining why. Show what actually has to happen next.
      if (data.data?.requiresEmailConfirmation) {
        setConfirmationSent(true);
        return;
      }

      toast.success('Account created successfully!');
      // Full document navigation so middleware re-evaluates the httpOnly
      // session cookie set by the response above (see login page for detail).
      //
      // An invitee goes back to the invitation rather than to the dashboard:
      // they have an account and still belong nowhere, so the dashboard would
      // bounce them to onboarding — the screen they were sent here to avoid.
      window.location.assign(
        joining ? `/accept-invite?token=${encodeURIComponent(inviteToken!)}` : '/dashboard',
      );
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
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
   *
   * What it now does that it did not: name the inbox, say what the link does
   * when opened, and offer the two things somebody in this state actually
   * wants — a way back to the form when they mistyped the address, and the
   * spam-folder hint they will otherwise email support about.
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
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="firstName">First name</Label>
            <Input
              id="firstName"
              placeholder="Alex"
              value={formData.firstName}
              onChange={(e) => updateField('firstName', e.target.value)}
              required
              autoComplete="given-name"
              autoFocus
              disabled={isLoading}
              className="h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">Last name</Label>
            <Input
              id="lastName"
              placeholder="Morgan"
              value={formData.lastName}
              onChange={(e) => updateField('lastName', e.target.value)}
              required
              autoComplete="family-name"
              disabled={isLoading}
              className="h-11"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="signup-email">Work email</Label>
          <Input
            id="signup-email"
            type="email"
            placeholder="you@company.com"
            value={formData.email}
            onChange={(e) => updateField('email', e.target.value)}
            required
            autoComplete="email"
            disabled={isLoading}
            className="h-11"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="signup-password">Password</Label>
          <div className="relative">
            <Input
              id="signup-password"
              type={showPassword ? 'text' : 'password'}
              placeholder="Create a strong password"
              value={formData.password}
              onChange={(e) => updateField('password', e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              disabled={isLoading}
              className="h-11 pr-11"
              aria-describedby="password-requirements"
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

          <div id="password-requirements" className="space-y-1 pt-0.5">
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
        </div>

        {/*
          Not asked of an invitee. The workspace they are joining already
          exists — this field is how they used to end up owning a second
          one, which then followed them around for ever.
        */}
        {!joining && (
          <div className="space-y-2">
            <Label htmlFor="organization">Company name</Label>
            <Input
              id="organization"
              placeholder="Harlow Manufacturing"
              value={formData.organization}
              onChange={(e) => updateField('organization', e.target.value)}
              required
              autoComplete="organization"
              disabled={isLoading}
              className="h-11"
            />
            <p className="text-muted-foreground text-[0.75rem]">
              This names your workspace. You can change it later.
            </p>
          </div>
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
