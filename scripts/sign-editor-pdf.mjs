import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, degrees } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
const base = process.env.APP_URL || 'http://localhost:3018';
const { email, password } = JSON.parse(
  readFileSync(join(tmpdir(), 'nextmav-sign-fixture.json')),
);
const login = await fetch(base + '/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
assert.equal(login.status, 200);
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');
async function rotationFixture() {
  const pdf = await PDFDocument.create();
  const recipient = {
    id: crypto.randomUUID(),
    role: 'approver',
    order: 1,
    name: 'Practice Reviewer',
    email: '',
    verification: 'possession',
    generation: 0,
  };
  const fields = [];
  for (const [i, angle] of [0, 90, 180, 270].entries()) {
    const page = pdf.addPage([590 + i * 17, 820 - i * 13]);
    page.setRotation(degrees(angle));
    for (let line = 0; line < 28; line++)
      page.drawText(
        'Agreement review copy. Each paragraph is provided for test purposes only.',
        { x: 28, y: 780 - line * 17, size: 9 },
      );
    fields.push({
      id: crypto.randomUUID(),
      page: i + 1,
      recipientId: recipient.id,
      type: 'text',
      label: 'Review ' + angle,
      placeholder: '',
      inputMode: 'readonly',
      defaultValue: 'Approved ' + angle,
      x: 0.18,
      y: 0.76,
      width: 0.47,
      height: 0.12,
      fontSize: 16,
      fontFamily: ['sans', 'serif', 'mono', 'sans'][i],
      alignment: 'right',
      required: true,
    });
  }
  const upload = await fetch(base + '/api/sign', {
    method: 'POST',
    headers: {
      cookie,
      'Content-Type': 'application/pdf',
      'X-File-Name': 'TEST ONLY rotated review.pdf',
    },
    body: await pdf.save(),
  });
  assert.equal(upload.status, 200);
  let e = (await upload.json()).data;
  async function post(path, body, credentials = cookie) {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: { cookie: credentials, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, 200, result.error);
    return { response, result };
  }
  async function op(operation, extra = {}) {
    const { result } = await post('/api/sign/' + e.id, {
      operation,
      revision: e.revision,
      ...extra,
    });
    e = result.data;
    return result;
  }
  await op('save', {
    data: {
      title: e.title,
      sequential: false,
      expiresAt: e.data.expiresAt,
      recipients: [recipient],
      fields,
    },
  });
  await op('send');
  const { link } = await op('link', { recipientId: recipient.id });
  const session = await post(
    '/api/sign-portal',
    { operation: 'exchange', token: new URL(link).hash.slice(1) },
    '',
  );
  const auth = session.response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  await post(
    '/api/sign-portal',
    {
      operation: 'complete',
      confirmation: 'confirm-electronic-action',
      consent: true,
      values: {},
    },
    auth,
  );
  return e.id;
}
const id = process.argv.includes('--rotation-fixture')
  ? await rotationFixture()
  : readFileSync('docs/sign-evidence/browser-envelope-id.txt', 'utf8').trim();
const url = base + '/api/sign/' + id;
const envelope = (await (await fetch(url, { headers: { cookie } })).json())
  .data;
assert.equal(envelope.status, 'completed');
async function load(file) {
  const response = await fetch(url + '?file=' + file, { headers: { cookie } });
  assert.equal(response.status, 200);
  return getDocument({
    data: new Uint8Array(await response.arrayBuffer()),
    useSystemFonts: true,
  });
}
const original = await load('original'),
  completed = await load('completed');
try {
  const before = await original.promise,
    after = await completed.promise;
  for (let n = 1; n <= after.numPages; n++) {
    async function render(pdf) {
      const page = await pdf.getPage(n),
        vp = page.getViewport({ scale: 1.5 });
      const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height)),
        context = canvas.getContext('2d');
      await page.render({ canvas, canvasContext: context, viewport: vp })
        .promise;
      return {
        pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
        width: canvas.width,
        height: canvas.height,
        rotation: vp.rotation,
      };
    }
    const old = await render(before),
      current = await render(after);
    const fields = envelope.data.fields
      .filter((f) => f.page === n)
      .map((f) => ({
        left: f.x * current.width,
        right: (f.x + f.width) * current.width,
        top: f.y * current.height,
        bottom: (f.y + f.height) * current.height,
        ink: 0,
      }));
    for (let y = 0; y < current.height; y++)
      for (let x = 0; x < current.width; x++) {
        const i = (x + y * current.width) * 4;
        if (Math.abs(old.pixels[i] - current.pixels[i]) < 12) continue;
        const field = fields.find(
          (f) =>
            x >= f.left - 2 &&
            x <= f.right + 2 &&
            y >= f.top - 2 &&
            y <= f.bottom + 2,
        );
        assert.ok(field, 'Unexpected ink outside fields on page ' + n);
        field.ink++;
      }
    assert.ok(fields.every((f) => f.ink > 0));
    console.log(
      'PASS page ' +
        n +
        ' at ' +
        current.rotation +
        ' degrees, ' +
        fields.length +
        ' completed fields have ink at the saved positions',
    );
  }
} finally {
  await original.destroy();
  await completed.destroy();
}
