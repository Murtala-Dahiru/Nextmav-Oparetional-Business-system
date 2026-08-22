'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  PanelLeftClose,
  PanelLeft,
  ChevronsUpDown,
  UserRound,
  KeyRound,
  LogOut,
  Monitor,
  Moon,
  Sun,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ModuleId } from '@/lib/constants';
import { ROLES } from '@/lib/constants';
import { navigationFor, type NavItem, type NavSection } from '@/lib/navigation';
import { useAppStore, SIDEBAR_COLLAPSED_KEY } from '@/store/app-store';
import { PlatformMark } from './platform-mark';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The application's navigation
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What changed, and why ─────────────────────────────────────────────────
 *
 * This rendered thirteen rows in one flat list, every one at identical visual
 * weight, in build order. Three consequences, all of them the reason the shell
 * read as generated rather than designed:
 *
 *   1. Nothing said what belonged with what. CRM, Support and the Client
 *      Portal are three views of the same customer and sat apart; Admin
 *      configures the other twelve and looked like a thirteenth.
 *   2. Nothing said what mattered. A person opens Dashboard and My Work every
 *      morning and Inventory twice a month, and the sidebar gave them the
 *      same row.
 *   3. Two of the thirteen drew the wrong icon. The map here had no entry for
 *      `CheckSquare` or `Building2`, so My Work and Client Portal both fell
 *      back to the dashboard's mark — visible on every screen, for two years,
 *      to everyone.
 *
 * The structure now comes from `lib/navigation.ts`, which is also what the
 * command palette reads, so the two cannot drift. Icons are resolved there by
 * a total record, which is what makes (3) a compile error rather than a
 * silent fallback.
 *
 * ── What did not change ───────────────────────────────────────────────────
 *
 * Access. The list still starts from `visibleModules()` — the capability set
 * the server resolved for this session — and `setActiveModule` still refuses
 * a module the role lacks. Grouping is presentation; it adds nothing to what
 * a person may open.
 */

const SIDEBAR_WIDTH = 264;
const SIDEBAR_RAIL = 68;

