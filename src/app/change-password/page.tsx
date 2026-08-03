'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Eye, EyeOff, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AuthShell } from '@/components/auth/auth-shell';
import { Notice } from '@/components/auth/notice';
import { Field } from '@/components/forms/field';
import { useAppStore } from '@/store/app-store';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

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
  const [show, setShow] = useState(false);
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
      <div className="bg-background flex min-h-screen items-center justify-center">
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
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
      footer={
        forced ? (
          <button
            type="button"
            onClick={() => logout()}
            disabled={saving}
            className="hover:text-foreground underline decoration-[1.5px] underline-offset-[3px] transition-colors disabled:opacity-50"
          >
            Sign out instead
          </button>
        ) : (
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            disabled={saving}
            className="hover:text-foreground underline decoration-[1.5px] underline-offset-[3px] transition-colors disabled:opacity-50"
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

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <Field id="current" label={forced ? 'Temporary password' : 'Current password'}>
          <Input
            id="current"
            type={show ? 'text' : 'password'}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoFocus
            autoComplete="current-password"
            disabled={saving}
            className="h-11"
          />
        </Field>

        <Field
          id="next"
          label="New password"
          error={unchanged ? 'This is the password you are replacing.' : null}
        >
          {(a11y) => (
            <div className="relative">
              <Input
                id="next"
                type={show ? 'text' : 'password'}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                disabled={saving}
                aria-invalid={unchanged}
                {...a11y}
                className="h-11 pr-12"
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 grid size-10 -translate-y-1/2 place-items-center rounded-md transition-colors"
                aria-label={show ? 'Hide passwords' : 'Show passwords'}
                aria-pressed={show}
                tabIndex={-1}
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          )}
        </Field>

        {!unchanged && (
          <p
            className={cn(
              '-mt-3 flex items-center gap-1.5 text-[0.75rem] transition-colors',
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
        )}

        <Field
          id="confirm"
          label="Confirm new password"
          error={mismatch ? 'These don’t match yet.' : null}
        >
          <Input
            id="confirm"
            type={show ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            disabled={saving}
            aria-invalid={mismatch}
            className="h-11"
          />
        </Field>

        <Button
          type="submit"
          variant="cta"
          size="xl"
          className="w-full"
          disabled={saving || !current || !longEnough || mismatch || unchanged}
        >
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Saving…
            </>
          ) : (
            'Change password'
          )}
        </Button>
      </form>
    </AuthShell>
  );
}
