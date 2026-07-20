'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useTheme } from 'next-themes';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Menu,
  Search,
  Sun,
  Moon,
  Bell,
  Info,
  AlertTriangle,
  CheckCircle,
  CheckCheck,
  LogOut,
  Settings,
  User,
  ChevronRight,
  Command,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { useAppStore } from '@/store/app-store';
import { currentUser } from '@/lib/mock-data';
import type { ModuleId } from '@/types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const moduleLabels: Record<ModuleId, string> = {
  dashboard: 'Dashboard',
  crm: 'CRM',
  workspace: 'Workspace',
  projects: 'Projects',
  hr: 'HR Management',
  finance: 'Finance',
  communication: 'Communication',
  calendar: 'Calendar',
  files: 'File Management',
  automation: 'Automation',
  support: 'Support Desk',
  inventory: 'Inventory',
  reports: 'Reports',
  admin: 'Administration',
};

function NotificationIcon({ type }: { type: string }) {
  switch (type) {
    case 'warning':
      return <AlertTriangle className="size-4 text-amber-500" />;
    case 'success':
      return <CheckCircle className="size-4 text-emerald-500" />;
    default:
      return <Info className="size-4 text-teal-500" />;
  }
}

export function Header() {
  const {
    activeModule,
    sidebarOpen,
    sidebarCollapsed,
    setSidebarOpen,
    setSidebarCollapsed,
    notifications,
    unreadCount,
    markNotificationRead,
    markAllNotificationsRead,
  } = useAppStore();

  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [notifOpen, setNotifOpen] = useState(false);

  const count = unreadCount();

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        const input = e.currentTarget;
        input?.focus();
      }
    },
    []
  );

  const toggleSidebar = useCallback(() => {
    setSidebarOpen(!sidebarOpen);
  }, [sidebarOpen, setSidebarOpen]);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-16 items-center border-b bg-background px-4 gap-4'
      )}
    >
      {/* ── Left side ── */}
      <div className="flex items-center gap-3 min-w-0">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 lg:hidden"
          onClick={toggleSidebar}
          aria-label="Toggle sidebar"
        >
          <Menu className="size-5" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="hidden lg:shrink-0 lg:flex"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          aria-label="Collapse sidebar"
        >
          <Menu className="size-5" />
        </Button>

        <nav className="flex items-center gap-1.5 text-sm min-w-0">
          <span className="text-muted-foreground font-medium hidden sm:inline">
            {currentUser.companyName}
          </span>
          <ChevronRight className="size-3.5 text-muted-foreground/60 hidden sm:inline" />
          <span className="font-semibold text-foreground truncate">
            {moduleLabels[activeModule]}
          </span>
        </nav>
      </div>

      {/* ── Center: search ── */}
      <div className="flex-1 flex justify-center max-w-md mx-auto hidden md:flex">
        <div className="relative w-full">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            placeholder="Search anything..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="pl-9 pr-20 h-9 bg-muted/50 border-transparent focus-visible:border-teal-500/50 focus-visible:ring-teal-500/20"
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:flex">
            <Command className="size-2.5" />K
          </kbd>
        </div>
      </div>

      {/* ── Right side ── */}
      <div className="flex items-center gap-1 shrink-0 ml-auto">
        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="relative"
        >
          {mounted ? (
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={theme}
                initial={{ y: -8, opacity: 0, rotate: -90 }}
                animate={{ y: 0, opacity: 1, rotate: 0 }}
                exit={{ y: 8, opacity: 0, rotate: 90 }}
                transition={{ duration: 0.2 }}
                className="flex items-center justify-center"
              >
                {theme === 'dark' ? (
                  <Sun className="size-5 text-amber-400" />
                ) : (
                  <Moon className="size-5 text-slate-600" />
                )}
              </motion.span>
            </AnimatePresence>
          ) : (
            <div className="size-5" />
          )}
        </Button>

        {/* Notification bell */}
        <Popover open={notifOpen} onOpenChange={setNotifOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative"
              aria-label="Notifications"
            >
              <Bell className="size-5" />
              {count > 0 && (
                <Badge className="absolute -top-0.5 -right-0.5 size-4.5 min-w-[18px] h-[18px] p-0 flex items-center justify-center bg-teal-600 text-white text-[10px] font-bold border-2 border-background">
                  {count}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className="w-80 p-0"
          >
            <AnimatePresence>
              {notifOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.95 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-3">
                    <h4 className="text-sm font-semibold">Notifications</h4>
                    {count > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-teal-600 hover:text-teal-700 hover:bg-teal-50 dark:hover:bg-teal-950/40"
                        onClick={() => markAllNotificationsRead()}
                      >
                        <CheckCheck className="size-3.5 mr-1" />
                        Mark all read
                      </Button>
                    )}
                  </div>
                  <Separator />

                  {/* List */}
                  <ScrollArea className="h-[320px]">
                    {notifications.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                        <Bell className="size-8 mb-2 opacity-40" />
                        <p className="text-sm">No notifications</p>
                      </div>
                    ) : (
                      <div className="flex flex-col">
                        {notifications.map((notif, index) => (
                          <motion.button
                            key={notif.id}
                            initial={{ opacity: 0, x: -12 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{
                              duration: 0.15,
                              delay: index * 0.03,
                            }}
                            className={cn(
                              'flex items-start gap-3 px-4 py-3 w-full text-left hover:bg-muted/60 transition-colors border-b border-border/50 last:border-b-0'
                            )}
                            onClick={() => markNotificationRead(notif.id)}
                          >
                            <div className="mt-0.5 shrink-0">
                              <NotificationIcon type={notif.type} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p
                                  className={cn(
                                    'text-sm truncate',
                                    !notif.isRead && 'font-semibold'
                                  )}
                                >
                                  {notif.title}
                                </p>
                                {!notif.isRead && (
                                  <span className="size-2 rounded-full bg-teal-500 shrink-0" />
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                                {notif.message}
                              </p>
                              <p className="text-[10px] text-muted-foreground/70 mt-1">
                                {notif.createdAt}
                              </p>
                            </div>
                          </motion.button>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </motion.div>
              )}
            </AnimatePresence>
          </PopoverContent>
        </Popover>

        {/* User avatar dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="relative h-9 w-9 rounded-full ml-1"
              aria-label="User menu"
            >
              <Avatar className="size-8">
                <AvatarFallback className="bg-gradient-to-br from-teal-500 to-emerald-600 text-white text-xs font-bold">
                  {currentUser.initials}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8} className="w-64">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium leading-none">
                  {currentUser.firstName} {currentUser.lastName}
                </p>
                <p className="text-xs text-muted-foreground leading-none">
                  {currentUser.email}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuLabel className="font-normal pt-0">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded bg-teal-100 px-1.5 py-0.5 font-medium text-teal-700 dark:bg-teal-900/40 dark:text-teal-400">
                  {currentUser.roleName}
                </span>
                <span>{currentUser.jobTitle}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <User className="size-4 mr-2" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Settings className="size-4 mr-2" />
                Settings
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">
              <LogOut className="size-4 mr-2" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

export default Header;
