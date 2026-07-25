import { create } from 'zustand';
import type { ModuleId, RoleId } from '@/lib/constants';
import {
  normalizeRole, canAccessModule, defaultModuleFor, allowedModules,
  type CapabilitySummary, type Action,
} from '@/lib/permissions';

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
  role: string;
  isActive: boolean;
  /** Server-computed capability mirror, used for rendering decisions only. */
  capabilities?: CapabilitySummary;
}

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string;
  isRead: boolean;
  createdAt: string;
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

  // Navigation
  activeModule: ModuleId;
  sidebarCollapsed: boolean;
  sidebarOpen: boolean;
  searchOpen: boolean;
  
  // Notifications
  notifications: Notification[];
  setNotifications: (n: Notification[]) => void;
  unreadCount: () => number;
  
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
  setNotifications: (n) => set({ notifications: n }),
  unreadCount: () => get().notifications.filter(n => !n.isRead).length,
  
  // Navigation actions
  setActiveModule: (m) => {
    // Guard the transition itself: a stale link, command-palette entry or
    // dashboard widget must not be able to open a module this role lacks.
    if (!canAccessModule(get().activeRole, m)) return;
    set({ activeModule: m });
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
      set({ user: null, isAuthenticated: false });
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
        set({
          user: userData,
          isAuthenticated: true,
          needsOrganization: !!(json?.data?.needsOrganization ?? json?.needsOrganization),
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
          isLoading: false, activeRole: 'employee',
        });
      }
    } catch (e) {
      console.error('Fetch user failed:', e);
      set({ user: null, isAuthenticated: false, needsOrganization: false, isLoading: false });
    }
  },
}));