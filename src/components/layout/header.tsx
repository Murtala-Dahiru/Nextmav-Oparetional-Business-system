'use client';

import * as React from 'react';
import { useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTheme } from 'next-themes';
import {
  Menu,
  Search,
  Sun,
  Moon,
  Bell,
  User,
  Settings,
  LogOut,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MODULES, type ModuleId } from '@/lib/constants';
import { useAppStore } from '@/store/app-store';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/* -------------------------------------------------------------------------- */
/*  Hydration-safe mounted detection                                           */
/* -------------------------------------------------------------------------- */
const emptySubscribe = () => () => {};

function useMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

/* -------------------------------------------------------------------------- */
/*  Hardcoded current user (future: from auth)                                 */
/* -------------------------------------------------------------------------- */
const currentUser = {
  firstName: 'Alex',
  lastName: 'Johnson',
  email: 'alex.johnson@nexuscorp.com',
  roleName: 'Admin',
  jobTitle: 'CEO',
  companyName: 'NexusCorp',
  initials: 'AJ',
};

/* -------------------------------------------------------------------------- */
/*  Theme toggle                                                              */
/* -------------------------------------------------------------------------- */
function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label="Toggle theme"
    >
      <AnimatePresence mode="wait" initial={false}>
        {mounted && theme === 'dark' ? (
          <motion.span
            key="moon"
            initial={{ rotate: -90, opacity: 0, scale: 0.5 }}
            animate={{ rotate: 0, opacity: 1, scale: 1 }}
            exit={{ rotate: 90, opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.2 }}
          >
            <Moon className="size-4 text-muted-foreground" />
          </motion.span>
        ) : (
          <motion.span
            key="sun"
            initial={{ rotate: 90, opacity: 0, scale: 0.5 }}
            animate={{ rotate: 0, opacity: 1, scale: 1 }}
            exit={{ rotate: -90, opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.2 }}
          >
            <Sun className="size-4 text-muted-foreground" />
          </motion.span>
        )}
      </AnimatePresence>
    </Button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Notification bell                                                         */
/* -------------------------------------------------------------------------- */
function NotificationBell() {
  const { notifications, setNotifications, unreadCount } = useAppStore();
  const mounted = useMounted();

  React.useEffect(() => {
    fetch('/api/admin/notifications')
      .then((res) => res.json())
      .then((json) => {
        const items = json.data ?? json.items ?? json ?? [];
        setNotifications(
          items.map((n: any) => ({
            id: n.id,
            type: n.type ?? 'info',
            title: n.title ?? '',
            message: n.message ?? '',
            link: n.link ?? '',
            isRead: !!n.isRead,
            createdAt: n.createdAt ?? '',
          }))
        );
      })
      .catch(() => {
        // silently ignore — notifications are not critical
      });
  }, [setNotifications]);

  const handleMarkAllRead = async () => {
    try {
      await fetch('/api/admin/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAll: true }),
      });
      setNotifications(notifications.map((n) => ({ ...n, isRead: true })));
    } catch {
      // ignore
    }
  };

  const unread = mounted ? unreadCount() : 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative size-8">
          <Bell className="size-4 text-muted-foreground" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold leading-none text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
          <span className="sr-only">Notifications</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold text-foreground">Notifications</span>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={handleMarkAllRead}
            >
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-72">
          {notifications.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-sm text-muted-foreground">No notifications yet</p>
            </div>
          ) : (
            <div className="flex flex-col">
              {notifications.slice(0, 10).map((n) => (
                <div
                  key={n.id}
                  className={cn(
                    'flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-accent cursor-pointer',
                    !n.isRead && 'bg-accent/40'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">
                      {n.title}
                    </span>
                    {!n.isRead && (
                      <span className="size-1.5 rounded-full bg-emerald-500 shrink-0" />
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground line-clamp-2">
                    {n.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------------------------------------------------- */
/*  User dropdown                                                             */
/* -------------------------------------------------------------------------- */
function UserDropdown() {
  const { setActiveModule } = useAppStore();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2 px-2 h-8">
          <Avatar className="size-7">
            <AvatarFallback className="bg-emerald-500/10 text-emerald-600 text-xs font-semibold">
              {currentUser.initials}
            </AvatarFallback>
          </Avatar>
          <span className="hidden sm:inline text-sm font-medium text-foreground">
            {currentUser.firstName} {currentUser.lastName}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">
              {currentUser.firstName} {currentUser.lastName}
            </p>
            <p className="text-xs text-muted-foreground">{currentUser.email}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {currentUser.roleName}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {currentUser.jobTitle}
              </span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <User className="size-4" />
            Profile
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setActiveModule('admin')}>
            <Settings className="size-4" />
            Settings
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive">
          <LogOut className="size-4" />
          Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* -------------------------------------------------------------------------- */
/*  Header                                                                    */
/* -------------------------------------------------------------------------- */
export function Header() {
  const { activeModule, setSidebarOpen, setSearchOpen } = useAppStore();
  const isMobile = useIsMobile();

  const activeLabel =
    MODULES.find((m) => m.id === activeModule)?.label ?? 'Dashboard';

  return (
    <header
      data-slot="header"
      className={cn(
        'sticky top-0 z-30 flex h-14 shrink-0 items-center gap-4 border-b border-border px-4 sm:px-6',
        'bg-background/80 backdrop-blur-sm'
      )}
    >
      {/* Left: mobile menu + breadcrumb */}
      <div className="flex items-center gap-3 min-w-0">
        {isMobile && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="size-4 text-foreground" />
          </Button>
        )}
        <nav className="flex items-center gap-1.5 text-sm min-w-0" aria-label="Breadcrumb">
          <span className="text-muted-foreground truncate">{currentUser.companyName}</span>
          <ChevronRight className="size-3.5 text-muted-foreground/60 shrink-0" />
          <span className="font-medium text-foreground truncate">{activeLabel}</span>
        </nav>
      </div>

      {/* Center: search */}
      <div className="flex-1 flex justify-center max-w-md mx-auto">
        <div className="relative w-full">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search..."
            className="h-8 pl-8 pr-12 text-sm bg-muted/50 border-0 focus-visible:ring-1 cursor-pointer"
            readOnly
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            <span className="text-xs">⌘</span>K
          </kbd>
        </div>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-1 shrink-0">
        <ThemeToggle />
        <NotificationBell />
        <Separator orientation="vertical" className="h-5 mx-1" />
        <UserDropdown />
      </div>
    </header>
  );
}