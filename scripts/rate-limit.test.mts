/**
 * The rate limiter.
 *
 *     npm run test:rate-limit          (no server or database needed)
 *
 * The properties asserted here are the ones whose failure is silent. A limiter
 * that is too strict announces itself immediately — users complain. A limiter
 * that never actually blocks, that buckets every caller together, that reads a
 * client-supplied address, or that takes the login page down when its counter
 * breaks, all look exactly like a working one from the outside.
 *
 * Limits are set from the environment *before* the module is imported, which
 * is both how the tests get small numbers to work with and the proof that the
 * configuration is real rather than decorative.
 */
process.env.RATE_LIMIT_DISABLED = '0';
process.env.RATE_LIMIT_TRUSTED_HOPS = '1';
process.env.RATE_LIMIT_SIGN_IN_PER_ADDRESS = '4';
process.env.RATE_LIMIT_SIGN_IN_PER_ACCOUNT = '2';
process.env.RATE_LIMIT_EMAIL_PER_ADDRESS = '0';
process.env.RATE_LIMIT_EMAIL_PER_ACCOUNT = '2';

const {
  enforceRateLimit,
  clientAddress,
  setRateLimitStore,
  RATE_LIMITS,
  RATE_LIMIT_SUMMARY,
} = await import('../src/lib/rate-limit');

let pass = 0, fail = 0;

