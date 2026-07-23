'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/store/app-store';
import { AppShell } from '@/components/layout/app-shell';

export default function DashboardPage() {
  const router = useRouter();
  const { isAuthenticated, fetchUser } = useAppStore();
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
    if (profileLoaded && !isAuthenticated) {
      router.replace('/login');
    }
  }, [profileLoaded, isAuthenticated, router]);

  if (!profileLoaded) {
    return (
      <div className="bg-background flex h-screen flex-col items-center justify-center gap-3">
        <div className="size-8 animate-spin rounded-full border-b-2 border-emerald-500" />
        <p className="text-muted-foreground text-sm">Loading your workspace…</p>
      </div>
    );
  }

  // Stale cookie — the redirect above is already in flight.
  if (!isAuthenticated) return null;

  return <AppShell />;
}
