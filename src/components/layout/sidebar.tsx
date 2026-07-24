'use client';

import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Users,
  FolderKanban,
  BookOpen,
  MessageSquare,
  LifeBuoy,
  UserCog,
  DollarSign,
  Package,
  Calendar,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  Hexagon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MODULES, ROLE_PERMISSIONS, type ModuleId } from '@/lib/constants';
import { useAppStore } from '@/store/app-store';
import { useIsMobile } from '@/hooks/use-mobile';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

const iconMap: Record<string, React.ElementType> = {
  LayoutDashboard,
  Users,
  FolderKanban,
  BookOpen,
  MessageSquare,
  LifeBuoy,
  UserCog,
  DollarSign,
  Package,
  Calendar,
  Settings,
};

const SIDEBAR_EXPANDED = 260;
const SIDEBAR_COLLAPSED = 68;

/* -------------------------------------------------------------------------- */
/*  Nav content shared between desktop sidebar & mobile sheet                  */
/* -------------------------------------------------------------------------- */
function SidebarNav({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { activeModule, setActiveModule, visibleModules: allowedIds } = useAppStore();

  const handleNav = (id: ModuleId) => {
    setActiveModule(id);
    onNavigate?.();
  };

  // Driven by the capability set the server returned for this session, not by
  // a client-selected role. Falling back to an empty list (rather than every
  // module) means a failure to resolve capabilities hides navigation instead
  // of exposing it.
  const allowed = new Set(allowedIds());
  const visibleModules = MODULES.filter((m) => allowed.has(m.id));

  return (
    <ScrollArea className="flex-1 px-3 py-2">
      <nav className="flex flex-col gap-1" role="navigation" aria-label="Main navigation">
        {visibleModules.map((mod) => {
          const Icon = iconMap[mod.icon] ?? LayoutDashboard;
          const isActive = activeModule === mod.id;

          const button = (
            <button
              key={mod.id}
              onClick={() => handleNav(mod.id)}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'group relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                'text-foreground/70 hover:bg-accent hover:text-accent-foreground',
                isActive && 'bg-accent text-accent-foreground',
                collapsed && 'justify-center px-0'
              )}
            >
              {/* Active indicator bar */}
              <AnimatePresence>
                {isActive && (
                  <motion.span
                    layoutId="sidebar-active-indicator"
                    className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-emerald-500"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
              </AnimatePresence>

              <Icon className={cn('size-5 shrink-0', isActive && 'text-emerald-500')} />

              <AnimatePresence initial={false}>
                {!collapsed && (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                    className="overflow-hidden whitespace-nowrap"
                  >
                    {mod.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          );

          // In collapsed mode, wrap with Tooltip
          if (collapsed) {
            return (
              <Tooltip key={mod.id}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {mod.label}
                </TooltipContent>
              </Tooltip>
            );
          }

          return button;
        })}
      </nav>
    </ScrollArea>
  );
}

/* -------------------------------------------------------------------------- */
/*  Desktop sidebar                                                           */
/* -------------------------------------------------------------------------- */
function DesktopSidebar() {
  const { sidebarCollapsed, setSidebarCollapsed } = useAppStore();
  const width = sidebarCollapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED;

  return (
    <motion.aside
      data-slot="sidebar"
      className="hidden lg:flex flex-col h-full border-r border-border bg-card shrink-0 overflow-hidden"
      animate={{ width }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      aria-label="Sidebar"
    >
      {/* Logo */}
      <div
        className={cn(
          'flex items-center gap-3 border-b border-border px-4 h-14 shrink-0',
          sidebarCollapsed && 'justify-center px-0'
        )}
      >
        <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10">
          <Hexagon className="size-5 text-emerald-500" />
        </div>
        <AnimatePresence initial={false}>
          {!sidebarCollapsed && (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden whitespace-nowrap text-base font-semibold tracking-tight text-foreground"
            >
              NexusCorp
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Nav */}
      <SidebarNav collapsed={sidebarCollapsed} />

      {/* Collapse toggle */}
      <div className="mt-auto border-t border-border p-3">
        {sidebarCollapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="w-full"
                onClick={() => setSidebarCollapsed(false)}
                aria-label="Expand sidebar"
              >
                <ChevronsRight className="size-4 text-muted-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              Expand sidebar
            </TooltipContent>
          </Tooltip>
        ) : (
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-muted-foreground"
            onClick={() => setSidebarCollapsed(true)}
          >
            <ChevronsLeft className="size-4" />
            <span className="text-sm">Collapse</span>
          </Button>
        )}
      </div>
    </motion.aside>
  );
}

/* -------------------------------------------------------------------------- */
/*  Mobile sidebar (Sheet)                                                    */
/* -------------------------------------------------------------------------- */
function MobileSidebar() {
  const { sidebarOpen, setSidebarOpen } = useAppStore();

  return (
    <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <SheetContent side="left" className="w-[280px] p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation</SheetTitle>
        </SheetHeader>

        {/* Logo */}
        <div className="flex items-center gap-3 border-b border-border px-4 h-14 shrink-0">
          <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10">
            <Hexagon className="size-5 text-emerald-500" />
          </div>
          <span className="text-base font-semibold tracking-tight text-foreground">
            NexusCorp
          </span>
        </div>

        {/* Nav */}
        <SidebarNav
          collapsed={false}
          onNavigate={() => setSidebarOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/*  Exported Sidebar                                                          */
/* -------------------------------------------------------------------------- */
export function Sidebar() {
  const isMobile = useIsMobile();

  // On mobile, render the Sheet overlay
  // On desktop, render the inline animated sidebar
  if (isMobile) {
    return <MobileSidebar />;
  }

  return <DesktopSidebar />;
}