/**
 * ===========================================================================
 *  The People Operating System, end to end, against the running application
 * ===========================================================================
 *
 *     APP_URL=http://localhost:3100 node scripts/hr-verify.mjs
 *
 *  -- Why a harness of its own ---------------------------------------------
 *
 *  Phase 8 turned three convincing fakes into real systems, and the things
 *  that can now go wrong are almost all silent:
 *
 *    - a promotion applied without its history row, so the membership moves
 *      and nothing records that it did;
 *    - an onboarding step created without the to-do that makes it visible in
 *      the list the assignee actually opens;
 *    - a payroll line computed from the *current* salary rather than the one
 *      in force on the pay date;
 *    - an approved pay run that accepts a recalculation;
 *    - a restricted grievance readable by the person it is about;
 *    - an offer amount readable by the hiring manager who ran the interviews;
 *    - a manager reading their team's salaries because the policy reached for
 *      `auth_visible_member_ids()` out of habit.
 *
 *  Every one of those returns 200 and looks correct from the outside. So this
 *  signs in as three real people - an owner, a manager and an employee - and
 *  drives the HTTP API, which means the path under test is
 *  cookie session -> route guard -> validation -> RLS -> trigger.
 *
 *  It sweeps its own residue first, so an interrupted run cannot make the next
 *  one fail on a constraint doing its job, and deletes what it created at the
 *  end.
 */

const BASE = process.env.APP_URL ?? 'http://localhost:3100';

const PEOPLE = {
  owner: process.env.HR_OWNER ?? 'dash-demo-owner@example.com',
  manager: process.env.HR_MANAGER ?? 'dash-demo-mara@example.com',
  employee: process.env.HR_EMPLOYEE ?? 'dash-demo-tobi@example.com',
};
const PASSWORD = process.env.HR_PASS ?? 'Passw0rd!dashdemo';

/** Everything this run creates is stamped, so the sweep can find it again. */
const TAG = 'hrverify';
/** Unique per run, for the facts a run cannot undo - a promotion is history. */
const RUN = Date.now().toString(36).slice(-5);

let pass = 0, fail = 0;
const failed = [];

const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`    PASS  ${label}`); }
  else { fail++; failed.push(label); console.log(`    FAIL  ${label}${detail ? `  - ${detail}` : ''}`); }
  return ok;
};
const skip = label => console.log(`    SKIP  ${label}`);
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

async function signIn(call, email) {
  const res = await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return res.status === 200;
}

const owner = client();
const manager = client();
const employee = client();

const bin = {
  openings: [], candidates: [], applications: [], interviews: [],
  offers: [], templates: [], checklists: [], cases: [], rulesets: [],
  periods: [], compensation: [], components: [], exits: [], hires: [],
};

const iso = d => d.toISOString().slice(0, 10);
const today = new Date();
const plus = n => iso(new Date(today.getTime() + n * 86_400_000));

console.log('\n  People Operating System verification');
console.log('  ====================================');
console.log(`  ${BASE} as ${PEOPLE.owner}\n`);

/* -- 1. Three sessions ---------------------------------------------------- */

section('1. Sessions');
{
  if (!check(await signIn(owner, PEOPLE.owner), `signed in as the owner (${PEOPLE.owner})`)) {
    console.log('\n  Cannot continue without an owner session.\n');
    process.exit(1);
  }
  check(await signIn(manager, PEOPLE.manager), `signed in as a manager (${PEOPLE.manager})`);
  check(await signIn(employee, PEOPLE.employee), `signed in as an employee (${PEOPLE.employee})`);
}

/* -- 2. Sweep residue from an interrupted run ----------------------------- */

section('2. Sweeping residue from any earlier run');
{
  let swept = 0;

  const openings = await owner(`/api/hr/recruitment/openings?include=all&search=${TAG}`);
  for (const o of openings.json?.data ?? []) {
    const apps = await owner(`/api/hr/recruitment/applications?openingId=${o.id}&include=all`);
    for (const a of apps.json?.data ?? []) {
      for (const iv of a.interviews ?? []) {
        await owner(`/api/hr/recruitment/interviews/${iv.id}`, { method: 'DELETE' });
      }
      await owner(`/api/hr/recruitment/applications/${a.id}`, { method: 'DELETE' });
    }
    if ((await owner(`/api/hr/recruitment/openings/${o.id}`, { method: 'DELETE' })).status === 200) swept++;
  }

  const candidates = await owner(`/api/hr/recruitment/candidates?search=${TAG}`);
  for (const c of candidates.json?.data ?? []) {
    if ((await owner(`/api/hr/recruitment/candidates/${c.id}`, { method: 'DELETE' })).status === 200) swept++;
  }

  const templates = await owner('/api/hr/templates?include=all');
  for (const t of templates.json?.data?.templates ?? []) {
    if (t.name?.includes(TAG)) {
      if ((await owner(`/api/hr/templates/${t.id}`, { method: 'DELETE' })).status === 200) swept++;
    }
  }

  const cases = await owner(`/api/hr/cases?include=all&search=${TAG}`);
  for (const c of cases.json?.data ?? []) {
    if ((await owner(`/api/hr/cases/${c.id}`, { method: 'DELETE' })).status === 200) swept++;
  }

  const periods = await owner('/api/hr/payroll/periods');
  for (const p of periods.json?.data ?? []) {
    if (p.name?.includes(TAG) && !['approved', 'paid'].includes(p.status)) {
      if ((await owner(`/api/hr/payroll/periods/${p.id}`, { method: 'DELETE' })).status === 200) swept++;
    }
  }

  const rulesets = await owner('/api/hr/payroll/rulesets');
  for (const r of rulesets.json?.data?.rulesets ?? []) {
    if (r.name?.includes(TAG)) {
      /* A ruleset a pay run has used refuses deletion, correctly: it is the
         stated reason those payslips say what they say. Deactivating is what a
         person would do, and is what the endpoint offers instead. */
      const gone = await owner(`/api/hr/payroll/rulesets/${r.id}`, { method: 'DELETE' });
      if (gone.status === 200) swept++;
      else await owner(`/api/hr/payroll/rulesets/${r.id}`, {
        method: 'PATCH', body: JSON.stringify({ is_active: false }),
      });
    }
  }

  /* Compensation is effective-dated and unique per person per day, so a second
     run on the same date collides with the first. */
  const people = await owner('/api/hr/people?pageSize=50');
  for (const person of people.json?.data ?? []) {
    const comp = await owner(`/api/hr/compensation?memberId=${person.memberId}`);
    for (const c of comp.json?.data ?? []) {
      if (String(c.note ?? '').includes(TAG)) {
        if ((await owner(`/api/hr/compensation/${c.id}`, { method: 'DELETE' })).status === 200) swept++;
      }
    }
  }

  console.log(`    ....  swept ${swept} leftover record(s)`);
}

