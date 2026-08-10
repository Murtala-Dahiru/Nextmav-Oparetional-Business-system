'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Loader2, ArrowLeft, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthShell } from '@/components/auth/auth-shell';
import { toast } from 'sonner';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error?.message || 'Something went wrong. Please try again.');
        return;
      }

      setIsSubmitted(true);
      // The toast said "Password reset link sent to your email", which is a
      // claim the response deliberately does not make: this endpoint answers
      // identically whether or not the address has an account, so that the
      // form cannot be used to discover who has one. Announcing a send that
      // may not have happened undoes that in the interface.
      toast.success('If that address has an account, a link is on its way.');
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  /**
   * ── The confirmation state ────────────────────────────────────────────
   *
   * Worded carefully. The old copy — "We've sent a password reset link to
   * alex@acme.com" — asserts that an account exists at that address to anyone
   * who types one in, which is precisely the enumeration the API is written to
   * prevent. The screen was quietly leaking what the endpoint refused to.
   */
  if (isSubmitted) {
    return (
      <AuthShell
        eyebrow="Check your inbox"
        title="If that address has an account, the link is on its way"
        description={
          <>
            {/* No expiry stated. The lifetime is Supabase's setting, not this
                application's, so any duration printed here would be a number
                the page cannot actually know. */}
            We sent it to{' '}
            <span className="text-foreground font-medium">{email}</span>. The
            link can be used once.
          </>
        }
        footer={
          <Link
            href="/login"
            className="hover:text-foreground inline-flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            Back to sign in
          </Link>
        }
      >
        <div className="border-hairline bg-surface flex gap-4 rounded-xl border p-5">
          <MailCheck
            className="text-brand mt-0.5 size-5 shrink-0"
            strokeWidth={1.9}
            aria-hidden="true"
          />
          <p className="text-muted-foreground text-[0.875rem] leading-relaxed">
            Nothing after a few minutes? Check the spam folder, then confirm the
            address is the one you signed up with — a typo produces exactly this
            screen.
          </p>
        </div>

        <Button
          variant="ctaOutline"
          size="xl"
          className="mt-6 w-full"
          onClick={() => {
            setIsSubmitted(false);
            setEmail('');
          }}
        >
          Try a different address
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      description="Enter the address you sign in with and we'll send a link to set a new password."
      footer={
        <Link
          href="/login"
          className="hover:text-foreground inline-flex items-center gap-1.5 transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="reset-email">Email address</Label>
          <Input
            id="reset-email"
            type="email"
            placeholder=""
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            autoFocus
            disabled={isLoading}
            className="h-11"
          />
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
              Sending…
            </>
          ) : (
            'Send reset link'
          )}
        </Button>
      </form>
    </AuthShell>
  );
}
