'use client';

import * as React from 'react';
import { Menu, Search, Bell, CheckCheck, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { Button } from '@/components/ui/button';
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
import { useRealtime } from '@/hooks/use-realtime';
import { MODULES } from '@/lib/constants';
import { formatRelativeTime } from '@/lib/format';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The top bar
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What it now does, and what it stopped doing ───────────────────────────
 *
 * It carried seven things at once: a menu button, the module name at 14px, a
 * workspace badge, a role pill, a search icon, a theme toggle, a notification
 * bell and a user menu. Six of them were controls and one was information,
 * which is the wrong ratio for the only strip of the product that is on
 * screen at all times — and the one piece of information, "where am I", was
 * the smallest thing in it.
 *
 * So the header answers exactly one question now — *which workspace, and
 * which screen* — and holds the two controls that belong to the screen rather
 * than to the person: find something, and see what has happened. Identity,
 * role and appearance moved to the foot of the sidebar, where the person is
 * described rather than the page.
 *
 * ── Which tenant facts may appear here ────────────────────────────────────
 *
 * The workspace's *name*, and nothing else. `security:check` names this file
 * as the one place in `components/layout` that may read it — the sidebar
 * carries the platform's identity, and a customer's logo in the chrome would
 * mean every tenant sees a different product.
 */
export function Header() {
  const {
    user,
    activeModule,
    sidebarOpen,
    setSidebarOpen,
    setSearchOpen,
    notifications,
    unreadTotal,
    isAuthenticated,
    fetchNotifications,
    markNotificationsRead,
    dismissNotification,
    setActiveModule,
  } = useAppStore();

  const unreadCount = unreadTotal;
  const currentModule = MODULES.find(m => m.id === activeModule);

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

  /**
   * Which workspace this is — the one piece of tenant identity the shell
   * legitimately shows.
   *
   * No fallback to the platform name. It used to read
   * `user?.organizationName || 'NexusCorp'`, so a workspace whose name had not
   * resolved yet displayed the *product's* name as though it were the
   * customer's — the same conflation, in miniature, that put a tenant's logo in
   * the sidebar. An unnamed workspace shows no line, which is honest: there is
   * nothing to say yet.
   */
  const workspaceName = user?.organizationName?.trim() || '';

  /**
   * `⌘K` on a Mac, `Ctrl K` everywhere else — resolved after mount, because
   * the server cannot know which, and a guess renders one and then the other.
   */
  const [shortcut, setShortcut] = React.useState<string | null>(null);
  React.useEffect(() => {
    setShortcut(/Mac|iPhone|iPad/i.test(navigator.userAgent) ? '⌘K' : 'Ctrl K');
  }, []);

  return (
    /* The padding matches what the modules use for their own content
       (`p-4 md:p-6`), so the page title sits on the same left edge as the
       first thing below it. Eight pixels out is not noticed as eight pixels —
       it is noticed as the header belonging to a different screen. */
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background px-4 md:px-6">
      {/* Below `lg` the sidebar is a sheet, and this is what opens it. Gated
          in CSS on the same breakpoint the sidebar uses — when this was gated
          on a 768px JavaScript media query and the sidebar on a 1024px CSS
          one, every tablet-width viewport had neither. */}
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </Button>

      {/* Where am I: the workspace, then the screen. Two lines rather than a
          badge beside a 14px title — this is the product's only permanent
          statement of place, and it should read as one. */}
      <div className="min-w-0 flex-1">
        {workspaceName && (
          <p className="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
            {workspaceName}
          </p>
        )}
        <h1 className="truncate text-[17px] font-semibold leading-tight tracking-[-0.018em] text-foreground">
          {currentModule?.label ?? 'Executive Overview'}
        </h1>
      </div>

      {/*
        Search, as a field rather than a magnifying glass.

        It opens the command palette, which searches customers, projects,
        tickets and invoices across every module the role may open — the most
        capable thing in the product, and it was represented by a 16px icon
        that gave no indication anything would happen. A field says what can
        be typed into it and shows the shortcut that gets there faster.
      */}
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        // The shortcut is drawn in the field; this is the same fact for
        // somebody who cannot see it.
        aria-keyshortcuts="Control+K Meta+K"
        className="hidden h-9 w-56 items-center gap-2 rounded-md border border-input bg-card px-2.5 text-left text-[13px] text-muted-foreground transition-colors hover:border-ring/40 hover:text-foreground md:flex lg:w-64"
      >
        <Search className="size-4 shrink-0" strokeWidth={1.75} />
        <span className="flex-1 truncate">Search…</span>
        {shortcut && (
          <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">
            {shortcut}
          </kbd>
        )}
      </button>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
          >
            <Search className="size-4 text-muted-foreground" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Search</TooltipContent>
      </Tooltip>

      {/* Notifications */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative"
                /* The count is in the label, not only in the dot: a badge that
                   is announced as "Notifications, button" has told a screen
                   reader user nothing about why it is there. */
                aria-label={
                  unreadCount > 0
                    ? `Notifications, ${unreadCount} unread`
                    : 'Notifications'
                }
              >
                <Bell className="size-4 text-muted-foreground" strokeWidth={1.75} />
                {unreadCount > 0 && (
                  <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-semibold leading-none tabular-nums text-background">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Notifications</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" sideOffset={8} className="w-[22rem] p-0 sm:w-96">
          <DropdownMenuLabel className="flex items-center justify-between px-3 py-2.5">
            <span className="flex items-center gap-2 text-[13px]">
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
            <div className="px-3 py-10 text-center">
              <Bell className="mx-auto mb-2 size-5 text-muted-foreground/40" />
              <p className="text-sm text-foreground">You are all caught up</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
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
                    'group flex cursor-pointer flex-col items-start gap-1 border-b px-3 py-2.5 last:border-b-0',
                    !notification.isRead && 'bg-muted/50',
                  )}
                >
                  <div className="flex w-full items-start gap-2.5">
                    {/* An unread marker that survives greyscale and does not
                        rely on the row tint alone. */}
                    <span
                      className={cn(
                        'mt-1.5 size-1.5 shrink-0 rounded-full',
                        notification.isRead ? 'bg-transparent' : 'bg-foreground',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium leading-snug text-foreground">
                        {notification.title}
                      </p>
                      {notification.body && (
                        <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
                          {notification.body}
                        </p>
                      )}
                      <p className="mt-1 text-[10px] uppercase tracking-[0.06em] text-muted-foreground/70">
                        {formatRelativeTime(notification.createdAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="Dismiss"
                      className="shrink-0 rounded p-1 text-muted-foreground/50 opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
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
    </header>
  );
}
