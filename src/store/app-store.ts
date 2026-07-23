import { create } from 'zustand';
import type { ModuleId, RoleId } from '@/lib/constants';

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
  
  // Navigation
  activeModule: ModuleId;
  sidebarCollapsed: boolean;
  sidebarOpen: boolean;
  searchOpen: boolean;
  
  // Notifications
  notifications: Notification[];
  setNotifications: (n: Notification[]) => void;
  unreadCount: () => number;
  
  // RBAC Role simulation
  activeRole: RoleId;
  setActiveRole: (r: RoleId) => void;

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
  
  // RBAC
  activeRole: 'owner',
  setActiveRole: (r) => set({ activeRole: r }),

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
  setActiveModule: (m) => set({ activeModule: m }),
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
        set({ 
          user: userData, 
          isAuthenticated: true, 
          isLoading: false 
        });
      } else {
        set({ user: null, isAuthenticated: false, isLoading: false });
      }
    } catch (e) {
      console.error('Fetch user failed:', e);
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },
}));