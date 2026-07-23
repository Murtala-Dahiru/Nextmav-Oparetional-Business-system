'use client';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { ModuleContent } from './module-content';
import { CommandPalette } from './command-palette';

export function AppShell() {
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