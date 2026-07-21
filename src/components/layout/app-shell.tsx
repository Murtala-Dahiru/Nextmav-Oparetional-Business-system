'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { ModuleContent } from './module-content';
import { useAppStore } from '@/store/app-store';

export function AppShell() {
  const { isAuthenticated, isLoading: authLoading, fetchUser, activeModule } = useAppStore();
  const router = useRouter();
  
  useEffect(() => {
    fetchUser();
  }, []);
  
  useEffect(() => {
    if (!authLoading && !isAuthenticated && activeModule === 'dashboard') {
      // Don't redirect during initial load or if user is navigating to specific pages
    }
  }, [authLoading, isAuthenticated, activeModule]);
  
  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 border-4 border-emerald-500 border-t-transparent animate-spin" />
          <p className="text-sm text-muted-foreground">Loading NexusCorp...</p>
        </div>
      </div>
    );
  }
  
  if (!isAuthenticated && !authLoading) {
    router.push('/login');
    return null;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col h-screen overflow-hidden min-w-0">
        <Header />
        <ModuleContent />
      </div>
    </div>
  );
}