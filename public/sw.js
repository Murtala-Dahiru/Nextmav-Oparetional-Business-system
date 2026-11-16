/* NextMav push worker v1. No fetch handler: existing network/cache behavior is preserved. */
self.addEventListener('push', event => {
  let payload;
  try { payload = event.data.json(); } catch { return; }
  // Content is deliberately generic even if an unexpected payload contains a preview.
  const id = String(payload.id || '');
  const org = String(payload.organizationId || '');
  if (!/^\d+$/.test(id) || !/^[a-f0-9-]{36}$/i.test(org)) return;
  event.waitUntil(self.registration.showNotification('NextMav', {
    body: 'You have a new notification in your workspace.',
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
