'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/store/app-store';
import { AppShell } from '@/components/layout/app-shell';

export default function DashboardPage() {
  const router = useRouter();
  const { isAuthenticated, needsOrganization, mustChangePassword, fetchUser } = useAppStore();
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
  }, [profileLoaded, isAuthenticated, mustChangePassword, needsOrganization, router]);

  if (!profileLoaded) {
    return (
      <div className="bg-background flex h-screen flex-col items-center justify-center gap-3">
        <div className="size-8 animate-spin rounded-full border-b-2 border-emerald-500" />
        <p className="text-muted-foreground text-sm">Loading your workspace…</p>
      </div>
    );
  }

  // Stale cookie, or a session with no organization — in both cases the
  // redirect above is already in flight.
  if (!isAuthenticated || mustChangePassword || needsOrganization) return null;

  return <AppShell />;
}