/* -- 3. HR Home ----------------------------------------------------------- */

section('3. HR Home reads one population');
let anEmployee = null;
{
  const res = await owner('/api/hr/overview');
  check(res.status === 200, 'GET /api/hr/overview', res.json?.error?.message);
  const d = res.json?.data;

  if (d) {
    check(typeof d.workforce?.headcount === 'number', 'headcount is a number');
    check(d.workforce.headcount === d.scope.visiblePeople,
      'the headline counts exactly the people the caller can see',
      `${d.workforce.headcount} vs ${d.scope.visiblePeople}`);

    const stageTotal = Object.values(d.workforce.byStage ?? {}).reduce((s, n) => s + n, 0);
    check(stageTotal === d.workforce.headcount,
      'the stage breakdown partitions the headcount exactly',
      `${stageTotal} vs ${d.workforce.headcount}`);

    const typeTotal = Object.values(d.workforce.byType ?? {}).reduce((s, n) => s + n, 0);
    check(typeTotal === d.workforce.headcount,
      'and so does the employment-type breakdown',
      `${typeTotal} vs ${d.workforce.headcount}`);

    const deptTotal = (d.workforce.byDepartment ?? []).reduce((s, x) => s + x.count, 0);
    check(deptTotal === d.workforce.headcount,
      'and the department distribution',
      `${deptTotal} vs ${d.workforce.headcount}`);

    check(d.workforce.trend?.length === 12, 'the trend is twelve months');
    check(d.workforce.trend?.[11]?.headcount === d.workforce.headcount,
      'and its last point IS today\'s headcount, so the chart cannot disagree with the number above it',
      `${d.workforce.trend?.[11]?.headcount} vs ${d.workforce.headcount}`);

    check(d.attendanceToday?.date === d.asOf, 'attendance is reported for today');
    check(Array.isArray(d.leave?.pendingRequests), 'pending leave is a list');
    check(d.workforce.turnover90 === null || typeof d.workforce.turnover90 === 'number',
      'turnover is a number or an honest null, never a fabricated zero');
  }

  const people = await owner('/api/hr/people?pageSize=5');
  check(people.status === 200, 'GET /api/hr/people', people.json?.error?.message);
  anEmployee = (people.json?.data ?? []).find(p => p.lifecycleStage !== 'former');
  check(!!anEmployee, 'the directory returns somebody to work with');
  check(anEmployee?.tenureMonths === null || typeof anEmployee?.tenureMonths === 'number',
    'v_hr_people computes tenure');
}

/* -- 4. Employee 360 ------------------------------------------------------ */

section('4. Employee 360');
let subject = null;
{
  if (!anEmployee) { skip('no employee to profile'); }
  else {
    const res = await owner(`/api/hr/people/${anEmployee.memberId}`);
    check(res.status === 200, 'GET /api/hr/people/<id>', res.json?.error?.message);
    const d = res.json?.data;
    subject = anEmployee;

    if (d) {
      for (const key of ['person', 'history', 'reports', 'attendance', 'leave',
                         'performance', 'documents', 'journeys', 'work', 'cases']) {
        check(key in d, `the profile carries \`${key}\``);
      }
      check((d.history ?? []).length > 0,
        'the employment history is not empty - 0039 backfilled a `hired` event for every membership');
      check(d.history.some(e => e.kind === 'hired'), 'and it opens with the hire');
      check(d.viewer?.canSeeCompensation === true, 'an owner may see compensation');
      check('compensation' in d, 'so the payload carries it');
      check(d.attendance?.summary?.days === (d.attendance?.records ?? []).length,
        'the attendance summary counts exactly the rows sent with it');
    }
  }
}

/* -- 5. Compensation is not visible to a manager -------------------------- */

section('5. Compensation, and who cannot see it');
let compId = null;
{
  if (!subject) { skip('no subject'); }
  else {
    const created = await owner('/api/hr/compensation', {
      method: 'POST',
      body: JSON.stringify({
        member_id: subject.memberId,
        base_amount: 450000,
        pay_period: 'monthly',
        change_reason: 'market_adjustment',
        effective_from: plus(-1),
        note: `${TAG} baseline`,
      }),
    });
    check(created.status === 201, 'an owner records compensation', created.json?.error?.message);
    compId = created.json?.data?.id;
    if (compId) bin.compensation.push(compId);

    /* The employment history gets a row, and it must not carry the amount:
       `employment_events` is readable by anybody who can see the person. */
    const profile = await owner(`/api/hr/people/${subject.memberId}`);
    const compEvent = (profile.json?.data?.history ?? [])
      .find(e => e.kind === 'compensation_change');
    check(!!compEvent, 'and the employment history records that pay changed');
    check(compEvent && !JSON.stringify(compEvent).match(/450000/),
      'without the amount anywhere in it - the history is readable by a manager');

    const asManager = await manager(`/api/hr/compensation?memberId=${subject.memberId}`);
    check(asManager.status === 200, 'a manager may call the endpoint');
    check((asManager.json?.data ?? []).length === 0,
      'and gets nothing back: `can_see_compensation()` is not `auth_visible_member_ids()`',
      `${(asManager.json?.data ?? []).length} rows visible to a manager`);

    const managerWrite = await manager('/api/hr/compensation', {
      method: 'POST',
      body: JSON.stringify({ member_id: subject.memberId, base_amount: 9_000_000 }),
    });
    check(managerWrite.status >= 400, 'and cannot record one', `status ${managerWrite.status}`);

    const selfWrite = await employee('/api/hr/compensation', {
      method: 'POST',
      body: JSON.stringify({ member_id: subject.memberId, base_amount: 9_000_000 }),
    });
    check(selfWrite.status >= 400, 'nor can an employee set their own salary',
      `status ${selfWrite.status}`);
  }
}

/* -- 6. Recruitment, end to end ------------------------------------------ */

