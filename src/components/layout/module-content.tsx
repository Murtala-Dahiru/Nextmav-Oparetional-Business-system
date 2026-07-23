'use client';

import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/store/app-store';
import { MODULES, type ModuleId } from '@/lib/constants';

/* -------------------------------------------------------------------------- */
/*  Placeholder for modules that are not yet built                             */
/* -------------------------------------------------------------------------- */
function ModulePlaceholder({ name }: { name: string }) {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <div className="h-12 w-12 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mx-auto mb-4">
          <div className="h-6 w-6 rounded-full bg-emerald-500/20 animate-pulse" />
        </div>
        <h3 className="text-base font-medium text-foreground mb-1">Loading {name}...</h3>
        <p className="text-muted-foreground text-xs mb-4">Initializing {name} enterprise environment.</p>
        <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
          Reload View
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Lazy module imports                                                       */
/* -------------------------------------------------------------------------- */
const lazyModules: Record<ModuleId, React.LazyExoticComponent<React.ComponentType>> = {
  dashboard: React.lazy(() => import('@/components/modules/dashboard')),
  crm: React.lazy(() => import('@/components/modules/crm')),
  projects: React.lazy(() => import('@/components/modules/projects')),
  workspace: React.lazy(() => import('@/components/modules/workspace')),
  communication: React.lazy(() => import('@/components/modules/communication')),
  support: React.lazy(() => import('@/components/modules/support')),
  hr: React.lazy(() => import('@/components/modules/hr')),
  finance: React.lazy(() => import('@/components/modules/finance')),
  inventory: React.lazy(() => import('@/components/modules/inventory')),
  calendar: React.lazy(() => import('@/components/modules/calendar')),
  admin: React.lazy(() => import('@/components/modules/admin')),
};

/* -------------------------------------------------------------------------- */
/*  Loading skeleton                                                          */
/* -------------------------------------------------------------------------- */
function ModuleSkeleton() {
  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-4xl space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Module content wrapper with transitions                                   */
/* -------------------------------------------------------------------------- */
export function ModuleContent() {
  const { activeModule } = useAppStore();

  const ModuleComponent = lazyModules[activeModule];
  const moduleLabel = MODULES.find((m) => m.id === activeModule)?.label ?? 'Module';

  return (
    <main className="flex-1 overflow-hidden flex flex-col">
      <AnimatePresence mode="wait">
        <motion.div
          key={activeModule}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <React.Suspense fallback={<ModuleSkeleton />}>
            <ErrorBoundary fallback={<ModulePlaceholder name={moduleLabel} />}>
              <ModuleComponent />
            </ErrorBoundary>
          </React.Suspense>
        </motion.div>
      </AnimatePresence>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/*  Simple error boundary                                                     */
/* -------------------------------------------------------------------------- */
interface EBProps {
  children: React.ReactNode;
  fallback: React.ReactNode;
}

interface EBState {
  hasError: boolean;
}

class ErrorBoundary extends React.Component<EBProps, EBState> {
  constructor(props: EBProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): EBState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}