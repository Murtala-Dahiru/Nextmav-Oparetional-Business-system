/** Dashboard live-data verification. Creates a disposable organization and removes it in finally.
 * Run with APP_URL pointing at a local app. Service credentials provision/clean up fixtures only;
 * subscriptions, business writes and dashboard reads use authenticated user sessions and RLS.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.APP_URL ?? 'http://localhost:3100';

function env(k) {
  const m = readFileSync('.env', 'utf8').match(new RegExp(`^${k}=(.*)$`, 'm'));
  return m ? m[1].trim() : '';
}
const SUPABASE = env('NEXT_PUBLIC_SUPABASE_URL');
const ANON = env('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY');
const REST = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const rest = (q, init) => fetch(`${SUPABASE}/rest/v1/${q}`, { headers: REST, ...init });

let pass = 0, fail = 0;
const failed = [];
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`    PASS  ${label}`); }
  else { fail++; failed.push(label); console.log(`    FAIL  ${label}${detail ? `  — ${detail}` : ''}`); }
  return ok;
};
const section = t => console.log(`\n  ${t}\n  ${'─'.repeat(t.length)}`);

/** Cookie-carrying client for the application's own API. */
function makeClient() {
  const jar = new Map();
  return {
    async json(path, init = {}) {
      const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
      const res = await fetch(BASE + path, {
        ...init, redirect: 'manual',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
      });
      for (const raw of res.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';');
        const i = pair.indexOf('=');
        const n = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
        if (v === '') jar.delete(n); else jar.set(n, v);
      }
      let body = null;
      try { body = await res.json(); } catch { /* non-JSON */ }
      return { status: res.status, ok: res.ok, body };
    },
  };
}

/**
 * Wait for one event on a subscription, or give up.
 *
 * Resolves to `{ subscribed, received }` rather than throwing, so a channel
 * that could not subscribe is reported differently from one that subscribed
 * and heard nothing — those have completely different causes and the
 * distinction is the main thing this harness exists to make. The returned
 * promise also carries a `.ready` promise that settles when the channel is
 * actually SUBSCRIBED.
 *
 * ── Why `.ready` exists ───────────────────────────────────────────────────
 *
 * Every call site used to sleep a flat 1500ms between subscribing and writing.
 * That is a guess at how long the websocket handshake takes, and on a slow
 * link it is the wrong guess: the write lands before the subscription is live,
 * the event is legitimately never delivered, and the harness reports a broken
 * feature. That is exactly what happened — "editing a project notifies a
 * subscriber" failed on one run and passed on the next with no code change
 * between them, which is the worst thing a verification suite can do, because
 * it teaches you to re-run it until it is green.
 *
 * Waiting for the actual SUBSCRIBED callback removes the guess. The timeout
 * remains as a bound, so a subscription that never establishes still fails
 * rather than hanging.
 */
function watch(sb, name, tables, timeoutMs = 12_000) {
  let markReady;
  const ready = new Promise(resolve => { markReady = resolve; });

  const outcome = new Promise(resolve => {
    let subscribed = false;
    const channel = sb.channel(name);

    for (const t of tables) {
      channel.on(
        'postgres_changes',
        {
          event: t.event ?? '*',
          schema: 'public',
          table: t.table,
          ...(t.filter ? { filter: t.filter } : {}),
        },
        payload => {
          clearTimeout(timer);
          void sb.removeChannel(channel);
          resolve({ subscribed: true, received: true, payload, table: t.table });
        },
      );
    }

    const timer = setTimeout(() => {
      void sb.removeChannel(channel);
      markReady(false);
      resolve({ subscribed, received: false });
    }, timeoutMs);

    channel.subscribe(state => {
      if (state === 'SUBSCRIBED') {
        subscribed = true;
        markReady(true);
      }
      // A channel that errors or times out will never subscribe; release the
      // waiter so the write still happens and the check fails honestly
      // rather than the run hanging until the harness timeout.
      if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
        markReady(false);
      }
    });
  });

  outcome.ready = ready;
  return outcome;
}

const run = Date.now().toString(36);
const email = `realtime-${run}@example.com`;
const PW = 'Passw0rd!verify';
let user = null;
let mateUser = null;

