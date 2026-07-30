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
  CheckCheck,
  X,
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
import { useRealtime } from '@/hooks/use-realtime';
import { MODULES, ROLES } from '@/lib/constants';
import { formatRelativeTime } from '@/lib/format';

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
    unreadTotal,
    isAuthenticated,
    fetchNotifications,
    markNotificationsRead,
    dismissNotification,
    setActiveModule,
    activeRole,
  } = useAppStore();

  const unreadCount = unreadTotal;
  const currentModule = MODULES.find((m) => m.id === activeModule);

  /**
   * Notifications arrive over the socket, and polling is now the fallback.
   *
   * ── What changed, and what was kept ─────────────────────────────────────
   *
   * This was a flat thirty-second poll. The note here said a subscription would
   * be the better answer but needed "a browser client holding the session, a
   * reconnect strategy and a fallback for when the socket is blocked by a
   * corporate proxy, which is common in exactly the enterprises this product
   * targets" — all three of which are true, and all three of which
   * `useRealtime` now provides. The socket carries the session's JWT, phoenix
   * reconnects on its own, and the hook reports whether the channel actually
   * subscribed.
   *
   * So the poll is kept rather than deleted, because the proxy concern was
   * correct — it just no longer has to run when the socket is working. The
   * interval reads the subscription status: two minutes as a safety net while
   * events are flowing, thirty seconds when they are not. A tray that stops
   * updating behind a proxy would be a regression on a feature that worked, and
   * nobody would find out until they missed something.
   */
  const notificationsLive = useRealtime({
    name: 'notifications',
    enabled: isAuthenticated,
    tables: [{ table: 'notifications', event: 'INSERT' }],
    onChange: fetchNotifications,
    // Short: the badge appearing is the whole point, and an INSERT on this table
    // is one row, not a burst.
    debounceMs: 150,
  }) === 'subscribed';

  React.useEffect(() => {
    if (!isAuthenticated) return;

    fetchNotifications();
    const timer = setInterval(fetchNotifications, notificationsLive ? 120_000 : 30_000);

    // Coming back to the tab is the moment someone most wants an accurate
    // badge, and it is free compared with shortening the interval.
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchNotifications();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isAuthenticated, fetchNotifications, notificationsLive]);

  /**
   * Open whatever a notification is about.
   *
   * Triggers write a `link` shaped `/dashboard?module=projects&project=<id>`.
   * Rather than navigating — which would remount the whole shell — the module
   * is switched in place and the deep-link parameters are pushed into the URL
   * so the target module can pick them up and the page stays shareable.
   */
  const openNotification = React.useCallback((n: typeof notifications[number]) => {
    if (!n.isRead) markNotificationsRead([n.id]);
    if (!n.link) return;

    try {
      const url = new URL(n.link, window.location.origin);
      const target = url.searchParams.get('module');
      if (target && MODULES.some(m => m.id === target)) {
        setActiveModule(target as (typeof MODULES)[number]['id']);
        window.history.replaceState(null, '', url.pathname + url.search);
      }
    } catch {
      // A malformed link is not worth failing the click over; the notification
      // is still marked read, which is the part the user asked for.
    }
  }, [markNotificationsRead, setActiveModule]);

  const userInitials = user
    ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() || 'U'
    : 'U';

  const userDisplayName = user
    ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email
    : 'User';

  const userRole = user?.role || 'employee';
  /**
   * Which workspace this is — the one piece of tenant identity the shell
   * legitimately shows, and the reason it is a small outline badge next to the
   * module title rather than the product's name in the corner.
   *
   * No fallback to the platform name. It used to read
   * `user?.organizationName || 'NexusCorp'`, so a workspace whose name had not
   * resolved yet displayed the *product's* name as though it were the
   * customer's — the same conflation, in miniature, that put a tenant's logo in
   * the sidebar. An unnamed workspace shows no badge, which is honest: there is
   * nothing to say yet.
   */
  const workspaceName = user?.organizationName?.trim() || '';

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
          {workspaceName && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="hidden sm:inline-flex"
            >
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground">
                {workspaceName}
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
        <DropdownMenuContent align="end" className="w-96 p-0">
          <DropdownMenuLabel className="flex items-center justify-between px-3 py-2.5">
            <span className="flex items-center gap-2">
              Notifications
              {unreadCount > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  {unreadCount} new
                </Badge>
              )}
            </span>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] font-normal text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  // The menu would otherwise close on the first click, which
                  // makes "mark all read" feel like it dismissed the tray.
                  e.preventDefault();
                  markNotificationsRead();
                }}
              >
                <CheckCheck className="mr-1 size-3" /> Mark all read
              </Button>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="my-0" />

          {notifications.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <Bell className="mx-auto mb-2 size-5 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">You are all caught up</p>
              <p className="mt-0.5 text-xs text-muted-foreground/70">
                Assignments, approvals and mentions appear here.
              </p>
            </div>
          ) : (
            <div className="max-h-[26rem] overflow-y-auto">
              {notifications.map((notification) => (
                <DropdownMenuItem
                  key={notification.id}
                  onSelect={() => openNotification(notification)}
                  className={cn(
                    'group flex flex-col items-start gap-1 border-b px-3 py-2.5 last:border-b-0 cursor-pointer',
                    !notification.isRead && 'bg-emerald-500/5',
                  )}
                >
                  <div className="flex w-full items-start gap-2">
                    {/* An unread marker that survives greyscale and does not
                        rely on the row tint alone. */}
                    <span
                      className={cn(
                        'mt-1.5 size-1.5 shrink-0 rounded-full',
                        notification.isRead ? 'bg-transparent' : 'bg-emerald-500',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-snug text-foreground">
                        {notification.title}
                      </p>
                      {notification.body && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {notification.body}
                        </p>
                      )}
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                        {formatRelativeTime(notification.createdAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="Dismiss"
                      className="shrink-0 rounded p-1 text-muted-foreground/50 opacity-0 transition hover:bg-muted hover:text-foreground group-hover:opacity-100"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        dismissNotification(notification.id);
                      }}
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                </DropdownMenuItem>
              ))}
            </div>
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