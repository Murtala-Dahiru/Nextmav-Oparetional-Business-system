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
const distDir = process.env.NEXT_DIST_DIR || '.next';
const standalone = join(root, distDir, 'standalone');

const exists = async (p) => {
  try { await access(p); return true; } catch { return false; }
};

if (!(await exists(standalone))) {
  console.log('[standalone] no standalone output — nothing to prepare.');
  process.exit(0);
}

for (const [from, to] of [
  // Next's native dependency trace may omit libvips DLLs beside Sharp's addon.
  // Preserve the installed platform package; never copy a different-platform binary.
  [join(root, 'node_modules', '@img', `sharp-${process.platform}-${process.arch}`), join(standalone, 'node_modules', '@img', `sharp-${process.platform}-${process.arch}`)],
  [join(root, distDir, 'static'), join(standalone, distDir, 'static')],
  [join(root, 'public'), join(standalone, 'public')],
]) {
  if (await exists(from)) {
    await cp(from, to, { recursive: true });
    console.log(`[standalone] copied ${from.replace(root, '.')} -> ${to.replace(root, '.')}`);
  }
}

console.log(`[standalone] ready — run: node ${distDir}/standalone/server.js`);
