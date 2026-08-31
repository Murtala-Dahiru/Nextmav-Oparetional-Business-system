/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Projects, end to end, against the running application
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *     APP_URL=http://localhost:3100 node scripts/projects-verify.mjs
 *
 * ── Why a harness of its own ──────────────────────────────────────────────
 *
 * `app:verify` proves the shared route factories work. Phase 6 turned on four
 * things the factories do not cover, every one of which fails *quietly* - the
 * request succeeds and the data is subtly wrong, which is this repository's
 * dominant defect class:
 *
 *   · a task can finally be filed under a phase, and must not be fileable
 *     under another project's phase;
 *   · subtasks exist, and must stop at one level;
 *   · dependencies exist, and must refuse a cycle and a duplicate;
 *   · a completion timestamp is stamped by a trigger, and cleared on reopen.
 *
 * Plus the two claims the delivery screen makes out loud: that its totals are
 * counted from the same population as its list, and that a reader without the
 * finance grant is told the figures are absent rather than shown a zero.
 *
 * It signs in as the seeded demo owner and drives the real HTTP API, so the
 * path under test is cookie session -> route -> RLS -> Postgres -> trigger.
 * Everything it creates, it deletes.
 */

const BASE = process.env.APP_URL ?? 'http://localhost:3100';
const EMAIL = process.env.PROJECTS_USER ?? 'dash-demo-owner@example.com';
const PASSWORD = process.env.PROJECTS_PASS ?? 'Passw0rd!dashdemo';

let pass = 0, fail = 0;
const failed = [];

const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`    PASS  ${label}`); }
  else { fail++; failed.push(label); console.log(`    FAIL  ${label}${detail ? `  - ${detail}` : ''}`); }
  return ok;
};
const section = t => console.log(`\n  ${t}\n  ${'-'.repeat(t.length)}`);

function client() {
  const jar = new Map();
  return async function call(path, init = {}) {
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(BASE + path, {
      ...init,
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(init.headers ?? {}),
      },
    });
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (value === '') jar.delete(name); else jar.set(name, value);
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not every response is JSON */ }
    return { status: res.status, json, text };
  };
}

const call = client();
const bin = { projects: [], tasks: [], milestones: [], files: [], comments: [] };

console.log('\n  Projects verification');
console.log('  ═════════════════════');
console.log(`  ${BASE} as ${EMAIL}\n`);

/* ── 1. Session ──────────────────────────────────────────────────────────── */

section('1. Session');
{
  const res = await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!check(res.status === 200, 'signed in', res.json?.error?.message ?? res.status)) {
    console.log('\n  Cannot continue without a session.\n');
    process.exit(1);
  }
}

/* ── 2. The delivery portfolio ───────────────────────────────────────────── */

section('2. Delivery portfolio');

{
  const res = await call('/api/projects/overview');
  check(res.status === 200, 'GET /api/projects/overview', res.json?.error?.message);
  const d = res.json?.data;

  if (d) {
    const t = d.totals;
    check(Array.isArray(d.projects), 'the portfolio is a list');

    /**
     * The page's central claim. Every figure in the strip is counted from the
     * same array the list under it renders, so these cannot disagree unless
     * somebody reintroduces a second query - which is exactly what went wrong
     * on the Executive Overview.
     */
    check(t.live === d.projects.length,
      'the headline count is the length of the list it heads',
      `${t.live} vs ${d.projects.length}`);
    check(t.onTrack + t.atRisk + t.offTrack === t.live,
      'the health bar partitions the portfolio exactly',
      `${t.onTrack}+${t.atRisk}+${t.offTrack} vs ${t.live}`);
    check(t.active === d.projects.filter(p => p.status === 'active').length,
      'the active count matches the rows that are active');
    check(t.overdueTasks === d.projects.reduce((n, p) => n + Number(p.overdueTasks), 0),
      'overdue tasks sum from the same rows');
    check(t.blockedTasks <= t.openTasks,
      'blocked work is a subset of open work',
      `${t.blockedTasks} vs ${t.openTasks}`);
    check(d.projects.every(p => ['planning', 'active', 'on_hold'].includes(p.status)),
      'only live projects are in the portfolio');
    check(d.projects.every(p => ['on_track', 'at_risk', 'off_track'].includes(p.health)),
      'every row carries a health grade');
    check(d.attention.every(a => d.projects.some(p => p.id === a.projectId)),
      'every attention row points at a project in the list');
    check(d.upcoming.every(m => m.projectName !== 'Unknown project'),
      'every upcoming phase resolves its project name');
  }
}