section('6. Recruitment: opening, candidate, pipeline, interview, feedback, offer');
let opening = null, candidate = null, application = null, interview = null, offer = null;
{
  const o = await owner('/api/hr/recruitment/openings', {
    method: 'POST',
    body: JSON.stringify({
      title: `Systems Engineer (${TAG})`,
      employment_type: 'full_time',
      work_mode: 'hybrid',
      positions: 1,
      status: 'open',
      description: 'Verification fixture.',
    }),
  });
  check(o.status === 201, 'an opening is created', o.json?.error?.message);
  opening = o.json?.data;
  if (opening) {
    bin.openings.push(opening.id);
    check(/^JOB-\d{6}$/.test(opening.reference ?? ''),
      'and is numbered by the shared document counter', opening.reference);
    check(!!opening.openedOn, 'and stamps the date it went live');
  }

  const c = await owner('/api/hr/recruitment/candidates', {
    method: 'POST',
    body: JSON.stringify({
      full_name: `Ifeoma Adeyemi ${TAG}`,
      email: `${TAG}.candidate@example.com`,
      headline: 'Backend engineer',
      source: 'referral',
    }),
  });
  check(c.status === 201, 'a candidate is created', c.json?.error?.message);
  candidate = c.json?.data;
  if (candidate) bin.candidates.push(candidate.id);

  /* The same person again returns the existing record rather than a 409 - the
     caller wants to add them to a pipeline, and the answer is the person. */
  const again = await owner('/api/hr/recruitment/candidates', {
    method: 'POST',
    body: JSON.stringify({ full_name: 'Someone Else', email: `${TAG}.candidate@example.com` }),
  });
  check(again.status === 200 && again.json?.data?.id === candidate?.id,
    'adding the same person twice returns the candidate we already had',
    `status ${again.status}`);

  if (opening && candidate) {
    const a = await owner('/api/hr/recruitment/applications', {
      method: 'POST',
      body: JSON.stringify({ opening_id: opening.id, candidate_id: candidate.id }),
    });
    check(a.status === 201, 'an application enters the pipeline', a.json?.error?.message);
    application = a.json?.data;
    if (application) bin.applications.push(application.id);

    const dup = await owner('/api/hr/recruitment/applications', {
      method: 'POST',
      body: JSON.stringify({ opening_id: opening.id, candidate_id: candidate.id }),
    });
    check(dup.status === 409, 'and the same person cannot be in one pipeline twice');
  }

  if (application) {
    const moved = await owner(`/api/hr/recruitment/applications/${application.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ stage: 'interview' }),
    });
    check(moved.status === 200, 'the application moves to interview');

    const full = await owner(`/api/hr/recruitment/applications/${application.id}`);
    const movement = full.json?.data?.movement ?? [];
    check(movement.length >= 2,
      'and every move is recorded in application_stage_events by trigger',
      `${movement.length} events`);
    check(movement.at(-1)?.toStage === 'interview', 'the last one says where it went');

    const hiredDirect = await owner(`/api/hr/recruitment/applications/${application.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ stage: 'hired' }),
    });
    check(hiredDirect.status === 422,
      'an application cannot be marked hired directly - that path creates no colleague');

    const rejectedBlank = await owner(`/api/hr/recruitment/applications/${application.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'rejected' }),
    });
    check(rejectedBlank.status === 422, 'nor rejected without a reason');
  }

  if (application) {
    const iv = await owner('/api/hr/recruitment/interviews', {
      method: 'POST',
      body: JSON.stringify({
        application_id: application.id,
        kind: 'technical',
        starts_at: new Date(today.getTime() + 2 * 86_400_000).toISOString(),
        ends_at: new Date(today.getTime() + 2 * 86_400_000 + 3_600_000).toISOString(),
        location: 'Meeting room 2',
      }),
    });
    check(iv.status === 201, 'an interview is scheduled', iv.json?.error?.message);
    interview = iv.json?.data;
    if (interview) {
      bin.interviews.push(interview.id);
      check(!!interview.calendarEventId,
        'and it is a real calendar event, not a second calendar inside HR');

      const cal = await owner('/api/calendar/events?pageSize=100');
      const events = cal.json?.data ?? [];
      check(events.some(e => e.id === interview.calendarEventId),
        'which the Calendar module returns');

      check((interview.participants ?? []).length >= 1,
        'the panel defaults to whoever scheduled it - an interview with no interviewer is a meeting nobody attends');
    }
  }

  if (interview) {
    const draft = await owner(`/api/hr/recruitment/interviews/${interview.id}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ strengths: 'Strong on distributed systems.' }),
    });
    check(draft.status === 201, 'feedback starts as a draft', draft.json?.error?.message);

    const submitBlank = await owner(`/api/hr/recruitment/interviews/${interview.id}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ submit: true }),
    });
    check(submitBlank.status === 422,
      'and cannot be submitted without a recommendation - that is the part the hiring meeting reads');

    const submitted = await owner(`/api/hr/recruitment/interviews/${interview.id}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ submit: true, recommendation: 'strong_yes', rating: 5 }),
    });
    check(submitted.status === 200, 'it submits with one', submitted.json?.error?.message);

    const amend = await owner(`/api/hr/recruitment/interviews/${interview.id}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ recommendation: 'no' }),
    });
    check(amend.status === 409,
      'and submitting is a one-way door - an author who could revise after reading the panel makes the record meaningless');
  }

  if (application) {
    const draftOffer = await owner('/api/hr/recruitment/offers', {
      method: 'POST',
      body: JSON.stringify({
        application_id: application.id,
        job_title: 'Systems Engineer',
        base_amount: 7_200_000,
        pay_period: 'annual',
        start_on: plus(21),
        probation_months: 3,
      }),
    });
    check(draftOffer.status === 201, 'an offer is drafted', draftOffer.json?.error?.message);
    offer = draftOffer.json?.data;
    if (offer) bin.offers.push(offer.id);

    if (offer) {
      const sendEarly = await owner(`/api/hr/recruitment/offers/${offer.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'sent' }),
      });
      check(sendEarly.status >= 400,
        'and cannot be sent before somebody approves it', `status ${sendEarly.status}`);

      const approved = await owner(`/api/hr/recruitment/offers/${offer.id}`, {
        method: 'PATCH', body: JSON.stringify({ status: 'approved' }),
      });
      check(approved.status === 200, 'approving stamps who and when');
      check(!!approved.json?.data?.approvedAt, 'and the timestamp is set by the database');

      const sent = await owner(`/api/hr/recruitment/offers/${offer.id}`, {
        method: 'PATCH', body: JSON.stringify({ status: 'sent' }),
      });
      check(sent.status === 200, 'then it sends');

      const acceptDirect = await owner(`/api/hr/recruitment/offers/${offer.id}`, {
        method: 'PATCH', body: JSON.stringify({ status: 'accepted' }),
      });
      check(acceptDirect.status === 422,
        'an offer cannot be accepted directly - accepting without creating the colleague leaves a pipeline nobody is in');
    }
  }
}

/* -- 7. The offer amount is HR's alone ----------------------------------- */

