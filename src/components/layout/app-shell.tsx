'use client';
import '@/styles/application.css';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { ModuleContent } from './module-content';
import { CommandPalette } from './command-palette';
import { usePresence } from '@/hooks/use-presence';
import { SessionGuard } from './session-guard';
import { useAppStore } from '@/store/app-store';
import { useEffect } from 'react';
import { MODULES } from '@/lib/constants';

export function AppShell() {
  /**
   * The heartbeat, mounted once for the whole application.
   *
   * Here rather than in any module because presence is a property of the
   * session, not of whatever screen happens to be open — somebody reading the
   * dashboard is exactly as present as somebody in the chat, and a hook per
   * module would mean the beat stopping whenever they navigated.
   *
   * Gated on being signed in so a login page left open overnight is not
   * reporting an authenticated user's presence every forty-five seconds.
   */
  const isAuthenticated = useAppStore(s => s.isAuthenticated);
  usePresence(isAuthenticated);
  useEffect(() => {
    // Another tab can sign out, change accounts or explicitly select a workspace.
    // Discard the old record URL and component data when this tab resumes.
    let disposed = false;
    let checking = false;
    async function verifyContext() {
      if (checking || document.visibilityState !== 'visible') return;
      const current = useAppStore.getState().user;
      if (!current) return;
      checking = true;
      try {
        const response = await fetch('/api/auth/session', { cache: 'no-store' });
        if (!response.ok || disposed) return;
        const session = (await response.json()).data?.user;
        if (!disposed && (session?.id !== current.id || session?.organizationId !== current.organizationId || session?.role !== current.role)) {
          window.location.replace('/dashboard');
        }
      } catch {
        // A network interruption does not establish a change of identity.
      } finally { checking = false; }
    }
    const restored = (event: PageTransitionEvent) => { if (event.persisted) void verifyContext(); };
    document.addEventListener('visibilitychange', verifyContext);
    window.addEventListener('pageshow', restored);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', verifyContext);
      window.removeEventListener('pageshow', restored);
    };
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const moduleId = params.get('module');
    const target = MODULES.find(m => m.id === moduleId);
    if (!target) return;
    const type = ['channel', 'case', 'member', 'interview', 'review', 'goal', 'event', 'page', 'agreement', 'commercial', 'task', 'project', 'ticket', 'lead', 'deal', 'company', 'contact', 'invoice', 'expense'].find(key => params.has(key));
    if (type) useAppStore.getState().openRecord(target.id, type === 'case' ? 'hr_case' : type, params.get(type)!);
    else useAppStore.getState().setActiveModule(target.id);
  }, []);

  return (
    <div className="nm-app flex overflow-hidden bg-background">
      {/*
        The first thing in the tab order, and invisible until it is reached.

        The sidebar is thirteen buttons plus an account menu, and it is on
        every screen — so without this, reaching the actual work by keyboard
        means tabbing past the whole of the navigation, every time, on every
        module. One link, and the cost is a keystroke.
      */}
      <a
        href="#module-content"
        className="sr-only rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
      >
        Skip to content
      </a>

      <Sidebar />
      <div className="nm-app-frame flex-1 flex flex-col overflow-hidden min-w-0">
        <Header />
        <ModuleContent />
        <CommandPalette />
        {/*
          Mounted beside the palette, at the shell level, for the same reason
          the heartbeat is: a session belongs to the application rather than to
          whichever module happens to be open, and a warning that unmounted on
          navigation would be a warning nobody sees.
        */}
        <SessionGuard />
      </div>
    </div>
  );
}