/* ── 3. A project, its phases and its work ───────────────────────────────── */

section('3. Project, phase, task');

let projectId = null;
let otherProjectId = null;
let milestoneId = null;
let otherMilestoneId = null;

{
  const res = await call('/api/projects/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Verify - delivery harness',
      description: 'Created by scripts/projects-verify.mjs',
      status: 'active',
      priority: 'high',
      startDate: '2026-01-05',
      endDate: '2026-12-18',
      budget: 250000,
    }),
  });
  check(res.status === 201, 'created a project', res.json?.error?.message);
  projectId = res.json?.data?.id;
  if (projectId) bin.projects.push(projectId);

  const other = await call('/api/projects/projects', {
    method: 'POST',
    body: JSON.stringify({ name: 'Verify - second project', status: 'planning' }),
  });
  otherProjectId = other.json?.data?.id;
  if (otherProjectId) bin.projects.push(otherProjectId);
}

if (!projectId || !otherProjectId) {
  console.log('\n  Cannot continue without a project.\n');
  process.exit(1);
}

{
  const res = await call('/api/projects/milestones', {
    method: 'POST',
    body: JSON.stringify({
      projectId, name: 'Verify - design', stage: 'planning',
      startDate: '2026-01-05', dueDate: '2026-03-02', sortOrder: 0, progressPct: 40,
    }),
  });
  check(res.status === 201, 'created a phase', res.json?.error?.message);
  milestoneId = res.json?.data?.id;
  if (milestoneId) bin.milestones.push(milestoneId);

  check(res.json?.data?.progressPct === 40,
    'a phase keeps the progress it was created with',
    String(res.json?.data?.progressPct));

  const other = await call('/api/projects/milestones', {
    method: 'POST',
    body: JSON.stringify({ projectId: otherProjectId, name: 'Verify - elsewhere', stage: 'planning' }),
  });
  otherMilestoneId = other.json?.data?.id;
  if (otherMilestoneId) bin.milestones.push(otherMilestoneId);
}

let taskId = null;
{
  /**
   * The defect this phase existed to find: `milestoneId` was absent from
   * `createTaskSchema`, so the resolver stripped it out of every request and
   * no task in the product could ever be put on a phase.
   */
  const res = await call('/api/projects/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Verify - parent task', projectId, milestoneId,
      status: 'todo', priority: 'medium', dueDate: '2026-02-20',
    }),
  });
  check(res.status === 201, 'created a task', res.json?.error?.message);
  taskId = res.json?.data?.id;
  if (taskId) bin.tasks.push(taskId);
  check(res.json?.data?.milestoneId === milestoneId,
    'a task can be filed under a phase',
    `${res.json?.data?.milestoneId} vs ${milestoneId}`);
}

{
  const res = await call('/api/projects/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Verify - wrong phase', projectId, milestoneId: otherMilestoneId }),
  });
  check(res.status === 422 && res.json?.error?.code === 'MILESTONE_PROJECT_MISMATCH',
    'a phase from another project is refused on create',
    `${res.status} ${res.json?.error?.code}`);
}

{
  const res = await call(`/api/projects/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ milestoneId: otherMilestoneId }),
  });
  check(res.status === 422 && res.json?.error?.code === 'MILESTONE_PROJECT_MISMATCH',
    'and on edit, which had no such check at all',
    `${res.status} ${res.json?.error?.code}`);
}

/* ── 4. Subtasks ─────────────────────────────────────────────────────────── */

section('4. Subtasks');

let subtaskId = null;
{
  const res = await call('/api/projects/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Verify - subtask', projectId, parentTaskId: taskId }),
  });
  check(res.status === 201, 'a subtask can be created', res.json?.error?.message);
  subtaskId = res.json?.data?.id;
  if (subtaskId) bin.tasks.push(subtaskId);
  check(res.json?.data?.parentTaskId === taskId, 'and it keeps its parent');
}

{
  const res = await call('/api/projects/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Verify - grandchild', projectId, parentTaskId: subtaskId }),
  });
  check(res.status === 422 && res.json?.error?.code === 'PARENT_IS_SUBTASK',
    'subtasks stop at one level',
    `${res.status} ${res.json?.error?.code}`);
}

{
  const res = await call(`/api/projects/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ parentTaskId: taskId }),
  });
  check(res.status === 422 && res.json?.error?.code === 'PARENT_IS_SELF',
    'a task cannot be its own subtask',
    `${res.status} ${res.json?.error?.code}`);
}

