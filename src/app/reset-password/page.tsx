'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { AuthShell, ASIDES } from '@/components/auth/auth-shell';
import {
  AuthField,
  AuthPasswordInput,
  AuthSubmit,
  PasswordRules,
} from '@/components/auth/fields';
import { toast } from 'sonner';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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
        aside={ASIDES.recovery}
      >
        <div
          className="nm-auth-panel"
          style={{
            marginTop: 'var(--nm-space-8)',
            background: 'var(--nm-accent-soft)',
            borderColor: 'transparent',
          }}
        >
          <CheckCircle2 className="nm-auth-panel-icon" size={20} aria-hidden="true" />
          {/*
            No screen is named here on purpose. The obvious sentence to write
            was "end your other sessions from Settings → Security" — and there
            is no such screen. `revoke_user_sessions()` exists, but it runs
            when an administrator suspends someone; a member cannot reach it.
            Sending a worried person to a settings page that does not have the
            control on it is worse than telling them who can help.
          */}
          <p className="nm-auth-panel-body">
            Changing a password does not, on its own, sign out sessions that are
            already active elsewhere. If you reset this because somebody else
            may have had access, tell a workspace administrator — they can
            revoke every session on the account.
          </p>
        </div>

        {/* An anchor, not a button wrapped in a link: nesting the two gives the
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
      title="Set a new password"
      description="Choose something you don't use anywhere else."
      aside={ASIDES.recovery}
    >
      <form onSubmit={handleSubmit} className="nm-auth-form">
        <AuthField id="new-password" label="New password">
          {(a11y) => (
            <AuthPasswordInput
              id="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              autoFocus
              disabled={isLoading}
              {...a11y}
            />
          )}
        </AuthField>

        {/* Acknowledges being met rather than restating itself for ever. The
            length is the server's only rule — see the note in signup. Sits
            outside the field's own message slot because it is a standing
            requirement, not a validation result. */}
        <div style={{ marginTop: 'calc(var(--nm-space-3) * -1)' }}>
          <PasswordRules rules={[{ label: 'At least 8 characters', met: longEnough }]} />
        </div>

        <AuthField
          id="confirm-password"
          label="Confirm password"
          /*
            Told here, at the field, rather than only as a toast on submit. The
            old form let you fill both boxes, press the button and lose the
            attempt to a notification in the corner — for a mistake it could see
            the moment it was made.
          */
          error={mismatch ? 'These don’t match yet.' : null}
        >
          {(a11y) => (
            <AuthPasswordInput
              id="confirm-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              disabled={isLoading}
              invalid={mismatch}
              {...a11y}
            />
          )}
        </AuthField>

        <AuthSubmit
          type="submit"
          className="nm-auth-submit"
          busy={isLoading}
          busyLabel="Updating…"
          disabled={mismatch || !longEnough}
        >
          Update password
        </AuthSubmit>
      </form>
    </AuthShell>
  );
}
