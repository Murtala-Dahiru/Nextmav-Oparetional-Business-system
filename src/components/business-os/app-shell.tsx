'use client';

import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useIsMobile } from '@/hooks/use-mobile';

import { Sidebar } from './sidebar';
import { Header } from './header';
import { ModuleContent } from './module-content';

// ── helpers ──────────────────────────────────────────────────────────────────
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ── app shell ─────────────────────────────────────────────────────────────────
export function AppShell() {
  const isMobile = useIsMobile();

  return (
    <div
      className={cn(
        'flex h-screen overflow-hidden bg-background',
      )}
    >
      {/* Sidebar – hidden on mobile (uses Sheet overlay instead) */}
      {!isMobile && <Sidebar />}

      {/* Right content area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <Header />
        <ModuleContent />
      </div>

      {/* Mobile sidebar overlay (Sheet) */}
      {isMobile && <Sidebar />}
    </div>
  );
}

export default AppShell;