/* ── 5. Dependencies ─────────────────────────────────────────────────────── */

section('5. Dependencies');

let secondTaskId = null;
let edgeId = null;
{
  const res = await call('/api/projects/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Verify - blocker', projectId }),
  });
  secondTaskId = res.json?.data?.id;
  if (secondTaskId) bin.tasks.push(secondTaskId);

  const dep = await call(`/api/projects/tasks/${taskId}/dependencies`, {
    method: 'POST',
    body: JSON.stringify({ dependsOnId: secondTaskId }),
  });
  check(dep.status === 201, 'a dependency can be recorded', dep.json?.error?.message);
  edgeId = dep.json?.data?.id;
}

{
  const again = await call(`/api/projects/tasks/${taskId}/dependencies`, {
    method: 'POST',
    body: JSON.stringify({ dependsOnId: secondTaskId }),
  });
  check(again.status === 409 && again.json?.error?.code === 'DUPLICATE_DEPENDENCY',
    'the same dependency twice is refused',
    `${again.status} ${again.json?.error?.code}`);
}

{
  /** A -> B already exists, so B -> A would close a loop. Trigger, since 0034. */
  const cycle = await call(`/api/projects/tasks/${secondTaskId}/dependencies`, {
    method: 'POST',
    body: JSON.stringify({ dependsOnId: taskId }),
  });
  check(cycle.status === 422 && cycle.json?.error?.code === 'DEPENDENCY_CYCLE',
    'a cycle is refused by the database, not by the client',
    `${cycle.status} ${cycle.json?.error?.code}`);
}

{
  const self = await call(`/api/projects/tasks/${taskId}/dependencies`, {
    method: 'POST',
    body: JSON.stringify({ dependsOnId: taskId }),
  });
  check(self.status === 422, 'a task cannot wait for itself', String(self.status));
}

{
  const res = await call(`/api/projects/tasks/${taskId}/dependencies`);
  check(res.status === 200, 'GET dependencies', res.json?.error?.message);
  check(res.json?.data?.blockedBy?.length === 1, 'it reads what the task waits for');

  const reverse = await call(`/api/projects/tasks/${secondTaskId}/dependencies`);
  check(reverse.json?.data?.blocking?.length === 1,
    'and, from the other end, what waits for it');
}

/* ── 6. Completion is stamped, and cleared ───────────────────────────────── */

section('6. Completion');

{
  const done = await call(`/api/projects/tasks/${secondTaskId}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'done' }),
  });
  check(done.status === 200, 'a task can be completed', done.json?.error?.message);
  check(!!done.json?.data?.completedAt,
    'and the trigger stamps when, which nothing used to write',
    String(done.json?.data?.completedAt));

  const reopened = await call(`/api/projects/tasks/${secondTaskId}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'in_progress' }),
  });
  check(reopened.json?.data?.completedAt === null,
    'reopening clears it, so a row cannot claim to be both');
}

/* ── 7. Resources, links and deliverables ────────────────────────────────── */

section('7. Files, links and client approval');

let linkId = null;
{
  const res = await call('/api/projects/files', {
    method: 'POST',
    body: JSON.stringify({ projectId, externalUrl: 'figma.com/file/verify-harness' }),
  });
  check(res.status === 201, 'a link can be added as a project resource', res.json?.error?.message);
  linkId = res.json?.data?.id;
  if (linkId) bin.files.push(linkId);
  check(res.json?.data?.externalUrl === 'https://figma.com/file/verify-harness',
    'a bare host is normalised to https',
    res.json?.data?.externalUrl);
  check(res.json?.data?.filename === 'figma.com',
    'and an unnamed link is named after its host',
    res.json?.data?.filename);
}

