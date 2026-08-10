/**
 * `next dev` against a private dist directory.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Next 16 holds an exclusive lock on `<distDir>/dev/lock` for the lifetime of
 * the dev server, in both Turbopack and webpack. The lock is per *directory*,
 * not per port, so a second `next dev` in this checkout exits immediately with
 * "Unable to acquire lock" no matter how many ports are free — which is why
 * changing `-p` or turning on `autoPort` does not help.
 *
 * Pointing the second server at its own dist directory gives it its own lock.
 * `next.config.ts` reads `NEXT_DIST_DIR` and falls back to `.next`, so nothing
 * outside this script is affected: `npm run build`, the standalone copy step
 * and CI all still use `.next`.
 *
 * PORT is passed straight through, so the harness's assigned port is honoured.
 *
 * This is a convenience for running two sessions side by side. For anything
 * touching sign-in, prefer the ordinary `npm run dev` — auth redirects are
 * configured against a known origin.
 */
import { spawn } from 'node:child_process';

const env = { ...process.env, NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || '.next-preview' };

// `shell: true` because the executable is `npx` — a shim, not a binary, on
// Windows. Without it spawn cannot resolve it.
const child = spawn('npx', ['next', 'dev'], { stdio: 'inherit', shell: true, env });

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}
