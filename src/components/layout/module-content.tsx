'use client';

import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/store/app-store';
import { MODULES, type ModuleId } from '@/lib/constants';
import { log, serializeError } from '@/lib/logger';

/* -------------------------------------------------------------------------- */
/*  What a module shows when it crashes                                        */
/* -------------------------------------------------------------------------- */
/**
 * ── Why this replaced a loading spinner ───────────────────────────────────
 *
 * This fallback used to read "Loading {name}… Initializing {name} enterprise
 * environment", with a pulsing dot. It is the *error* boundary: it renders
 * only after a module has thrown and unmounted. So every crash in the product
 * — a bad currency code reaching Intl, an undefined field in a table cell,
 * a failed import — presented as a module that was still loading.
 *
 * That is the single most expensive kind of bug to have: nobody reports a
 * spinner. They wait, refresh, wait again, and conclude the product is slow
 * rather than broken. Meanwhile the actual exception is sitting in a console
 * nobody opened, and the screen is claiming to be busy doing something it has
 * already given up on.
 *
 * An honest error state costs one screen and saves every one of those
 * investigations. The message says what failed, the reason is shown rather
 * than hidden — it is the one piece of information a support conversation
 * actually needs — and the two things worth trying are offered directly.
 */
function ModuleErrorState({
  name,
  error,
  onRetry,
}: {
  name: string;
  error: Error | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="size-6" />
        </div>

        <h3 className="mb-1 text-base font-medium text-foreground">
          {name} could not be displayed
        </h3>
        <p className="mb-4 text-xs text-muted-foreground">
          Something in this module failed while rendering. Your data is safe —
          nothing was saved or changed by this error.
        </p>

        {/*
          The message is shown, not swallowed. It is usually the only clue
          available, and a user who can quote it turns an unreproducible
          report into a one-line fix.
        */}
        {error?.message && (
          <pre className="mb-4 max-h-32 overflow-auto rounded-md border bg-muted/50 p-3 text-left text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
            {error.message}
          </pre>
        )}

        <div className="flex items-center justify-center gap-2">
          {/*
            Retry re-mounts the module without discarding the session. A full
            reload is the heavier option and is offered second, because it
            costs every other module's state as well.
          */}
          <Button size="sm" onClick={onRetry} className="gap-1.5">
            <RotateCcw className="size-3.5" /> Try again
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
            Reload the page
          </Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Lazy module imports                                                       */
/* -------------------------------------------------------------------------- */
const lazyModules: Record<ModuleId, React.LazyExoticComponent<React.ComponentType>> = {
  dashboard: React.lazy(() => import('@/components/modules/dashboard')),
  mywork: React.lazy(() => import('@/components/modules/mywork')),
  portal: React.lazy(() => import('@/components/modules/portal')),
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
            {/*
              Keyed on the module so switching away from a crashed module and
              back resets the boundary. Without the key the fallback persists
              for the rest of the session and every other module the user
              opens appears broken too.
            */}
            <ErrorBoundary key={activeModule} moduleLabel={moduleLabel}>
              <ModuleComponent />
            </ErrorBoundary>
          </React.Suspense>
        </motion.div>
      </AnimatePresence>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/*  Error boundary                                                            */
/* -------------------------------------------------------------------------- */
interface EBProps {
  children: React.ReactNode;
  moduleLabel: string;
}

interface EBState {
  error: Error | null;
  /** Bumped by "Try again" to force the subtree to remount. */
  attempt: number;
}

/**
 * Catches a module crash and reports it.
 *
 * Holds the error itself rather than a boolean, so the fallback can show what
 * went wrong. `componentDidCatch` logs the component stack too — that is the
 * part that identifies *which* component threw, and it is not recoverable
 * from the error alone.
 */
class ErrorBoundary extends React.Component<EBProps, EBState> {
  constructor(props: EBProps) {
    super(props);
    this.state = { error: null, attempt: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<EBState> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    /**
     * The boundary was already doing the right thing and had nowhere to put
     * it. Through the logger it acquires a level, a structure, and — the
     * point of the exercise — a single place to attach an external provider,
     * so a module crashing in a customer's browser becomes something that can
     * be known about without the customer reporting it.
     */
    log.error('module crashed', {
      module: this.props.moduleLabel,
      componentStack: info.componentStack,
      err: serializeError(error),
    });
  }

  private retry = () => {
    this.setState(s => ({ error: null, attempt: s.attempt + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <ModuleErrorState
          name={this.props.moduleLabel}
          error={this.state.error}
          onRetry={this.retry}
        />
      );
    }
    // The key remounts the module's whole subtree on retry, so a component
    // that failed on bad state gets a genuinely fresh start rather than being
    // re-rendered into the same broken state.
    return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
  }
}