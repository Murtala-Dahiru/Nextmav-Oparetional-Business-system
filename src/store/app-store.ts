import { create } from 'zustand';
import type { ModuleId, RoleId } from '@/lib/constants';
import {
  normalizeRole, canAccessModule, defaultModuleFor, allowedModules,
  type CapabilitySummary, type Action,
} from '@/lib/permissions';
import { configureFormatting } from '@/lib/format';

export interface CurrentUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  department: string | null;
  organizationId: string;
  organizationName: string | null;
  organizationSlug: string | null;
  /**
   * The caller's membership row id.
   *
   * The session has always returned this and the type omitted it, so screens
   * that needed to ask "is this record mine?" had nothing to compare against.
   * Business tables reference the membership, not the account — one person can
   * hold memberships in several organizations.
   */
  memberId?: string | null;
  role: string;
  isActive: boolean;
  /** Server-computed capability mirror, used for rendering decisions only. */
  capabilities?: CapabilitySummary;
}

/**
 * A notification as the API returns it.
 *
 * `body` rather than `message`: the column is `notifications.body`, and the
 * store previously declared `message`, which is one reason nothing ever
 * rendered even once rows existed — the header read a field the endpoint does
 * not send. `entityType`/`entityId` are what make a notification clickable;
 * `link` is the pre-built destination where a trigger knew one.
 */
export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  entityType: string | null;
  entityId: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

/**
 * This workspace, as the session resolved it.
 *
 * Carries the presentation settings every module formats with *and* the policy
 * documents they read — which leave types are offered, what the working week
 * is, the project vocabulary. Those live on `/api/admin/settings` for editing,
 * which only administrators may call; an employee's leave form needs them too,
 * so the readable half rides along with the session instead. One request per
 * session, and one answer, which is the same argument that put currency here.
 */
export interface OrganizationContext {
  id: string;
  name: string;
  currency: string;
  locale: string;
  timezone: string;
  logoUrl?: string | null;
  workStart?: string;
  workEnd?: string;
  workDays?: number[];
  graceMinutes?: number;
  breakMinutes?: number;
  /** Keyed as stored — `leavePolicy`, `projectDefaults`, … after camelising. */
  policies?: Record<string, any>;
}

interface AppState {
  // Auth
  user: CurrentUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /**
   * Authenticated, but belonging to no organization — the state between
   * confirming an email and creating or joining a workspace. Distinct from
   * `!isAuthenticated`: the session is valid, so sending them back to the
   * login form would loop. They need onboarding instead.
   */
  needsOrganization: boolean;

  /**
   * Signed in, but still holding the password an administrator issued.
   *
   * Distinct from `!isAuthenticated` and from `needsOrganization`: the session
   * is valid and the organization is known, but the server refuses every
   * module until the password is replaced. The only useful destination is the
   * change-password screen.
   */
  mustChangePassword: boolean;

  /** This workspace's presentation settings, as the server resolved them. */
  organization: OrganizationContext | null;

  // Navigation
  activeModule: ModuleId;
  sidebarCollapsed: boolean;
  sidebarOpen: boolean;
  searchOpen: boolean;
  
  /**
   * Notifications.
   *
   * The array, the badge count and the actions that change them. Previously
   * only `notifications` and `setNotifications` existed and nothing ever
   * called the setter, so the bell rendered "No notifications yet" for every
   * user for the life of the application — while the table filled up and the
   * endpoint worked perfectly.
   */
  notifications: Notification[];
  /** Unread across the whole tray, not just the page that was fetched. */
  unreadTotal: number;
  /**
   * Unread per module, for the sidebar badges — Support (3), Projects (2).
   *
   * Counted by the server across the whole tray for the same reason
   * `unreadTotal` is: a badge derived from the twenty rows this store holds
   * would cap at the page size and change as the user paged.
   *
   * Communication is composed differently on purpose. A notification is written
   * only for a mention — posting in a channel does not notify everyone in it,
   * and should not — so its count also carries unread *messages*, taken from
   * each channel's own read marker. A chat badge that ignored those would read
   * zero with eleven messages waiting.
   */
  unreadByModule: Partial<Record<ModuleId, number>>;
  notificationsLoading: boolean;
  setNotifications: (n: Notification[]) => void;
  unreadCount: () => number;
  fetchNotifications: () => Promise<void>;
  markNotificationsRead: (ids?: string[]) => Promise<void>;
  dismissNotification: (id: string) => Promise<void>;