const check = (ok: boolean, label: string, detail = '') => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} | ${label}${ok || !detail ? '' : `  (${detail})`}`);
};

const section = (t: string) => console.log(`\n${t}`);

/** Only `headers` is read, so only `headers` is supplied. */
function req(headers: Record<string, string> = {}) {
  return { headers: new Headers(headers) } as unknown as Parameters<typeof enforceRateLimit>[0];
}

/** A caller from a fixed address, one hop away, as a proxy would present them. */
const from = (ip: string) => req({ 'x-forwarded-for': ip });

// ───────────────────────────────────────────────────────────────────────────
section('THE LIMITS COME FROM THE ENVIRONMENT');

check(RATE_LIMITS.signIn.perAddress === 4,
  'a configured per-address limit is used', `got ${RATE_LIMITS.signIn.perAddress}`);
check(RATE_LIMITS.signIn.perSubject === 2,
  'a configured per-subject limit is used', `got ${RATE_LIMITS.signIn.perSubject}`);
check(RATE_LIMITS.emailDispatch.perAddress === 0,
  'zero is honoured as "off" rather than falling back to the default');
check(RATE_LIMITS.signUp.perSubject === 3,
  'an unset limit keeps its default', `got ${RATE_LIMITS.signUp.perSubject}`);
check(RATE_LIMIT_SUMMARY.enabled === true, 'the summary reports the limiter as enabled');

// ───────────────────────────────────────────────────────────────────────────
section('THE ADDRESS BUCKET ACTUALLY BLOCKS');
{
  // Four permitted, each as a different account so only the address bucket
  // can be what stops the fifth.
  const results: (Response | null)[] = [];
  for (let i = 0; i < 5; i++) {
    results.push(await enforceRateLimit(from('10.0.0.1'), RATE_LIMITS.signIn, `user${i}@example.com`));
  }
  check(results.slice(0, 4).every(r => r === null), 'the first four attempts are permitted');
  check(results[4] !== null, 'the fifth is refused');
  check(results[4]?.status === 429, 'refusal is a 429', `got ${results[4]?.status}`);

  const retry = Number(results[4]?.headers.get('Retry-After'));
  check(retry > 0 && retry <= 60, 'Retry-After is set and inside the window', `${retry}s`);
}

{
  // A different address is a different bucket — one abuser must not lock out
  // everybody else.
  const other = await enforceRateLimit(from('10.0.0.2'), RATE_LIMITS.signIn, 'someone@example.com');
  check(other === null, 'a different address is unaffected by the first one being blocked');
}

// ───────────────────────────────────────────────────────────────────────────
section('THE SUBJECT BUCKET SURVIVES A CHANGE OF ADDRESS');
{
  // The credential-stuffing case: one account, attacked from a fresh address
  // every time. The address bucket can never see this.
  const results: (Response | null)[] = [];
  for (let i = 0; i < 3; i++) {
    results.push(await enforceRateLimit(from(`192.0.2.${i}`), RATE_LIMITS.signIn, 'victim@example.com'));
  }
  check(results.slice(0, 2).every(r => r === null), 'two attempts against one account are permitted');
  check(results[2]?.status === 429, 'the third is refused despite a new address each time');
}

// ───────────────────────────────────────────────────────────────────────────
section('A REFUSAL SAYS NOTHING AND COSTS NOTHING');
{
  const first = await enforceRateLimit(from('198.51.100.1'), RATE_LIMITS.signIn, 'victim@example.com');
  check(first?.status === 429, 'still refused');

  const body = await first!.clone().json();
  check(body?.error?.code === 'RATE_LIMITED', 'carries the RATE_LIMITED code the client already handles');
  check(!/victim|example\.com|account|address/i.test(body?.error?.message ?? ''),
    'the message names neither the account nor which bucket tripped',
    body?.error?.message);

  // Knocking again must not push the deadline out. If refusals counted, an
  // attacker could hold a real user's account shut indefinitely.
  const a = Number(first!.headers.get('Retry-After'));
  const again = await enforceRateLimit(from('198.51.100.2'), RATE_LIMITS.signIn, 'victim@example.com');
  const b = Number(again!.headers.get('Retry-After'));
  check(b <= a, 'a rejected attempt does not extend the window', `${a}s then ${b}s`);
}

// ───────────────────────────────────────────────────────────────────────────
section('A BUCKET SET TO ZERO IS OFF, NOT CLOSED');
{
  // `emailDispatch.perAddress` is 0 above. Zero must mean "do not check this
  // bucket" — read as a limit of nought it would refuse every request, which
  // is how a disabled control becomes an outage.
  const results: (Response | null)[] = [];
  for (let i = 0; i < 6; i++) {
    results.push(await enforceRateLimit(from('203.0.113.9'), RATE_LIMITS.emailDispatch, `r${i}@example.com`));
  }
  check(results.every(r => r === null), 'every request passes when the address bucket is disabled');
}

// ───────────────────────────────────────────────────────────────────────────
section('THE FORWARDED ADDRESS IS READ FROM THE RIGHT');
{
  // The header a client can write to is the left of the list; the entry the
  // trusted proxy appended is on the right. Reading the left — which is the
  // more commonly written version of this code — means an attacker rotates
  // `x-forwarded-for` and is never limited.
  const spoofed = clientAddress(req({ 'x-forwarded-for': '1.2.3.4, 9.9.9.9' }));
  check(spoofed === '9.9.9.9', 'a forged left-hand entry is ignored', `got ${spoofed}`);

  check(clientAddress(req({ 'x-forwarded-for': '9.9.9.9' })) === '9.9.9.9',
    'a single-entry header is the client');
  check(clientAddress(req({ 'x-real-ip': '8.8.8.8' })) === '8.8.8.8',
    'x-real-ip is the fallback');
  check(clientAddress(req()) === null,
    'no forwarding headers means no address, rather than a shared placeholder');
}

{
  // The consequence of that null, and the reason it is a null: callers we
  // cannot identify must not all land in one bucket, or a deployment with no
  // proxy headers locks its entire user base out after a few sign-ins.
  const results: (Response | null)[] = [];
  for (let i = 0; i < 8; i++) {
    results.push(await enforceRateLimit(req(), RATE_LIMITS.signIn, `anon${i}@example.com`));
  }
  check(results.every(r => r === null),
    'unidentifiable callers are not pooled into a single shared allowance');

  // They are still protected by the subject bucket, which is the one that
  // matters. Three attempts against one account, limit of two.
  await enforceRateLimit(req(), RATE_LIMITS.signIn, 'pooled@example.com');
  await enforceRateLimit(req(), RATE_LIMITS.signIn, 'pooled@example.com');
  const third = await enforceRateLimit(req(), RATE_LIMITS.signIn, 'pooled@example.com');
  check(third?.status === 429, 'but the subject bucket still applies to them');
}

// ───────────────────────────────────────────────────────────────────────────
section('A BROKEN COUNTER DOES NOT BREAK THE LOGIN PAGE');
{
  setRateLimitStore({
    hit() { throw new Error('store unavailable'); },
  });
  const result = await enforceRateLimit(from('10.0.0.1'), RATE_LIMITS.signIn, 'anyone@example.com');
  check(result === null, 'a store that throws fails open');

  setRateLimitStore({
    async hit() { return Promise.reject(new Error('timeout')); },
  });
  const rejected = await enforceRateLimit(from('10.0.0.1'), RATE_LIMITS.signIn, 'anyone@example.com');
  check(rejected === null, 'a store that rejects fails open');
}

// ───────────────────────────────────────────────────────────────────────────
section('THE STORE IS REPLACEABLE WITHOUT TOUCHING A ROUTE');
{
  // The seam that a shared counter — Redis, or whatever replaces it after any
  // future move off Supabase — would slot into.
  const seen: string[] = [];
  setRateLimitStore({
    hit(key) {
      seen.push(key);
      return { allowed: false, resetAt: Date.now() + 30_000 };
    },
  });

  const result = await enforceRateLimit(from('10.0.0.1'), RATE_LIMITS.signIn, 'someone@example.com');
  check(result?.status === 429, 'an external store decides the verdict');
  check(seen.length === 1 && seen[0].startsWith('sign-in:a:'),
    'the key is namespaced by policy and bucket', seen[0]);
  check(!seen.some(k => k.includes('someone') || k.includes('10.0.0.1')),
    'neither the address nor the account appears in the key');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
