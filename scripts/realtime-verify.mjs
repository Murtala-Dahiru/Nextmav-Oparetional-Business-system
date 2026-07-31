/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Does realtime actually deliver?
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *     npm run realtime:verify        (dev server must be on :3100)
 *
 * ── Why this needs its own harness ────────────────────────────────────────
 *
 * A realtime subscription that receives nothing is indistinguishable from one
 * watching a quiet table. Every failure mode is silent:
 *
 *   · the table is not in the `supabase_realtime` publication
 *   · it is published but has no `REPLICA IDENTITY FULL`, so an UPDATE arrives
 *     carrying only the primary key and a filter on any other column matches
 *     nothing
 *   · the socket connected as `anon`, so RLS discards every row before it is
 *     sent
 *   · the channel never subscribed at all, because a proxy blocked the upgrade
 *
 * None of those produce an error anywhere. The screen simply stops updating,
 * and `app:verify` cannot see it — that harness speaks HTTP, and this is a
 * websocket carrying replication events.
 *
 * So this connects as a real signed-in user with the anon key, exactly as the
 * browser does, subscribes to the same tables `hooks/use-realtime.ts`
 * subscribes to, performs a write through the application's own API, and waits
 * for the event. If the notification does not arrive within the timeout, the
 * feature does not work, whatever the code looks like.
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

  // ─────────────────────────────────────────────────────────────────────────
  section('2. A project write reaches a subscriber');

  const project = await A.json('/api/projects/projects', {
    method: 'POST', body: JSON.stringify({ name: `RT project ${run}`, status: 'active' }),
  });
  const projectId = project.body?.data?.id;
  check(!!projectId, 'a project to watch', project.body?.error?.message);

  /**
   * An UPDATE filtered on the primary key. This is the case that fails when a
   * table is published without `REPLICA IDENTITY FULL`.
   */
  const projectWatch = watch(sb, `rt-project-${run}`, [
    { table: 'projects', filter: `id=eq.${projectId}` },
  ]);
  // Wait for the subscription to be live, not for a guessed interval.
  await projectWatch.ready;

  await A.json(`/api/projects/projects/${projectId}`, {
    method: 'PUT', body: JSON.stringify({ priority: 'critical' }),
  });

  const projectResult = await projectWatch;
  check(projectResult.subscribed, 'the channel subscribes');
  check(projectResult.received,
    'editing a project notifies a subscriber filtered on its id',
    projectResult.subscribed ? 'subscribed but no event arrived within 12s' : 'never subscribed');

  // ─────────────────────────────────────────────────────────────────────────
  section('3. A task completed reaches a project subscriber');
  /**
   * The specification's own example: "task completed — project progress updates
   * immediately". The subscriber watches `tasks` filtered by project, which is
   * what `useProjectRealtime` does.
   */

  const task = await A.json('/api/projects/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: `RT task ${run}`, projectId, status: 'todo' }),
  });
  const taskId = task.body?.data?.id;
  check(!!taskId, 'a task to complete', task.body?.error?.message);

  const taskWatch = watch(sb, `rt-task-${run}`, [
    { table: 'tasks', filter: `project_id=eq.${projectId}` },
  ]);
  await taskWatch.ready;

  await A.json(`/api/projects/tasks/${taskId}`, {
    method: 'PUT', body: JSON.stringify({ status: 'done' }),
  });

  const taskResult = await taskWatch;
  check(taskResult.received,
    'completing a task notifies the project subscriber',
    taskResult.subscribed ? 'subscribed but no event arrived' : 'never subscribed');

  /**
   * And the number the screen would refetch has actually moved. The event is
   * only useful if the derived figure behind it changed — this is the half of
   * "progress updates immediately" that lives in the database.
   */
  const board = await A.json('/api/projects/projects?pageSize=100');
  const row = (board.body?.data ?? []).find(p => p.id === projectId);
  check(Number(row?.progressPct) === 100,
    `and the progress the subscriber refetches has moved (${row?.progressPct}%)`);

  // ─────────────────────────────────────────────────────────────────────────
  section('4. A milestone completed reaches a subscriber');

  const milestone = await A.json('/api/projects/milestones', {
    method: 'POST',
    body: JSON.stringify({ projectId, name: `RT phase ${run}`, dueDate: '2030-01-01' }),
  });
  const milestoneId = milestone.body?.data?.id;
  check(!!milestoneId, 'a milestone to complete', milestone.body?.error?.message);

  const msWatch = watch(sb, `rt-ms-${run}`, [
    { table: 'milestones', filter: `project_id=eq.${projectId}` },
  ]);
  await msWatch.ready;

  await A.json(`/api/projects/milestones/${milestoneId}`, {
    method: 'PATCH', body: JSON.stringify({ completed: true }),
  });

  const msResult = await msWatch;
  check(msResult.received,
    'completing a milestone notifies the project subscriber',
    msResult.subscribed ? 'subscribed but no event arrived' : 'never subscribed');

  // ─────────────────────────────────────────────────────────────────────────
  section('5. A notification reaches its recipient');
  /**
   * "Notification received — appears instantly." Watched as an INSERT, exactly
   * as the header does, and provoked by a real business write rather than by
   * inserting a notification row: the point is that the fan-out triggers reach a
   * connected client.
   *
   * ── Why this needs a second person ────────────────────────────────────────
   *
   * The first version of this check had the owner raise an invoice and waited
   * for their own socket to hear about it. It failed, correctly:
   * `notify_members` skips the actor, by design and stated in 0016 — "never
   * notify the actor about their own action". Nobody is told about something
   * they just did.
   *
   * So the notification has to be provoked *at* somebody else. A owns the
   * project and assigns a task to B; B's socket is the one that must hear it.
   * That is also the honest shape of the feature — a notification is a message
   * between two people, and a test where both are the same person was never
   * testing delivery.
   */

  const mateEmail = `realtime-mate-${run}@example.com`;
  const mate = await A.json('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email: mateEmail, firstName: 'Realtime', lastName: 'Mate', role: 'employee',
    }),
  });
  check(mate.status === 201, `a colleague to notify (${mate.status})`, mate.body?.error?.message);
  mateUser = { id: mate.body?.data?.member?.userId };
  const mateMemberId = mate.body?.data?.member?.id ?? mate.body?.data?.member?.memberId;
  const matePassword = mate.body?.data?.temporaryPassword;

  /**
   * B subscribes with their own session.
   *
   * A provisioned account still holds the password an administrator issued, so
   * `authorize()` refuses it every module — but realtime does not go through
   * `authorize()`, it goes through RLS, and `notifications_select` admits a row
   * whose `recipient_id` is your own membership. Which is the right boundary:
   * being told about your work does not require having changed your password.
   */
  const sbMate = createClient(SUPABASE, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: mateSession } = await sbMate.auth.signInWithPassword({
    email: mateEmail, password: matePassword,
  });
  check(!!mateSession?.session?.access_token, 'the colleague can hold a session');
  sbMate.realtime.setAuth(mateSession.session.access_token);

  const notifyWatch = watch(sbMate, `rt-notif-${run}`, [
    { table: 'notifications', event: 'INSERT' },
  ]);
  await notifyWatch.ready;

  // Assigning a task notifies the assignee — `notify_task_assignment` in 0016.
  const assigned = await A.json('/api/projects/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: `RT assignment ${run}`, projectId, assigneeId: mateMemberId,
    }),
  });
  check(assigned.status === 201, `a task assigned to them (${assigned.status})`,
    assigned.body?.error?.message);

  const notifyResult = await notifyWatch;
  check(notifyResult.received,
    'being assigned a task delivers a notification over the socket',
    notifyResult.subscribed ? 'subscribed but no event arrived' : 'never subscribed');

  await sbMate.auth.signOut();
  await sbMate.removeAllChannels();

  // ─────────────────────────────────────────────────────────────────────────
  section('6. A message reaches the channel it was posted in');

  const channels = await A.json('/api/communication/channels');
  const channelId = (channels.body?.data ?? [])[0]?.channelId;
  check(!!channelId, 'a channel to post in');

  if (channelId) {
    const msgWatch = watch(sb, `rt-msg-${run}`, [
      { table: 'messages', filter: `channel_id=eq.${channelId}` },
    ]);
    await msgWatch.ready;

    await A.json('/api/communication/messages', {
      method: 'POST', body: JSON.stringify({ channelId, body: `realtime probe ${run}` }),
    });

    const msgResult = await msgWatch;
    check(msgResult.received,
      'a message posted notifies a subscriber on that channel',
      msgResult.subscribed ? 'subscribed but no event arrived' : 'never subscribed');
  }

  // ─────────────────────────────────────────────────────────────────────────
  section('7. A deliverable decision reaches the delivery team');
  /**
   * The client's half of the loop. Approving a deliverable is a write a *client*
   * makes, and the team's screens have to hear about it — otherwise a project
   * sits waiting on a decision that has already been made.
   */

  const upload = await A.json('/api/projects/files', {
    method: 'POST',
    body: JSON.stringify({
      projectId, bucket: 'documents',
      path: `${org.body.data.id}/projects/${projectId}/${run}-spec.pdf`,
      filename: 'spec.pdf', sizeBytes: 1024, isClientVisible: true,
    }),
  });
  const fileId = upload.body?.data?.id;
  check(!!fileId, 'a shared file', upload.body?.error?.message);

  const promoted = await A.json(`/api/projects/files/${fileId}`, {
    method: 'PATCH', body: JSON.stringify({ requiresApproval: true }),
  });
  check(promoted.body?.data?.requiresApproval === true,
    `it can be put forward as a deliverable (${promoted.status})`,
    promoted.body?.error?.message);

  const fileWatch = watch(sb, `rt-file-${run}`, [
    { table: 'files', filter: `project_id=eq.${projectId}` },
  ]);
  await fileWatch.ready;

  const decided = await A.json(`/api/portal/deliverables/${fileId}`, {
    method: 'PATCH', body: JSON.stringify({ decision: 'approved' }),
  });
  check(decided.body?.data?.approvalDecision === 'approved',
    `a decision is recorded (${decided.status})`, decided.body?.error?.message);

  const fileResult = await fileWatch;
  check(fileResult.received,
    'approving a deliverable notifies the project subscriber',
    fileResult.subscribed ? 'subscribed but no event arrived' : 'never subscribed');

  await sb.auth.signOut();
  await sb.removeAllChannels();

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
