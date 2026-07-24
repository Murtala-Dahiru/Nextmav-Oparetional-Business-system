/**
 * Fail the build when Supabase configuration is missing.
 *
 * `NEXT_PUBLIC_*` values are substituted into the output while `next build`
 * runs, not read per request. A build that starts without them produces a
 * bundle with `undefined` baked in — it compiles, deploys, serves, and then
 * fails on the first request with "Supabase is not configured". Setting the
 * variables on the host afterwards changes nothing, because only a new build
 * can pick them up.
 *
 * That failure is expensive precisely because it arrives late and looks like
 * an application bug rather than a configuration one. Checking here turns it
 * into a build error that names the missing variable.
 *
 * Real environment wins over `.env`, matching how hosts inject configuration.
 */
import { readFileSync } from 'node:fs';

/** Values from `.env`, if it exists. Absent on hosts, which set real env vars. */
function dotenv() {
  try {
    return Object.fromEntries(
      readFileSync('.env', 'utf8')
        .split(/\r?\n/)
        .map(l => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/))
        .filter(Boolean)
        .map(([, k, v]) => [k, v.trim().replace(/^['"]|['"]$/g, '')]),
    );
  } catch {
    return {};
  }
}

const file = dotenv();
const read = k => (process.env[k] ?? file[k] ?? '').trim();

const REQUIRED = [
  ['NEXT_PUBLIC_SUPABASE_URL', 'Supabase dashboard → Settings → API → Project URL'],
  ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'Supabase dashboard → Settings → API → anon public'],
];

const problems = [];

for (const [key, where] of REQUIRED) {
  if (!read(key)) problems.push(`${key} is not set.\n    Find it at: ${where}`);
}

const url = read('NEXT_PUBLIC_SUPABASE_URL');

// The dashboard shows the project URL next to the REST endpoint, and the two
// are easy to confuse. The trailing path makes every call resolve to
// /rest/v1/rest/v1/… and 404 with nothing pointing at the cause.
if (url && /\/rest\/v1\/?$/.test(url)) {
  problems.push(
    'NEXT_PUBLIC_SUPABASE_URL must be the bare project origin, not the REST endpoint.\n' +
      `    Got:      ${url}\n` +
      `    Expected: ${url.replace(/\/rest\/v1\/?$/, '')}`,
  );
}

if (url && !/^https?:\/\//.test(url)) {
  problems.push(`NEXT_PUBLIC_SUPABASE_URL must include the scheme.\n    Got: ${url}`);
}

if (problems.length) {
  console.error('\n  Build stopped — Supabase is not configured.\n');
  problems.forEach(p => console.error(`  · ${p}\n`));
  console.error(
    '  These are baked into the build, so setting them on the host and\n' +
      '  restarting will not help — set them, then build again.\n' +
      '  Locally: put them in .env. See DEPLOYMENT.md.\n',
  );
  process.exit(1);
}

console.log('[check-env] Supabase configuration present.');
