'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Hexagon, Loader2, KeyRound, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
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
        <Loader2 className="size-6 animate-spin text-emerald-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center gap-2 mb-2">
            <Hexagon className="size-8 text-emerald-500" />
            <span className="text-2xl font-bold tracking-tight">NexusCorp</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {forced ? 'One step before you start' : 'Account security'}
          </p>
        </div>

        <Card className="border-gray-200 dark:border-gray-800 shadow-lg">
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl flex items-center gap-2">
              <KeyRound className="size-5 text-emerald-500" />
              Choose a new password
            </CardTitle>
            <CardDescription>
              {forced
                ? 'Your account is using a temporary password set by an administrator. Choose your own to continue — they cannot see whatever you pick.'
                : 'Enter your current password, then the new one you would like to use.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current">
                  {forced ? 'Temporary password' : 'Current password'}
                </Label>
                <Input
                  id="current"
                  type={show ? 'text' : 'password'}
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  required
                  autoFocus
                  autoComplete="current-password"
                  disabled={saving}
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="next">New password</Label>
                <div className="relative">
                  <Input
                    id="next"
                    type={show ? 'text' : 'password'}
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    disabled={saving}
                    className="h-11 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShow(!show)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={show ? 'Hide passwords' : 'Show passwords'}
                  >
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">Must be at least 8 characters</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm new password</Label>
                <Input
                  id="confirm"
                  type={show ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  disabled={saving}
                  className="h-11"
                />
              </div>

              <Button
                type="submit"
                className="w-full h-11 bg-emerald-500 hover:bg-emerald-600 text-white"
                disabled={saving || !current || !next || !confirm}
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
          </CardContent>

          <CardFooter className="flex flex-col gap-2">
            {forced ? (
              <>
                <p className="text-xs text-center text-muted-foreground">
                  This cannot be skipped — the rest of the workspace stays locked
                  until your password is your own.
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 w-full text-muted-foreground"
                  onClick={() => logout()}
                  disabled={saving}
                >
                  Sign out
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="h-9 w-full text-muted-foreground"
                onClick={() => router.push('/dashboard')}
                disabled={saving}
              >
                Back to dashboard
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
