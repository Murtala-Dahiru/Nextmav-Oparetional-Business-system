'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { NotificationCategoryIcon } from '@/components/shared/notification-category-icon';
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
  const [pushReady, setPushReady] = useState<boolean | null>(null);
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
  const loadSettings = useCallback(async () => {
    const { data } = await request('/settings');
    setPrefs(data.preferences);
    setKey(data.publicKey);
    setPushReady(data.pushReady === true);
  }, []);
  useEffect(() => {
    setPermission(!window.isSecureContext ? 'insecure origin' : !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window) ? 'unsupported browser' : Notification.permission);
    void Promise.all([loadSettings(), loadDevices()]).catch(cause => setFailure(cause.message));
  }, [loadDevices, loadSettings]);
  useEffect(() => { historyFilter.current = { page, unread, type }; void loadHistory(); }, [page, unread, type, loadHistory]);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setFailure(''); setMessage(''); try { await fn(); } catch (cause) { setFailure((cause as Error).message); } finally { setBusy(false); } };
  async function enable() {
    if (!key || !pushReady) throw Error('Push delivery is not configured on this deployment.');
    if (!window.isSecureContext || !('PushManager' in window)) throw Error('Use a supported browser on HTTPS. On iPhone or iPad, add NextMav to your Home Screen and open it there.');
    const granted = await Notification.requestPermission(); setPermission(granted);
    if (granted !== 'granted') throw Error('Permission was not granted. You can change this in your browser’s site settings.');
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    await navigator.serviceWorker.ready;
    const bytes = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    let subscription = await registration.pushManager.getSubscription();
    const existingKey = subscription?.options.applicationServerKey;
    if (existingKey && (new Uint8Array(existingKey).length !== bytes.length || new Uint8Array(existingKey).some((value, index) => value !== bytes[index]))) {
      throw Error('This browser subscription uses a different push key. Remove its site notification registration in browser settings, then enable it again.');
    }
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
  return <main className="min-h-screen bg-background text-foreground"><div className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-8">
    <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft size={16} /> Back to workspace</Link>
    <header><div className="mb-2 flex items-center gap-2"><Bell size={22} /><h1 className="text-2xl font-semibold tracking-tight">Notifications</h1></div><p className="text-sm text-muted-foreground">Your updates, delivery preferences, and connected browsers.</p></header>
    {failure && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">{failure}<button className="ml-3 underline" onClick={() => void run(async () => { await Promise.all([loadSettings(), loadHistory(), loadDevices()]); })}>Retry</button></div>}
    {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">Stay informed away from NextMav</h2><p className="mt-1 text-sm text-muted-foreground">Receive alerts even when this tab is closed, where your browser and operating system support it.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3"><Button disabled={busy || !key || !pushReady || permission === 'denied'} onClick={() => void run(enable)}>Enable Notifications</Button><span className="text-xs text-muted-foreground">{permission === 'denied' ? 'Notifications blocked — change browser site settings' : permission === 'granted' ? 'Notifications permitted' : `Permission: ${permission}`}{pushReady === false ? ' · Push configuration unavailable' : ''}</span></div>
      <p className="mt-3 text-xs text-muted-foreground">iPhone / iPad: add NextMav to your Home Screen first. If permission is denied or later revoked, change it in your browser’s site settings. Browser profiles are separate registrations.</p>
    </section>
    <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">Delivery preferences</h2><p className="mt-1 text-xs text-muted-foreground">Preview text may be visible on a locked screen. HR, Finance, signing and commercial details remain hidden.</p>
      <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={prefs.push} onChange={e => setPrefs({ ...prefs, push: e.target.checked })} /> Push notifications</label>
      <label className="mt-4 block text-sm font-medium">Message previews on connected devices
        <select className="mt-1 block w-full max-w-sm rounded-md border px-3 py-2" value={prefs.messagePreviews ? 'preview' : prefs.senderNames ? 'sender' : 'private'}
          onChange={e => setPrefs({ ...prefs, messagePreviews: e.target.value === 'preview', senderNames: e.target.value === 'sender' })}>
          <option value="private">Hide sender and message</option>
          <option value="sender">Show sender name only</option>
          <option value="preview">Show sender and message preview</option>
        </select>
      </label>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={prefs.businessPreviews} onChange={e => setPrefs({ ...prefs, businessPreviews: e.target.checked })} /> Show task, CRM and support details</label>
      <table className="my-4 w-full text-sm"><thead><tr className="border-b text-left"><th>Category</th><th>In app</th><th>Push</th></tr></thead><tbody>{categories.map(category => <tr key={category} className="border-b"><td className="py-2 capitalize">{category}</td>{(['inAppCategories', 'categories'] as const).map(channel => <td key={channel}><input aria-label={category + (channel === 'categories' ? ' push' : ' in app')} type="checkbox" checked={prefs[channel][category]} onChange={e => setPrefs({ ...prefs, [channel]: { ...prefs[channel], [category]: e.target.checked } })} /></td>)}</tr>)}</tbody></table>
      <div className="space-y-3 border-t pt-4"><label className="block text-sm">Deadline reminder <select value={prefs.reminderMinutes} onChange={e => setPrefs({ ...prefs, reminderMinutes: Number(e.target.value) as NotificationPreferences['reminderMinutes'] })}><option value={0}>At the due time</option><option value={15}>15 minutes before</option><option value={60}>1 hour before</option><option value={1440}>1 day before</option></select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={prefs.silent} onChange={e => setPrefs({ ...prefs, silent: e.target.checked })} /> Deliver silently where supported</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={prefs.quietEnabled} onChange={e => setPrefs({ ...prefs, quietEnabled: e.target.checked })} /> Quiet hours</label><div className="flex flex-wrap gap-3">
        <label className="text-xs">From<select className="ml-2 rounded border p-2" value={prefs.quietStart} onChange={e => setPrefs({ ...prefs, quietStart: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></label>
        <label className="text-xs">Until<select className="ml-2 rounded border p-2" value={prefs.quietEnd} onChange={e => setPrefs({ ...prefs, quietEnd: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></label>
        <label className="text-xs">Timezone<input aria-label="Timezone" className="ml-2 rounded border p-2" value={prefs.timezone} onChange={e => setPrefs({ ...prefs, timezone: e.target.value })} /></label>
      </div><Button variant="outline" disabled={busy} onClick={() => void run(async () => { await request('/settings', 'PUT', prefs); setMessage('Preferences saved.'); })}>Save preferences</Button></div>
    </section>
    <section><h2 className="mb-3 font-semibold">Connected devices</h2><div className="divide-y rounded-xl border">{devices.length === 0 && <div className="space-y-2 p-4"><p className="text-sm text-muted-foreground">Enable notifications on this device to send a test notification.</p><Button variant="outline" disabled>Send Test Notification</Button></div>}{devices.map(device => <div key={device.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="flex items-center gap-3"><Monitor size={18} /><div><p className="text-sm font-medium">{device.label}</p><p className="text-xs text-muted-foreground">{!device.enabled && !device.retiredAt ? 'Device disconnected (paused)' : device.retiredAt ? 'Subscription expired — enable this browser again' : device.lastAcceptedAt ? `Last provider acceptance: ${new Date(device.lastAcceptedAt).toLocaleString()}` : 'Device connected · No provider acceptance recorded'}</p></div></div><div className="flex gap-2"><Button size="sm" variant="ghost" disabled={busy || !!device.retiredAt} onClick={() => void run(async () => { await request("/devices", "PATCH", { id: device.id, enabled: !device.enabled }); await loadDevices(); })}>{device.enabled ? "Pause" : "Resume"}</Button><Button size="sm" variant="outline" disabled={busy || !device.enabled || !!device.retiredAt} onClick={() => void run(async () => { const result = await request('/test', 'POST', { deviceId: device.id }); setMessage('Test queued. Waiting for the server worker…'); for (let attempt = 0; attempt < 15; attempt++) { await new Promise(resolve => setTimeout(resolve, 2000)); const status = (await request(`/test?id=${result.data.notificationId}`)).data; if (status?.state === 'accepted') { setMessage('Push provider accepted the test. Check this device’s notifications to confirm display.'); await loadDevices(); return; } if (['failed', 'skipped'].includes(status?.state)) throw Error(`Test ${status.state}. Provider status: ${status.providerCode ?? 'unavailable'}. Contact your administrator.`); } setMessage('Test is still pending. The worker may be offline or retrying; contact your administrator.'); })}>Send Test Notification</Button><Button aria-label={`Remove ${device.label}`} size="icon" variant="ghost" disabled={busy} onClick={() => void run(async () => { await request(`/devices?id=${device.id}`, 'DELETE'); await loadDevices(); setMessage('Browser removed from this workspace.'); })}><Trash2 size={16} /></Button></div></div>)}</div></section>
    <section><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Notification history</h2><Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(async () => { await request('', 'PATCH', {}); await loadHistory(); })}><CheckCheck size={16} /> Mark all read</Button></div><div className="mb-3 flex flex-wrap items-center gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={unread} onChange={e => { setUnread(e.target.checked); setPage(1); }} />Unread only</label><label>Category <select className="rounded border p-2" value={type} onChange={e => { setType(e.target.value); setPage(1); }}><option value="">All categories</option>{categories.map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label></div>
      <div aria-busy={loading} className="divide-y rounded-xl border">{loading ? <p className="p-6 text-sm text-muted-foreground">Loading notifications…</p> : rows.length === 0 ? <p className="p-6 text-sm text-muted-foreground">You’re all caught up. No notifications match this view.</p> : rows.map(row => (
        <article key={row.id} className={`grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] ${row.isRead ? '' : 'bg-muted/40'}`}>
          <NotificationCategoryIcon type={row.type} />
          <a className="min-w-0 rounded-sm focus-visible:outline-2" href={`/api/notifications/open?id=${row.id}&organizationId=${row.organizationId}`}>
            <p className={`break-words text-sm leading-snug ${row.isRead ? 'font-medium' : 'font-semibold'}`}>
              {!row.isRead && <span aria-label="Unread" role="img" className="mr-2 inline-block size-2 rounded-full bg-primary" />}{row.title}
            </p>
            <p className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground">{row.body}</p>
            <time dateTime={row.createdAt} className="mt-1 block text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</time>
          </a>
          <div className="col-start-2 flex items-center gap-1 sm:col-start-3 sm:items-start">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(async () => {
              await request('', 'PATCH', { ids: [row.id], isRead: !row.isRead }); await loadHistory();
            })}>{row.isRead ? 'Mark unread' : 'Mark read'}</Button>
            <Button size="icon" variant="ghost" aria-label="Dismiss notification" disabled={busy} onClick={() => void run(async () => {
              await request(`?id=${row.id}`, 'DELETE'); await loadHistory();
            })}><Trash2 size={14} /></Button>
          </div>
        </article>
      ))}</div>
      <div className="mt-3 flex items-center justify-between"><Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-xs text-muted-foreground">Page {page} of {pages}</span><Button variant="outline" size="sm" disabled={page >= pages || loading} onClick={() => setPage(page + 1)}>Next</Button></div>
    </section>
  </div></main>;
}