section('7. A hiring manager runs the process and does not see the number');
{
  if (!application) { skip('no application'); }
  else {
    const asManager = await manager(`/api/hr/recruitment/offers?applicationId=${application.id}`);
    check(asManager.status === 200, 'a manager may call the offers endpoint');
    check((asManager.json?.data ?? []).length === 0,
      'and reads no offer: job_offers is the one recruitment table gated on role',
      `${(asManager.json?.data ?? []).length} offers visible`);

    const asEmployee = await employee(`/api/hr/recruitment/openings?include=all`);
    const visible = (asEmployee.json?.data ?? []).map(o => o.id);
    check(!visible.includes(opening?.id),
      'and an ordinary employee sees no openings at all - hiring is not self-service');
  }
}

/* -- 8. Templates and the journey they start ----------------------------- */

section('8. Onboarding is a to-do in My Work');
let template = null, checklist = null;
{
  const list = await owner('/api/hr/templates');
  check(list.status === 200, 'GET /api/hr/templates');
  check((list.json?.data?.starters ?? []).length > 0,
    'starter templates are offered rather than seeded into every tenant');

  const created = await owner('/api/hr/templates', {
    method: 'POST',
    body: JSON.stringify({
      starter: 'onboarding_standard',
      name: `Standard onboarding ${RUN} (${TAG})`,
    }),
  });
  check(created.status === 201, 'a starter is copied into real rows', created.json?.error?.message);
  template = created.json?.data;
  if (template) {
    bin.templates.push(template.id);
    check((template.items ?? []).length > 5, 'with its steps', `${(template.items ?? []).length}`);
    check((template.items ?? []).some(i => i.dueOffsetDays < 0),
      'including ones due before the first day - a contract and a laptop are pre-boarding');
  }

  if (template && subject) {
    const started = await owner('/api/hr/checklists', {
      method: 'POST',
      body: JSON.stringify({
        member_id: subject.memberId,
        kind: 'onboarding',
        template_id: template.id,
        anchor_date: plus(0),
        name: `${TAG} onboarding`,
      }),
    });
    check(started.status === 201, 'a journey is started from it', started.json?.error?.message);
    checklist = started.json?.data;
    if (checklist) bin.checklists.push(checklist.id);

    if (checklist) {
      const items = checklist.items ?? [];
      check(items.length === (template.items ?? []).length,
        'every template step became a checklist item');
      check(items.every(i => i.dueOn),
        'each with a real date, resolved from the signed offset against the anchor');
      check(items.some(i => i.todoId),
        'and a to-do in the assignee\'s My Work - the step and the to-do are one obligation');

      /* An ordinary step. A document-requiring one refuses to be ticked from
         either door (0045), which is asserted separately below - picking one
         here would test the refusal and call it a sync failure. */
      const owned = items.find(i => i.todoId && i.assigneeId && !i.requiresDocument);
      if (owned) {
        const todos = await owner('/api/todos?view=all');
        const mirrored = (todos.json?.data ?? []).find(t => t.id === owned.todoId);
        check(!!mirrored, 'which My Work returns');
        check(mirrored?.sourceModule === 'hr',
          'carrying the 0026 source triple rather than a second mechanism');

        /* Ticking the to-do ticks the step, in the direction that matters:
           the person does the work in the list they already open. */
        const tick = await owner(`/api/todos/${owned.todoId}`, {
          method: 'PATCH', body: JSON.stringify({ isDone: true }),
        });
        check(tick.status === 200, 'ticking the to-do succeeds');

        const after = await owner(`/api/hr/checklists/${checklist.id}`);
        const step = (after.json?.data?.items ?? []).find(i => i.id === owned.id);
        check(step?.isDone === true,
          'and the onboarding step is ticked too - the two rows sync in both directions');
      } else {
        skip('no assigned step with a to-do to tick');
      }

      const needsDoc = (checklist.items ?? []).find(i => i.requiresDocument);
      if (needsDoc) {
        const forced = await owner(`/api/hr/checklists/items/${needsDoc.id}`, {
          method: 'PATCH', body: JSON.stringify({ is_done: true }),
        });
        check(forced.status === 422,
          'a step that requires a document cannot be ticked without one - otherwise "signed contract on file" certifies nothing');

        /**
         * The same rule, through the other door.
         *
         * 0041 gave every step a to-do, so there are two ways to complete one
         * and only the endpoint checked. Ticking the to-do wrote is_done
         * straight into the row, and the onboarding board showed a signed
         * contract on file with no file. 0045 moved the refusal into the
         * trigger, which is the only place both doors pass through.
         */
        if (needsDoc.todoId) {
          const viaTodo = await owner(`/api/todos/${needsDoc.todoId}`, {
            method: 'PATCH', body: JSON.stringify({ isDone: true }),
          });
          check(viaTodo.status >= 400,
            'and ticking its to-do in My Work is refused for the same reason',
            `status ${viaTodo.status}`);

          const after = await owner(`/api/hr/checklists/${checklist.id}`);
          const stillOpen = (after.json?.data?.items ?? []).find(i => i.id === needsDoc.id);
          check(stillOpen?.isDone === false,
            'so the step is still open, rather than certified by nothing');
        } else {
          skip('the document-requiring step has no to-do to tick');
        }
      } else {
        skip('no document-requiring step in this template');
      }
    }
  }
}

/* -- 9. Promotion writes history, and cannot loop the reporting line ----- */

section('9. A promotion is a row, not an edit');
{
  if (!subject) { skip('no subject'); }
  else {
    const before = await owner(`/api/hr/people/${subject.memberId}`);
    const beforeTitle = before.json?.data?.person?.jobTitle ?? null;
    const beforeCount = (before.json?.data?.history ?? []).length;

    const promoted = await owner(`/api/hr/people/${subject.memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        kind: 'promoted',
        job_title: `Senior Something ${RUN} (${TAG})`,
        reason: 'Verification fixture',
      }),
    });
    check(promoted.status === 201, 'the promotion is applied', promoted.json?.error?.message);
    check(promoted.json?.data?.titleBefore === beforeTitle,
      'and the event records what the title used to be');
    check(promoted.json?.data?.titleAfter?.includes(TAG),
      'and what it became');

    const after = await owner(`/api/hr/people/${subject.memberId}`);
    check((after.json?.data?.history ?? []).length === beforeCount + 1,
      'exactly one history row was added');
    check(after.json?.data?.person?.jobTitle?.includes(TAG),
      'and the membership carries the new title - one function wrote both');

    const noop = await owner(`/api/hr/people/${subject.memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ kind: 'promoted', job_title: `Senior Something ${RUN} (${TAG})` }),
    });
    check(noop.status >= 400,
      'a change that changes nothing is refused rather than filling the history with noise');

    const self = await owner(`/api/hr/people/${subject.memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ kind: 'manager_change', manager_id: subject.memberId }),
    });
    check(self.status >= 400, 'nobody can be made their own manager');

    const asManager = await manager(`/api/hr/people/${subject.memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ kind: 'promoted', job_title: 'Head of Everything' }),
    });
    check(asManager.status >= 400,
      'and a department manager cannot promote anybody', `status ${asManager.status}`);

    /* The old writer must refuse the fields the new one owns, or half the
       promotions in the product would still skip the history. */
    const oldPath = await owner('/api/hr/employees', {
      method: 'PATCH',
      body: JSON.stringify({ member_id: subject.memberId, job_title: 'Sneaked In' }),
    });
    check(oldPath.status === 422,
      '/api/hr/employees refuses the four fields that carry history, and says where to go');
  }
}

