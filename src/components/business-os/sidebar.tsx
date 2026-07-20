'use client';

import React, { useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Users,
  BookOpen,
  FolderKanban,
  UserCog,
  DollarSign,
  MessageSquare,
  Calendar,
  Folder,
  Workflow,
  LifeBuoy,
  Package,
  BarChart3,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  Hexagon,
  type LucideIcon,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { useAppStore } from '@/store/app-store';
import { useIsMobile } from '@/hooks/use-mobile';
import type { ModuleId } from '@/types';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';

// ── helpers ──────────────────────────────────────────────────────────────────
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ── nav definition ───────────────────────────────────────────────────────────
interface NavDef {
  id: ModuleId;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

const NAV_ITEMS: NavDef[] = [
  { id: 'dashboard',     label: 'Dashboard',     icon: LayoutDashboard },
  { id: 'crm',           label: 'CRM',           icon: Users,          badge: 12 },
  { id: 'workspace',     label: 'Workspace',     icon: BookOpen },
  { id: 'projects',      label: 'Projects',      icon: FolderKanban,   badge: 5 },
  { id: 'hr',            label: 'HR',            icon: UserCog },
  { id: 'finance',       label: 'Finance',       icon: DollarSign },
  { id: 'communication', label: 'Communication',  icon: MessageSquare,  badge: 8 },
  { id: 'calendar',      label: 'Calendar',      icon: Calendar },
  { id: 'files',         label: 'Files',         icon: Folder },
  { id: 'automation',    label: 'Automation',    icon: Workflow },
  { id: 'support',       label: 'Support',       icon: LifeBuoy,       badge: 3 },
  { id: 'inventory',     label: 'Inventory',     icon: Package },
  { id: 'reports',       label: 'Reports',       icon: BarChart3 },
  { id: 'admin',         label: 'Administration', icon: Settings },
];

// ── sub-component: single nav item ──────────────────────────────────────────
function SidebarNavItem({
  item,
  isActive,
  collapsed,
  onClick,
}: {
  item: NavDef;
  isActive: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;

  const button = (
    <button
      onClick={onClick}
      aria-label={item.label}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50',
        isActive
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        collapsed && 'justify-center px-0',
      )}
    >
      {/* Active left-border accent */}
      {isActive && (
        <motion.span
          layoutId="sidebar-active-indicator"
          className="absolute inset-y-0 left-0 w-[3px] rounded-r-full bg-emerald-500"
          transition={{ type: 'spring', stiffness: 350, damping: 30 }}
        />
      )}

      <Icon
        className={cn(
          'size-5 shrink-0 transition-colors',
          isActive
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-muted-foreground group-hover:text-foreground',
        )}
      />

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="truncate whitespace-nowrap overflow-hidden"
          >
            {item.label}
          </motion.span>
        )}
      </AnimatePresence>

      {/* Badge */}
      {item.badge != null && item.badge > 0 && (
        <AnimatePresence initial={false}>
          {!collapsed ? (
            <motion.span
              key="badge-inline"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className={cn(
                'ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
                isActive
                  ? 'bg-emerald-500 text-white'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {item.badge}
            </motion.span>
          ) : (
            <motion.span
              key="badge-dot"
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0 }}
              className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background dark:ring-sidebar-background"
            />
          )}
        </AnimatePresence>
      )}
    </button>
  );

  // In collapsed mode, wrap with Tooltip so the label is still visible
  if (collapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={12}>
          <p>{item.label}</p>
          {item.badge != null && item.badge > 0 && (
            <span className="ml-1.5 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
              {item.badge}
            </span>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  return button;
}

// ── sub-component: the actual nav list (shared between desktop & mobile) ─────
function NavList({
  collapsed = false,
  onItemClick,
}: {
  collapsed?: boolean;
  onItemClick?: () => void;
}) {
  const activeModule = useAppStore((s) => s.activeModule);
  const setActiveModule = useAppStore((s) => s.setActiveModule);

  const handleSelect = useCallback(
    (id: ModuleId) => {
      setActiveModule(id);
      onItemClick?.();
    },
    [setActiveModule, onItemClick],
  );

  return (
    <nav className="flex flex-col gap-1 px-3 py-2">
      {NAV_ITEMS.map((item) => (
        <SidebarNavItem
          key={item.id}
          item={item}
          isActive={activeModule === item.id}
          collapsed={collapsed}
          onClick={() => handleSelect(item.id)}
        />
      ))}
    </nav>
  );
}

// ── desktop sidebar ──────────────────────────────────────────────────────────
function DesktopSidebar() {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);

  return (
    <motion.aside
      data-slot="sidebar"
      initial={false}
      animate={{ width: sidebarCollapsed ? 72 : 260 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className={cn(
        'relative z-30 hidden h-full flex-col border-r bg-card md:flex',
        'border-border/60 dark:border-border/40',
      )}
    >
      {/* ── Logo / brand ── */}
      <div className="flex h-16 items-center border-b border-border/60 dark:border-border/40 px-4">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-white shadow-sm shadow-emerald-500/25">
            <Hexagon className="size-5" strokeWidth={2.2} />
          </div>
          <AnimatePresence initial={false}>
            {!sidebarCollapsed && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className="overflow-hidden whitespace-nowrap"
              >
                <span className="text-lg font-bold tracking-tight text-foreground">
                  NexusCorp
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Navigation ── */}
      <ScrollArea className="flex-1">
        <NavList collapsed={sidebarCollapsed} />
      </ScrollArea>

      {/* ── Collapse toggle ── */}
      <div className="border-t border-border/60 dark:border-border/40 p-3">
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size={sidebarCollapsed ? 'icon' : 'default'}
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={cn(
                'w-full',
                sidebarCollapsed ? 'justify-center' : 'justify-start gap-2',
              )}
            >
              {sidebarCollapsed ? (
                <ChevronsRight className="size-4 text-muted-foreground" />
              ) : (
                <>
                  <ChevronsLeft className="size-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Collapse</span>
                </>
              )}
            </Button>
          </TooltipTrigger>
          {sidebarCollapsed && (
            <TooltipContent side="right" sideOffset={12}>
              Expand sidebar
            </TooltipContent>
          )}
        </Tooltip>
      </div>
    </motion.aside>
  );
}

// ── mobile sidebar (Sheet) ───────────────────────────────────────────────────
function MobileSidebar() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);

  const handleClose = useCallback(() => {
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  return (
    <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <SheetContent
        side="left"
        className="w-[280px] p-0 bg-card"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Visually hidden title for a11y (required by Radix) */}
        <SheetTitle className="sr-only">Navigation Menu</SheetTitle>

        {/* ── Logo ── */}
        <div className="flex h-16 items-center gap-3 border-b border-border/60 dark:border-border/40 px-4">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-white shadow-sm shadow-emerald-500/25">
            <Hexagon className="size-5" strokeWidth={2.2} />
          </div>
          <span className="text-lg font-bold tracking-tight text-foreground">
            NexusCorp
          </span>
        </div>

        {/* ── Navigation ── */}
        <ScrollArea className="flex-1">
          <NavList onItemClick={handleClose} />
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ── public export ────────────────────────────────────────────────────────────
export function Sidebar() {
  const isMobile = useIsMobile();

  // On mobile the sidebar is always the Sheet overlay; on desktop it's the
  // persistent panel that supports collapse.
  return isMobile ? <MobileSidebar /> : <DesktopSidebar />;
}

export default Sidebar;