import { create } from 'zustand';

export type ModuleId =
  | 'dashboard'
  | 'crm'
  | 'workspace'
  | 'projects'
  | 'hr'
  | 'finance'
  | 'communication'
  | 'calendar'
  | 'files'
  | 'automation'
  | 'customer-portal'
  | 'support'
  | 'inventory'
  | 'reports'
  | 'administration';

interface AppState {
  activeModule: ModuleId;
  sidebarOpen: boolean;
  activeSubModule: string;
  setActiveModule: (m: ModuleId) => void;
  setSidebarOpen: (o: boolean) => void;
  setActiveSubModule: (s: string) => void;
  notifications: Notification[];
  addNotification: (n: Notification) => void;
  markNotificationRead: (id: string) => void;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  read: boolean;
  time: string;
  module?: ModuleId;
}

export const useAppStore = create<AppState>((set) => ({
  activeModule: 'dashboard',
  sidebarOpen: true,
  activeSubModule: '',
  setActiveModule: (m) => set({ activeModule: m, activeSubModule: '' }),
  setSidebarOpen: (o) => set({ sidebarOpen: o }),
  setActiveSubModule: (s) => set({ activeSubModule: s }),
  notifications: [
    { id: '1', title: 'New Lead Assigned', message: 'Sarah Connor assigned lead "Acme Corp" to you', type: 'info', read: false, time: '2 min ago', module: 'crm' },
    { id: '2', title: 'Invoice Overdue', message: 'Invoice #INV-2024-089 is 3 days overdue', type: 'warning', read: false, time: '15 min ago', module: 'finance' },
    { id: '3', title: 'Task Completed', message: 'John Doe completed "API Integration" task', type: 'success', read: false, time: '1 hr ago', module: 'projects' },
    { id: '4', title: 'New Support Ticket', message: 'Customer opened ticket #TKT-445 regarding login issue', type: 'info', read: true, time: '2 hrs ago', module: 'support' },
    { id: '5', title: 'Leave Request', message: 'Emily Chen requested 3 days vacation', type: 'info', read: true, time: '3 hrs ago', module: 'hr' },
    { id: '6', title: 'Payment Received', message: 'Payment of $12,500 received from TechStart Inc.', type: 'success', read: true, time: '5 hrs ago', module: 'finance' },
  ],
  addNotification: (n) => set((s) => ({ notifications: [n, ...s.notifications] })),
  markNotificationRead: (id) => set((s) => ({ notifications: s.notifications.map((n) => n.id === id ? { ...n, read: true } : n) })),
}));