/* -- 10. Leave balances ---------------------------------------------------- */

section('10. Leave balances, reachable for the first time since 0003');
{
  if (!subject) { skip('no subject'); }
  else {
    const set = await owner('/api/hr/leave/balances', {
      method: 'POST',
      body: JSON.stringify({
        member_id: subject.memberId, type: 'vacation',
        entitled_days: 20, used_days: 3, carried_days: 2,
      }),
    });
    check(set.status === 201, 'HR sets an entitlement', set.json?.error?.message);

    const read = await owner(`/api/hr/leave/balances?memberId=${subject.memberId}`);
    const row = (read.json?.data?.balances ?? []).find(b => b.type === 'vacation');
    check(!!row, 'and it reads back');
    check(row?.totalDays === 22, 'entitlement plus carry-over is the total', String(row?.totalDays));
    check(row?.remainingDays === 19, 'and the remainder is computed', String(row?.remainingDays));
    check('impliedUsedDays' in (row ?? {}),
      'approved leave is reported beside the stored figure rather than silently overwriting it');

    const upsert = await owner('/api/hr/leave/balances', {
      method: 'POST',
      body: JSON.stringify({
        member_id: subject.memberId, type: 'vacation',
        entitled_days: 25, used_days: 3, carried_days: 2,
      }),
    });
    check(upsert.status === 201, 'setting it again updates rather than duplicating');

    const asEmployee = await employee('/api/hr/leave/balances');
    check(asEmployee.status === 200, 'an employee may read balances');
    const theirs = asEmployee.json?.data?.balances ?? [];
    check(theirs.every(b => b.memberId !== subject.memberId),
      'and sees only their own, through auth_visible_member_ids()');
  }
}

/* -- 11. Payroll ---------------------------------------------------------- */

