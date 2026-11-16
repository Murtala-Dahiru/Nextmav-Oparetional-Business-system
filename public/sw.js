/* NextMav push worker v2. No fetch handler: existing network/cache behavior is preserved. */
self.addEventListener('push', event => {
  let payload;
  try { payload = event.data.json(); } catch { return; }
  // Presentation is minimized by the authorized server dispatcher, then encrypted by Web Push.
  const id = String(payload.id || '');
  const org = String(payload.organizationId || '');
  if (!/^\d+$/.test(id) || !/^[a-f0-9-]{36}$/i.test(org)) return;
  event.waitUntil(self.registration.showNotification(typeof payload.presentation?.title === 'string' ? payload.presentation.title.slice(0, 100) : 'NextMav', {
    body: typeof payload.presentation?.body === 'string' ? payload.presentation.body.slice(0, 320) : 'You have a new notification in your workspace.',
    tag: `nextmav:${org}:${/^[a-zA-Z0-9_-]{1,32}$/.test(payload.group || '') ? payload.group : id}`, icon: '/icons/nextmav-192.png', silent: payload.silent !== false,
    data: { url: `/api/notifications/open?id=${id}&organizationId=${org}` },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const candidate = new URL(event.notification.data?.url || '/dashboard', self.location.origin);
  const url = candidate.origin === self.location.origin && candidate.pathname === '/api/notifications/open' ? candidate.href : new URL('/dashboard', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin && new URL(client.url).pathname === '/dashboard');
    if (existing) { await existing.navigate(url); await existing.focus(); }
    else await self.clients.openWindow(url);
  })());
});
