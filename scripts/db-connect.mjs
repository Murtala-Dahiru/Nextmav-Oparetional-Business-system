/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Building a Postgres client that survives a broken local resolver.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The problem this solves ───────────────────────────────────────────────
 *
 * `npm run db:apply` and `npm run db:verify` both failed with:
 *
 *     getaddrinfo EAI_AGAIN aws-0-eu-west-1.pooler.supabase.com
 *
 * and the script's own advice — "check the password, and that the project is
 * not paused" — sent the reader looking in the wrong two places. Neither was
 * wrong. The diagnosis was:
 *
 *   · The hostname is correct and does exist. Queried directly against
 *     8.8.8.8 and 9.9.9.9 it returns real A records.
 *   · Those addresses accept TCP on 5432 and 6543.
 *   · The credentials are correct: connecting to one of those addresses
 *     authenticates and reports PostgreSQL 17.6.
 *   · Only the machine's configured resolver fails on it. It answers for
 *     supabase.co, github.com and npmjs.org, but returns SERVFAIL for
 *     `*.pooler.supabase.com`.
 *
 * `EAI_AGAIN` is the tell. It means *temporary failure in name resolution* —
 * the resolver was reached and could not answer — as opposed to `ENOTFOUND`,
 * which is what a genuinely wrong hostname produces. Those two are easy to
 * read as the same thing and they have completely different causes.
 *
 * ── Why the fallback is here rather than in the environment ───────────────
 *
 * The real fix is the operator's DNS, and this does not pretend otherwise: it
 * prints exactly what it did and why, every time it engages. But a migration
 * runner that cannot run because a home router mishandles one domain is a
 * broken tool, and "reconfigure your resolver" is not something a build agent
 * or a CI container can act on either.
 *
 * The fallback is deliberately narrow:
 *
 *   · The system resolver is always tried first, and is used when it works.
 *   · It engages only on the resolution error codes, never on an auth
 *     failure, a timeout, or a refused connection — those are real problems
 *     and must keep surfacing as themselves.
 *   · It resolves the *same* hostname from the URL. It never substitutes a
 *     different host, region or port, so it cannot silently connect somewhere
 *     other than where you pointed it.
 *   · TLS still presents the original hostname via SNI, so the pooler routes
 *     the connection exactly as it would have.
 *
 * Set `DB_DNS_FALLBACK=off` to disable it and get the bare failure back.
 */
import { readFileSync } from 'node:fs';
import { Resolver } from 'node:dns/promises';
import pg from 'pg';

/** Resolution failures the fallback is allowed to act on, and nothing else. */
const DNS_ERRORS = new Set(['EAI_AGAIN', 'ENOTFOUND', 'ESERVFAIL', 'ETIMEOUT']);

/**
 * Public resolvers, tried in order.
 *
 * Two operators rather than one so a single provider being blocked — 1.1.1.1
 * is filtered on a fair number of consumer networks — does not defeat it.
 */
const PUBLIC_RESOLVERS = [['8.8.8.8', '8.8.4.4'], ['9.9.9.9'], ['1.1.1.1']];

export function readEnv(key, file = '.env') {
  if (process.env[key]) return process.env[key];
  try {
    const m = readFileSync(file, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  } catch {
    return '';
  }
}

/** Does the machine's own resolver answer for this host? */
async function systemResolves(hostname) {
  const dns = await import('node:dns/promises');
  try {
    await dns.lookup(hostname);
    return { ok: true };
  } catch (e) {
    return { ok: false, code: e.code };
  }
}

/** Ask the public resolvers for A records, first one to answer wins. */
async function resolveViaPublic(hostname) {
  for (const servers of PUBLIC_RESOLVERS) {
    const r = new Resolver({ timeout: 5000, tries: 2 });
    r.setServers(servers);
    try {
      const addresses = await r.resolve4(hostname);
      if (addresses?.length) return { addresses, via: servers[0] };
    } catch {
      // Try the next operator.
    }
  }
  return null;
}

/**
 * A connected `pg.Client` for the given connection string.
 *
 * Returns the client and a short note about how it got there, so the caller
 * can print one honest line rather than each script inventing its own wording.
 */
export async function connect(connectionString, { statement_timeout } = {}) {
  const url = new URL(connectionString);
  const base = {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1) || 'postgres',
    port: Number(url.port) || 5432,
    // Supabase terminates TLS with a certificate this client does not have the
    // chain for; unchanged from the original scripts, and the reason an
    // address-based connection is possible at all.
    ssl: { rejectUnauthorized: false, servername: url.hostname },
    ...(statement_timeout ? { statement_timeout } : {}),
  };

  const system = await systemResolves(url.hostname);

  if (system.ok) {
    const client = new pg.Client({ ...base, host: url.hostname });
    await client.connect();
    return { client, note: null };
  }

  if (!DNS_ERRORS.has(system.code) || readEnv('DB_DNS_FALLBACK') === 'off') {
    const e = new Error(`getaddrinfo ${system.code} ${url.hostname}`);
    e.code = system.code;
    throw e;
  }

  const resolved = await resolveViaPublic(url.hostname);
  if (!resolved) {
    const e = new Error(
      `Could not resolve ${url.hostname} through this machine's resolver ` +
      `(${system.code}) or through any public resolver. The hostname may be ` +
      `wrong, or this network blocks outbound DNS.`,
    );
    e.code = system.code;
    throw e;
  }

  /**
   * Try each address. The pooler publishes several and any of them will serve
   * the connection, but one can be draining or unreachable from a given
   * network — giving up after the first would reintroduce the same class of
   * intermittent failure this exists to remove.
   */
  let lastError = null;
  for (const address of resolved.addresses) {
    const client = new pg.Client({ ...base, host: address });
    try {
      await client.connect();
      return {
        client,
        note:
          `this machine's DNS could not resolve ${url.hostname} (${system.code}); ` +
          `resolved it via ${resolved.via} to ${address} instead.\n` +
          `  The database and credentials are fine — fix the resolver to remove this step.`,
      };
    } catch (e) {
      lastError = e;
      try { await client.end(); } catch { /* already failed */ }
      // An authentication or permission failure is not going to be different
      // at another address, so stop rather than retrying it three times.
      if (e.code && !['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'].includes(e.code)) break;
    }
  }

  throw lastError ?? new Error(`Could not connect to any address for ${url.hostname}`);
}