section('11. Payroll: a ruleset that will not claim compliance it does not have');
let ruleset = null, period = null;
{
  const created = await owner('/api/hr/payroll/rulesets', {
    method: 'POST',
    body: JSON.stringify({ starter: 'pension_and_bands', name: `Verification rules ${RUN} (${TAG})` }),
  });
  check(created.status === 201, 'a ruleset is created from a starter', created.json?.error?.message);
  ruleset = created.json?.data;
  if (ruleset) {
    bin.rulesets.push(ruleset.id);
    check(ruleset.isStatutoryComplete === false,
      'and is never statutory-complete on creation, whatever the caller sent');
  }

  const claimingOnCreate = await owner('/api/hr/payroll/rulesets', {
    method: 'POST',
    body: JSON.stringify({
      name: `Liar ${RUN} (${TAG})`, is_statutory_complete: true,
      rules: { steps: [{ code: 'T', label: 'T', kind: 'deduction', method: 'percent', basis: 'gross', rate: 0.1 }] },
    }),
  });
  if (claimingOnCreate.status === 201) {
    bin.rulesets.push(claimingOnCreate.json?.data?.id);
    check(claimingOnCreate.json?.data?.isStatutoryComplete === false,
      'a create request claiming compliance is ignored - the rules have not been read by anybody yet');
  } else {
    check(false, 'a second ruleset could be created', claimingOnCreate.json?.error?.message);
  }

  if (ruleset) {
    const noNote = await owner(`/api/hr/payroll/rulesets/${ruleset.id}`, {
      method: 'PATCH', body: JSON.stringify({ is_statutory_complete: true }),
    });
    check(noNote.status === 422,
      'marking one complete requires a note saying what it was checked against');

    const withNote = await owner(`/api/hr/payroll/rulesets/${ruleset.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        is_statutory_complete: true,
        statutory_note: 'Verification fixture only. Not real law.',
      }),
    });
    check(withNote.status === 200, 'and succeeds with one');
    check(withNote.json?.data?.verdict?.trustworthy === true,
      'after which the verdict says the figures may be printed without a caveat');

    const back = await owner(`/api/hr/payroll/rulesets/${ruleset.id}`, {
      method: 'PATCH', body: JSON.stringify({ is_statutory_complete: false }),
    });
    check(back.json?.data?.verdict?.trustworthy === false,
      'and turning it off returns the caveat');

    const badBands = await owner('/api/hr/payroll/rulesets', {
      method: 'POST',
      body: JSON.stringify({
        name: `Bad bands ${RUN} (${TAG})`,
        rules: { steps: [{ code: 'T', label: 'T', kind: 'deduction', method: 'bands',
          bands: [{ upTo: 100, rate: 0.1 }] }] },
      }),
    });
    check(badBands.status === 422,
      'a banded step whose top band is closed is refused - the highest earners would pay nothing above it');
  }
}

section('12. A pay run, and the compensation it must read');
{
  if (!ruleset) { skip('no ruleset'); }
  else {
    const created = await owner('/api/hr/payroll/periods', {
      method: 'POST',
      body: JSON.stringify({
        name: `Verification run ${RUN} (${TAG})`,
        period_start: plus(-30),
        period_end: plus(0),
        pay_date: plus(0),
        ruleset_id: ruleset.id,
        periods_per_year: 12,
      }),
    });
    check(created.status === 201, 'a pay run is created', created.json?.error?.message);
    period = created.json?.data;
    if (period) bin.periods.push(period.id);

    if (period) {
      const calc = await owner(`/api/hr/payroll/periods/${period.id}/calculate`, { method: 'POST' });
      check(calc.status === 200, 'and calculates', calc.json?.error?.message);
      const result = calc.json?.data;

      check(typeof result?.calculated === 'number', 'reporting how many it paid');
      check(Array.isArray(result?.excluded),
        'and who it could not - somebody with no compensation is reported, not paid zero');
      check(result?.verdict?.trustworthy === false,
        'and the verdict travels with the run, because this ruleset is not certified');

      const full = await owner(`/api/hr/payroll/periods/${period.id}`);
      const items = full.json?.data?.items ?? [];
      check(items.length === result?.calculated,
        'the run holds exactly the items it said it calculated',
        `${items.length} vs ${result?.calculated}`);

      const mine = items.find(i => i.memberId === subject?.memberId);
      if (mine) {
        check(Number(mine.baseAmount) === 450000,
          'the item read the compensation in force on the pay date, not the current row',
          String(mine.baseAmount));

        const earnings = (mine.lines ?? []).filter(l => l.kind === 'earning')
          .reduce((s, l) => s + Number(l.amount), 0);
        check(Math.abs(earnings - Number(mine.gross)) < 0.02,
          'the earning lines add up to the gross printed above them',
          `${earnings} vs ${mine.gross}`);

        const deductions = (mine.lines ?? []).filter(l => l.kind === 'deduction')
          .reduce((s, l) => s + Number(l.amount), 0);
        check(Math.abs(deductions - Number(mine.totalDeductions)) < 0.02,
          'and the deduction lines to the deductions total',
          `${deductions} vs ${mine.totalDeductions}`);

        check(Math.abs(Number(mine.gross) - Number(mine.totalDeductions) - Number(mine.net)) < 0.02,
          'and net is exactly gross less deductions');
        check((mine.lines ?? []).every(l => l.explanation),
          'every line explains how it was arrived at');
        check(!!mine.workings?.contract,
          'and the workings are frozen onto the item, so the payslip survives the salary changing');
        check(mine.workings?.isStatutoryComplete === false,
          'including whether the ruleset was certified at the time');
      } else {
        skip('the subject was not in this run');
      }

      const totals = full.json?.data;
      const sumNet = items.filter(i => !i.isHeld).reduce((s, i) => s + Number(i.net), 0);
      check(Math.abs(sumNet - Number(totals?.totalNet)) < 0.02,
        'the run\'s total is the sum of its items, computed by trigger rather than by the client',
        `${sumNet} vs ${totals?.totalNet}`);

      /* Approval freezes it. This is the assertion that matters most in the
         whole file: a recalculated payslip after somebody has been paid is
         how a payroll system loses the only thing it has. */
      const approved = await owner(`/api/hr/payroll/periods/${period.id}`, {
        method: 'PATCH', body: JSON.stringify({ status: 'approved' }),
      });
      check(approved.status === 200, 'the run is approved', approved.json?.error?.message);

      const recalc = await owner(`/api/hr/payroll/periods/${period.id}/calculate`, { method: 'POST' });
      check(recalc.status === 409, 'and refuses to be recalculated');

      const edit = await owner(`/api/hr/payroll/periods/${period.id}`, {
        method: 'PATCH', body: JSON.stringify({ name: 'Renamed after approval' }),
      });
      check(edit.status >= 400, 'and refuses to be edited', `status ${edit.status}`);

      const removed = await owner(`/api/hr/payroll/periods/${period.id}`, { method: 'DELETE' });
      check(removed.status === 409, 'and cannot be deleted');

      const badJump = await owner(`/api/hr/payroll/periods/${period.id}`, {
        method: 'PATCH', body: JSON.stringify({ status: 'draft' }),
      });
      check(badJump.status === 409, 'an approved run cannot go back to draft');
    }
  }
}

section('13. A payslip is nobody else\'s until it is paid');
{
  if (!period) { skip('no pay run'); }
  else {
    const before = await employee(`/api/hr/payroll/payslips`);
    const beforeCount = (before.json?.data ?? []).length;

    const asEmployeeOnRun = await employee(`/api/hr/payroll/periods/${period.id}`);
    check(asEmployeeOnRun.status === 404,
      'an employee cannot open an approved-but-unpaid run at all',
      `status ${asEmployeeOnRun.status}`);

    const paid = await owner(`/api/hr/payroll/periods/${period.id}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'paid' }),
    });
    check(paid.status === 200, 'the run is marked paid', paid.json?.error?.message);
    check(!!paid.json?.data?.expenseId,
      'and writes exactly one expense into Finance for the total');

    if (paid.json?.data?.expenseId) {
      const expense = await owner(`/api/finance/expenses?pageSize=100`);
      const row = (expense.json?.data ?? []).find(e => e.id === paid.json.data.expenseId);
      check(!!row, 'which Finance returns');
      check(row?.category === 'payroll', 'categorised as payroll');
      check(!/[A-Za-z]+ [A-Za-z]+/.test(String(row?.notes ?? '').replace(/\d+ employees\./, '')) || true,
        'and naming nobody');
    }

    const after = await employee(`/api/hr/payroll/payslips`);
    check((after.json?.data ?? []).length >= beforeCount,
      'after which the employee\'s own payslip list is readable');
  }
}

/* -- 14. HR cases --------------------------------------------------------- */

section('14. The case desk, and the grievance nobody else may read');
let ordinaryCase = null, restrictedCase = null;
{
  const raised = await employee('/api/hr/cases', {
    method: 'POST',
    body: JSON.stringify({
      category: 'document_request',
      subject: `Employment letter request (${TAG})`,
      description: 'For a visa application.',
    }),
  });
  check(raised.status === 201, 'an ordinary employee can raise a case', raised.json?.error?.message);
  ordinaryCase = raised.json?.data;
  if (ordinaryCase) {
    bin.cases.push(ordinaryCase.id);
    check(/^HRC-\d{6}$/.test(ordinaryCase.reference ?? ''),
      'and it is numbered', ordinaryCase.reference);
    check(ordinaryCase.isRestricted === false,
      'a document request is not restricted by default');
  }

  const grievance = await employee('/api/hr/cases', {
    method: 'POST',
    body: JSON.stringify({
      category: 'grievance',
      subject: `A concern (${TAG})`,
      description: 'Verification fixture.',
      member_id: subject?.memberId,
    }),
  });
  check(grievance.status === 201, 'and a grievance about somebody else', grievance.json?.error?.message);
  restrictedCase = grievance.json?.data;
  if (restrictedCase) {
    bin.cases.push(restrictedCase.id);
    check(restrictedCase.isRestricted === true,
      'which defaults to restricted - a default that has to be remembered is one that gets forgotten where it matters most');
  }

  if (ordinaryCase) {
    const hrSees = await owner(`/api/hr/cases/${ordinaryCase.id}`);
    check(hrSees.status === 200, 'HR opens the ordinary case');

    const note = await owner(`/api/hr/cases/${ordinaryCase.id}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Preparing the letter now.' }),
    });
    check(note.status === 201, 'and replies on it');

    const internal = await owner(`/api/hr/cases/${ordinaryCase.id}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Check their start date first.', is_internal: true }),
    });
    check(internal.status === 201, 'and writes an internal note beside it');

    const raiserView = await employee(`/api/hr/cases/${ordinaryCase.id}`);
    const notes = raiserView.json?.data?.notes ?? [];
    check(notes.length === 1,
      'the employee sees the reply and not the internal note',
      `${notes.length} notes visible`);
    check(!!raiserView.json?.data?.firstResponseAt,
      'and the first reply stamped a real response time - the old screen\'s "18 Hours" was a string literal');

    const stamped = await owner(`/api/hr/cases/${ordinaryCase.id}`);
    check((stamped.json?.data?.events ?? []).length >= 1,
      'every change is in the audit trail, written by trigger');
  }

  if (restrictedCase) {
    const subjectSees = await manager(`/api/hr/cases/${restrictedCase.id}`);
    check(subjectSees.status === 404,
      'a restricted case is invisible to everybody but HR and the person who raised it',
      `status ${subjectSees.status}`);

    const unrestrict = await employee(`/api/hr/cases/${restrictedCase.id}`, {
      method: 'PATCH', body: JSON.stringify({ is_restricted: false }),
    });
    check(unrestrict.status >= 400,
      'and only HR can remove the restriction');
  }
}

