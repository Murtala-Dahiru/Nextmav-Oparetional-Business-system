'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Menu,
  Search,
  Bell,
  LogOut,
  User,
  Settings,
  ChevronDown,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { MODULES, ROLES } from '@/lib/constants';

export function Header() {
  const isMobile = useIsMobile();
  const router = useRouter();
  const {
    user,
    activeModule,
    sidebarOpen,
    setSidebarOpen,
    setSearchOpen,
    logout,
    notifications,
    setActiveModule,
    activeRole,
  } = useAppStore();

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const currentModule = MODULES.find((m) => m.id === activeModule);

  const userInitials = user
    ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() || 'U'
    : 'U';

  const userDisplayName = user
    ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email
    : 'User';

  const userRole = user?.role || 'employee';
  const userOrgName = user?.organizationName || 'NexusCorp';

  return (
    <header className="flex items-center h-14 px-4 border-b border-border bg-card/80 backdrop-blur-sm shrink-0 gap-3">
      {/* Mobile menu toggle */}
      {isMobile && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="Toggle navigation"
            >
              <Menu className="size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Toggle menu</TooltipContent>
        </Tooltip>
      )}

      {/* Module title / breadcrumb */}
      <div className="flex items-center gap-2 min-w-0">
        <h1 className="text-sm font-semibold text-foreground truncate">
          {currentModule?.label || 'Dashboard'}
        </h1>
        <AnimatePresence>
          {userOrgName && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="hidden sm:inline-flex"
            >
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground">
                {userOrgName}
              </Badge>
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/*
        Role indicator — read-only.

        This was a "Switch Operating Role" dropdown that let anyone reassign
        themselves to Owner and reveal Finance and HR in the sidebar. Role is
        now resolved server-side from the session and displayed, not chosen.
      */}
      <Tooltip>
        <TooltipTrigger asChild>
          {/*
            Always visible: what you can and cannot do here depends entirely on
            this, so it should never be the first thing dropped on a narrow
            screen. Only the label collapses below `sm`, not the indicator.
          */}
          <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 text-xs font-semibold text-emerald-600 sm:px-2.5">
            <ShieldCheck className="size-3.5 shrink-0" />
            <span className="hidden sm:inline">
              {ROLES.find((r) => r.id === activeRole)?.name || 'Employee'}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <p className="text-xs">
            {ROLES.find((r) => r.id === activeRole)?.description ||
              'Standard workplace access.'}
          </p>
          <p className="text-muted-foreground mt-1 text-[10px]">
            Assigned by your administrator. Contact them to change it.
          </p>
        </TooltipContent>
      </Tooltip>

      {/* Search */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
          >
            <Search className="size-4 text-muted-foreground" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Search (Ctrl+K)</TooltipContent>
      </Tooltip>

      {/* Theme */}
      <ThemeToggle />

      {/* Notifications */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
                <Bell className="size-4 text-muted-foreground" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Notifications</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuLabel className="flex items-center justify-between">
            <span>Notifications</span>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {unreadCount} new
              </Badge>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {notifications.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No notifications yet
            </div>
          ) : (
            notifications.slice(0, 5).map((notification) => (
              <DropdownMenuItem
                key={notification.id}
                className={cn(
                  'flex flex-col items-start gap-1 p-3 cursor-pointer',
                  !notification.isRead && 'bg-accent/50'
                )}
              >
                <span className="text-sm font-medium text-foreground">
                  {notification.title}
                </span>
                <span className="text-xs text-muted-foreground line-clamp-2">
                  {notification.message}
                </span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* User menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="flex items-center gap-2 px-2 h-9"
          >
            <Avatar className="size-7">
              <AvatarImage src={user?.avatarUrl || undefined} alt={userDisplayName} />
              <AvatarFallback className="bg-emerald-500/10 text-emerald-600 text-xs font-medium">
                {userInitials}
              </AvatarFallback>
            </Avatar>
            <span className="hidden sm:inline text-sm font-medium text-foreground truncate max-w-[140px]">
              {userDisplayName}
            </span>
            <ChevronDown className="size-3.5 text-muted-foreground hidden sm:block" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">{userDisplayName}</p>
              <p className="text-xs text-muted-foreground">{user?.email || ''}</p>
              <Badge variant="outline" className="w-fit text-[10px] mt-1">
                {userRole}
              </Badge>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/*
            Both of these used to open the Admin module, which almost nobody
            can: `setActiveModule` refuses a module the role lacks, so for an
            ordinary employee the menu items simply did nothing. They now go to
            the account page, which belongs to whoever is signed in.
          */}
          <DropdownMenuItem onClick={() => router.push('/settings')}>
            <User className="mr-2 size-4" />
            Profile
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push('/change-password')}>
            <Settings className="mr-2 size-4" />
            Change password
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={logout}
            className="text-red-600 focus:text-red-600"
          >
            <LogOut className="mr-2 size-4" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}