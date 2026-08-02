'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Hexagon, ShieldAlert } from 'lucide-react';
import { PLATFORM } from '@/lib/platform';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useAppStore } from '@/store/app-store';
import { AppShell } from '@/components/layout/app-shell';

export default function DashboardPage() {
  const router = useRouter();
  const {
    isAuthenticated, needsOrganization, mustChangePassword, accessMessage, logout, fetchUser,
  } = useAppStore();
  const [profileLoaded, setProfileLoaded] = useState(false);
  const fetchStarted = useRef(false);

  // Middleware already guaranteed a session cookie before this page was served,
  // so this is a profile load rather than an auth gate. It still handles the
  // edge case of a cookie that is present but no longer valid (expired or
  // revoked server-side), which middleware cannot detect from the cookie alone.
  useEffect(() => {
    if (fetchStarted.current) return;
    fetchStarted.current = true;
    fetchUser().then(() => setProfileLoaded(true));
  }, [fetchUser]);

  useEffect(() => {
    if (!profileLoaded) return;
    // A withdrawn account is handled in place, below. Redirecting it to /login
    // would send someone whose password still works back to a form that lets
    // them straight in again, to be refused a second time with no explanation.
    if (accessMessage) return;
    if (!isAuthenticated) {
      router.replace('/login');
    } else if (mustChangePassword) {
      // The server refuses every module while a temporary password is in
      // place, so rendering the shell here would show a dashboard whose every
      // panel reports 403. This redirect is a courtesy, not the enforcement —
      // that lives in authorize().
      router.replace('/change-password');
    } else if (needsOrganization) {
      // Valid session, no membership. Rendering the shell here would leave
      // every module failing authorization with a Try again that can never
      // succeed, so send them to the step that actually unblocks them.
      router.replace('/onboarding');
    }
  }, [profileLoaded, isAuthenticated, mustChangePassword, needsOrganization, accessMessage, router]);

  if (!profileLoaded) {
    return (
      <div className="bg-background flex h-screen flex-col items-center justify-center gap-3">
        <div className="size-8 animate-spin rounded-full border-b-2 border-emerald-500" />
        <p className="text-muted-foreground text-sm">Loading your workspace…</p>
      </div>
    );
  }

  /**
   * Suspended, terminated, removed or disabled.
   *
   * Said out loud rather than expressed as a redirect. Every one of these used
   * to arrive at /onboarding — the same screen a new signup sees — where the
   * create-a-workspace form let a terminated employee back onto the platform as
   * the owner of a tenant of their own. The screen now names what happened and
   * offers the only action that is any use.
   */
  if (accessMessage) {
    return (
      <div className="bg-background flex h-screen items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="mb-8 flex flex-col items-center">
            <div className="mb-2 flex items-center gap-2">
              <Hexagon className="size-8 text-emerald-500" />
              <span className="text-2xl font-bold tracking-tight">{PLATFORM.name}</span>
            </div>
          </div>
          <Card className="shadow-lg">
            <CardHeader className="space-y-1">
              <div className="flex items-center gap-2">
                <ShieldAlert className="size-5 text-amber-500" />
                <CardTitle className="text-xl">Access unavailable</CardTitle>
              </div>
              <CardDescription>{accessMessage}</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button variant="outline" className="h-10 w-full" onClick={() => logout()}>
                Sign out
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

  // Stale cookie, or a session with no organization — in both cases the
  // redirect above is already in flight.
  if (!isAuthenticated || mustChangePassword || needsOrganization) return null;

  return <AppShell />;
}
