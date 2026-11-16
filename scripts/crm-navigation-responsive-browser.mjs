import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const fixturePath = process.env.CRM_AUDIT_FIXTURE;
assert.ok(fixturePath, 'Set CRM_AUDIT_FIXTURE to the synthetic owner login file');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const base = process.env.APP_URL;
assert.ok(base, 'Set APP_URL to the test application');
const { chromium } = await import(pathToFileURL(join(tmpdir(), 'nextmav-browser/node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch({ channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const login = await page.request.post(base + '/api/auth/login', { data: { email: fixture.email, password: fixture.password } });
  assert.ok(login.ok());
  await page.goto(base + '/dashboard');
  await page.getByRole('button', { name: 'Customers & revenue', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'CRM sections' });
  await nav.waitFor();
  for (const width of [1440, 1280, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await nav.evaluate(el => el.scrollWidth <= el.clientWidth), 'CRM navigation fits ' + width);
    const select = nav.getByRole('combobox');
    assert.equal(await select.isVisible(), width < 1440);
    console.log('PASS CRM navigation fits ' + width);
  }
  await nav.getByRole('combobox').selectOption('activities');
  const filter = page.getByRole('combobox', { name: 'Activity type' });
  await filter.focus();
  await filter.press('Enter');
  await page.getByRole('listbox').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('listbox').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Activity type');
  await nav.getByRole('combobox').selectOption('import');
  await page.getByRole('list', { name: 'Import steps' }).focus();
  assert.ok(await page.getByRole('list', { name: 'Import steps' }).evaluate(el => el === document.activeElement));
  console.log('PASS activity filter and import steps keyboard access');
} finally {
  await browser.close();
}