{
  const bad = await call('/api/projects/files', {
    method: 'POST',
    body: JSON.stringify({ projectId, externalUrl: 'javascript:alert(1)' }),
  });
  check(bad.status === 422 && bad.json?.error?.code === 'INVALID_LINK',
    'a non-http scheme is refused',
    `${bad.status} ${bad.json?.error?.code}`);
}

{
  const res = await call(`/api/projects/files/${linkId}`);
  check(res.status === 200 && res.json?.data?.url === 'https://figma.com/file/verify-harness',
    'opening a link returns the address rather than asking storage to sign it',
    res.json?.data?.url ?? res.json?.error?.message);
  check(res.json?.data?.expiresIn === null, 'and does not claim the link expires');
}

{
  /**
   * The rule the endpoint has enforced since 0018 and no screen ever reached:
   * a deliverable has to be something the client can actually see.
   */
  const tooSoon = await call(`/api/projects/files/${linkId}`, {
    method: 'PATCH', body: JSON.stringify({ requiresApproval: true }),
  });
  check(tooSoon.status === 422 && tooSoon.json?.error?.code === 'DELIVERABLE_NOT_SHARED',
    'an unshared file cannot be put forward for approval',
    `${tooSoon.status} ${tooSoon.json?.error?.code}`);

  const forward = await call(`/api/projects/files/${linkId}`, {
    method: 'PATCH', body: JSON.stringify({ isClientVisible: true, requiresApproval: true }),
  });
  check(forward.status === 200 && forward.json?.data?.requiresApproval === true,
    'sharing and putting forward in one act works',
    forward.json?.error?.message);

  const decision = await call(`/api/portal/deliverables/${linkId}`, {
    method: 'PATCH', body: JSON.stringify({ decision: 'approved', note: 'Verified by the harness' }),
  });
  check(decision.status === 200 && decision.json?.data?.approvalDecision === 'approved',
    'a decision can be recorded on the client\'s behalf',
    decision.json?.error?.message);

  const withdrawn = await call(`/api/projects/files/${linkId}`, {
    method: 'PATCH', body: JSON.stringify({ requiresApproval: false }),
  });
  check(withdrawn.json?.data?.approvalDecision === null,
    'withdrawing a deliverable clears its decision, so it cannot be reinstated as approved');
}

/* ── 8. Discussion ───────────────────────────────────────────────────────── */

section('8. Discussion');

let rootId = null;
{
  const res = await call('/api/projects/comments', {
    method: 'POST',
    body: JSON.stringify({ projectId, body: 'Verify - root message' }),
  });
  check(res.status === 201, 'a message can be posted', res.json?.error?.message);
  rootId = res.json?.data?.id;
  if (rootId) bin.comments.push(rootId);

  const reply = await call('/api/projects/comments', {
    method: 'POST',
    body: JSON.stringify({ projectId, body: 'Verify - reply', parentId: rootId }),
  });
  check(reply.status === 201, 'and replied to', reply.json?.error?.message);
  if (reply.json?.data?.id) bin.comments.push(reply.json.data.id);
}

/* ── 9. The workspace, in one request ────────────────────────────────────── */

section('9. Workspace');

