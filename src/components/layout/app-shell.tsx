'use client';
import { useEffect } from 'react';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { ModuleContent } from './module-content';
import { CommandPalette } from './command-palette';
import { useAppStore } from '@/store/app-store';

export function AppShell() {
  const { fetchUser } = useAppStore();

  useEffect(() => {
    fetchUser();
  }, []);

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