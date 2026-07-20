import { create } from 'zustand';
import type { ModuleId, NotificationItem } from '@/types';

interface AppState {
  activeModule: ModuleId;
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  activeSubModule: string;
  searchQuery: string;
  searchOpen: boolean;
  commandOpen: boolean;
  setActiveModule: (m: ModuleId) => void;
  setSidebarOpen: (o: boolean) => void;
  setSidebarCollapsed: (c: boolean) => void;
  setActiveSubModule: (s: string) => void;
  setSearchQuery: (q: string) => void;
  setSearchOpen: (o: boolean) => void;
  setCommandOpen: (o: boolean) => void;
  notifications: NotificationItem[];
  addNotification: (n: NotificationItem) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  unreadCount: () => number;
}

export const useAppStore = create<AppState>((set, get) => ({
  activeModule: 'dashboard',
  sidebarOpen: true,
  sidebarCollapsed: false,
  activeSubModule: '',
  searchQuery: '',
  searchOpen: false,
  commandOpen: false,
  setActiveModule: (m) => set({ activeModule: m, activeSubModule: '' }),
  setSidebarOpen: (o) => set({ sidebarOpen: o }),
  setSidebarCollapsed: (c) => set({ sidebarCollapsed: c }),
  setActiveSubModule: (s) => set({ activeSubModule: s }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSearchOpen: (o) => set({ searchOpen: o }),
  setCommandOpen: (o) => set({ commandOpen: o }),
  notifications: [
    { id: '1', type: 'info', title: 'New Lead Assigned', message: 'Sarah Connor assigned lead "Acme Corp" to you', isRead: false, createdAt: '2026-07-20T09:30:00Z', data: {} },
    { id: '2', type: 'warning', title: 'Invoice Overdue', message: 'Invoice #INV-2024-089 is 3 days overdue', isRead: false, createdAt: '2026-07-20T09:15:00Z', data: {} },
    { id: '3', type: 'success', title: 'Task Completed', message: 'John Doe completed "API Integration" task', isRead: false, createdAt: '2026-07-20T08:00:00Z', data: {} },
    { id: '4', type: 'info', title: 'New Support Ticket', message: 'Customer opened ticket #TKT-445 regarding login issue', isRead: true, createdAt: '2026-07-20T07:00:00Z', data: {} },
    { id: '5', type: 'info', title: 'Leave Request', message: 'Emily Chen requested 3 days vacation', isRead: true, createdAt: '2026-07-20T06:00:00Z', data: {} },
    { id: '6', type: 'success', title: 'Payment Received', message: 'Payment of $12,500 received from TechStart Inc.', isRead: true, createdAt: '2026-07-20T04:00:00Z', data: {} },
  ],
  addNotification: (n) => set((s) => ({ notifications: [n, ...s.notifications] })),
  markNotificationRead: (id) => set((s) => ({
    notifications: s.notifications.map((n) => n.id === id ? { ...n, isRead: true } : n)
  })),
  markAllNotificationsRead: () => set((s) => ({
    notifications: s.notifications.map((n) => ({ ...n, isRead: true }))
  })),
  unreadCount: () => get().notifications.filter((n) => !n.isRead).length,
}));