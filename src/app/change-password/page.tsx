'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AuthShell, AuthLoading, ASIDES } from '@/components/auth/auth-shell';
import { Notice } from '@/components/auth/notice';
import {
  AuthField,
  AuthInput,
  AuthPasswordInput,
  AuthSubmit,
  PasswordRules,
} from '@/components/auth/fields';
import { useAppStore } from '@/store/app-store';
import { toast } from 'sonner';

/**
 * Replace a temporary password.
 *
 * Reached two ways: forced, when an administrator provisioned the account or
 * reset its password, and voluntarily from profile settings. The difference is
 * only in the wording and whether there is a way out — the request is the same
 * either way, and always requires the current password.
 *
 * There is no skip. The server refuses every module while
 * `force_password_change` is set, so a skip button would lead somewhere that
 * answers 403 to everything; signing out is the only other exit, and it is
 * offered honestly rather than hidden.
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const { logout, fetchUser } = useAppStore();

  const [checking, setChecking] = useState(true);
  const [forced, setForced] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/session');
        const json = await res.json();
        if (cancelled) return;
        if (!json?.data?.user) {
          router.replace('/login');
          return;
        }
        setForced(!!json?.data?.mustChangePassword);
        setChecking(false);
      } catch {
        // Let them try: the change request will report the real problem.
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (next !== confirm) {
      toast.error('The two new passwords do not match');
      return;
    }
    if (next.length < 8) {
      toast.error('Your new password must be at least 8 characters');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error?.message || 'Could not change your password');
        return;
      }

      toast.success('Password changed.');
      // The flag is what the server was refusing on, so the store has to be
      // re-read before leaving — otherwise the dashboard sends them straight
      // back here on the stale value it already holds.
      await fetchUser();
      window.location.assign('/dashboard');
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (checking) {
    return (
      <AuthLoading />
    );
  }

  const longEnough = next.length >= 8;
  // Only report a mismatch once there is something to mismatch. Validating
  // from the first character means the field spends most of its life showing
  // an error about an answer still being given.
  const mismatch = confirm.length > 0 && next !== confirm;
  // Catches the most common failed attempt on this screen: pasting the
  // temporary password into both boxes. The server would refuse it; saying so
  // here saves a round trip and a confusing toast.
  const unchanged = next.length > 0 && next === current;

  return (
    <AuthShell
      eyebrow={forced ? 'One step before you start' : undefined}
      title="Choose a new password"
      description={
        forced
          ? 'This account is using a temporary password set by an administrator. Pick your own to continue — nobody else can see what you choose.'
          : 'Enter your current password, then the one you would like to use instead.'
      }
      aside={ASIDES.recovery}
      footer={
        forced ? (
          <button
            type="button"
            onClick={() => logout()}
            disabled={saving}
            className="nm-link"
          >
            Sign out instead
          </button>
        ) : (
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            disabled={saving}
            className="nm-link"
          >
            Back to dashboard
          </button>
        )
      }
    >
      {forced && (
        <Notice tone="neutral">
          {/*
            Stated up front rather than discovered. The server refuses every
            module while `force_password_change` is set, so somebody who goes
            looking for a way around this finds 403s and assumes the product is
            broken. There is no skip because a skip would lead nowhere.
          */}
          The rest of the workspace stays locked until this is done. There is no
          way to skip it, which is why there is no button that pretends there is.
        </Notice>
      )}

      {/*
        Each field now owns its own reveal toggle rather than sharing one
        "Show passwords" control for all three. The shared switch read well
        on this screen in particular — comparing a temporary password against
        a new one is exactly when you want both visible — but it carried
        `tabIndex={-1}`, so the only people who could use it were the ones who
        could already see the field. A per-field toggle in the tab order is
        worth more than the convenience it costs.
      */}
      <form onSubmit={handleSubmit} noValidate className="nm-auth-form">
        <AuthField id="current" label={forced ? 'Temporary password' : 'Current password'}>
          {(a11y) => (
            <AuthPasswordInput
              id="current"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoFocus
              autoComplete="current-password"
              disabled={saving}
              {...a11y}
            />
          )}
        </AuthField>

        <AuthField
          id="next"
          label="New password"
          error={unchanged ? 'This is the password you are replacing.' : null}
        >
          {(a11y) => (
            <AuthPasswordInput
              id="next"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              disabled={saving}
              invalid={unchanged}
              {...a11y}
            />
          )}
        </AuthField>

        {!unchanged && (
          <div style={{ marginTop: 'calc(var(--nm-space-3) * -1)' }}>
            <PasswordRules rules={[{ label: 'At least 8 characters', met: longEnough }]} />
          </div>
        )}

        <AuthField
          id="confirm"
          label="Confirm new password"
          error={mismatch ? 'These don’t match yet.' : null}
        >
          {(a11y) => (
            <AuthPasswordInput
              id="confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              disabled={saving}
              invalid={mismatch}
              {...a11y}
            />
          )}
        </AuthField>

        <AuthSubmit
          type="submit"
          className="nm-auth-submit"
          busy={saving}
          busyLabel="Saving…"
          disabled={!current || !longEnough || mismatch || unchanged}
        >
          Change password
        </AuthSubmit>
      </form>
    </AuthShell>
  );
}