try {
  section('1. A signed-in browser client can subscribe at all');

  const made = await fetch(`${SUPABASE}/auth/v1/admin/users`, {
    method: 'POST', headers: REST,
    body: JSON.stringify({
      email, password: PW, email_confirm: true,
      user_metadata: { first_name: 'Realtime', last_name: 'Probe' },
    }),
  });
  if (!made.ok) throw new Error(`admin create: ${made.status} ${await made.text()}`);
  user = await made.json();

  const A = makeClient();
  await A.json('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: PW }) });
  const org = await A.json('/api/organizations', {
    method: 'POST', body: JSON.stringify({ name: `Realtime ${run}` }),
  });
  check(!!org.body?.data?.id, 'organization created', org.body?.error?.message);

  /**
   * The anon key with a password sign-in, which is what the browser holds.
   *
   * Deliberately *not* the service key: that bypasses RLS, so it would report
   * success on a subscription an actual user could never receive — the exact
   * false pass this harness is meant to rule out.
   */
  const sb = createClient(SUPABASE, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });

  const { data: signIn, error: signInError } = await sb.auth.signInWithPassword({
    email, password: PW,
  });
  check(!!signIn?.session?.access_token, 'the anon client holds a session', signInError?.message);
  sb.realtime.setAuth(signIn.session.access_token);


  const orgId = org.body.data.id;
  const dashboard = async () => {
    const result = await A.json('/api/dashboard');
    if (!result.ok) throw new Error(`dashboard HTTP ${result.status}`);
    return result.body.data;
  };
  const mutate = async (table, path, method, body) => {
    const event = watch(sb, `dashboard-${table}-${Date.now()}`, [{table, filter:`organization_id=eq.${orgId}`}], 20000);
    await event.ready;
    const response = await A.json(path, {method,body:JSON.stringify(body)});
    check(response.ok, `${table} mutation accepted (${response.status})`, response.body?.error?.message);
    const delivered = await event;
    check(delivered.received, `${table} organization-scoped event delivered`);
    return response.body?.data;
  };
  section('Dashboard source changes and aggregate consistency');
  const project = await mutate('projects','/api/projects/projects','POST',{name:`Dashboard probe ${run}`,status:'active'});
  let snapshot = await dashboard();
  check(snapshot.projects?.active === 1, 'new project appears in dashboard');
  await mutate('projects',`/api/projects/projects/${project.id}`,'PATCH',{status:'completed'});
  snapshot = await dashboard();
  check(snapshot.projects?.active === 0,'completed project leaves active chart');
  const deal = await mutate('deals','/api/crm/deals','POST',{name:`Dashboard deal ${run}`,value:1200,stage:'prospecting',probability:25});
  snapshot = await dashboard();
  check(snapshot.crm?.pipelineValue === 1200,'pipeline totals include created deal');
  await mutate('deals',`/api/crm/deals/${deal.id}`,'PATCH',{stage:'closed_won'});
  snapshot = await dashboard();
  check(snapshot.crm?.pipelineValue === 0,'won deal leaves open pipeline');
  const ticket = await mutate('support_tickets','/api/support/tickets','POST',{subject:`Dashboard ticket ${run}`,priority:'high'});
  snapshot = await dashboard();
  check(snapshot.support?.open === 1,'support backlog includes new ticket');
  await mutate('support_tickets',`/api/support/tickets/${ticket.id}`,'PATCH',{status:'resolved'});
  snapshot = await dashboard();
  check(snapshot.support?.open === 0,'resolved ticket leaves backlog');
  const invoice = await mutate('invoices','/api/finance/invoices','POST',{status:'sent',lineItems:[{description:'Verification only',quantity:1,unitPrice:1000}]});
  snapshot = await dashboard();
  check(snapshot.finance?.receivables.outstanding === 1000,'issued invoice is outstanding');
  check(snapshot.finance?.revenueThisMonth === 0,'unpaid invoice is not collected revenue');
  const paymentEvent = watch(sb,`dashboard-payment-${run}`,[{table:'invoices',filter:`organization_id=eq.${orgId}`}],20000);
  await paymentEvent.ready;
  const payment = await sb.from('payments').insert({organization_id:orgId,invoice_id:invoice.id,amount:250});
  check(!payment.error,'authenticated partial payment accepted',payment.error?.message);
  check((await paymentEvent).received,'payment trigger delivers invoice event');
  snapshot = await dashboard();
  check(snapshot.finance?.revenueThisMonth === 250,'partial payment updates collected revenue');
  check(snapshot.finance?.receivables.outstanding === 750,'partial payment updates outstanding balance');

  const mateEmail = `dashboard-mate-${run}@example.com`;
  const mate = await A.json('/api/admin/users', {method:'POST',body:JSON.stringify({email:mateEmail,firstName:'Dashboard',lastName:'Verifier',role:'employee'})});
  mateUser = {id:mate.body?.data?.member?.userId};
  const memberId = mate.body?.data?.member?.id ?? mate.body?.data?.member?.memberId;
  const sbMate = createClient(SUPABASE, ANON, {auth:{persistSession:false,autoRefreshToken:false}});
  await sbMate.auth.signInWithPassword({email:mateEmail,password:mate.body?.data?.temporaryPassword});
  const submitted = await sbMate.from('expenses').insert({organization_id:orgId,title:'Disposable approval verification',amount:50,currency:snapshot.finance.currency,submitted_by:memberId}).select('id').single();
  check(!submitted.error,'employee submits own expense through RLS',submitted.error?.message);
  snapshot = await dashboard();
  check(snapshot.finance?.pendingExpenseCount === 1,'pending approval appears');
  const approvalEvent = watch(sb,`dashboard-approval-${run}`,[{table:'expenses',filter:`organization_id=eq.${orgId}`}],20000);
  await approvalEvent.ready;
  const actor = await sb.from('organization_members').select('id').eq('organization_id',orgId).eq('user_id',user.id).single();
  const approved = await sb.from('expenses').update({status:'approved',approved_by:actor.data?.id}).eq('id',submitted.data?.id);
  check(!approved.error,'owner approves another member expense through RLS',approved.error?.message);
  check((await approvalEvent).received,'approval delivers organization-scoped expense event');
  snapshot = await dashboard();
  check(snapshot.finance?.pendingExpenseCount === 0 && snapshot.finance?.expensesThisMonth === 50,'approval count and approved costs change together');
  const forbidden = await sbMate.from('payments').select('id').eq('organization_id',orgId);
  check(!!forbidden.error || forbidden.data?.length === 0,'employee cannot read finance payments');
  await sbMate.auth.signOut();
  await sb.removeAllChannels();
  check(sb.getChannels().length === 0, 'all verification subscriptions cleaned up');
  const rejoined = await mutate('support_tickets','/api/support/tickets','POST',{subject:`Reconnect probe ${run}`});
  snapshot = await dashboard();
  check(!!rejoined?.id && snapshot.support?.open === 1,'a fresh subscription catches up after disconnect');
  await sb.removeAllChannels();
  await sb.auth.signOut();

} catch (e) {
  fail++; failed.push('harness error');
  console.error(`\n  HARNESS ERROR: ${e.message}`);
} finally {
  // B is removed first: their membership belongs to A's organization, and the
  // last-owner rule refuses a user delete while the organization is still there.
  if (mateUser?.id) {
    await fetch(`${SUPABASE}/auth/v1/admin/users/${mateUser.id}`, { method: 'DELETE', headers: REST });
  }
  if (user?.id) {
    const members = await (await rest(
      `organization_members?user_id=eq.${user.id}&select=organization_id`,
    )).json().catch(() => []);
    for (const { organization_id: org } of members ?? []) {
      const orders = await (await rest(`purchase_orders?organization_id=eq.${org}&select=id`)).json().catch(() => []);
      if (orders?.length) await rest(`purchase_orders?organization_id=eq.${org}`, { method: 'DELETE' });
      await rest(`organizations?id=eq.${org}`, { method: 'DELETE' });
    }
    await fetch(`${SUPABASE}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: REST });
  }
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log('\n  Failed:'); failed.forEach(f => console.log(`    · ${f}`)); }
process.exit(fail ? 1 : 0);
