'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Hexagon, Loader2, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useAppStore } from '@/store/app-store';
import { toast } from 'sonner';

/**
 * The step between having an account and having somewhere to work.
 *
 * A user reaches this state whenever they are authenticated but belong to no
 * organization — after confirming their email (signup with confirmation on
 * returns no session, so the organization cannot be created inline), or after
 * being removed from the last organization they belonged to.
 *
 * Without this screen such a user was sent to /dashboard, where every module
 * request failed `authorize()` and the shell showed "Authentication required"
 * with a Try again button that could never succeed — authenticated, but with
 * no route forward and no way to understand why.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const { logout } = useAppStore();
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checking, setChecking] = useState(true);

  // Someone who already has an organization has no business here — most often
  // a stale tab, or the back button after onboarding completed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/session');
        const json = await res.json();
        if (cancelled) return;
        const user = json?.data?.user;
        if (!user) {
          router.replace('/login');
          return;
        }
        if (!json?.data?.needsOrganization) {
          router.replace('/dashboard');
          return;
        }
        // The organization name typed during signup, carried through the
        // confirmation email in user metadata. Email confirmation means the
        // signup request cannot create the organization itself, and without
        // this the very first thing the product asks after confirming is a
        // question it already asked.
        const pending = json?.data?.user?.pendingOrganizationName;
        if (pending) setName(pending);
        setChecking(false);
      } catch {
        // Treat an unreachable session endpoint as "still needs onboarding"
        // rather than spinning: the form below is safe to show, and creating
        // an organization will surface the real error.
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error?.message || 'Could not create the organization.');
        return;
      }

      toast.success(`${name.trim()} is ready.`);
      // Full document navigation so the dashboard loads with a fresh request:
      // the membership this call just created changes what every subsequent
      // query is permitted to return.
      window.location.assign('/dashboard');
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
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
          <p className="text-sm text-muted-foreground">One more step</p>
        </div>

        <Card className="border-gray-200 dark:border-gray-800 shadow-lg">
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl">Create your organization</CardTitle>
            <CardDescription>
              Your account is confirmed, but it isn&apos;t attached to a workspace
              yet. Name your organization to finish setting up.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Organization name</Label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    id="name"
                    placeholder="Acme Inc."
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoFocus
                    disabled={isSubmitting}
                    className="h-11 pl-9"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  You&apos;ll be the owner, and can invite your team once inside.
                </p>
              </div>
              <Button
                type="submit"
                className="w-full h-11 bg-emerald-500 hover:bg-emerald-600 text-white"
                disabled={isSubmitting || !name.trim()}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Creating…
                  </>
                ) : (
                  'Create organization'
                )}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <p className="text-xs text-center text-muted-foreground">
              Joining a company that already uses NexusCorp? Open the invitation
              link from your email instead — it will add you to their workspace.
            </p>
            <Button
              type="button"
              variant="ghost"
              className="h-9 w-full text-muted-foreground"
              onClick={() => logout()}
              disabled={isSubmitting}
            >
              Sign out
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
