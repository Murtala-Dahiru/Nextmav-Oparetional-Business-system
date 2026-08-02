/**
 * The logger and the correlation id.
 *
 *     npm run test:observability          (no server or database needed)
 *
 * Two of these are security properties rather than conveniences, and both fail
 * silently. Redaction is only observable by reading the logs *after* a
 * password has been written to them, at which point the remedy is rotating
 * every credential that passed through. And an unvalidated correlation id is a
 * log-injection primitive: a newline in an attacker-supplied header forges
 * whole entries, which is how an intruder writes a reassuring line into the
 * record of their own visit.
 *
 * The rest guard the failure that makes an incident unreadable: an `Error` has
 * non-enumerable `message` and `stack`, so a logger that hands it to
 * `JSON.stringify` writes `{}` and destroys the only useful thing it was given.
 */
process.env.LOG_FORMAT = 'json';
process.env.LOG_LEVEL = 'debug';
process.env.NEXT_PUBLIC_APP_ENV = 'test';

const { log, setLogSink, resetLogSink, serializeError, LOG_CONFIG } =
  await import('../src/lib/logger');
const { sanitizeRequestId, resolveRequestId, REQUEST_ID_HEADER } =
  await import('../src/lib/request-id');

let pass = 0, fail = 0;

const check = (ok: boolean, label: string, detail = '') => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} | ${label}${ok || !detail ? '' : `  (${detail})`}`);
};

const section = (t: string) => console.log(`\n${t}`);

/** Collect what the logger emits instead of printing it. */
function capture() {
  const records: Record<string, unknown>[] = [];
  setLogSink(r => { records.push(r as Record<string, unknown>); });
  return records;
}

/** Everything in a record, flattened to one string, for "does this leak" tests. */
const flat = (r: unknown) => JSON.stringify(r);

// ───────────────────────────────────────────────────────────────────────────
section('EVERY RECORD CARRIES WHAT MAKES IT SEARCHABLE');
{
  const records = capture();
  log.info('something happened', { requestId: 'abc12345', route: '/api/crm/leads' });

  const r = records[0];
  check(r?.level === 'info', 'the level');
  check(typeof r?.time === 'string' && !Number.isNaN(Date.parse(r.time as string)),
    'an ISO timestamp', String(r?.time));
  check(r?.message === 'something happened', 'the message');
  check(r?.environment === 'test', 'the environment', String(r?.environment));
  check(r?.requestId === 'abc12345', 'the correlation id');
  check(r?.route === '/api/crm/leads', 'and arbitrary fields pass through');
}

{
  const records = capture();
  log.debug('d'); log.info('i'); log.warn('w'); log.error('e');
  check(records.length === 4, 'all four levels are available', `${records.length} written`);
  check(LOG_CONFIG.format === 'json', 'the format is configurable from the environment');
  check(LOG_CONFIG.level === 'debug', 'the threshold is configurable from the environment');
}

// ───────────────────────────────────────────────────────────────────────────
section('SECRETS NEVER REACH A LOG LINE');
{
  const records = capture();
  log.info('sign-in attempt', {
    password: 'hunter2',
    accessToken: 'eyJhbGciOi.reallysecret',
    refreshToken: 'rt_9f8a7b',
    cookie: 'sb-abc-auth-token=xyz',
    authorization: 'Bearer sk_live_1234',
    apiKey: 'ak_live_9999',
    clientSecret: 'shhh',
    email: 'someone@customer.example',
    // The identifier that should survive: pseudonymous, and the only way to
    // answer "which account" without logging who the person is.
    userId: '9f1c2d3e-0000-4444-8888-aaaabbbbcccc',
  });

  const line = flat(records[0]);
  for (const secret of [
    'hunter2', 'reallysecret', 'rt_9f8a7b', 'sb-abc-auth-token',
    'sk_live_1234', 'ak_live_9999', 'shhh', 'someone@customer.example',
  ]) {
    check(!line.includes(secret), `"${secret.slice(0, 18)}" is redacted`);
  }
  check(line.includes('9f1c2d3e-0000-4444-8888-aaaabbbbcccc'),
    'but the user id survives, so a line is still attributable');
}

{
  // Nesting is where redaction usually stops working, and a request body is
  // always nested.
  const records = capture();
  log.error('failed', {
    body: { user: { profile: { password: 'deep-secret', name: 'Ada' } } },
    headers: { Cookie: 'session=abc', 'X-Api-Key': 'nested-key' },
  });
  const line = flat(records[0]);
  check(!line.includes('deep-secret'), 'a secret three levels down is redacted');
  check(!line.includes('nested-key'), 'and one behind a differently-cased key');
  check(line.includes('Ada'), 'while ordinary nested values are kept');
}

// ───────────────────────────────────────────────────────────────────────────
section('AN EXCEPTION SURVIVES BEING LOGGED');
{
  // `JSON.stringify(new Error('boom'))` is `{}`. A logger that does not know
  // this throws away the only thing worth having.
  check(JSON.stringify(new Error('boom')) === '{}',
    'a raw Error really does serialise to nothing — the trap this avoids');

  const records = capture();
  log.error('handler failed', { err: serializeError(new Error('boom')) });
  const line = flat(records[0]);
  check(line.includes('boom'), 'the message survives');
  check(line.includes('stack'), 'the stack survives');
}

{
  // Supabase and PostgREST hang their diagnostics off the error object, and
  // they are the most useful part of a database failure.
  const pg = Object.assign(new Error('permission denied for table leads'), {
    code: '42501', details: 'row-level security', hint: 'check the policy',
  });
  const out = serializeError(pg);
  check(out.code === '42501', 'a PostgreSQL error code survives');
  check(out.details === 'row-level security', 'so do the details');
  check(out.hint === 'check the policy', 'and the hint');
}

{
  const out = serializeError('just a string');
  check(out.message === 'just a string', 'a thrown non-Error is still described');
  const nested = serializeError(Object.assign(new Error('outer'), { cause: new Error('inner') }));
  check(flat(nested).includes('inner'), 'a wrapped cause is not lost');
}

// ───────────────────────────────────────────────────────────────────────────
section('ONE FIELD CANNOT BECOME THE WHOLE LOG');
{
  const records = capture();
  log.info('big', { blob: 'x'.repeat(50_000), rows: Array.from({ length: 500 }, (_, i) => i) });
  const r = records[0] as { blob: string; rows: unknown };
  check(r.blob.length < 3_000, 'a runaway string is truncated', `${r.blob.length} chars`);
  check(typeof r.rows === 'string' && String(r.rows).includes('500'),
    'a large array is summarised rather than written out', String(r.rows));
}

{
  const records = capture();
  const cyclic: Record<string, unknown> = { name: 'loop' };
  cyclic.self = cyclic;
  let threw = false;
  try { log.info('cyclic', { cyclic }); } catch { threw = true; }
  check(!threw, 'a circular structure does not throw');
  check(records.length === 1, 'and is still written');
}

// ───────────────────────────────────────────────────────────────────────────
section('AN EXTERNAL PROVIDER ATTACHES WITHOUT TOUCHING A CALL SITE');
{
  const seen: unknown[] = [];
  setLogSink(r => { seen.push(r); });
  log.error('to the provider', { requestId: 'zzz11111' });
  check(seen.length === 1, 'records reach the sink');
  check(flat(seen[0]).includes('zzz11111'), 'with their fields intact');

  // Records arrive already redacted, so adding a provider cannot become the
  // thing that starts shipping customer data to a third party.
  seen.length = 0;
  log.error('secrets', { password: 'nope' });
  check(!flat(seen[0]).includes('nope'), 'and already redacted');
}

{
  // Observability failing must never be why a request fails.
  setLogSink(() => { throw new Error('provider is down'); });
  let threw = false;
  try { log.error('still fine'); } catch { threw = true; }
  check(!threw, 'a sink that throws does not propagate to the caller');
  resetLogSink();
}

// ───────────────────────────────────────────────────────────────────────────
section('THE CORRELATION ID CANNOT BE USED TO FORGE LOG ENTRIES');
{
  check(REQUEST_ID_HEADER === 'x-request-id',
    'the header is the conventional one, so proxies and aggregators know it');

  check(sanitizeRequestId('7f3c1b9e-0a2d-4c6f-8e1a-5b7d9f0c3a11') !== null,
    'a UUID from upstream is honoured — this is what makes a trace span hops');
  check(sanitizeRequestId('abc12345') !== null, 'as is any opaque token');

  check(sanitizeRequestId('good\nlevel=info message="all fine"') === null,
    'a newline is refused — this is the log-injection case');
  check(sanitizeRequestId('a'.repeat(5_000)) === null, 'a huge value is refused');
  check(sanitizeRequestId('short') === null, 'a too-short value is refused');
  check(sanitizeRequestId('has spaces here') === null, 'whitespace is refused');
  check(sanitizeRequestId('semi;colon') === null, 'punctuation is refused');
  check(sanitizeRequestId(null) === null, 'so is nothing at all');

  const fresh = resolveRequestId('bad value with spaces');
  check(/^[A-Za-z0-9_-]{8,64}$/.test(fresh),
    'a refused value is replaced rather than repaired', fresh);
  check(resolveRequestId('abc12345') === 'abc12345', 'a good value is kept');
  check(resolveRequestId(null) !== resolveRequestId(null), 'and a fresh one is unique');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
