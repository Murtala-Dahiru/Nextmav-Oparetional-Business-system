'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Hexagon, Loader2, Building2, MailCheck, ShieldAlert } from 'lucide-react';
import { PLATFORM } from '@/lib/platform';
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
 *
 * ── The three arrivals it now tells apart ─────────────────────────────────
 *
 * "Belongs to no organization" turned out to be four situations wearing one
 * label, and this screen offered the same answer to all of them. For a new
 * signup that answer is right. For someone holding an invitation it is the
 * wrong screen — the workspace they want already exists. And for a suspended
 * or terminated employee it was a way back onto the platform as the owner of a
 * tenant of their own, which is the defect this whole pass exists to close.
 *
 * `mayCreateOrganization` comes from the server and is enforced there twice
 * over: `POST /api/organizations` refuses, and so does `create_organization()`
 * itself, so a REST client that skips this page gets nowhere either.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const { logout } = useAppStore();
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checking, setChecking] = useState(true);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [invitationWaiting, setInvitationWaiting] = useState(false);

  // Someone who already has an organization has no business here — most often
  // a stale tab, or the back button after onboarding completed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/session');
        const json = await res.json();
        if (cancelled) return;

        const payload = json?.data ?? {};
        const user = payload.user;

        /**
         * Access withdrawn. The session endpoint returns no user for these,
         * and sending them to /login would be a loop: their password is
         * perfectly good, so they would sign in and arrive straight back here.
         * The reason is shown instead, with the sign-out that actually helps.
         */
        if (!user && payload.accessMessage) {
          setBlocked(payload.accessMessage);
          setChecking(false);
          return;
        }

        if (!user) {
          router.replace('/login');
          return;
        }
        if (!payload.needsOrganization) {
          router.replace('/dashboard');
          return;
        }
        if (payload.pendingInvitations > 0) setInvitationWaiting(true);
        if (payload.mayCreateOrganization === false) {
          setBlocked(
            payload.pendingInvitations > 0
              ? null
              : 'This account cannot create a workspace. Ask an administrator at your organization to invite you.',
          );
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

  /**
   * No form at all when this account may not found a workspace.
   *
   * Rendering it disabled would be worse than not rendering it: a person whose
   * employment ended would be looking at the create-a-workspace screen, which
   * is precisely the invitation this page used to extend them.
   */
  if (blocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 p-4">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center mb-8">
            <div className="flex items-center gap-2 mb-2">
              <Hexagon className="size-8 text-emerald-500" />
              <span className="text-2xl font-bold tracking-tight">{PLATFORM.name}</span>
            </div>
          </div>
          <Card className="border-gray-200 dark:border-gray-800 shadow-lg">
            <CardHeader className="space-y-1">
              <div className="flex items-center gap-2">
                <ShieldAlert className="size-5 text-amber-500" />
                <CardTitle className="text-xl">No workspace access</CardTitle>
              </div>
              <CardDescription>{blocked}</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button
                type="button"
                variant="outline"
                className="h-10 w-full"
                onClick={() => logout()}
              >
                Sign out
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center gap-2 mb-2">
            <Hexagon className="size-8 text-emerald-500" />
            <span className="text-2xl font-bold tracking-tight">{PLATFORM.name}</span>
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
            {/*
              An invitation changes what this screen is for.
              Someone who was invited and then filled in this form ended up
              owning a workspace nobody asked for, and joined the real one
              afterwards — two organizations, one of them meaningless, for a
              person who only ever wanted to accept an invitation.
            */}
            {invitationWaiting && (
              <div className="mb-4 flex gap-3 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
                <MailCheck className="mt-0.5 size-4 shrink-0" />
                <p>
                  You have an invitation waiting. Open the link in your
                  invitation email to join that workspace — you do not need to
                  create one of your own.
                </p>
              </div>
            )}

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
              Joining a company that already uses {PLATFORM.name}? Open the invitation
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