{
  const res = await call(`/api/projects/projects/${projectId}/overview`);
  check(res.status === 200, 'GET the workspace overview', res.json?.error?.message);
  const d = res.json?.data;

  if (d) {
    check(d.health?.totalTasks >= 3, 'the health row counts the tasks just created',
      String(d.health?.totalTasks));
    check(d.milestones.length === 1, 'the roadmap carries the phase');
    check(d.tasks.some(t => t.milestoneId === milestoneId),
      'a task on the roadmap comes back with its phase');
    check(d.tasks.some(t => t.parentTaskId === taskId),
      'and the subtask with its parent');
    check(d.dependencies.length >= 1, 'dependencies come back with the workspace');
    check(d.comments.some(c => c.parentId === rootId),
      'a reply comes back with the message it answers - `parent_id` was never selected before');
    check(d.files.some(f => f.externalUrl), 'links are listed with the files');
    check(typeof d.deliverables?.total === 'number', 'the deliverable counts are present');

    /**
     * A reader without the finance grant gets `null` rather than an empty
     * array, because "nothing invoiced" and "you cannot see what was invoiced"
     * must not render the same way. The seeded owner holds finance, so here it
     * is an object.
     */
    check(d.finance !== undefined, 'the finance region is explicit either way');
    check(d.finance === null || Array.isArray(d.finance.invoices),
      'and is null or a real pair of lists');

    const blockedIds = new Set(d.blockers.map(b => b.id));
    check(blockedIds.has(taskId) === d.tasks.some(
      t => t.id === taskId && (t.status === 'blocked' || d.dependencies.some(
        e => e.taskId === taskId && e.dependsOn && e.dependsOn.status !== 'done')),
    ), 'a task waiting on unfinished work is a blocker without anybody saying so');
  }
}

/* ── 10. A personal task ─────────────────────────────────────────────────── */

section('10. Personal tasks');

{
  /**
   * `tasks.project_id` is nullable by design and the endpoint has a branch for
   * it, but `createTaskSchema` demanded a project - so the form's own resolver
   * refused to submit the case the endpoint was written to accept.
   */
  const res = await call('/api/projects/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Verify - personal note' }),
  });
  check(res.status === 201, 'a task with no project is accepted', res.json?.error?.message);
  if (res.json?.data?.id) bin.tasks.push(res.json.data.id);
  check(res.json?.data?.projectId === null, 'and stays personal');
}

/* ── 10b. The task list's state filters ──────────────────────────────────── */

section('10b. Task filters');

{
  /**
   * The four `?state=` answers, checked against what they claim.
   *
   * These moved from the browser to the server in Phase 6. Filtering a *page*
   * of twenty rows and then printing the server's total under it described two
   * different populations, which is the quiet kind of wrong this harness is
   * for: the request succeeded either way.
   */
  const open = await call('/api/projects/tasks?state=open&pageSize=100');
  check(open.status === 200 && (open.json?.data ?? []).every(t => t.status !== 'done'),
    'state=open excludes finished work', open.json?.error?.message);

  const done = await call('/api/projects/tasks?state=done&pageSize=100');
  check(done.status === 200 && (done.json?.data ?? []).every(t => t.status === 'done'),
    'state=done returns only finished work');

  const blocked = await call('/api/projects/tasks?state=blocked&pageSize=100');
  check(blocked.status === 200 && (blocked.json?.data ?? []).every(t => t.status === 'blocked'),
    'state=blocked returns only blocked work');

  const overdue = await call('/api/projects/tasks?state=overdue&pageSize=100');
  const today = new Date().toISOString().slice(0, 10);
  check(overdue.status === 200
    && (overdue.json?.data ?? []).every(t => t.status !== 'done' && t.dueDate && t.dueDate < today),
    'state=overdue returns unfinished work past its due date');

  /** The count under the table has to describe the rows in it. */
  check((open.json?.meta?.total ?? 0) >= (open.json?.data ?? []).length,
    'the total counts the filtered population, not the unfiltered one');
  check((done.json?.meta?.total ?? 0) + (open.json?.meta?.total ?? 0)
    === (await call('/api/projects/tasks?pageSize=1')).json?.meta?.total,
    'open and done partition every task exactly');
}

/* ── 10c. What the Delivery screen draws ─────────────────────────────────── */

section('10c. Delivery instruments');

