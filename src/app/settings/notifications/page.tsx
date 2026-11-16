'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, ArrowLeft, Monitor, Trash2, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { categories, defaultPreferences, type NotificationPreferences } from '@/lib/notifications/model';

type Device = { id: string; label: string; enabled: boolean; retiredAt: string | null; lastAcceptedAt: string | null };
type Notice = { id: string; title: string; body: string; type: string; isRead: boolean; createdAt: string; organizationId: string };
async function request(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`/api/notifications${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await response.json();
  if (!response.ok) throw Error(json.error?.message ?? 'Unable to load notifications');
  return json;
}
export default function NotificationSettings() {
  const [prefs, setPrefs] = useState<NotificationPreferences>(defaultPreferences);
  const [key, setKey] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [rows, setRows] = useState<Notice[]>([]);
  const [page, setPage] = useState(1), [pages, setPages] = useState(1);
  const [unread, setUnread] = useState(false), [type, setType] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(''), [message, setMessage] = useState('');
  const [permission, setPermission] = useState('checking');
  const requestSequence = useRef(0);
  const historyFilter = useRef({ page, unread, type });
  const loadDevices = useCallback(async () => setDevices((await request('/devices')).data), []);
  const loadHistory = useCallback(async () => {
    const sequence = ++requestSequence.current;
    const { page, unread, type } = historyFilter.current;
    setLoading(true);
    try { const result = await request(`?page=${page}&pageSize=20&unread=${unread}&category=${encodeURIComponent(type)}`); if (sequence === requestSequence.current) { setRows(result.data); setPages(Math.max(1, result.meta.totalPages)); } }
    catch (cause) { if (sequence === requestSequence.current) setFailure((cause as Error).message); }
    finally { if (sequence === requestSequence.current) setLoading(false); }
  }, []);
  useEffect(() => {
    setPermission(!window.isSecureContext ? 'insecure origin' : !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window) ? 'unsupported browser' : Notification.permission);
    void Promise.all([request('/settings').then(result => { setPrefs(result.data.preferences); setKey(result.data.publicKey); }), loadDevices()]).catch(cause => setFailure(cause.message));
  }, [loadDevices]);
  useEffect(() => { historyFilter.current = { page, unread, type }; void loadHistory(); }, [page, unread, type, loadHistory]);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setFailure(''); setMessage(''); try { await fn(); } catch (cause) { setFailure((cause as Error).message); } finally { setBusy(false); } };
  async function enable() {
    if (!key) throw Error('Push delivery is not configured on this deployment.');
    if (!window.isSecureContext || !('PushManager' in window)) throw Error('Use a supported browser on HTTPS. On iPhone or iPad, add NextMav to your Home Screen and open it there.');
    const granted = await Notification.requestPermission(); setPermission(granted);
    if (granted !== 'granted') throw Error('Permission was not granted. You can change this in your browser’s site settings.');
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    await navigator.serviceWorker.ready;
    const bytes = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      try {
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'NotAllowedError' && Notification.permission === 'granted') {
          throw Error('This browser could not register with its push service. Try a regular browser profile, check your site notification settings, and contact your administrator if browser policies restrict push.');
        }
        throw cause;
      }
    }
    const label = /Edg/.test(navigator.userAgent) ? 'Microsoft Edge' : /Firefox/.test(navigator.userAgent) ? 'Firefox' : /Chrome/.test(navigator.userAgent) ? 'Chrome' : 'Safari / browser';
    await request('/devices', 'POST', { ...subscription.toJSON(), label });
    const next = { ...prefs, push: true }; await request('/settings', 'PUT', next); setPrefs(next);
    await loadDevices(); setMessage('This browser is connected. Send a test to check delivery.');
  }
  return <main className="min-h-screen bg-white text-slate-900"><div className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-8">
    <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-slate-500"><ArrowLeft size={16} /> Back to workspace</Link>
    <header><div className="mb-2 flex items-center gap-2"><Bell size={22} /><h1 className="text-2xl font-semibold tracking-tight">Notifications</h1></div><p className="text-sm text-slate-500">Your updates, delivery preferences, and connected browsers.</p></header>
    {failure && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">{failure}<button className="ml-3 underline" onClick={() => void run(async () => { await loadHistory(); await loadDevices(); })}>Retry</button></div>}
    {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    <section className="rounded-xl border p-5"><h2 className="font-semibold">Stay informed away from NextMav</h2><p className="mt-1 text-sm text-slate-500">Receive private, generic alerts even when this tab is closed, where your browser and operating system support it.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3"><Button disabled={busy || !key || permission === 'denied'} onClick={() => void run(enable)}>Enable this browser</Button><span className="text-xs text-slate-500">Permission: {permission}{!key ? ' · Delivery configuration pending' : ''}</span></div>
      <p className="mt-3 text-xs text-slate-500">iPhone / iPad: add NextMav to your Home Screen first. If permission is denied or later revoked, change it in your browser’s site settings. Browser profiles are separate registrations.</p>
    </section>
    <section className="rounded-xl border p-5"><h2 className="font-semibold">Delivery preferences</h2><p className="mt-1 text-xs text-slate-500">In-app history remains available. Lock-screen previews always hide business details.</p>
      <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={prefs.push} onChange={e => setPrefs({ ...prefs, push: e.target.checked })} /> Push notifications</label>
      <table className="my-4 w-full text-sm"><thead><tr className="border-b text-left"><th>Category</th><th>In app</th><th>Push</th></tr></thead><tbody>{categories.map(category => <tr key={category} className="border-b"><td className="py-2 capitalize">{category}</td>{(['inAppCategories', 'categories'] as const).map(channel => <td key={channel}><input aria-label={category + (channel === 'categories' ? ' push' : ' in app')} type="checkbox" checked={prefs[channel][category]} onChange={e => setPrefs({ ...prefs, [channel]: { ...prefs[channel], [category]: e.target.checked } })} /></td>)}</tr>)}</tbody></table>
      <div className="space-y-3 border-t pt-4"><label className="block text-sm">Deadline reminder <select value={prefs.reminderMinutes} onChange={e => setPrefs({ ...prefs, reminderMinutes: Number(e.target.value) as NotificationPreferences['reminderMinutes'] })}><option value={0}>At the due time</option><option value={15}>15 minutes before</option><option value={60}>1 hour before</option><option value={1440}>1 day before</option></select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={prefs.silent} onChange={e => setPrefs({ ...prefs, silent: e.target.checked })} /> Deliver silently where supported</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={prefs.quietEnabled} onChange={e => setPrefs({ ...prefs, quietEnabled: e.target.checked })} /> Quiet hours</label><div className="flex flex-wrap gap-3">
        <label className="text-xs">From<select className="ml-2 rounded border p-2" value={prefs.quietStart} onChange={e => setPrefs({ ...prefs, quietStart: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></label>
        <label className="text-xs">Until<select className="ml-2 rounded border p-2" value={prefs.quietEnd} onChange={e => setPrefs({ ...prefs, quietEnd: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></label>
        <label className="text-xs">Timezone<input aria-label="Timezone" className="ml-2 rounded border p-2" value={prefs.timezone} onChange={e => setPrefs({ ...prefs, timezone: e.target.value })} /></label>
      </div><Button variant="outline" disabled={busy} onClick={() => void run(async () => { await request('/settings', 'PUT', prefs); setMessage('Preferences saved.'); })}>Save preferences</Button></div>
    </section>
    <section><h2 className="mb-3 font-semibold">Connected browsers</h2><div className="divide-y rounded-xl border">{devices.length === 0 && <p className="p-5 text-sm text-slate-500">No browsers connected yet.</p>}{devices.map(device => <div key={device.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="flex items-center gap-3"><Monitor size={18} /><div><p className="text-sm font-medium">{device.label}</p><p className="text-xs text-slate-500">{device.retiredAt ? 'Subscription expired — enable this browser again' : device.lastAcceptedAt ? `Last provider acceptance: ${new Date(device.lastAcceptedAt).toLocaleString()}` : 'No provider acceptance recorded'}</p></div></div><div className="flex gap-2"><Button size="sm" variant="ghost" disabled={busy || !!device.retiredAt} onClick={() => void run(async () => { await request("/devices", "PATCH", { id: device.id, enabled: !device.enabled }); await loadDevices(); })}>{device.enabled ? "Pause" : "Resume"}</Button><Button size="sm" variant="outline" disabled={busy || !device.enabled || !!device.retiredAt} onClick={() => void run(async () => { await request('/test', 'POST', { deviceId: device.id }); setMessage('Test queued. Provider acceptance and actual device display are separate checks.'); })}>Send test</Button><Button aria-label={`Remove ${device.label}`} size="icon" variant="ghost" disabled={busy} onClick={() => void run(async () => { await request(`/devices?id=${device.id}`, 'DELETE'); await loadDevices(); setMessage('Browser removed from this workspace.'); })}><Trash2 size={16} /></Button></div></div>)}</div></section>
    <section><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Notification history</h2><Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(async () => { await request('', 'PATCH', {}); await loadHistory(); })}><CheckCheck size={16} /> Mark all read</Button></div><div className="mb-3 flex items-center gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={unread} onChange={e => { setUnread(e.target.checked); setPage(1); }} />Unread only</label><label>Category <select className="rounded border p-2" value={type} onChange={e => { setType(e.target.value); setPage(1); }}><option value="">All categories</option>{categories.map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label></div>
      <div aria-busy={loading} className="divide-y rounded-xl border">{loading ? <p className="p-6 text-sm text-slate-500">Loading notifications…</p> : rows.length === 0 ? <p className="p-6 text-sm text-slate-500">You’re all caught up. No notifications match this view.</p> : rows.map(row => <div key={row.id} className={`flex gap-3 p-4 ${row.isRead ? '' : 'bg-slate-50'}`}><span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${row.isRead ? 'bg-transparent' : 'bg-emerald-600'}`} /><a className="min-w-0 flex-1" href={`/api/notifications/open?id=${row.id}&organizationId=${row.organizationId}`}><p className="text-sm font-medium">{row.title}</p><p className="mt-1 line-clamp-2 text-sm text-slate-500">{row.body}</p><time className="mt-1 block text-xs text-slate-400">{new Date(row.createdAt).toLocaleString()}</time></a><Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(async () => { await request('', 'PATCH', { ids: [row.id], isRead: !row.isRead }); await loadHistory(); })}>{row.isRead ? 'Unread' : 'Read'}</Button><Button size="icon" variant="ghost" aria-label="Dismiss notification" disabled={busy} onClick={() => void run(async () => { await request(`?id=${row.id}`, 'DELETE'); await loadHistory(); })}><Trash2 size={14} /></Button></div>)}</div>
      <div className="mt-3 flex items-center justify-between"><Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-xs text-slate-500">Page {page} of {pages}</span><Button variant="outline" size="sm" disabled={page >= pages || loading} onClick={() => setPage(page + 1)}>Next</Button></div>
    </section>
  </div></main>;
}