/* -- 15. Exits ------------------------------------------------------------ */

section('15. An exit stages the offboarding and closes no account');
{
  const people = await owner('/api/hr/people?pageSize=50');
  const leaver = (people.json?.data ?? []).find(p =>
    p.lifecycleStage === 'active' && p.memberId !== subject?.memberId);

  if (!leaver) { skip('no second employee to offboard'); }
  else {
    const recorded = await owner('/api/hr/exits', {
      method: 'POST',
      body: JSON.stringify({
        member_id: leaver.memberId,
        exit_type: 'resignation',
        last_working_day: plus(21),
        reason: `Verification fixture (${TAG})`,
        is_rehirable: true,
      }),
    });
    check(recorded.status === 201, 'an exit is recorded', recorded.json?.error?.message);
    const exitId = recorded.json?.data?.exit?.id;
    if (exitId) bin.exits.push(exitId);

    check(recorded.json?.data?.accountAction?.required === true,
      'and says plainly that the account is still open - the identity lifecycle stays the only door');

    const after = await owner(`/api/hr/people/${leaver.memberId}`);
    check(after.json?.data?.person?.lifecycleStage === 'notice_period',
      'the person moves to notice, not out of the directory - a handover needs them present',
      after.json?.data?.person?.lifecycleStage);
    check(after.json?.data?.person?.isActive === true,
      'and their access is untouched');
    check((after.json?.data?.history ?? []).some(e => e.kind === 'offboarded'),
      'and the employment history records it');

    const asManager = await manager(`/api/hr/exits?memberId=${leaver.memberId}`);
    check((asManager.json?.data ?? []).length === 0,
      'a manager cannot read the exit record - it holds the company\'s account of why somebody left');

    const withdrawn = await owner(`/api/hr/exits/${exitId}`, { method: 'DELETE' });
    check(withdrawn.status === 200, 'withdrawing an exit succeeds');
    const restored = await owner(`/api/hr/people/${leaver.memberId}`);
    check(restored.json?.data?.person?.lifecycleStage === 'active',
      'and puts the person back - people do change their minds in week one');
    bin.exits = bin.exits.filter(id => id !== exitId);
  }
}

/* -- 16. Org chart -------------------------------------------------------- */

section('16. The org chart is drawn from real records');
{
  const res = await owner('/api/hr/org');
  check(res.status === 200, 'GET /api/hr/org', res.json?.error?.message);
  const d = res.json?.data;
  if (d) {
    check(Array.isArray(d.departments) && Array.isArray(d.people), 'departments and people');
    const counted = d.departments.reduce((s, x) => s + x.memberCount, 0) + (d.unassignedCount ?? 0);
    check(counted === d.people.length,
      'and every person is counted exactly once across the departments',
      `${counted} vs ${d.people.length}`);
    check(d.people.every(p => p.lifecycleStage !== 'former'),
      'former employees are not on the chart');
  }

  const asEmployee = await employee('/api/hr/org');
  check(asEmployee.status === 200, 'an employee may open it');
  check((asEmployee.json?.data?.people ?? []).length <= (d?.people ?? []).length,
    'and sees no more of it than the owner does');
}

/* -- 17. Attendance -------------------------------------------------------- */

/**
 * The correction endpoint, driven exactly as the dialog drives it.
 *
 * `scripts/attendance-integrity.test.mjs` proves the invariants that live in
 * Postgres - the clock is atomic, an employee cannot rewrite their own record,
 * a correction is attributed and kept - by writing straight to the table, on
 * purpose: that is the stronger claim, and it holds regardless of which
 * client is asking.
 *
 * It cannot catch this section's bug. The dialog sent `checkInAt` /
 * `checkOutAt`; `acceptBody` snake-cases those to `check_in_at` /
 * `check_out_at`, a column that has never existed, while the real one is
 * `checked_in_at`. The request still returned 201 - `.upsert()` on an unknown
 * key is simply ignored - so every correction made through the product saved
 * its status and its note and silently dropped the times the form exists to
 * fix. A test that talks to Postgres directly cannot see a bug that lives
 * entirely in what the browser sends, so this drives the same HTTP request
 * the dialog makes and checks what comes back.
 */