  /**
   * The signed-in user's role, resolved by the server from the session.
   *
   * This used to be a client-settable "operating role" that defaulted to
   * `owner` and drove sidebar visibility — meaning any user could grant
   * themselves Finance and HR from a dropdown. It is now derived state.
   */
  activeRole: RoleId;
  /** Modules this role may open, in navigation order. */
  visibleModules: () => ModuleId[];
  /** Whether the current role may perform `action` in `module`. */
  allows: (module: ModuleId, action?: Action) => boolean;

  // Actions
  setActiveModule: (m: ModuleId) => void;
  setSidebarCollapsed: (c: boolean) => void;
  setSidebarOpen: (o: boolean) => void;
  setSearchOpen: (o: boolean) => void;
  setUser: (user: CurrentUser | null) => void;
  setIsAuthenticated: (v: boolean) => void;
  setIsLoading: (v: boolean) => void;
  logout: () => Promise<void>;
  fetchUser: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Auth state
  user: null,
  isAuthenticated: false,
  isLoading: true,
  needsOrganization: false,
  mustChangePassword: false,
  organization: null,

  // RBAC — starts at the least-privileged role and is raised only by the
  // server's answer in fetchUser(). Defaulting to `owner` here would flash
  // modules the user may not actually open.
  activeRole: 'employee',

  visibleModules: () => {
    const { user, activeRole } = get();
    // Prefer the server's own list; fall back to computing from the role.
    return user?.capabilities?.modules ?? allowedModules(activeRole);
  },

  allows: (module, action = 'view') => {
    const { user, activeRole } = get();
    const grant = user?.capabilities?.grants?.[module];
    if (grant) return grant.actions.includes(action);
    return canAccessModule(activeRole, module) && action === 'view';
  },

  // Navigation
  activeModule: 'dashboard',
  sidebarCollapsed: false,
  sidebarOpen: false,
  searchOpen: false,
  
  // Notifications
  notifications: [],
  unreadTotal: 0,
  unreadByModule: {},
  notificationsLoading: false,
  setNotifications: (n) => set({ notifications: n }),
  unreadCount: () => get().unreadTotal,

  fetchNotifications: async () => {
    // Nothing to fetch before the session resolves, and calling it then just
    // produces a 401 in the console on every page load.
    if (!get().isAuthenticated) return;

    set({ notificationsLoading: true });
    try {
      const res = await fetch('/api/notifications?pageSize=20');
      const json = await res.json();
      if (json?.error) throw new Error(json.error.message);

      set({
        notifications: json?.data ?? [],
        // The server counts unread across the whole tray. Deriving it from the
        // fetched page would cap the badge at the page size and quietly
        // under-report once someone has more than twenty unread.
        unreadTotal: Number(json?.meta?.unread ?? 0),
        unreadByModule: json?.meta?.byModule ?? {},
        notificationsLoading: false,
      });
    } catch (e) {
      // Deliberately quiet. A failed poll is not worth a toast every thirty
      // seconds; the tray simply keeps showing what it last had.
      console.error('Fetch notifications failed:', e);
      set({ notificationsLoading: false });
    }
  },

