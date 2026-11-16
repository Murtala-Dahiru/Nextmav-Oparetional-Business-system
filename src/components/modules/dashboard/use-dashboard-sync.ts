'use client';

import * as React from 'react';
import { useRealtime } from '@/hooks/use-realtime';
import { BACKGROUND_HEADER } from '@/lib/session-policy';
import { useAppStore } from '@/store/app-store';
import type { ModuleId } from '@/lib/constants';
import { createSyncQueue } from './sync-queue';
import type { DashboardData } from './types';

// Payments/line items invalidate invoices through the existing recalculation trigger.
const SOURCES: Partial<Record<ModuleId, string[]>> = {
  projects: ['projects', 'tasks', 'milestones'], crm: ['deals', 'leads', 'companies'],
  finance: ['invoices', 'expenses'], support: ['support_tickets'],
  inventory: ['products', 'stock_movements'], hr: ['leave_requests', 'attendance_records', 'departments'],
  calendar: ['calendar_events'], communication: ['activity_log'],
};

export function useDashboardSync(organizationId: string, memberId: string | null) {
  const allows = useAppStore(s => s.allows);
  const [data, setData] = React.useState<DashboardData | null>(null);
  const [updating, setUpdating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const queue = React.useRef<ReturnType<typeof createSyncQueue> | null>(null);
  const lastSuccess = React.useRef(0);
  const failed = React.useRef(false);
  const request = React.useCallback(() => queue.current?.request(), []);
  const tables = React.useMemo(() => [
    ...Object.entries(SOURCES).filter(([module]) => allows(module as ModuleId))
      .flatMap(([, tables]) => tables.map(table => ({ table, filter: `organization_id=eq.${organizationId}` }))),
    ...(memberId ? [{ table: 'notifications', filter: `recipient_id=eq.${memberId}` }] : []),
  ], [organizationId, memberId, allows]);
  const status = useRealtime({ name: `dashboard:${organizationId}:${memberId ?? 'member'}`,
    tables, onChange: request, enabled: !!organizationId, debounceMs: 0 });
  const connection = React.useRef(status);
  React.useEffect(() => { connection.current = status; }, [status]);

  React.useEffect(() => {
    let disposed = false;
    let controller: AbortController | null = null;
    let first = true;
    const visible = () => document.visibilityState !== 'hidden' && navigator.onLine !== false;
    const current = createSyncQueue(async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 25_000);
      setUpdating(true);
      try {
        const res = await fetch('/api/dashboard', { cache: 'no-store', signal: controller.signal,
          headers: first ? {} : { [BACKGROUND_HEADER]: '1' } });
        if ((res.status === 401 || res.status === 403) && !disposed) setData(null);
        const json = await res.json();
        if (!res.ok || !json.data) throw new Error(json.error?.message ?? 'Unable to synchronize dashboard');
        if (disposed) return;
        // The endpoint applies RLS and module grants; update the aggregate atomically.
        setData(json.data);
        setError(null);
        lastSuccess.current = Date.now();
        failed.current = !!json.data.unavailable?.length;
      } catch (cause) {
        if (disposed) return;
        failed.current = true;
        setError(cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'Synchronization timed out');
      } finally {
        clearTimeout(timeout);
        if (!disposed) { setLoaded(true); setUpdating(false); }
        first = false;
      }
    }, { visible });
    queue.current = current;
    current.request();
    const wake = () => {
      if (!visible()) return;
      current.resume();
      if (failed.current || Date.now() - lastSuccess.current >= 45_000) current.request();
    };
    // Also reconciles unpublished tables, missed DELETE events and date rollovers.
    const poll = setInterval(() => {
      if (connection.current !== 'subscribed' || failed.current || Date.now() - lastSuccess.current >= 300_000) current.request();
    }, 60_000);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    return () => {
      disposed = true;
      current.stop();
      controller?.abort();
      queue.current = null;
      clearInterval(poll);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
    };
  }, [organizationId, memberId]);

  // A rejoin cannot replay changes missed while the socket was disconnected.
  React.useEffect(() => { if (status === 'subscribed') request(); }, [status, request]);
  return { data, loading: !loaded, updating, error, status, retry: request };
}
