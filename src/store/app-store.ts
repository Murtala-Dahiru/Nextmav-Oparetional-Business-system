import { create } from 'zustand';
import type { ModuleId } from '@/lib/constants';

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
  activeModule: ModuleId;
  sidebarCollapsed: boolean;
  sidebarOpen: boolean; // for mobile Sheet
  searchOpen: boolean;

  setActiveModule: (m: ModuleId) => void;
  setSidebarCollapsed: (c: boolean) => void;
  setSidebarOpen: (o: boolean) => void;
  setSearchOpen: (o: boolean) => void;

  // Notifications (fetched from API)
  notifications: Notification[];
  setNotifications: (n: Notification[]) => void;
  unreadCount: () => number;
}

export const useAppStore = create<AppState>((set, get) => ({
  activeModule: 'dashboard',
  sidebarCollapsed: false,
  sidebarOpen: false,
  searchOpen: false,

  setActiveModule: (m) => set({ activeModule: m }),
  setSidebarCollapsed: (c) => set({ sidebarCollapsed: c }),
  setSidebarOpen: (o) => set({ sidebarOpen: o }),
  setSearchOpen: (o) => set({ searchOpen: o }),

  notifications: [],
  setNotifications: (n) => set({ notifications: n }),
  unreadCount: () => get().notifications.filter(n => !n.isRead).length,
}));