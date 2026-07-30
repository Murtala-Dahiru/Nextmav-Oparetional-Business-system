'use client';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { ModuleContent } from './module-content';
import { CommandPalette } from './command-palette';
import { usePresence } from '@/hooks/use-presence';
import { useAppStore } from '@/store/app-store';

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

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col h-screen overflow-hidden min-w-0">
        <Header />
        <ModuleContent />
        <CommandPalette />
      </div>
    </div>
  );
}
