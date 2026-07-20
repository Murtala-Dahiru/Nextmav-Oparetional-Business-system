'use client';

import React, { lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useAppStore } from '@/store/app-store';
import type { ModuleId } from '@/types';
import type { ComponentType } from 'react';

// ── helpers ──────────────────────────────────────────────────────────────────
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ── lazy module imports ──────────────────────────────────────────────────────
const DashboardModule = lazy(() => import('./dashboard/dashboard-module'));
const CrmModule = lazy(() => import('./crm/crm-module'));
const WorkspaceModule = lazy(() => import('./workspace/workspace-module'));
const ProjectsModule = lazy(() => import('./projects/projects-module'));
const HrModule = lazy(() => import('./hr/hr-module'));
const FinanceModule = lazy(() => import('./finance/finance-module'));
const CommunicationModule = lazy(() => import('./communication/communication-module'));
const CalendarModule = lazy(() => import('./calendar/calendar-module'));
const FilesModule = lazy(() => import('./files/files-module'));
const AutomationModule = lazy(() => import('./automation/automation-module'));
const SupportModule = lazy(() => import('./support/support-module'));
const InventoryModule = lazy(() => import('./inventory/inventory-module'));
const ReportsModule = lazy(() => import('./reports/reports-module'));
const AdminModule = lazy(() => import('./admin/admin-module'));

// ── module map ───────────────────────────────────────────────────────────────
const MODULE_COMPONENTS: Record<ModuleId, ComponentType> = {
  dashboard: DashboardModule,
  crm: CrmModule,
  workspace: WorkspaceModule,
  projects: ProjectsModule,
  hr: HrModule,
  finance: FinanceModule,
  communication: CommunicationModule,
  calendar: CalendarModule,
  files: FilesModule,
  automation: AutomationModule,
  support: SupportModule,
  inventory: InventoryModule,
  reports: ReportsModule,
  admin: AdminModule,
};

// ── loading skeleton ─────────────────────────────────────────────────────────
function ModuleLoadingSkeleton() {
  return (
    <div className="space-y-6 p-1">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-9 w-32 animate-pulse rounded-md bg-muted" />
      </div>

      {/* KPI cards row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border bg-card p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
              <div className="h-8 w-8 animate-pulse rounded-lg bg-muted" />
            </div>
            <div className="h-7 w-32 animate-pulse rounded bg-muted" />
            <div className="h-3 w-20 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* Main content area */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border bg-card p-5 space-y-4">
          <div className="h-5 w-40 animate-pulse rounded bg-muted" />
          <div className="flex items-end gap-2 h-[200px]">
            {Array.from({ length: 7 }).map((_, i) => (
              <div
                key={i}
                className="flex-1 animate-pulse rounded-sm bg-muted"
                style={{ height: `${40 + Math.random() * 60}%` }}
              />
            ))}
          </div>
        </div>
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <div className="h-5 w-32 animate-pulse rounded bg-muted" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-full animate-pulse rounded bg-muted" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Table skeleton */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="p-5 space-y-3 border-b">
          <div className="h-5 w-36 animate-pulse rounded bg-muted" />
          <div className="h-9 w-64 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="divide-y">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3.5">
              <div className="h-4 w-4 animate-pulse rounded bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-1/3 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
              </div>
              <div className="h-6 w-16 animate-pulse rounded-full bg-muted" />
              <div className="h-4 w-20 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── transition variants ──────────────────────────────────────────────────────
const pageVariants = {
  initial: { opacity: 0, x: 12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -12 },
};

const pageTransition = {
  type: 'tween' as const,
  ease: 'easeInOut' as const,
  duration: 0.2,
};

// ── main component ───────────────────────────────────────────────────────────
export function ModuleContent() {
  const activeModule = useAppStore((s) => s.activeModule);
  const ActiveComponent = MODULE_COMPONENTS[activeModule];

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-muted/30">
      <AnimatePresence mode="wait">
        <motion.div
          key={activeModule}
          initial={pageVariants.initial}
          animate={pageVariants.animate}
          exit={pageVariants.exit}
          transition={pageTransition}
          className="mx-auto w-full max-w-[1600px]"
        >
          <Suspense fallback={<ModuleLoadingSkeleton />}>
            <ActiveComponent />
          </Suspense>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export default ModuleContent;