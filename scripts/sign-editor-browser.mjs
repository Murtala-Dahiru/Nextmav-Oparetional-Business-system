import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { PDFDocument, degrees } from 'pdf-lib';
const { chromium } = await import(
  pathToFileURL(
    join(tmpdir(), 'nextmav-browser/node_modules/playwright/index.mjs'),
  ).href
);
const bundle = await build({
  stdin: {
    contents: `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FieldEditor} from './src/components/sign/field-editor';
const recipients=['signer','witness'].map(role=>({id:crypto.randomUUID(),name:role,role,order:1,generation:0,verification:'possession',email:''}));
function App(){const [fields,update]=useState([]); return <><FieldEditor url="/fixture.pdf" fields={fields} recipients={recipients} pages={2} onChange={update}/><output hidden>{JSON.stringify(fields)}</output></>}
createRoot(document.querySelector('main')).render(<App/>);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  jsx: 'automatic',
  format: 'esm',
  write: false,
  define: { 'process.env.NODE_ENV': '"production"' },
});
const pdf = await PDFDocument.create();
pdf.addPage([600, 800]).drawText('Full Name:', { x: 40, y: 650 });
pdf.addPage([700, 400]).setRotation(degrees(90));
const fixture = await pdf.save();
const stylesheet = await postcss([tailwind()]).process(
  '@import "tailwindcss" source(none); @source "../src/components/sign";',
  { from: join(process.cwd(), 'scripts/sign-editor-browser.css') },
);
const server = createServer((req, res) => {
  if (req.url === '/bundle.js' || req.url === '/sign/pdf.worker.min.mjs') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(
      req.url === '/bundle.js'
        ? bundle.outputFiles[0].contents
        : readFileSync('public/sign/pdf.worker.min.mjs'),
    );
    return;
  }
  if (req.url === '/fixture.pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.end(fixture);
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>' +
      stylesheet.css +
      '</style><main></main><script type="module" src="/bundle.js"></script>',
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'msedge' });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.on('pageerror', (err) => console.error(err.message));
  await page.goto('http://127.0.0.1:' + server.address().port);
  const paper = page.locator('#pdf-page-1');
  const fields = () =>
    page.locator('output').evaluate((el) => JSON.parse(el.textContent));
  const button = (name) => page.getByRole('button', { name, exact: true });
  for (const label of [
    'Signature',
    'Full Name',
    'Date Signed',
    'Manual Date',
    'Initials',
    'Checkbox',
    'Text',
    'Email',
    'Company',
    'Witness Name',
    'Witness Signature',
    'Witness Date',
  ]) {
    const before = await fields();
    await button(label).click();
    await paper.click({ position: { x: 100, y: 120 } });
    const after = await fields();
    assert.equal(after.length, before.length + 1, label);
    assert.equal(after.at(-1).label, label);
    if (label.startsWith('Witness'))
      assert.match(
        await page
          .getByLabel('Recipient', { exact: true })
          .locator('option:checked')
          .innerText(),
        /witness/,
      );
  }
  const second = page.locator('#pdf-page-2');
  await second.scrollIntoViewIfNeeded();
  await button('Company').dragTo(second, { targetPosition: { x: 40, y: 60 } });
  assert.equal((await fields()).at(-1).page, 2);
  const placed = second.getByRole('button', { name: /Company/ });
  const before = (await fields()).at(-1);
  await placed.scrollIntoViewIfNeeded();
  const box = await placed.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 65, box.y + 30, { steps: 8 });
  await page.mouse.up();
  const moved = (await fields()).at(-1);
  assert.ok(moved.x > before.x);
  await button('Undo').click();
  assert.deepEqual((await fields()).at(-1), before);
  await button('Redo').click();
  await placed.focus();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  assert.equal((await fields()).length, 14);
  await page.keyboard.press('Delete');
  assert.equal((await fields()).length, 13);
  await page.keyboard.press('Control+z');
  assert.equal((await fields()).length, 14);
  await page.keyboard.press('Control+Shift+z');
  assert.equal((await fields()).length, 13);
  const selected = second.getByRole('button', { name: /Company/ });
  await selected.click();
  const corner = selected.locator('[data-corner=se]');
  await corner.scrollIntoViewIfNeeded();
  const handle = await corner.boundingBox();
  await page.mouse.move(handle.x + 4, handle.y + 4);
  await page.mouse.down();
  await page.mouse.move(handle.x + 28, handle.y + 18, { steps: 8 });
  await page.mouse.up();
  const resized = (await fields()).at(-1);
  assert.ok(resized.width > moved.width);
  await button('Undo').click();
  assert.equal((await fields()).at(-1).width, moved.width);
  await selected.click();
  const proportionalHandle = await selected
    .locator('[data-corner=se]')
    .boundingBox();
  const proportionalBefore = (await fields()).at(-1);
  await page.keyboard.down('Shift');
  await page.mouse.move(proportionalHandle.x + 4, proportionalHandle.y + 4);
  await page.mouse.down();
  await page.mouse.move(proportionalHandle.x + 24, proportionalHandle.y + 16, {
    steps: 5,
  });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const proportionalAfter = (await fields()).at(-1);
  assert.ok(
    Math.abs(
      proportionalBefore.width / proportionalBefore.height -
        proportionalAfter.width / proportionalAfter.height,
    ) < 0.00001,
  );
  await button('Undo').click();
  await page.getByLabel('Display label').fill('Client company');
  await page.getByLabel('Display label').press('Backspace');
  assert.equal((await fields()).length, 13);

  const beforeGroup = (await fields()).length;
  await button('Witness Name + Signature + Date').click();
  await paper.click({ position: { x: 70, y: 180 } });
  assert.equal((await fields()).length, beforeGroup + 3);
  await button('Undo').click();
  assert.equal((await fields()).length, beforeGroup);
  await button('Suggested fields · page 1').click();
  assert.equal((await fields()).length, beforeGroup);
  await button('Add Full Name:').click();
  assert.equal((await fields()).at(-1).type, 'name');
  await page.getByLabel('Font family').selectOption('mono');
  assert.equal((await fields()).at(-1).fontFamily, 'mono');
  await page.getByLabel('Text alignment').selectOption('right');
  assert.equal((await fields()).at(-1).alignment, 'right');
  await button('Center').click();
  const centered = (await fields()).at(-1);
  assert.equal(centered.x, (1 - centered.width) / 2);
  await button('Zoom in').click();
  assert.deepEqual((await fields()).at(-1), centered);
  await page.getByLabel('Document page', { exact: true }).selectOption('2');
  assert.deepEqual((await fields()).at(-1), centered);
  console.log(
    'PASS optional suggestions and groups, font family, alignment, zoom and page navigation',
  );
  const mobile = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 780 },
  });
  const phone = await mobile.newPage();
  await phone.goto('http://127.0.0.1:' + server.address().port);
  await phone.getByRole('button', { name: 'Witness Name', exact: true }).tap();
  await phone.locator('#pdf-page-1').tap({ position: { x: 20, y: 80 } });
  assert.equal(
    await phone
      .locator('output')
      .evaluate((el) => JSON.parse(el.textContent)[0].label),
    'Witness Name',
  );
  const target = phone.locator('#pdf-page-1 button').first();
  await target.scrollIntoViewIfNeeded();
  const touchBox = await target.boundingBox(),
    cdp = await mobile.newCDPSession(phone);
  const start = {
    x: touchBox.x + touchBox.width / 2,
    y: touchBox.y + touchBox.height / 2,
  };
  const prev = await phone
    .locator('output')
    .evaluate((el) => JSON.parse(el.textContent)[0].x);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [start],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: start.x + 30, y: start.y + 22 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  assert.ok(
    (await phone
      .locator('output')
      .evaluate((el) => JSON.parse(el.textContent)[0].x)) > prev,
  );
  await mobile.close();
  console.log(
    'PASS corner resizing, single undo per gesture, input editing and mobile tap placement',
  );
  console.log(
    'PASS all twelve field tools, witness role resolution, toolbar drag onto rotated page 2, field movement, grouped undo/redo, copy/paste and deletion in Edge',
  );
} finally {
  await browser.close();
  server.close();
}
