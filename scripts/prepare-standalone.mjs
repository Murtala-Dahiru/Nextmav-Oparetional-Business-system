/**
 * Copy static assets into the standalone output.
 *
 * `output: "standalone"` in next.config.ts emits a self-contained server but
 * deliberately omits `.next/static` and `public` — they are expected to be
 * served by a CDN. When the standalone server is run directly (Railway, Render,
 * Fly, Docker) those directories must sit alongside it or every stylesheet,
 * script and image 404s.
 *
 * This replaces a `cp -r` chain that only worked on POSIX shells, and is a
 * no-op on platforms that build their own output (Vercel, Netlify), so the same
 * build command is safe everywhere.
 */
import { cp, access } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const standalone = join(root, '.next', 'standalone');

const exists = async (p) => {
  try { await access(p); return true; } catch { return false; }
};

if (!(await exists(standalone))) {
  console.log('[standalone] no standalone output — nothing to prepare.');
  process.exit(0);
}

for (const [from, to] of [
  [join(root, '.next', 'static'), join(standalone, '.next', 'static')],
  [join(root, 'public'), join(standalone, 'public')],
]) {
  if (await exists(from)) {
    await cp(from, to, { recursive: true });
    console.log(`[standalone] copied ${from.replace(root, '.')} -> ${to.replace(root, '.')}`);
  }
}

console.log('[standalone] ready — run: node .next/standalone/server.js');
