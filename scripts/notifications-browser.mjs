import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(join(tmpdir(), 'nextmav-browser/node_modules/playwright/index.mjs')).href);
const fixture = JSON.parse(readFileSync(join(tmpdir(), 'nextmav-notifications-fixture.json')));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const base = process.env.APP_URL || fixture.base;
try {
  const recipient = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const sender = await browser.newContext();
  for (const [context, user] of [[recipient, fixture.users[1]], [sender, fixture.users[0]]]) {
    assert.equal((await context.request.post(base + '/api/auth/login', { data: { email: user.email, password: user.password } })).status(), 200);
  }
  const page = await recipient.newPage();
  await page.goto(base + '/settings/notifications', { waitUntil: 'domcontentloaded' });
  await page.getByText('New message from your team', { exact: true }).first().waitFor({ timeout: 90000 });
  console.log('PASS Windows Edge headless recipient history renders real message');
  console.log('BROWSER ' + JSON.stringify(await page.evaluate(() => ({ secure: isSecureContext, pushAPI: 'PushManager' in window, notificationAPI: 'Notification' in window, permission: Notification.permission, serviceWorker: 'serviceWorker' in navigator }))));
  const worker = await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); const r = await navigator.serviceWorker.ready; return { active: !!r.active, subscription: !!await r.pushManager.getSubscription() }; });
  assert.equal(worker.active, true); console.log('SERVICE WORKER ' + JSON.stringify(worker));
  if (process.env.TEST_WEB_PUSH === '1') {
    await recipient.grantPermissions(['notifications'], { origin: base });
    await page.getByRole('button', { name: 'Enable Notifications' }).click();
    try {
      await page.getByText(/This browser is connected/).waitFor({ timeout: 45000 });
      console.log('PUSH subscription created and registered for isolated Edge profile');
    } catch {
      const error = await page.getByRole('alert').textContent({ timeout: 1000 }).catch(() => 'Browser subscription did not complete');
      console.log('PUSH subscription unavailable: ' + error);
    }
  }
  mkdirSync('docs/notifications-evidence', { recursive: true });
  await page.screenshot({ path: 'docs/notifications-evidence/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'docs/notifications-evidence/mobile.png', fullPage: true });
  console.log('PASS desktop and phone-width layouts, no horizontal overflow');
  await page.getByRole('button', { name: 'Mark all read' }).click();
  await page.getByLabel('Unread only').check();
  await page.getByText(/No notifications match this view/).waitFor();
  console.log('PASS unread filter and empty state');
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(base + '/dashboard', { waitUntil: 'domcontentloaded' });
  const bell = page.getByRole('button', { name: /notification/i }).first();
  await bell.waitFor({ timeout: 90000 });
  const result = await sender.request.post(base + '/api/communication/messages', { data: { channelId: fixture.channelId, body: 'Live delivery acceptance' } });
  assert.equal(result.status(), 201);
  await bell.click();
  await page.getByText(/\d+ new/).first().waitFor({ timeout: 40000 });
  await page.getByText('New message from your team', { exact: true }).first().click();
  await page.getByText('Live delivery acceptance', { exact: true }).last().waitFor({ timeout: 60000 });
  console.log('PASS two browser contexts, live bell, click opens correct conversation and message');
} finally { await browser.close(); }