/* -------------------------------------------------------------------------- */
/*  One navigation row                                                        */
/* -------------------------------------------------------------------------- */
function NavRow({
  item,
  active,
  badge,
  collapsed,
  touch,
  onSelect,
}: {
  item: NavItem;
  active: boolean;
  badge: number;
  collapsed: boolean;
  /** Rendered for a finger rather than a cursor — see `MobileSidebar`. */
  touch: boolean;
  onSelect: (id: ModuleId) => void;
}) {
  const Icon = item.icon;

  const row = (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-current={active ? 'page' : undefined}
      /**
       * The name a screen reader announces.
       *
       * Needed because the rail has no text at all: the icon is decorative and
       * the tooltip is `aria-describedby`, which is a description, not a name.
       * An unnamed button is announced as "button", thirteen times in a row.
       */
      aria-label={
        collapsed
          ? badge > 0 ? `${item.label}, ${badge} unread` : item.label
          : undefined
      }
      className={cn(
        'group relative flex items-center rounded-md transition-colors duration-150',
        touch ? 'text-sm' : 'text-[13px]',
        collapsed
          ? 'mx-auto size-10 justify-center'
          : cn('w-full gap-2.5 px-2.5', touch ? 'h-11' : 'h-[34px]'),
        active
          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent/55 hover:text-foreground',
      )}
    >
      <span className="relative flex shrink-0 items-center">
        <Icon
          className={cn('size-[18px]', active ? 'text-foreground' : 'text-current')}
          strokeWidth={active ? 2 : 1.75}
          aria-hidden="true"
        />
        {/*
          Collapsed there is no room for a number, so the badge becomes a mark
          on the icon. It still says "something is waiting here", which is the
          part that survives the width.
        */}
        {collapsed && badge > 0 && (
          <span className="absolute -right-1 -top-0.5 size-[7px] rounded-full bg-foreground ring-2 ring-sidebar" />
        )}
      </span>

      {!collapsed && <span className="truncate text-left">{item.label}</span>}

      {/*
        The count. Quiet by construction — a number, not a siren. What is
        urgent in this product is a red invoice or an overdue ticket inside
        the module; the sidebar's job is only to say where to look.
      */}
      {!collapsed && badge > 0 && (
        <span
          className="ml-auto min-w-[20px] shrink-0 rounded-full bg-foreground/[0.07] px-1.5 py-[3px] text-center text-[10.5px] font-semibold leading-none tabular-nums text-foreground"
          aria-label={`${badge} unread in ${item.label}`}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );

  if (!collapsed) return row;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10} className="max-w-56">
        <p className="font-medium">
          {item.label}
          {badge > 0 && (
            <span className="ml-1.5 font-semibold tabular-nums">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </p>
        {/* The one line that says what the module is for — the piece a rail
            of icons otherwise throws away. */}
        <p className="mt-0.5 text-[11px] leading-snug opacity-80">{item.summary}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/* -------------------------------------------------------------------------- */
/*  The grouped navigation                                                    */
/* -------------------------------------------------------------------------- */
function SidebarNav({
  collapsed,
  touch = false,
  onNavigate,
}: {
  collapsed: boolean;
  touch?: boolean;
  onNavigate?: () => void;
}) {
  const activeModule = useAppStore(s => s.activeModule);
  const setActiveModule = useAppStore(s => s.setActiveModule);
  const unreadByModule = useAppStore(s => s.unreadByModule);
  const activeRole = useAppStore(s => s.activeRole);
  const visibleModules = useAppStore(s => s.visibleModules);

  /**
   * Driven by the capability set the server returned for this session, never
   * by a client-selected role. Falling back to an empty list rather than to
   * every module means a failure to resolve capabilities hides navigation
   * instead of exposing it.
   */
  const sections: NavSection[] = React.useMemo(
    () => navigationFor(visibleModules(), activeRole),
    [visibleModules, activeRole],
  );

  const handle = React.useCallback(
    (id: ModuleId) => {
      setActiveModule(id);
      onNavigate?.();
    },
    [setActiveModule, onNavigate],
  );

  return (
    /*
      `min-h-0` is the whole reason the account row stays pinned to the foot.
      A flex child's default minimum height is its content, so a scroll area
      with more rows than fit does not scroll — it grows, and pushes whatever
      follows it off the bottom of the sheet. It was doing exactly that on a
      phone the moment the rows were sized for a thumb.
    */
    <ScrollArea className="min-h-0 flex-1">
      <nav
        className={cn('flex flex-col py-3', collapsed ? 'px-2.5' : 'px-3')}
        aria-label="Main navigation"
      >
        {sections.map((section, index) => (
          <div key={section.id} className={index === 0 ? undefined : 'mt-5'}>
            {section.label &&
              (collapsed ? (
                /* A rail has no room for a heading, so the grouping is carried
                   by a separator instead — the information survives, the words
                   do not have to. */
                <div
                  className="mx-auto mb-2.5 h-px w-6 bg-sidebar-border"
                  role="presentation"
                />
              ) : (
                <h2
                  id={`nav-${section.id}`}
                  className="px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/75"
                >
                  {section.label}
                </h2>
              ))}

            {/*
              The list is labelled by its heading, so a screen reader announces
              "Customers, list, three items" rather than three lists of unnamed
              buttons. Collapsed there is no heading to point at — the label
              rides on each button instead, which is where it has to be when
              the words are gone.
            */}
            <ul
              className="flex flex-col gap-0.5"
              aria-labelledby={section.label && !collapsed ? `nav-${section.id}` : undefined}
              aria-label={section.label && collapsed ? section.label : undefined}
            >
              {section.items.map(item => (
                <li key={item.id}>
                  <NavRow
                    item={item}
                    active={activeModule === item.id}
                    /**
                     * Suppressed on the module being looked at: a count
                     * against the screen already open says nothing, and it
                     * would sit there until the notifications happened to be
                     * marked read — which reads as a badge that will not
                     * clear.
                     */
                    badge={activeModule === item.id ? 0 : unreadByModule[item.id] ?? 0}
                    collapsed={collapsed}
                    touch={touch}
                    onSelect={handle}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </ScrollArea>
  );
}

/* -------------------------------------------------------------------------- */
/*  Account                                                                    */
/* -------------------------------------------------------------------------- */
/**
 * Who is signed in, what they are allowed to be, and the three things they
 * can do about it.
 *
 * It sits at the foot of the navigation rather than in the top bar because
 * that is where identity belongs in a product with a persistent shell: the
 * header describes the screen you are on, the sidebar describes the person
 * looking at it. It also takes three controls out of a header that had six.
 *
 * The role is shown and never chosen. This was a "Switch Operating Role"
 * dropdown that let anyone reassign themselves to Owner; it is resolved
 * server-side from the session, and the description below it says who to ask.
 */
function AccountMenu({ collapsed, touch = false }: { collapsed: boolean; touch?: boolean }) {
  const router = useRouter();
  const user = useAppStore(s => s.user);
  const activeRole = useAppStore(s => s.activeRole);
  const logout = useAppStore(s => s.logout);
  const { theme, setTheme } = useTheme();

  /**
   * The active theme is not knowable during the first render — it lives in
   * localStorage and on <html> — so the radio group is left unset until mount
   * rather than briefly claiming the wrong one.
   */
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const displayName = user
    ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email
    : 'Account';
  const initials = user
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase() || 'U'
    : 'U';
  const role = ROLES.find(r => r.id === activeRole);

  const trigger = (
    <button
      type="button"
      className={cn(
        'flex items-center rounded-md text-left transition-colors hover:bg-sidebar-accent/55',
        collapsed
          ? 'mx-auto size-10 justify-center'
          : cn('w-full gap-2.5 p-1.5', touch && 'min-h-11'),
      )}
      aria-label="Account menu"
    >
      <Avatar className="size-7 shrink-0">
        <AvatarImage src={user?.avatarUrl || undefined} alt="" />
        <AvatarFallback className="bg-foreground/[0.07] text-[11px] font-semibold text-foreground">
          {initials}
        </AvatarFallback>
      </Avatar>

      {!collapsed && (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium leading-tight text-foreground">
              {displayName}
            </span>
            <span className="block truncate text-[11px] leading-tight text-muted-foreground">
              {role?.name ?? 'Employee'}
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </>
      )}
    </button>
  );

  return (
    <DropdownMenu>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>
            <p className="font-medium">{displayName}</p>
            <p className="text-[11px] opacity-80">{role?.name ?? 'Employee'}</p>
          </TooltipContent>
        </Tooltip>
      ) : (
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      )}

      <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-64">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
          <p className="truncate text-xs text-muted-foreground">{user?.email ?? ''}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* What this account may do, and who changes it. Carried over from the
            header's role pill, where it had a tooltip nobody hovered. */}
        <div className="px-2 py-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/75">
            Access
          </p>
          <p className="mt-1 text-xs font-medium text-foreground">
            {role?.name ?? 'Employee'}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {role?.description ?? 'Standard workplace access.'} Assigned by your
            administrator.
          </p>
        </div>
        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => router.push('/settings')}>
          <UserRound className="size-4" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push('/change-password')}>
          <KeyRound className="size-4" />
          Change password
        </DropdownMenuItem>
        <DropdownMenuSeparator />

        {/*
          Three states rather than a switch. `next-themes` is mounted with
          `enableSystem`, and until now nothing in the product could express
          it: the header's toggle only ever flipped between light and dark, so
          "follow my computer" was reachable from no screen at all.
        */}
        <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/75">
          Appearance
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={mounted ? theme : undefined}
          onValueChange={setTheme}
        >
          <DropdownMenuRadioItem value="light">
            <Sun className="size-4" />
            Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="size-4" />
            Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor className="size-4" />
            System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={() => logout()}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* -------------------------------------------------------------------------- */
/*  Shared body: brand, navigation, account                                   */
/* -------------------------------------------------------------------------- */
function SidebarBody({
  collapsed,
  touch = false,
  onNavigate,
  children,
}: {
  collapsed: boolean;
  touch?: boolean;
  onNavigate?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <>
      <div
        className={cn(
          'flex h-16 shrink-0 items-center border-b border-sidebar-border',
          collapsed ? 'justify-center px-0' : 'gap-2.5 px-4',
        )}
      >
        {/*
          The platform's identity, always — never the tenant's. A workspace is
          something you are *in*; it is not what the software is called. Which
          workspace that is belongs in the header, beside the module title.
        */}
        <PlatformMark collapsed={collapsed} />
      </div>

      <SidebarNav collapsed={collapsed} touch={touch} onNavigate={onNavigate} />

      <div
        className={cn(
          'mt-auto shrink-0 space-y-1 border-t border-sidebar-border py-2',
          collapsed ? 'px-2.5' : 'px-2',
        )}
      >
        <AccountMenu collapsed={collapsed} touch={touch} />
        {children}
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Desktop                                                                    */
/* -------------------------------------------------------------------------- */
function DesktopSidebar() {
  const collapsed = useAppStore(s => s.sidebarCollapsed);
  const setCollapsed = useAppStore(s => s.setSidebarCollapsed);

  // Restore the preference once, after mount. Reading localStorage during
  // render would make the server's markup and the browser's disagree.
  React.useEffect(() => {
    try {
      if (window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1') setCollapsed(true);
    } catch {
      // Private mode, or storage disabled. The default is a usable state.
    }
  }, [setCollapsed]);

  // `setSidebarCollapsed` is what persists the choice, so the shortcut, this
  // button and the command palette's entry all record it identically.
  const toggle = React.useCallback(() => {
    setCollapsed(!useAppStore.getState().sidebarCollapsed);
  }, [setCollapsed]);

  /**
   * `[` toggles the rail.
   *
   * The command palette has advertised this shortcut in its Actions list
   * since it was written, and nothing ever listened for the key. Ignored
   * while typing, and while a modifier is held, so it cannot fire inside a
   * message composer or steal a browser shortcut.
   */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '[' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  return (
    <aside
      data-slot="sidebar"
      // Below `lg` the sheet takes over. This used to be `hidden lg:flex`
      // while the header's menu button was gated on `useIsMobile()`, which is
      // 768 — so between 768 and 1023 there was no sidebar *and* no way to
      // open one. The breakpoint is now stated once, in CSS, on both.
      className={cn(
        'hidden h-full shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar lg:flex',
        'transition-[width] duration-200 ease-out motion-reduce:transition-none',
      )}
      style={{ width: collapsed ? SIDEBAR_RAIL : SIDEBAR_WIDTH }}
      aria-label="Sidebar"
    >
      <SidebarBody collapsed={collapsed}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggle}
                className="mx-auto flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/55 hover:text-foreground"
                aria-label="Expand sidebar"
              >
                <PanelLeft className="size-[18px]" strokeWidth={1.75} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={10}>
              Expand sidebar
              <kbd className="ml-1.5 font-mono text-[10px] opacity-70">[</kbd>
            </TooltipContent>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={toggle}
            className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-sidebar-accent/55 hover:text-foreground"
          >
            <PanelLeftClose className="size-[18px] shrink-0" strokeWidth={1.75} />
            <span>Collapse</span>
            <kbd className="ml-auto rounded border border-sidebar-border bg-background/60 px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">
              [
            </kbd>
          </button>
        )}
      </SidebarBody>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/*  Below `lg`: the same navigation in a sheet                                */
/* -------------------------------------------------------------------------- */
function MobileSidebar() {
  const open = useAppStore(s => s.sidebarOpen);
  const setOpen = useAppStore(s => s.setSidebarOpen);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="left"
        className="flex w-[286px] flex-col gap-0 bg-sidebar p-0"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>
            Move between the modules your account can open.
          </SheetDescription>
        </SheetHeader>
        {/* 44px rows: the same navigation, sized for a thumb rather than a
            cursor. */}
        <SidebarBody collapsed={false} touch onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/*  Exported                                                                   */
/* -------------------------------------------------------------------------- */
/**
 * Both are rendered, and CSS decides which is visible.
 *
 * The sheet's contents are unmounted while it is closed, so this is not two
 * copies of the navigation in the accessibility tree — and choosing between
 * them in CSS rather than from a `matchMedia` hook means the sidebar and the
 * button that opens it can never disagree about where the breakpoint is.
 */
export function Sidebar() {
  return (
    <>
      <DesktopSidebar />
      <MobileSidebar />
    </>
  );
}
