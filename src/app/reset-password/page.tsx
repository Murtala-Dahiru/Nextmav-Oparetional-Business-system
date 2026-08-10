'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Loader2, CheckCircle2, Eye, EyeOff, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthShell } from '@/components/auth/auth-shell';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const longEnough = password.length >= 8;
  // Only a mismatch worth reporting once there is something to mismatch.
  // Validating on every keystroke from the first character means the field
  // spends most of its life displaying an error about an answer the person is
  // still in the middle of giving.
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error?.message || 'Failed to reset password');
        return;
      }

      setIsSuccess(true);
      toast.success('Password reset successfully!');
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  /**
   * ── The success state ─────────────────────────────────────────────────
   *
   * Says the one operationally important thing the old screen left out: other
   * sessions are unaffected. Somebody resetting a password because they think
   * an account is compromised needs to know that, and finding out later is the
   * kind of surprise that costs far more than the sentence does.
   */
  if (isSuccess) {
    return (
      <AuthShell
        eyebrow="Done"
        title="Your password has been updated"
        description="Use the new password the next time you sign in."
      >
        <div className="border-brand-line bg-brand-soft flex gap-4 rounded-xl border p-5">
          <CheckCircle2
            className="text-brand mt-0.5 size-5 shrink-0"
            strokeWidth={1.9}
            aria-hidden="true"
          />
          {/*
            No screen is named here on purpose. The obvious sentence to write
            was "end your other sessions from Settings → Security" — and there
            is no such screen. `revoke_user_sessions()` exists, but it runs
            when an administrator suspends someone; a member cannot reach it.
            Sending a worried person to a settings page that does not have the
            control on it is worse than telling them who can help.
          */}
          <p className="text-foreground/80 text-[0.875rem] leading-relaxed">
            Changing a password does not, on its own, sign out sessions that are
            already active elsewhere. If you reset this because somebody else
            may have had access, tell a workspace administrator — they can
            revoke every session on the account.
          </p>
        </div>

        <Button asChild variant="cta" size="xl" className="mt-6 w-full">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Set a new password"
      description="Choose something you don't use anywhere else."
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="new-password">New password</Label>
          <div className="relative">
            <Input
              id="new-password"
              type={showPassword ? 'text' : 'password'}
              placeholder=""
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              autoFocus
              disabled={isLoading}
              className="h-11 pr-11"
              aria-describedby="length-hint"
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
          {/* Acknowledges being met, rather than restating itself for ever.
              The rule is the server's only one — see the note in signup. */}
          <p
            id="length-hint"
            className={cn(
              'flex items-center gap-1.5 text-[0.75rem] transition-colors',
              longEnough ? 'text-brand' : 'text-muted-foreground',
            )}
          >
            <Check
              className={cn('size-3', longEnough ? 'opacity-100' : 'opacity-30')}
              strokeWidth={3}
              aria-hidden="true"
            />
            At least 8 characters
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm-password">Confirm password</Label>
          <div className="relative">
            <Input
              id="confirm-password"
              type={showConfirm ? 'text' : 'password'}
              placeholder=""
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              disabled={isLoading}
              className="h-11 pr-11"
              aria-invalid={mismatch}
              aria-describedby={mismatch ? 'confirm-error' : undefined}
            />
            <button
              type="button"
              onClick={() => setShowConfirm(!showConfirm)}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 transition-colors"
              aria-label={showConfirm ? 'Hide password' : 'Show password'}
            >
              {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {/*
            Told here, at the field, rather than only as a toast on submit.
            The old form let you fill both boxes, press the button and lose the
            attempt to a notification in the corner — for a mistake it could
            see the moment it was made.
          */}
          {mismatch && (
            <p id="confirm-error" role="alert" className="text-destructive text-[0.75rem]">
              These don’t match yet.
            </p>
          )}
        </div>

        <Button
          type="submit"
          variant="cta"
          size="xl"
          className="w-full"
          disabled={isLoading || mismatch || !longEnough}
        >
          {isLoading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Updating…
            </>
          ) : (
            'Update password'
          )}
        </Button>
      </form>
    </AuthShell>
  );
}