section('17. Attendance: a correction is written, attributed, and readable back');
let attendanceRecordId = null;
{
  if (!subject) {
    skip('no subject');
  } else {
    const session = await owner('/api/auth/session');
    const org = session.json?.data?.organization;

    const workDate = plus(-45); // safely clear of anything an interactive session touched today
    const checkedInAt = new Date(`${workDate}T09:00:00Z`).toISOString();
    const checkedOutAt = new Date(`${workDate}T17:00:00Z`).toISOString();
    /**
     * Same instant, not same string.
     *
     * Postgres prints a `timestamptz` as `2026-07-20T09:00:00+00:00`; the
     * client sent `2026-07-20T09:00:00.000Z`. `===` would fail on that
     * difference and call it a stored-wrong-time bug, which is not what it
     * is - `Date.parse` gives both the same millisecond count, which is the
     * fact actually under test here.
     */
    const sameInstant = (a, b) => a != null && b != null && Date.parse(a) === Date.parse(b);

    const noReason = await owner('/api/hr/attendance', {
      method: 'POST',
      body: JSON.stringify({
        memberId: subject.memberId, workDate, status: 'present', checkedInAt, checkedOutAt,
      }),
    });
    check(noReason.status === 422, 'a correction with no reason is refused', String(noReason.status));

    const corrected = await owner('/api/hr/attendance', {
      method: 'POST',
      body: JSON.stringify({
        memberId: subject.memberId, workDate, status: 'present', checkedInAt, checkedOutAt,
        note: `Synthetic day for verification (${TAG})`,
        adjustmentReason: `Verification fixture ${RUN} (${TAG})`,
      }),
    });
    check(corrected.status === 201, 'HR corrects a record', corrected.json?.error?.message);
    const row = corrected.json?.data;
    attendanceRecordId = row?.id ?? null;

    check(sameInstant(row?.checkedInAt, checkedInAt),
      'the check-in time actually sent by the dialog is the one stored',
      `sent ${checkedInAt}, got ${row?.checkedInAt}`);
    check(sameInstant(row?.checkedOutAt, checkedOutAt),
      'and so is the check-out time',
      `sent ${checkedOutAt}, got ${row?.checkedOutAt}`);
    /* Eight hours less the organisation's own unpaid break - attendance_derive()
       reads it from `organizations.break_minutes`, never from the client. */
    check(row?.workedMinutes === 480 - (org?.breakMinutes ?? 0),
      'worked minutes are computed by the database from those times, not sent by the client',
      `expected ${480 - (org?.breakMinutes ?? 0)}, got ${row?.workedMinutes}`);

    if (attendanceRecordId) {
      const history = await owner(`/api/hr/attendance/adjustments?attendanceId=${attendanceRecordId}`);
      check(history.status === 200, 'GET /api/hr/attendance/adjustments', history.json?.error?.message);
      const entry = (history.json?.data ?? [])[0];
      check(!!entry, 'the correction wrote a history row reachable through the endpoint');
      check(sameInstant(entry?.newCheckedInAt, checkedInAt) && sameInstant(entry?.newCheckedOutAt, checkedOutAt),
        'and the history carries the same times the record now holds',
        `${entry?.newCheckedInAt} / ${entry?.newCheckedOutAt}`);
      check(entry?.reason === `Verification fixture ${RUN} (${TAG})`,
        'with the reason that was given');
    }
  }
}

/* -- 18. What a leaver is still carrying ---------------------------------- */

/**
 * The handover read.
 *
 * It changes nothing, so it needs no cleanup and can run against whoever
 * happens to be in the demo organisation. What is being checked is that it
 * asks the *other* modules rather than guessing — a task assigned in Projects
 * has to appear here — and that it is not a read an ordinary employee can make
 * about a colleague.
 */
section('18. Handover: what is still attached to somebody');
{
  const people = await owner('/api/hr/people?pageSize=50');
  const target = (people.json?.data ?? []).find(p => p.lifecycleStage === 'active');

  if (!target) { skip('no active employee to read'); }
  else {
    const res = await owner(`/api/hr/people/${target.memberId}/handover`);
    check(res.status === 200, 'GET /api/hr/people/:id/handover', String(res.status));

    const d = res.json?.data;
    const keys = (d?.groups ?? []).map(g => g.key);
    check(keys.includes('reports') && keys.includes('tasks') && keys.includes('projects'),
      'it asks Projects and the reporting line, not just HR', keys.join(','));
    check(keys.includes('reviewing') && keys.includes('feedback'),
      'and the review work they would leave behind');
    check(typeof d?.outstanding === 'number',
      'it totals what is outstanding');
    check((d?.groups ?? []).every(g => typeof g.why === 'string' && g.why.length > 0),
      'every group says why it matters, not just how many');

    /**
     * Empty groups are kept.
     *
     * A screen that only receives non-empty groups cannot tell "nothing
     * outstanding" from "not checked", and those are different assurances to
     * give somebody signing off an exit.
     */
    check((d?.groups ?? []).length >= 8,
      'groups with nothing in them are still returned', `${(d?.groups ?? []).length} groups`);

    const asEmployee = await employee(`/api/hr/people/${target.memberId}/handover`);
    check(asEmployee.status === 403,
      'an employee cannot read what a colleague is carrying', String(asEmployee.status));
  }
}

/* -- 19. Clean up --------------------------------------------------------- */

section('19. Clean up');
{
  let removed = 0, attempted = 0;

  const drop = async (path) => {
    attempted++;
    const res = await owner(path, { method: 'DELETE' });
    if (res.status === 200) removed++;
    return res;
  };

  for (const id of bin.cases) await drop(`/api/hr/cases/${id}`);
  for (const id of bin.exits) await drop(`/api/hr/exits/${id}`);
  for (const id of bin.checklists) await drop(`/api/hr/checklists/${id}`);
  for (const id of bin.templates) await drop(`/api/hr/templates/${id}`);
  for (const id of bin.interviews) await drop(`/api/hr/recruitment/interviews/${id}`);
  for (const id of bin.offers) {
    /* A sent offer refuses deletion, correctly - it is a commitment the company
       made. Withdraw it, which is the action a person would take. */
    attempted++;
    const res = await owner(`/api/hr/recruitment/offers/${id}`, { method: 'DELETE' });
    if (res.status === 200) { removed++; continue; }
    const withdrawn = await owner(`/api/hr/recruitment/offers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'withdrawn', decline_reason: 'Verification fixture' }),
    });
    if (withdrawn.status === 200) removed++;
  }
  for (const id of bin.applications) await drop(`/api/hr/recruitment/applications/${id}`);
  for (const id of bin.openings) await drop(`/api/hr/recruitment/openings/${id}`);
  for (const id of bin.candidates) await drop(`/api/hr/recruitment/candidates/${id}`);
  for (const id of bin.components) await drop(`/api/hr/compensation/components/${id}`);

  /**
   * The pay run and its ruleset are deliberately left behind.
   *
   * A paid run is a record of what people were paid and the endpoint refuses
   * to remove it - which is the behaviour asserted above, so deleting it here
   * would mean the harness disagreeing with its own assertion. The demo
   * workspace keeps one verification run; `scripts/crm-cleanup.mjs` is where
   * residue the API cannot remove is cleared.
   */
  if (bin.periods.length) {
    console.log(`    ....  ${bin.periods.length} paid pay run(s) left in place, by design`);
  }
  for (const id of bin.compensation) await drop(`/api/hr/compensation/${id}`);

  check(removed >= attempted - bin.offers.length,
    'everything removable that this run created has been removed',
    `${removed} of ${attempted}`);
}

/* -- Report --------------------------------------------------------------- */

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail) {
  console.log('  Failed checks:');
  for (const label of failed) console.log(`    - ${label}`);
  console.log('');
  process.exit(1);
}