  markNotificationsRead: async (ids) => {
    const before = get().notifications;
    const beforeTotal = get().unreadTotal;

    // Applied locally first: a bell badge that waits for a round trip before
    // clearing feels broken, and the request almost never fails.
    set({
      notifications: before.map(n =>
        !ids || ids.includes(n.id) ? { ...n, isRead: true } : n,
      ),
      unreadTotal: ids
        ? Math.max(0, beforeTotal - before.filter(n => ids.includes(n.id) && !n.isRead).length)
        : 0,
    });

    try {
      const res = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ids ?? [] }),
      });
      const json = await res.json();
      if (json?.error) throw new Error(json.error.message);
    } catch (e) {
      // Put it back. Showing them as read when the server still has them
      // unread means they vanish from the tray and are never seen again.
      console.error('Mark read failed:', e);
      set({ notifications: before, unreadTotal: beforeTotal });
    }
  },

  dismissNotification: async (id) => {
    const before = get().notifications;
    const beforeTotal = get().unreadTotal;
    const target = before.find(n => n.id === id);

    set({
      notifications: before.filter(n => n.id !== id),
      unreadTotal: target && !target.isRead ? Math.max(0, beforeTotal - 1) : beforeTotal,
    });

    try {
      const res = await fetch(`/api/notifications?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const json = await res.json();
      if (json?.error) throw new Error(json.error.message);
    } catch (e) {
      console.error('Dismiss failed:', e);
      set({ notifications: before, unreadTotal: beforeTotal });
    }
  },

  // Navigation actions
  setActiveModule: (m) => {
    // Guard the transition itself: a stale link, command-palette entry or
    // dashboard widget must not be able to open a module this role lacks.
    if (!canAccessModule(get().activeRole, m)) return;
    set({ activeModule: m });

    /**
     * Opening a module clears its badge — "badges disappear after viewing".
     *
     * Optimistic locally, then confirmed on the server. A badge that waits for
     * a round trip before clearing reads as a click that did not register, and
     * this is the one interaction where the user is definitely looking at the
     * thing that changes.
     *
     * Only fired when there is something to clear, so ordinary navigation is
     * not a write on every click.
     */
    const pending = get().unreadByModule[m] ?? 0;
    if (pending <= 0) return;

    set({
      unreadByModule: { ...get().unreadByModule, [m]: 0 },
      /**
       * The bell total falls with it.
       *
       * Clamped rather than subtracted blindly: for `communication` the module
       * count includes unread *messages*, which are not notifications and are
       * cleared by opening the channel rather than by this call. Subtracting
       * the full figure would drive the bell below the number of notifications
       * that genuinely remain.
       */
      unreadTotal: Math.max(0, get().unreadTotal - pending),
    });

    void fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: m }),
    })
      // Re-read rather than trusting the optimistic figures: the server knows
      // how many it actually marked, and for communication that differs.
      .then(() => get().fetchNotifications())
      .catch(() => get().fetchNotifications());
  },
  setSidebarCollapsed: (c) => set({ sidebarCollapsed: c }),
  setSidebarOpen: (o) => set({ sidebarOpen: o }),
  setSearchOpen: (o) => set({ searchOpen: o }),
  
  // Auth actions
  setUser: (user) => set({ user, isAuthenticated: !!user }),
  setIsAuthenticated: (v) => set({ isAuthenticated: v }),
  setIsLoading: (v) => set({ isLoading: v }),
  
  logout: async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      // Even if the request fails we still clear local state and leave the
      // protected area — leaving someone on a dashboard they believe they
      // signed out of is worse than a redundant redirect.
      console.error('Logout request failed:', e);
    } finally {
      set({ user: null, isAuthenticated: false, mustChangePassword: false });
      // Back to the public landing page, not the login form: signing out
      // returns you to the marketing site.
      window.location.href = '/';
    }
  },
  
  fetchUser: async () => {
    set({ isLoading: true });
    try {
      const res = await fetch('/api/auth/session');
      const json = await res.json();
      const userData = json?.data?.user ?? json?.user;
      if (userData) {
        const role = normalizeRole(userData.capabilities?.role ?? userData.role);
        const { activeModule } = get();

        /**
         * Point the formatters at this organization before anything renders.
         *
         * Every module calls `formatCurrency`/`formatDate` without passing a
         * currency or locale, so this one assignment is what makes all of them
         * agree. Done here rather than in each screen because it has to happen
         * once, early, and cannot be forgotten by a component added later.
         */
        const org = json?.data?.organization;
        if (org) configureFormatting({ currency: org.currency, locale: org.locale });
        set({
          user: userData,
          isAuthenticated: true,
          needsOrganization: !!(json?.data?.needsOrganization ?? json?.needsOrganization),
          mustChangePassword: !!(json?.data?.mustChangePassword ?? json?.mustChangePassword),
          organization: org ?? null,
          isLoading: false,
          activeRole: role,
          // If the stored module is one this role cannot open (e.g. after
          // switching accounts), fall back to their natural landing module
          // rather than rendering a module they have no access to.
          activeModule: canAccessModule(role, activeModule)
            ? activeModule
            : defaultModuleFor(role),
        });
      } else {
        /**
         * Cookies say there is a session; the server says there is not.
         *
         * This is an expired or revoked token, and until the cookie is removed
         * it is a lockout rather than an inconvenience: `proxy.ts` routes on
         * cookie *presence*, so it lets /dashboard through, this store finds no
         * user, the page redirects to /login — and the proxy sends /login
         * straight back to /dashboard because the cookie is still there. The
         * result is a blank page that no amount of reloading escapes, and the
         * only cure was clearing site data by hand.
         *
         * Signing out breaks the cycle: it clears the cookie, so the redirect
         * that follows finally reaches the login form.
         */
        await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {
          // Best effort. If it fails the redirect still happens; the user is
          // no worse off than before.
        });
        set({
          user: null, isAuthenticated: false, needsOrganization: false,
          mustChangePassword: false, isLoading: false, activeRole: 'employee',
        });
      }
    } catch (e) {
      console.error('Fetch user failed:', e);
      set({ user: null, isAuthenticated: false, needsOrganization: false, mustChangePassword: false, isLoading: false });
    }
  },
}));