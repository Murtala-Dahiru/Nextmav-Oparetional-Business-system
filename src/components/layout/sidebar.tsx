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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MODULES, ROLE_PERMISSIONS, type ModuleId } from '@/lib/constants';
import { useAppStore } from '@/store/app-store';
import { OrgMark } from './org-mark';
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
  const { activeModule, setActiveModule, visibleModules: allowedIds, unreadByModule } = useAppStore();

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
          /**
           * What is waiting in this module.
           *
           * Suppressed on the module you are looking at: a count against the
           * screen currently open tells you nothing you cannot already see, and
           * it would sit there until the notifications happened to be marked
           * read — which reads as a badge that will not clear.
           */
          const badge = isActive ? 0 : (unreadByModule[mod.id] ?? 0);

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

              <span className="relative shrink-0">
                <Icon className={cn('size-5', isActive && 'text-emerald-500')} />
                {/*
                  Collapsed, there is no room for a number, so the badge becomes
                  a dot on the icon — still says "something is here", which is
                  the part that matters at that width.
                */}
                {collapsed && badge > 0 && (
                  <span className="absolute -right-1 -top-1 size-2 rounded-full bg-emerald-500 ring-2 ring-background" />
                )}
              </span>

              <AnimatePresence initial={false}>
                {!collapsed && (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                    className="flex-1 overflow-hidden whitespace-nowrap text-left"
                  >
                    {mod.label}
                  </motion.span>
                )}
              </AnimatePresence>

              {/*
                The count itself. Capped at 99+ because the difference between
                "a lot" and "rather more" is not worth the column width, and an
                unbounded number reflows the whole row.
              */}
              {!collapsed && badge > 0 && (
                <span
                  className="ml-auto shrink-0 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white tabular-nums"
                  aria-label={`${badge} unread in ${mod.label}`}
                >
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </button>
          );

          // In collapsed mode, wrap with Tooltip
          if (collapsed) {
            return (
              <Tooltip key={mod.id}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {mod.label}
                  {badge > 0 && (
                    <span className="ml-1.5 font-semibold text-emerald-500">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
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
        {/*
          The organisation's own mark and name, not the vendor's.
          `logo_url`, `name` and `branding.primary_colour` were all stored,
          validated and editable, and this rendered a generic hexagon and the
          literal "NexusCorp" — so a company could configure all three and see
          their own name nowhere in the product they had just set up.
        */}
        <OrgMark collapsed={sidebarCollapsed} />
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
          <OrgMark />
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