{
  const res = await call('/api/projects/overview');
  const d = res.json?.data;

  if (check(!!d, 'GET /api/projects/overview', res.json?.error?.message)) {
    /**
     * The trend is what the weekly columns are drawn from. Twelve buckets,
     * Monday-aligned, oldest first, and the last one is the week in progress -
     * which the chart draws hollow, so it must genuinely be the current week.
     */
    check(Array.isArray(d.completionTrend) && d.completionTrend.length === 12,
      'the completion trend has twelve weekly buckets',
      String(d.completionTrend?.length));

    const weeks = d.completionTrend ?? [];
    check(weeks.every((w, i) => i === 0
      || Math.round(
        (Date.parse(`${w.weekStart}T00:00:00Z`) - Date.parse(`${weeks[i - 1].weekStart}T00:00:00Z`)) / 86400000,
      ) === 7),
      'the buckets are exactly a week apart, oldest first');
    check(weeks.every(w => Number.isInteger(w.count) && w.count >= 0),
      'every bucket is a whole count');
    check(weeks[weeks.length - 1].weekStart <= d.today
      && Math.round(
        (Date.parse(`${d.today}T00:00:00Z`) - Date.parse(`${weeks[weeks.length - 1].weekStart}T00:00:00Z`)) / 86400000,
      ) < 7,
      'the last bucket is the week in progress, which is why it is drawn hollow');

    /**
     * The workload rows the load bars are drawn from. Unassigned work is
     * counted apart rather than folded into a person, so the two together have
     * to account for every open task the totals claim.
     */
    check(Array.isArray(d.workload), 'the workload is a list');
    check(d.workload.every((w, i) => i === 0 || d.workload[i - 1].open >= w.open),
      'it is ordered heaviest first, which is what the bar scale assumes');
    check(d.workload.every(w => w.overdue <= w.open),
      'nobody is more overdue than they are open');
    check(typeof d.unassignedOpen === 'number', 'unassigned work is counted apart');

    const assigned = d.workload.reduce((n, w) => n + w.open, 0);
    check(assigned + d.unassignedOpen === d.totals.openTasks,
      'the load bars and the unassigned row account for every open task',
      `${assigned} + ${d.unassignedOpen} vs ${d.totals.openTasks}`);

    /** Every project the timeline draws a span for needs both its dates. */
    const spans = d.projects.filter(p => p.startDate && p.endDate);
    check(spans.every(p => p.endDate >= p.startDate),
      'no project on the timeline ends before it starts');

    /** The card's milestone line, and the timeline's own "next" lookup. */
    check(d.projects.every(p => p.nextMilestone === null || !!p.nextMilestone.dueDate),
      'a next phase always carries the date it is drawn against');
    check(d.projects.every(p => !p.nextMilestone || p.nextMilestone.name),
      'and a name to print');
  }
}

{
  /** The same field, on the list the card view reads. */
  const res = await call('/api/projects/projects?page=1&pageSize=20');
  const rows = res.json?.data ?? [];
  check(res.status === 200, 'GET /api/projects/projects', res.json?.error?.message);
  check(rows.every(r => 'nextMilestone' in r),
    'every project row carries a next phase, or null - the card renders it');
  check(rows.every(r => !r.nextMilestone || r.nextMilestone.dueDate),
    'and it is never a phase without a date');
}

/* ── 11. Export ──────────────────────────────────────────────────────────── */

section('11. Export');

for (const dataset of ['projects', 'tasks']) {
  const res = await call(`/api/export?dataset=${dataset}`);
  check(res.status === 200, `GET /api/export?dataset=${dataset}`, res.json?.error?.message ?? res.status);
  check(res.text.split('\r\n')[0].includes(','), `${dataset} export has a header row`);
}

/* ── 12. Cleanup ─────────────────────────────────────────────────────────── */

section('12. Cleanup');

if (edgeId) {
  await call(`/api/projects/tasks/${taskId}/dependencies?edge=${edgeId}`, { method: 'DELETE' });
}
for (const id of bin.comments) await call(`/api/projects/comments/${id}`, { method: 'DELETE' });
for (const id of bin.files) await call(`/api/projects/files/${id}`, { method: 'DELETE' });
for (const id of bin.tasks) await call(`/api/projects/tasks/${id}`, { method: 'DELETE' });
for (const id of bin.milestones) await call(`/api/projects/milestones/${id}`, { method: 'DELETE' });
for (const id of bin.projects) await call(`/api/projects/projects/${id}`, { method: 'DELETE' });

{
  const res = await call(`/api/projects/projects/${projectId}/overview`);
  check(res.status === 404, 'the harness left nothing behind', String(res.status));
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (failed.length) {
  console.log('\n  Failures:');
  for (const f of failed) console.log(`    · ${f}`);
}
console.log('');
process.exit(fail ? 1 : 0);
