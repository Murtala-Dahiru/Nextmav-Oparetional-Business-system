#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  seed-demo.mjs — a year of development data for the demo workspace
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *      node scripts/seed-demo.mjs --yes
 *      node scripts/seed-demo.mjs --yes --dry-run
 *
 * ── What this is for ──────────────────────────────────────────────────────
 *
 * Every screen in this product is unreadable against an empty workspace, and
 * the Executive Overview most of all: a twelve-month revenue chart with two
 * months in it, a completion chart whose best week is 2, and a project health
 * table where every row reads 10% tell you nothing about whether the *design*
 * works. This fills one clearly-marked organisation with a year of interlinked
 * business history so those screens can be judged.
 *
 * ── The rule this file exists to obey ─────────────────────────────────────
 *
 * **It writes no number the application will later display.** It writes the
 * records a business would have — invoices with line items, payments against
 * them, expenses, deals, milestones, tasks with completion timestamps — and
 * lets `v_finance_monthly`, `v_project_health`, `v_receivables_ageing` and
 * `v_dashboard_stats` compute what the dashboard shows. If a figure on the
 * Executive Overview is wrong after this runs, the view is wrong, which is
 * exactly what a demo dataset is supposed to be able to reveal.
 *
 * That is also why the shapes below are expressed as *targets* rather than as
 * outcomes: the script sizes invoice line items so a month lands near a
 * revenue target, and then the database decides what the revenue actually is.
 *
 * ── Safety ────────────────────────────────────────────────────────────────
 *
 * This talks to a live Supabase project with the service key, so it is fenced:
 *
 *   1. It refuses to run without `--yes`.
 *   2. It refuses to run when `NODE_ENV=production`.
 *   3. It resolves **exactly one** organisation, by id or exact name, and
 *      every statement it issues is filtered on that `organization_id`. There
 *      is no unscoped DELETE anywhere in this file.
 *   4. That organisation must already carry the marker
 *      `settings->demo = true`. An organisation without it is refused unless
 *      `--adopt` is passed, which is the one deliberate action that turns a
 *      workspace into the demo workspace — and it stamps the marker and
 *      renames it so nobody can mistake it for a real one afterwards.
 *   5. It never touches `auth.users`, and it never deletes a profile or a
 *      membership. Memberships in this product are not deleted, ever.
 *
 * Re-running it is safe: it clears the demo organisation's own business rows
 * and rebuilds them. The seed is fixed, so two runs produce the same dataset.
 *
 * ── Two schema facts that shape the code below ────────────────────────────
 *
 *   · **Invoice status is derived, never declared.** `recalculate_invoice()`
 *     fires on every line-item and payment write and recomputes `subtotal`,
 *     `total`, `amount_paid` and `status` from the rows underneath. Inserting
 *     `status: 'paid'` with no payment lands as `overdue` the moment a line
 *     item arrives. So: insert the invoice, then its lines, then its payments,
 *     and let the trigger decide.
 *   · **`trg_set_updated_at` is BEFORE UPDATE.** A deal that has "gone quiet"
 *     therefore has to be INSERTed with an old `updated_at`; a PATCH would
 *     overwrite it with `now()`.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/* -------------------------------------------------------------------------- */
/*  Environment                                                               */
/* -------------------------------------------------------------------------- */

for (const line of fs.readFileSync(path.resolve('.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

const ARGS = new Set(process.argv.slice(2));
const DRY = ARGS.has('--dry-run');
const ADOPT = ARGS.has('--adopt');
/**
 * `--reset` clears the demo workspace and stops.
 *
 * It exists so that taking the development data back out is the *same* code
 * path, with the same five safety gates and the same organisation scoping, as
 * putting it in. A second script for the deletion half would be a second place
 * for an unscoped DELETE to appear.
 */
const RESET = ARGS.has('--reset');

const TARGET_ID = process.env.DEMO_ORG_ID || 'f90e4fc8-f408-47d3-b4d5-5e00f4133470';
const TARGET_NAME = process.env.DEMO_ORG_NAME || 'Northwind Studio (Demo)';
const LEGACY_NAME = 'Northwind Studio';

if (!ARGS.has('--yes')) {
  console.error(
    'Refusing to run without --yes.\n\n' +
    '  This writes a year of development data into one organisation and\n' +
    '  deletes that organisation\'s existing business rows first.\n\n' +
    `  Target: ${TARGET_ID} (${TARGET_NAME})\n\n` +
    '  node scripts/seed-demo.mjs --yes\n',
  );
  process.exit(1);
}

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run with NODE_ENV=production.');
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/*  REST                                                                      */
/* -------------------------------------------------------------------------- */

const HEADERS = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * One PostgREST call, with a retry for this machine's intermittent resolver.
 *
 * The local DNS SERVFAILs on the Supabase host every so often; a seed run
 * issues a few hundred requests, so without this it fails roughly every time.
 * Only network faults are retried — a 4xx is a real answer and is thrown.
 */
async function rest(method, url, body, extraHeaders = {}, attempt = 0) {
  try {
    const res = await fetch(`${URL}/rest/v1/${url}`, {
      method,
      headers: { ...HEADERS, ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${method} ${url} → ${res.status} ${text.slice(0, 400)}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch (e) {
    const transient = /fetch failed|EAI_AGAIN|ECONNRESET|ETIMEDOUT|socket hang up/i.test(
      e.message + (e.cause?.code ?? ''),
    );
    if (transient && attempt < 6) {
      await sleep(1000 * (attempt + 1));
      return rest(method, url, body, extraHeaders, attempt + 1);
    }
    throw e;
  }
}

const select = (table, query) => rest('GET', `${table}?${query}`);

/**
 * Insert, in chunks, returning the created rows.
 *
 * Two things this has to do that a bare POST does not:
 *
 *   · **Union the keys.** PostgREST rejects a bulk insert whose objects do not
 *     all carry identical keys — "All object keys must match" — so a batch
 *     where only some rows set `notes` fails. Every row is widened to the
 *     union of the batch's keys, with `null` for the ones it did not set.
 *   · **Chunk.** A few hundred rows in one request is fine; four thousand
 *     tasks is not, and the failure is a timeout rather than an error message.
 */
async function insert(table, rows, { returning = true, chunk = 250 } = {}) {
  if (!rows.length) return [];
  const out = [];
  for (let i = 0; i < rows.length; i += chunk) {
    const batch = rows.slice(i, i + chunk);
    const keys = [...new Set(batch.flatMap(Object.keys))];
    const widened = batch.map(r => Object.fromEntries(keys.map(k => [k, r[k] ?? null])));
    const res = await rest('POST', table, widened, {
      Prefer: returning ? 'return=representation' : 'return=minimal',
    });
    if (res) out.push(...res);
  }
  return out;
}

/** Every delete in this file goes through here, and every one is org-scoped. */
async function wipe(table, orgId, column = 'organization_id') {
  const before = await rest('GET', `${table}?select=id&${column}=eq.${orgId}`, undefined, {
    Prefer: 'count=exact', Range: '0-0',
  }).catch(() => null);
  await rest('DELETE', `${table}?${column}=eq.${orgId}`, undefined, { Prefer: 'return=minimal' });
  return before;
}

/* -------------------------------------------------------------------------- */
/*  Determinism                                                               */
/* -------------------------------------------------------------------------- */

/** mulberry32 — small, fast, and identical on every run, so is the dataset. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(20260828);
const pick = arr => arr[Math.floor(rand() * arr.length)];
const between = (lo, hi) => lo + rand() * (hi - lo);
const intBetween = (lo, hi) => Math.floor(between(lo, hi + 1));
const shuffle = arr => arr.map(v => [rand(), v]).sort((a, b) => a[0] - b[0]).map(x => x[1]);

/* -------------------------------------------------------------------------- */
/*  Time                                                                      */
/* -------------------------------------------------------------------------- */

const TODAY = new Date();
const iso = d => d.toISOString();
const day = d => d.toISOString().slice(0, 10);

/**
 * Add days — including fractions of one.
 *
 * This was `setUTCDate(getUTCDate() + n)`, which silently floors: passing 0.3
 * asked for the 28.3th of the month and got the 28th. Every caller using whole
 * days was fine, and the one place that wanted sub-day precision — the
 * activity feed, spread over hours — collapsed its hundred and fifty rows onto
 * about twenty identical timestamps. The panel then showed eighteen events all
 * stamped "1d ago" to the second, which is exactly what fabricated data looks
 * like.
 *
 * Milliseconds have no such rounding, and everything in this file is UTC, so
 * there is no daylight-saving case to preserve.
 */
const addDays = (d, n) => new Date(new Date(d).getTime() + n * 86_400_000);

const daysAgo = n => addDays(TODAY, -n);
const daysAhead = n => addDays(TODAY, n);

/** Midnight UTC on the first of the month `back` months before this one. */
function monthStart(back) {
  return new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth() - back, 1));
}

/**
 * The twelve months the chart will draw, oldest first, ending on the current
 * one — which is deliberately left partial, because it is.
 */
const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const start = monthStart(11 - i);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  const current = i === 11;
  return {
    index: i,
    current,
    start,
    end,
    label: start.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
    /** The last day that can carry a record: today, in the running month. */
    lastUsable: current ? TODAY : end,
  };
});

/** A date inside a month, biased away from the very first and last days. */
function dateIn(month, fraction = null) {
  const first = month.start.getTime();
  const last = month.lastUsable.getTime();
  const f = fraction === null ? between(0.06, 0.94) : fraction;
  return new Date(first + (last - first) * f);
}

/* -------------------------------------------------------------------------- */
/*  The shape of the year                                                     */
/* -------------------------------------------------------------------------- */
/**
 * Twelve months of a services-and-hardware studio, in naira.
 *
 * Deliberately not a straight line and not a sawtooth. It has a strong
 * December, a January collapse (the single most reliable feature of a real
 * revenue chart), a spring recovery, a genuinely loss-making November where an
 * equipment purchase lands, and a partial current month.
 *
 * `invoiced` is what was billed. `collected` is the share of it that has been
 * paid — falling as the months approach the present, which is what actually
 * produces a believable receivables ageing curve rather than one placed by
 * hand. `spend` moves on its own: payroll is steady, and the two spikes are a
 * hardware purchase and an offsite.
 */
/**
 * ── A note on the collected column ────────────────────────────────────────
 *
 * `v_finance_monthly` buckets revenue by an invoice's **issue** month and
 * counts it once the invoice is paid, whenever that happens. An invoice issued
 * in September and settled in November is September revenue. So an old month
 * converges on fully collected as its invoices are eventually paid, and the
 * gap between the invoiced line and the collected area is, correctly, a
 * right-hand-end phenomenon: it *is* the receivables book, drawn where it
 * actually lives.
 *
 * The taper is therefore deliberate rather than incidental — full collection
 * until about five months ago, then a widening shortfall into the present.
 */
const YEAR = [
  { invoiced: 12_400_000, collected: 1.00, spend:  8_100_000 },
  { invoiced: 14_900_000, collected: 1.00, spend:  8_650_000 },
  { invoiced: 11_200_000, collected: 1.00, spend: 12_900_000 },
  { invoiced: 18_600_000, collected: 1.00, spend:  9_400_000 },
  { invoiced:  9_800_000, collected: 1.00, spend:  8_250_000 },
  { invoiced: 13_500_000, collected: 0.98, spend:  8_900_000 },
  { invoiced: 16_200_000, collected: 0.96, spend: 10_150_000 },
  { invoiced: 12_100_000, collected: 0.93, spend:  9_600_000 },
  { invoiced: 19_400_000, collected: 0.87, spend: 13_800_000 },
  { invoiced: 15_600_000, collected: 0.79, spend: 10_400_000 },
  { invoiced: 21_300_000, collected: 0.61, spend: 11_250_000 },
  /*
    The current month, at roughly nine-tenths elapsed.

    Its billing is scaled to the part of the month that has actually happened,
    and its collection is higher than the taper alone would give it — because
    a real business does collect some of what it bills inside the same month,
    and because the alternative was a headline reading "revenue down 80%" on
    the 28th of every month. That figure was arithmetically true and told the
    reader nothing except that the calendar had not finished.
  */
  { invoiced: 15_800_000, collected: 0.55, spend:  9_400_000 },
];

/** Weekly task completions, oldest first; the last week is in progress. */
const COMPLETIONS_BY_WEEK = [22, 31, 18, 27, 39, 24, 33, 11];

const TAX_RATE = 7.5; // Nigerian VAT, so the invoice screens show a real one.

/* -------------------------------------------------------------------------- */
/*  Content                                                                   */
/* -------------------------------------------------------------------------- */

const CLIENTS = [
  { name: 'Sable & Finch',        industry: 'Retail',          city: 'Lagos',    country: 'Nigeria' },
  { name: 'Pallas Retail Group',  industry: 'Retail',          city: 'Abuja',    country: 'Nigeria' },
  { name: 'Corvo Health',         industry: 'Healthcare',      city: 'Lagos',    country: 'Nigeria' },
  { name: 'Halden Logistics',     industry: 'Logistics',       city: 'Port Harcourt', country: 'Nigeria' },
  { name: 'Meridian Bank',        industry: 'Financial services', city: 'Lagos', country: 'Nigeria' },
  { name: 'Kestrel Freight',      industry: 'Logistics',       city: 'Kano',     country: 'Nigeria' },
  { name: 'Northwind Trading',    industry: 'Wholesale',       city: 'Ibadan',   country: 'Nigeria' },
  { name: 'Ardent Energy',        industry: 'Energy',          city: 'Warri',    country: 'Nigeria' },
  { name: 'Bellhaven Hotels',     industry: 'Hospitality',     city: 'Lagos',    country: 'Nigeria' },
  { name: 'Quillon Media',        industry: 'Media',           city: 'Accra',    country: 'Ghana' },
  { name: 'Verano Agritech',      industry: 'Agriculture',     city: 'Kaduna',   country: 'Nigeria' },
  { name: 'Tessellate Studios',   industry: 'Creative',        city: 'Nairobi',  country: 'Kenya' },
];

const FIRST_NAMES = [
  'Adaeze', 'Tobi', 'Chidi', 'Ngozi', 'Emeka', 'Funke', 'Kelechi', 'Amara',
  'Segun', 'Zainab', 'Uche', 'Ifeoma', 'Bode', 'Halima', 'Obinna', 'Yewande',
  'Kwame', 'Nadia', 'Femi', 'Chiamaka',
];

const LAST_NAMES = [
  'Okafor', 'Adeyemi', 'Balogun', 'Nwosu', 'Eze', 'Danjuma', 'Oyelaran',
  'Mensah', 'Ibrahim', 'Achebe', 'Bassey', 'Olawale', 'Chukwu', 'Salami',
];

const JOB_TITLES = [
  'Operations Director', 'Head of Finance', 'Procurement Lead', 'IT Manager',
  'Chief Technology Officer', 'Programme Manager', 'Head of Digital',
  'Commercial Director', 'Facilities Manager', 'Head of Data',
];

const STAFF = [
  { first: 'Chidi',   last: 'Okafor',   title: 'Engineering Lead',      dept: 'Engineering' },
  { first: 'Ngozi',   last: 'Balogun',  title: 'Senior Engineer',       dept: 'Engineering' },
  { first: 'Emeka',   last: 'Nwosu',    title: 'Engineer',              dept: 'Engineering' },
  { first: 'Funke',   last: 'Adeyemi',  title: 'QA Engineer',           dept: 'Engineering' },
  { first: 'Kelechi', last: 'Eze',      title: 'Product Designer',      dept: 'Design' },
  { first: 'Amara',   last: 'Bassey',   title: 'Design Lead',           dept: 'Design' },
  { first: 'Segun',   last: 'Olawale',  title: 'Account Executive',     dept: 'Sales' },
  { first: 'Zainab',  last: 'Ibrahim',  title: 'Sales Manager',         dept: 'Sales' },
  { first: 'Uche',    last: 'Chukwu',   title: 'Delivery Manager',      dept: 'Delivery' },
  { first: 'Ifeoma',  last: 'Achebe',   title: 'Support Specialist',    dept: 'Support' },
  { first: 'Bode',    last: 'Salami',   title: 'Finance Analyst',       dept: 'Finance' },
];

const DEPARTMENTS = [
  ['Engineering', 'Product and platform development'],
  ['Design', 'Product and brand design'],
  ['Sales', 'Revenue and customer acquisition'],
  ['Delivery', 'Client programmes and implementation'],
  ['Support', 'Customer support and service levels'],
  ['Finance', 'Billing, payroll and reporting'],
];

const LINE_ITEMS = [
  'Implementation services', 'Platform licence — monthly', 'Discovery workshop',
  'Integration development', 'Data migration', 'Support retainer',
  'Custom reporting module', 'Training and enablement', 'Hardware — edge gateways',
  'Hosting and infrastructure', 'Design sprint', 'Security review',
];

const EXPENSE_KINDS = [
  { title: 'Payroll',                    category: 'payroll',   vendor: 'Internal',        share: 0.52 },
  { title: 'Cloud infrastructure',       category: 'software',  vendor: 'AWS',             share: 0.11 },
  { title: 'Office rent',                category: 'office',    vendor: 'Lekki Properties',share: 0.09 },
  { title: 'Contractor — engineering',   category: 'services',  vendor: 'Various',         share: 0.08 },
  { title: 'Software licences',          category: 'software',  vendor: 'Various',         share: 0.05 },
  { title: 'Marketing and events',       category: 'marketing', vendor: 'Various',         share: 0.05 },
  { title: 'Travel and accommodation',   category: 'travel',    vendor: 'Various',         share: 0.04 },
  { title: 'Utilities and internet',     category: 'utilities', vendor: 'MTN Business',    share: 0.03 },
  { title: 'Professional services',      category: 'services',  vendor: 'Adeoye & Co',     share: 0.03 },
];

const LOST_REASONS = [
  'Lost on price', 'Went with an incumbent supplier', 'Budget withdrawn',
  'Timeline could not be met', 'No decision — project shelved',
];

const TASK_VERBS = [
  'Build', 'Review', 'Migrate', 'Document', 'Test', 'Refactor', 'Design',
  'Integrate', 'Configure', 'Audit', 'Deploy', 'Investigate', 'Instrument',
];

const TASK_NOUNS = [
  'the payments endpoint', 'the reconciliation job', 'the onboarding flow',
  'the reporting schema', 'the SSO integration', 'the audit trail',
  'the notification service', 'the export pipeline', 'the search index',
  'the mobile layout', 'the permissions matrix', 'the invoice template',
  'the stock ledger', 'the client portal', 'the rate limiter',
];

/* -------------------------------------------------------------------------- */
/*  Main                                                                      */
/* -------------------------------------------------------------------------- */

const summary = {};
const note = (k, v) => { summary[k] = v; };

async function main() {
  /* ── 1. Resolve exactly one organisation ──────────────────────────────── */
  const orgs = await select('organizations', `select=*&id=eq.${TARGET_ID}`);
  const org = orgs?.[0];

  if (!org) {
    console.error(`No organisation with id ${TARGET_ID}. Set DEMO_ORG_ID.`);
    process.exit(1);
  }
  if (org.deleted_at) {
    console.error('That organisation is soft-deleted. Refusing.');
    process.exit(1);
  }

  const marked = org.settings?.demo === true;
  const nameOk = org.name === TARGET_NAME || org.name === LEGACY_NAME;

  if (!marked && !ADOPT) {
    console.error(
      `\n"${org.name}" is not marked as a demo workspace.\n\n` +
      '  This script only writes to an organisation whose settings carry\n' +
      '  { "demo": true }. To turn this one into the demo workspace, run it\n' +
      '  again with --adopt. That will stamp the marker and rename it, so it\n' +
      '  can never afterwards be mistaken for a real workspace.\n',
    );
    process.exit(1);
  }
  if (!marked && !nameOk) {
    console.error(
      `\nRefusing to adopt "${org.name}": the name does not match\n` +
      `  "${TARGET_NAME}" or "${LEGACY_NAME}". This is the last guard against\n` +
      '  adopting a real workspace by pasting the wrong id.\n',
    );
    process.exit(1);
  }

  console.log(`Target: ${org.name}  ${org.id}`);
  console.log(`        ${org.timezone} · ${org.currency}`);
  if (DRY) {
    console.log('\n--dry-run: nothing will be written.\n');
  }

  const ORG = org.id;

  /* ── 2. Mark it, unmistakably ─────────────────────────────────────────── */
  if (!DRY && !RESET) {
    await rest('PATCH', `organizations?id=eq.${ORG}`, {
      name: TARGET_NAME,
      industry: 'Development / demo data',
      settings: {
        ...(org.settings ?? {}),
        demo: true,
        demoSeededAt: iso(TODAY),
        demoSeededBy: 'scripts/seed-demo.mjs',
        demoNotice: 'Development dataset. Not a record of any real business.',
      },
    }, { Prefer: 'return=minimal' });
  }

  /* ── 3. Clear this organisation's business rows ───────────────────────── */
  /*
     Children before parents. Most foreign keys here are ON DELETE CASCADE or
     SET NULL, so the order is belt and braces rather than strictly required —
     but a seed script that depends on cascade behaviour it never states is a
     seed script that breaks silently when a constraint changes.
  */
  const WIPE_ORDER = [
    'payments', 'invoices',            // line items cascade from invoices
    'expenses',
    'crm_activities', 'deals', 'leads', 'contacts',
    'time_entries', 'tasks', 'milestones', 'projects',
    'support_tickets',
    'stock_movements', 'products', 'suppliers', 'warehouses',
    'calendar_events', 'activity_log', 'notifications',
    'leave_requests',
    'companies',
  ];

  if (!DRY) {
    console.log('\nClearing existing demo rows…');
    for (const table of WIPE_ORDER) {
      try {
        await wipe(table, ORG);
        process.stdout.write(`  ${table} `);
      } catch (e) {
        console.log(`\n  ! ${table}: ${e.message.slice(0, 120)}`);
      }
    }
    console.log('\n');
  }

  /* ── 3b. `--reset` stops here, having also removed its own people ─────── */
  if (RESET) {
    await removeSeededPeople(ORG);
    await rest('PATCH', `organizations?id=eq.${ORG}`, {
      name: LEGACY_NAME,
      industry: null,
      /*
        The demo marker stays. It is not business data — it is the flag this
        script checks before it will write anything, and removing it would mean
        the next run had to `--adopt` a workspace again, which is the one step
        that exists to be deliberate rather than routine.
      */
      settings: {
        ...(org.settings ?? {}),
        demo: true,
        demoSeededAt: null,
        demoSeededBy: 'scripts/seed-demo.mjs',
        demoNotice: 'Demo workspace. Currently empty — seed with npm run seed:demo.',
      },
    }, { Prefer: 'return=minimal' });

    /* Prove it rather than announce it. */
    console.log('What remains:');
    for (const t of ['companies', 'deals', 'projects', 'tasks', 'invoices', 'payments',
      'expenses', 'support_tickets', 'products', 'activity_log', 'calendar_events',
      'organization_members', 'departments']) {
      const r = await rest('GET', `${t}?select=id&organization_id=eq.${ORG}`, undefined, {
        Prefer: 'count=exact', Range: '0-0',
      }).catch(() => null);
      const n = (r?.__count ?? null);
      const rows = await select(t, `select=id&organization_id=eq.${ORG}`);
      console.log(`  ${t.padEnd(22)} ${rows.length}`);
    }
    console.log(`\n"${LEGACY_NAME}" holds no business data. Its owner, its real`);
    console.log('members and its departments are untouched.');
    return;
  }

  /* ── 4. People ────────────────────────────────────────────────────────── */
  const members = await select(
    'organization_members',
    `select=id,user_id,role,is_active&organization_id=eq.${ORG}&is_active=eq.true`,
  );
  const owner = members.find(m => m.role === 'owner');
  if (!owner) {
    console.error('No active owner on that organisation. Refusing.');
    process.exit(1);
  }

  const departments = await ensureDepartments(ORG);
  const staff = DRY ? [] : await ensureStaff(ORG, departments);

  /*
    Deduplicated, and the owner is deliberately first.

    `ensureStaff` reuses memberships on a re-run rather than creating new ones
    — memberships are never deleted in this product — so on the second run the
    same rows arrive both from the membership query above and from `staff`,
    and `project_members` has a UNIQUE (project_id, member_id).

    `team[0]` being the owner is relied on further down: it is who approves an
    expense, records a payment, and owns the tasks that make the signed-in
    user's own queue non-empty.
  */
  const team = [...new Map(
    [owner, ...members.filter(m => m.id !== owner.id), ...staff].map(m => [m.id, m]),
  ).values()];
  note('members', team.length);

  if (DRY) {
    console.log('Dry run complete — resolved the target and stopped.');
    return;
  }

  /* ── 5. Customers ─────────────────────────────────────────────────────── */
  const companies = await insert('companies', CLIENTS.map((c, i) => ({
    organization_id: ORG,
    name: c.name,
    industry: c.industry,
    city: c.city,
    country: c.country,
    email: `hello@${c.name.toLowerCase().replace(/[^a-z]+/g, '')}.example`,
    website: `https://${c.name.toLowerCase().replace(/[^a-z]+/g, '')}.example`,
    employee_count: intBetween(20, 2400),
    annual_revenue: Math.round(between(80, 4200)) * 1_000_000,
    owner_id: team[i % team.length].id,
    notes: 'Development data.',
    created_at: iso(dateIn(MONTHS[Math.min(11, Math.floor(i / 2))], 0.3)),
  })));
  note('companies', companies.length);

  const contacts = await insert('contacts', companies.flatMap((co, i) => (
    Array.from({ length: intBetween(1, 3) }, () => ({
      organization_id: ORG,
      company_id: co.id,
      first_name: pick(FIRST_NAMES),
      last_name: pick(LAST_NAMES),
      email: `${pick(FIRST_NAMES).toLowerCase()}.${pick(LAST_NAMES).toLowerCase()}@example.test`,
      phone: `+234 80${intBetween(10, 99)} ${intBetween(100, 999)} ${intBetween(1000, 9999)}`,
      job_title: pick(JOB_TITLES),
      source: pick(['referral', 'inbound', 'event', 'outbound']),
      owner_id: team[i % team.length].id,
    }))
  )));
  note('contacts', contacts.length);

  /* ── 6. Finance — the spine of the whole page ─────────────────────────── */
  const finance = await seedFinance(ORG, team, companies, departments);
  Object.assign(summary, finance);

  /* ── 7. Delivery ──────────────────────────────────────────────────────── */
  const delivery = await seedProjects(ORG, team, companies, departments);
  Object.assign(summary, delivery);

  /* ── 8. Pipeline ──────────────────────────────────────────────────────── */
  const crm = await seedCrm(ORG, team, companies, contacts);
  Object.assign(summary, crm);

  /* ── 9. Service, stock, calendar, approvals ───────────────────────────── */
  Object.assign(summary, await seedSupport(ORG, team, contacts));
  Object.assign(summary, await seedInventory(ORG));
  Object.assign(summary, await seedCalendar(ORG, team, companies));
  Object.assign(summary, await seedLeave(ORG, team));

  /* ── 10. What happened ────────────────────────────────────────────────── */
  Object.assign(summary, await seedActivity(ORG, team, {
    ...finance, ...delivery, ...crm,
  }));

  /* ── 11. Settle the notifications the seeding itself produced ─────────── */
  Object.assign(summary, await settleNotifications(ORG, team));

  /* ── 12. Report ───────────────────────────────────────────────────────── */
  console.log('\nSeeded:');
  for (const [k, v] of Object.entries(summary)) {
    console.log(`  ${String(k).padEnd(22)} ${v}`);
  }

  const monthly = await select(
    'v_finance_monthly',
    `select=period,revenue,invoiced,expenses,net&organization_id=eq.${ORG}&order=period.asc`,
  );
  console.log('\nWhat the finance view now reports:');
  console.log('  period      invoiced        collected       spend           net');
  for (const m of monthly) {
    const f = n => ('₦' + Number(n).toLocaleString('en-NG')).padEnd(15);
    console.log(`  ${m.period}  ${f(m.invoiced)} ${f(m.revenue)} ${f(m.expenses)} ${f(m.net)}`);
  }
}

/* -------------------------------------------------------------------------- */
/*  Departments and staff                                                     */
/* -------------------------------------------------------------------------- */

async function ensureDepartments(ORG) {
  const existing = await select('departments', `select=id,name&organization_id=eq.${ORG}`);
  const byName = new Map(existing.map(d => [d.name, d]));
  const missing = DEPARTMENTS.filter(([name]) => !byName.has(name));

  if (missing.length && !DRY) {
    const made = await insert('departments', missing.map(([name, description]) => ({
      organization_id: ORG, name, description,
    })));
    made.forEach(d => byName.set(d.name, d));
  }
  return byName;
}

/**
 * Colleagues, as records rather than as logins.
 *
 * `profiles.id` stopped referencing `auth.users` in migration 0025 — the
 * comment there is explicit that a profile outlives its auth identity, because
 * "who was member 4f2c…" has to stay answerable. That makes a profile without
 * an auth row a state the schema already models, and it is the right one for
 * demo staff: they appear in the directory, own deals, are assigned tasks and
 * approve nothing, and **nobody can sign in as them**, which is a smaller
 * surface than eleven real accounts with known passwords.
 *
 * `account_origin: 'provisioned'` is the existing enum value for a person an
 * administrator created rather than one who signed up.
 *
 * Memberships are never deleted in this product, so these are matched by email
 * and reused on a re-run rather than recreated.
 */
async function ensureStaff(ORG, departments) {
  const emails = STAFF.map(s => `${s.first}.${s.last}@northwind-demo.example`.toLowerCase());

  const existingProfiles = await select(
    'profiles',
    `select=id,email&email=in.(${emails.map(e => `"${e}"`).join(',')})`,
  );
  const byEmail = new Map(existingProfiles.map(p => [String(p.email).toLowerCase(), p]));

  const newProfiles = STAFF
    .map((s, i) => ({ s, email: emails[i] }))
    .filter(({ email }) => !byEmail.has(email))
    .map(({ s, email }) => ({
      id: crypto.randomUUID(),
      email,
      first_name: s.first,
      last_name: s.last,
      job_title: s.title,
      timezone: 'Africa/Lagos',
      account_origin: 'provisioned',
      force_password_change: true,
      is_active: true,
      last_seen_at: iso(daysAgo(intBetween(0, 3))),
    }));

  if (newProfiles.length) {
    const made = await insert('profiles', newProfiles);
    made.forEach(p => byEmail.set(String(p.email).toLowerCase(), p));
  }

  const existingMembers = await select(
    'organization_members',
    `select=id,user_id&organization_id=eq.${ORG}`,
  );
  const memberByUser = new Map(existingMembers.map(m => [m.user_id, m]));

  const newMembers = STAFF
    .map((s, i) => ({ s, profile: byEmail.get(emails[i]) }))
    .filter(({ profile }) => profile && !memberByUser.has(profile.id))
    .map(({ s, profile }) => ({
      organization_id: ORG,
      user_id: profile.id,
      role: s.dept === 'Sales' ? 'sales_staff'
        : s.dept === 'Support' ? 'support_staff'
          : s.dept === 'Finance' ? 'finance_staff'
            : 'employee',
      department_id: departments.get(s.dept)?.id ?? null,
      employment_type: 'full_time',
      hired_on: day(daysAgo(intBetween(120, 900))),
      is_active: true,
      joined_at: iso(daysAgo(intBetween(120, 900))),
    }));

  const made = newMembers.length ? await insert('organization_members', newMembers) : [];
  made.forEach(m => memberByUser.set(m.user_id, m));

  return STAFF
    .map((_, i) => byEmail.get(emails[i]))
    .filter(Boolean)
    .map(p => memberByUser.get(p.id))
    .filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/*  Finance                                                                   */
/* -------------------------------------------------------------------------- */
/**
 * Twelve months of invoices, their line items, their payments, and the spend
 * that ran alongside them.
 *
 * Nothing here writes a total or a status. The invoice rows carry a tax rate
 * and a due date; the line items carry quantities and unit prices sized so the
 * month lands near its target; `recalculate_invoice()` does the rest. What the
 * dashboard eventually shows as "collected" is therefore a sum the database
 * computed over rows a business would actually have.
 *
 * The receivables curve is not placed — it *falls out* of paying a smaller
 * share of recent months than of old ones, which is what a real ledger looks
 * like and what gives the ageing chart all five of its bands.
 */
async function seedFinance(ORG, team, companies, departments) {
  const finance = departments.get('Finance');
  const invoiceRows = [];
  const plan = [];

  MONTHS.forEach((month, mi) => {
    const shape = YEAR[mi];
    const count = month.current ? intBetween(4, 6) : intBetween(6, 10);

    // Split the month's billing across its invoices, unevenly.
    const weights = Array.from({ length: count }, () => between(0.5, 1.8));
    const total = weights.reduce((a, b) => a + b, 0);

    for (let i = 0; i < count; i++) {
      const share = weights[i] / total;
      const gross = shape.invoiced * share;
      const company = pick(companies);
      const issued = dateIn(month);
      const terms = pick([14, 21, 30, 30, 45]);
      const due = addDays(issued, terms);

      plan.push({ gross, month, mi, settled: 'unpaid' });
      invoiceRows.push({
        organization_id: ORG,
        company_id: company.id,
        status: month.current && rand() < 0.12 ? 'draft' : 'sent',
        issue_date: day(issued),
        due_date: day(due),
        tax_rate: TAX_RATE,
        owner_id: team[intBetween(0, team.length - 1)].id,
        notes: 'Development data.',
        created_at: iso(issued),
      });
    }
  });

  /*
    ── Deciding what has been paid ─────────────────────────────────────────

    The first version decided per invoice — "pay the first 88% of them" —
    which cannot express 88% of anything when a month has eight invoices in
    it. Every ratio above 1 − 1/n rounded to fully collected, so seven of the
    twelve months came out at exactly 100% however carefully the targets had
    been chosen. This walks each month by *value* instead.

    ── What that can and cannot control ────────────────────────────────────

    `v_finance_monthly.revenue` is `sum(total) FILTER (WHERE status = 'paid')`
    — the whole invoice, once it is settled, and **nothing at all before
    that**. A part payment moves `amount_paid`, and moves the invoice into
    `partially_paid`, and contributes zero to the revenue line.

    So this walk controls two different things with two different precisions,
    and it is worth being clear about which is which:

      · `amount_paid` per month lands on the target to the naira, because the
        part payment closes whatever the whole invoices could not;
      · the *collected* figure the chart draws is quantised to whole
        invoices, because that is what the view counts. A month with ten
        invoices can express roughly tenths.

    The second is not a defect in the data — it is the view's definition, and
    the resulting curve (full collection until about five months ago, then a
    taper into the present) is exactly what a real ledger produces. The part
    payments still earn their place: they are what puts genuinely
    `partially_paid` invoices into the receivables ageing panel, which
    otherwise only ever sees all-or-nothing.
  */
  MONTHS.forEach((month, mi) => {
    const target = YEAR[mi].invoiced * YEAR[mi].collected;

    /* Smallest first. Two reasons, and the second is the important one:
       the invoices left outstanding are then the *largest* of the month,
       which is what a real receivables book looks like and what makes the
       "most overdue" list worth reading; and the invoice that straddles the
       line is always a big one, so there is room in it for a part payment
       instead of the remainder being dropped. */
    const rows = plan.filter(p => p.mi === mi).sort((a, b) => a.gross - b.gross);

    let running = 0;
    for (const row of rows) {
      if (running + row.gross <= target + 1) {
        row.settled = 'paid';
        running += row.gross;
      }
    }

    /*
      Close the remainder with part payments, largest invoice first, across as
      many as it takes.

      Two earlier versions of this both undershot. The first dropped the
      remainder entirely whenever no single invoice could absorb it — four
      million naira of silently missing revenue at a collection rate of 0.61.
      The second closed the gap on one invoice only, which fails at the *other*
      end: at 98% collected the walk pays almost everything, and the leftover
      gap can be larger than the one invoice still outstanding.
    */
    let gap = target - running;
    const outstanding = rows
      .filter(r => r.settled === 'unpaid')
      .sort((a, b) => b.gross - a.gross);

    for (const row of outstanding) {
      if (gap <= target * 0.004) break;
      // Never more than 90% of an invoice: a part payment that rounds up to
      // the total is recorded by the trigger as paid in full.
      const take = Math.min(row.gross * 0.9, gap);
      if (take < row.gross * 0.05) continue;
      row.settled = 'partial';
      row.partialAmount = take;
      gap -= take;
    }
  });

  const invoices = await insert('invoices', invoiceRows);

  /* Line items, sized so the invoice total lands on its target. */
  const lineRows = [];
  invoices.forEach((inv, i) => {
    const target = plan[i].gross / (1 + TAX_RATE / 100); // subtotal, pre-VAT
    const lines = intBetween(1, 3);
    const weights = Array.from({ length: lines }, () => between(0.6, 1.6));
    const sum = weights.reduce((a, b) => a + b, 0);

    for (let l = 0; l < lines; l++) {
      const amount = (target * weights[l]) / sum;
      const qty = pick([1, 1, 1, 2, 4, 8, 12, 20]);
      lineRows.push({
        invoice_id: inv.id,
        description: pick(LINE_ITEMS),
        quantity: qty,
        unit_price: Math.round((amount / qty) * 100) / 100,
        sort_order: l + 1,
      });
    }
  });
  await insert('invoice_line_items', lineRows, { returning: false });

  /* Read back what the trigger computed, then pay against the real totals. */
  const priced = await select(
    'invoices',
    `select=id,total,issue_date,due_date,status&organization_id=eq.${ORG}&order=issue_date.asc`,
  );
  const byId = new Map(priced.map(p => [p.id, p]));

  const paymentRows = [];
  invoices.forEach((inv, i) => {
    const p = plan[i];
    const row = byId.get(inv.id);
    if (!row || row.status === 'draft') return;
    const total = Number(row.total);
    if (total <= 0) return;

    const issued = new Date(row.issue_date);
    const dueAt = new Date(row.due_date);
    const span = Math.max(1, (dueAt - issued) / 86_400_000);
    const when = addDays(issued, Math.round(span * between(0.35, 1.15)));
    const paidAt = iso(when > TODAY ? TODAY : when);

    if (p.settled === 'paid') {
      paymentRows.push({
        organization_id: ORG,
        invoice_id: inv.id,
        amount: total,
        method: pick(['bank_transfer', 'bank_transfer', 'card', 'cash']),
        reference: `PMT-${String(i + 1).padStart(5, '0')}`,
        paid_at: paidAt,
        recorded_by: team[0].id,
      });
    } else if (p.settled === 'partial') {
      /* Scaled against the total the trigger actually computed, not against
         the target the line items were sized from — rounding on eleven line
         items is small but it is not nothing, and a payment larger than the
         invoice would be recorded as fully paid. */
      const amount = Math.min(
        total * 0.95,
        Math.round((p.partialAmount / p.gross) * total * 100) / 100,
      );
      if (amount > 0) {
        paymentRows.push({
          organization_id: ORG,
          invoice_id: inv.id,
          amount,
          method: 'bank_transfer',
          reference: `PMT-${String(i + 1).padStart(5, '0')}-A`,
          paid_at: paidAt,
          recorded_by: team[0].id,
        });
      }
    }
  });
  await insert('payments', paymentRows, { returning: false });

  /* ── Spend ─────────────────────────────────────────────────────────────
     One row per category per month, so the totals are made of things a
     business actually buys rather than of one number called "expenses".
     Approved by the owner and submitted by somebody else: the schema's
     `expense_decision_attributed` check wants an approver, and
     `prevent_expense_self_approval` wants it to be a different person. */
  const expenseRows = [];
  MONTHS.forEach((month, mi) => {
    const shape = YEAR[mi];
    for (const kind of EXPENSE_KINDS) {
      const amount = shape.spend * kind.share * between(0.86, 1.14);
      const when = dateIn(month);
      const submitter = team[intBetween(1, team.length - 1)] ?? team[0];

      /*
        The running month keeps a few claims unapproved, which is what puts a
        real "expenses awaiting approval" item in the attention queue.

        Payroll and rent are excluded: they are standing commitments that go
        out whether or not anyone clicks approve, and leaving them pending
        removed sixty per cent of the current month's spend from the chart —
        so August drew a suspiciously cheap month and a positive net position
        that the business had not actually earned.
      */
      const discretionary = !['payroll', 'office'].includes(kind.category);
      const pending = month.current && discretionary && rand() < 0.5;

      expenseRows.push({
        organization_id: ORG,
        title: `${kind.title} — ${month.label}`,
        amount: Math.round(amount * 100) / 100,
        currency: 'NGN',
        category: kind.category,
        vendor: kind.vendor,
        expense_date: day(when),
        status: pending ? 'pending' : pick(['approved', 'approved', 'approved', 'reimbursed']),
        department_id: departments.get(pick(['Engineering', 'Sales', 'Finance', 'Delivery']))?.id
          ?? finance?.id ?? null,
        submitted_by: submitter.id,
        approved_by: pending ? null : team[0].id,
        decided_at: pending ? null : iso(addDays(when, intBetween(1, 6))),
        notes: 'Development data.',
        created_at: iso(when),
      });
    }
  });
  await insert('expenses', expenseRows, { returning: false });

  return {
    invoices: invoices.length,
    invoice_line_items: lineRows.length,
    payments: paymentRows.length,
    expenses: expenseRows.length,
  };
}

/* -------------------------------------------------------------------------- */
/*  Projects, milestones, tasks                                               */
/* -------------------------------------------------------------------------- */
/**
 * `v_project_health` decides risk, and it decides it from four things:
 * a past end date, an overdue task, an overdue milestone, or a blocked task.
 * A project is only "on track" when it has none of them.
 *
 * So the mix below is expressed the way the view reads it. A project that is
 * meant to look healthy is given a future end date and no overdue or blocked
 * work; one meant to look at risk is given the specific condition that earns
 * that verdict. Nothing sets a status field to "at risk" — there is no such
 * field, and inventing one would be exactly the fake intelligence this dataset
 * is supposed to avoid.
 *
 * Progress is a blend of milestone credit (weight 50) and task execution
 * (weight 30), so the completed-milestone and completed-task counts are chosen
 * to land near the intended figure rather than the figure being written down.
 */
const PROJECT_PLAN = [
  { name: 'Corvo patient portal',        client: 'Corvo Health',        status: 'active',    priority: 'critical', endIn: -11, milestones: 5, done: 3, tasks: 22, complete: 12, overdue: 2, blocked: 1 },
  { name: 'Halden telemetry platform',   client: 'Halden Logistics',    status: 'active',    priority: 'high',     endIn: 19,  milestones: 6, done: 2, tasks: 26, complete: 9,  overdue: 3, blocked: 0 },
  { name: 'Meridian data migration',     client: 'Meridian Bank',       status: 'active',    priority: 'high',     endIn: 41,  milestones: 5, done: 4, tasks: 24, complete: 18, overdue: 0, blocked: 0 },
  { name: 'Pallas POS integration',      client: 'Pallas Retail Group', status: 'active',    priority: 'medium',   endIn: 63,  milestones: 4, done: 2, tasks: 18, complete: 10, overdue: 0, blocked: 0 },
  { name: 'Kestrel fleet dashboard',     client: 'Kestrel Freight',     status: 'active',    priority: 'high',     endIn: 12,  milestones: 5, done: 4, tasks: 20, complete: 17, overdue: 0, blocked: 0 },
  { name: 'Sable commerce refresh',      client: 'Sable & Finch',       status: 'active',    priority: 'medium',   endIn: 88,  milestones: 6, done: 1, tasks: 22, complete: 5,  overdue: 0, blocked: 0 },
  { name: 'Internal design system',      client: null,                  status: 'active',    priority: 'low',      endIn: 34,  milestones: 4, done: 1, tasks: 16, complete: 5,  overdue: 1, blocked: 2 },
  { name: 'Ardent field reporting',      client: 'Ardent Energy',       status: 'active',    priority: 'medium',   endIn: 7,   milestones: 4, done: 3, tasks: 15, complete: 12, overdue: 0, blocked: 0 },
  { name: 'Bellhaven booking engine',    client: 'Bellhaven Hotels',    status: 'planning',  priority: 'medium',   endIn: 120, milestones: 3, done: 0, tasks: 6,  complete: 0,  overdue: 0, blocked: 0 },
  { name: 'Verano yield analytics',      client: 'Verano Agritech',     status: 'planning',  priority: 'low',      endIn: 150, milestones: 3, done: 0, tasks: 5,  complete: 0,  overdue: 0, blocked: 0 },
  { name: 'Quillon media pipeline',      client: 'Quillon Media',       status: 'on_hold',   priority: 'low',      endIn: 60,  milestones: 4, done: 1, tasks: 10, complete: 3,  overdue: 0, blocked: 1 },
  { name: 'Northwind stock sync',        client: 'Northwind Trading',   status: 'completed', priority: 'medium',   endIn: -46, milestones: 4, done: 4, tasks: 19, complete: 19, overdue: 0, blocked: 0 },
  { name: 'Tessellate brand system',     client: 'Tessellate Studios',  status: 'completed', priority: 'low',      endIn: -92, milestones: 3, done: 3, tasks: 14, complete: 14, overdue: 0, blocked: 0 },
  { name: 'Meridian card programme',     client: 'Meridian Bank',       status: 'completed', priority: 'high',     endIn: -141, milestones: 5, done: 5, tasks: 27, complete: 27, overdue: 0, blocked: 0 },
  { name: 'Pallas loyalty pilot',        client: 'Pallas Retail Group', status: 'completed', priority: 'medium',   endIn: -190, milestones: 4, done: 4, tasks: 16, complete: 16, overdue: 0, blocked: 0 },
  { name: 'Corvo triage prototype',      client: 'Corvo Health',        status: 'completed', priority: 'medium',   endIn: -238, milestones: 3, done: 3, tasks: 12, complete: 12, overdue: 0, blocked: 0 },
];

const MILESTONE_NAMES = [
  'Discovery', 'Solution design', 'Foundations', 'Core build', 'Integration',
  'User testing', 'Hardening', 'Launch', 'Handover',
];

async function seedProjects(ORG, team, companies, departments) {
  const byClient = new Map(companies.map(c => [c.name, c]));
  const owner = team[0];

  const projectRows = PROJECT_PLAN.map(p => {
    const end = daysAhead(p.endIn);
    const start = addDays(end, -intBetween(90, 210));
    return {
      organization_id: ORG,
      name: p.name,
      description: 'Development data.',
      status: p.status,
      priority: p.priority,
      department_id: departments.get(pick(['Engineering', 'Design', 'Delivery']))?.id ?? null,
      owner_id: team[intBetween(0, team.length - 1)].id,
      client_company_id: p.client ? byClient.get(p.client)?.id ?? null : null,
      budget: Math.round(between(4, 45)) * 1_000_000,
      start_date: day(start),
      end_date: day(end),
      completed_at: p.status === 'completed' ? iso(end) : null,
      created_at: iso(start),
    };
  });

  const projects = await insert('projects', projectRows);

  /* Everyone on the project, so member_count is not zero everywhere. */
  await insert('project_members', projects.flatMap(pr => (
    shuffle(team).slice(0, intBetween(3, 6)).map((m, i) => ({
      project_id: pr.id,
      member_id: m.id,
      role: i === 0 ? 'lead' : 'contributor',
      allocation_pct: pick([25, 50, 50, 75, 100]),
    }))
  )), { returning: false });

  /* ── Milestones ────────────────────────────────────────────────────────
     A completed one carries `completed_at`; an unfinished one past its due
     date is what `v_project_health` reads as "off track", so only the projects
     that are meant to look that way get one. */
  const milestoneRows = [];
  projects.forEach((pr, pi) => {
    const plan = PROJECT_PLAN[pi];
    const start = new Date(pr.start_date);
    const end = new Date(pr.end_date);
    const span = Math.max(1, (end - start) / 86_400_000);

    for (let i = 0; i < plan.milestones; i++) {
      const at = addDays(start, Math.round((span * (i + 1)) / plan.milestones));
      const isDone = i < plan.done;
      /* Only projects with a deliberate overdue-milestone condition get one:
         the first unfinished milestone of an off-track project. */
      const wantsOverdue = plan.endIn < 0 && plan.status === 'active' && i === plan.done;
      milestoneRows.push({
        organization_id: ORG,
        project_id: pr.id,
        name: MILESTONE_NAMES[i % MILESTONE_NAMES.length],
        description: 'Development data.',
        due_date: day(wantsOverdue ? daysAgo(intBetween(4, 18)) : at),
        completed_at: isDone ? iso(addDays(at, -intBetween(0, 5))) : null,
        progress_pct: isDone ? 100 : i === plan.done ? intBetween(20, 70) : 0,
        sort_order: i + 1,
      });
    }
  });
  const milestones = await insert('milestones', milestoneRows);

  const milestonesByProject = new Map();
  milestones.forEach(m => {
    if (!milestonesByProject.has(m.project_id)) milestonesByProject.set(m.project_id, []);
    milestonesByProject.get(m.project_id).push(m);
  });

  /* ── Tasks ─────────────────────────────────────────────────────────────
     Completion timestamps are spread to match `COMPLETIONS_BY_WEEK`, because
     the work chart buckets `completed_at` into eight Monday-anchored weeks and
     a flat spread would draw a flat chart. Anything older than that goes
     further back, so the totals are not all crammed into the visible window.

     `due_date` is what makes a task overdue — status alone does not — so the
     overdue counts per project are produced by giving that many unfinished
     tasks a date in the past, and no others. */
  const taskRows = [];

  // The completions the chart will show, as a pool of dates to hand out.
  const recentCompletionDates = [];
  COMPLETIONS_BY_WEEK.forEach((n, w) => {
    const weeksBack = COMPLETIONS_BY_WEEK.length - 1 - w;
    for (let i = 0; i < n; i++) {
      const base = daysAgo(weeksBack * 7);
      // Monday-anchored week, weekdays only, and never in the future.
      const monday = addDays(base, -((base.getUTCDay() + 6) % 7));
      const when = addDays(monday, intBetween(0, 4));
      recentCompletionDates.push(when > TODAY ? daysAgo(intBetween(0, 2)) : when);
    }
  });
  const completionPool = shuffle(recentCompletionDates);
  let poolAt = 0;

  projects.forEach((pr, pi) => {
    const plan = PROJECT_PLAN[pi];
    const ms = milestonesByProject.get(pr.id) ?? [];
    const start = new Date(pr.start_date);
    const end = new Date(pr.end_date);

    for (let i = 0; i < plan.tasks; i++) {
      const done = i < plan.complete;
      const remaining = i - plan.complete;
      const isOverdue = !done && remaining < plan.overdue;
      const isBlocked = !done && remaining >= plan.overdue && remaining < plan.overdue + plan.blocked;

      let status;
      if (done) status = 'done';
      else if (isBlocked) status = 'blocked';
      else status = pick(['todo', 'todo', 'in_progress', 'in_progress', 'review']);

      let completedAt = null;
      if (done) {
        if (poolAt < completionPool.length && pr.status === 'active' && rand() < 0.72) {
          completedAt = completionPool[poolAt++];
        } else {
          const s = Math.max(start.getTime(), daysAgo(330).getTime());
          const e = Math.min(end.getTime(), TODAY.getTime());
          completedAt = new Date(s + (Math.max(0, e - s)) * between(0.05, 0.95));
        }
      }

      const dueDate = isOverdue
        ? daysAgo(intBetween(2, 21))
        : done
          ? completedAt
          : daysAhead(intBetween(1, 60));

      taskRows.push({
        organization_id: ORG,
        project_id: pr.id,
        milestone_id: ms.length ? ms[Math.min(ms.length - 1, Math.floor((i / plan.tasks) * ms.length))].id : null,
        title: `${pick(TASK_VERBS)} ${pick(TASK_NOUNS)}`,
        description: 'Development data.',
        status,
        priority: pick(['low', 'medium', 'medium', 'high', 'critical']),
        assignee_id: team[intBetween(0, team.length - 1)].id,
        reporter_id: team[intBetween(0, team.length - 1)].id,
        due_date: day(dueDate),
        estimated_hours: pick([2, 4, 6, 8, 12, 16, 24]),
        logged_hours: done ? pick([2, 3, 5, 8, 10, 14]) : pick([0, 0, 1, 2, 4]),
        sort_order: i,
        completed_at: completedAt ? iso(completedAt) : null,
        created_at: iso(addDays(start, intBetween(0, 20))),
      });
    }
  });

  /*
    The signed-in owner's own desk.

    "Your open work", "Your next tasks" and the personal half of the attention
    queue all read tasks assigned to the caller, so a handful are reassigned to
    the owner deliberately — three of them overdue, which is what the queue is
    meant to raise as critical.
  */
  const ownerId = team[0].id;
  const openTasks = taskRows.filter(t => t.status !== 'done');
  shuffle(openTasks).slice(0, 8).forEach(t => { t.assignee_id = ownerId; });
  shuffle(openTasks.filter(t => t.assignee_id === ownerId)).slice(0, 3).forEach(t => {
    t.due_date = day(daysAgo(intBetween(2, 12)));
  });

  await insert('tasks', taskRows, { returning: false });

  return {
    projects: projects.length,
    milestones: milestoneRows.length,
    tasks: taskRows.length,
    tasks_done: taskRows.filter(t => t.status === 'done').length,
  };
}

/* -------------------------------------------------------------------------- */
/*  CRM                                                                       */
/* -------------------------------------------------------------------------- */
/**
 * A book with a past and a present.
 *
 * Won and lost deals carry `closed_at`, which is what makes a win rate and
 * "won this month" real rather than decorative. Open deals sit in the four
 * live stages with values that rise as they approach the close, which is how a
 * pipeline actually looks — and four of them are INSERTed with an old
 * `updated_at`, because "gone quiet" means nobody has touched the record in
 * thirty days and `trg_set_updated_at` would overwrite any attempt to age one
 * with a PATCH.
 */
async function seedCrm(ORG, team, companies, contacts) {
  const dealRows = [];
  const contactsByCompany = new Map();
  contacts.forEach(c => {
    if (!contactsByCompany.has(c.company_id)) contactsByCompany.set(c.company_id, []);
    contactsByCompany.get(c.company_id).push(c);
  });

  const dealName = co => `${co.name} - ${pick([
    'platform rollout', 'integration phase 2', 'support retainer',
    'data migration', 'analytics module', 'hardware refresh',
    'portal build', 'licence renewal', 'discovery engagement',
  ])}`;

  /* Closed business, spread across the year. */
  for (let m = 0; m < 12; m++) {
    const wins = m === 11 ? 2 : intBetween(1, 3);
    const losses = intBetween(0, 2);

    for (let i = 0; i < wins; i++) {
      const co = pick(companies);
      const when = dateIn(MONTHS[m]);
      dealRows.push({
        organization_id: ORG,
        name: dealName(co),
        company_id: co.id,
        contact_id: pick(contactsByCompany.get(co.id) ?? contacts)?.id ?? null,
        stage: 'closed_won',
        value: Math.round(between(1.2, 14)) * 1_000_000,
        probability: 100,
        expected_close: day(when),
        closed_at: iso(when),
        owner_id: team[intBetween(0, team.length - 1)].id,
        notes: 'Development data.',
        created_at: iso(addDays(when, -intBetween(30, 120))),
        updated_at: iso(when),
      });
    }
    for (let i = 0; i < losses; i++) {
      const co = pick(companies);
      const when = dateIn(MONTHS[m]);
      dealRows.push({
        organization_id: ORG,
        name: dealName(co),
        company_id: co.id,
        contact_id: null,
        stage: 'closed_lost',
        value: Math.round(between(0.8, 9)) * 1_000_000,
        probability: 0,
        expected_close: day(when),
        closed_at: iso(when),
        lost_reason: pick(LOST_REASONS),
        owner_id: team[intBetween(0, team.length - 1)].id,
        notes: 'Development data.',
        created_at: iso(addDays(when, -intBetween(30, 120))),
        updated_at: iso(when),
      });
    }
  }

  /* The open book: fewer deals as the stage gets later, and bigger ones. */
  const OPEN = [
    { stage: 'prospecting',   count: 6, prob: [10, 25], value: [1.5, 8] },
    { stage: 'qualification', count: 5, prob: [25, 45], value: [2, 12] },
    { stage: 'proposal',      count: 5, prob: [45, 65], value: [3, 18] },
    { stage: 'negotiation',   count: 3, prob: [65, 85], value: [6, 26] },
  ];

  const openDeals = [];
  for (const band of OPEN) {
    for (let i = 0; i < band.count; i++) {
      const co = pick(companies);
      const created = daysAgo(intBetween(10, 150));
      openDeals.push({
        organization_id: ORG,
        name: dealName(co),
        company_id: co.id,
        contact_id: pick(contactsByCompany.get(co.id) ?? contacts)?.id ?? null,
        stage: band.stage,
        value: Math.round(between(band.value[0], band.value[1]) * 10) / 10 * 1_000_000,
        probability: intBetween(band.prob[0], band.prob[1]),
        expected_close: day(daysAhead(intBetween(5, 120))),
        closed_at: null,
        owner_id: team[intBetween(0, team.length - 1)].id,
        notes: 'Development data.',
        created_at: iso(created),
        updated_at: iso(daysAgo(intBetween(1, 20))),
      });
    }
  }

  /* Three closing inside the current month, so the forecast has a near term. */
  shuffle(openDeals).slice(0, 3).forEach(d => {
    d.expected_close = day(new Date(Math.min(
      MONTHS[11].end.getTime(),
      daysAhead(intBetween(1, 20)).getTime(),
    )));
  });

  /* Four that nobody has touched in over a month — inserted, never updated. */
  shuffle(openDeals).slice(0, 4).forEach(d => {
    d.updated_at = iso(daysAgo(intBetween(34, 75)));
  });

  dealRows.push(...openDeals);
  const deals = await insert('deals', dealRows);

  /* Leads, in every state the funnel has. */
  const leadRows = Array.from({ length: 38 }, () => {
    const created = daysAgo(intBetween(1, 300));
    const status = pick([
      'new', 'new', 'new', 'contacted', 'contacted', 'contacted',
      'qualified', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'lost',
    ]);
    return {
      organization_id: ORG,
      first_name: pick(FIRST_NAMES),
      last_name: pick(LAST_NAMES),
      email: `${pick(FIRST_NAMES).toLowerCase()}${intBetween(1, 99)}@example.test`,
      phone: `+234 81${intBetween(10, 99)} ${intBetween(100, 999)} ${intBetween(1000, 9999)}`,
      company_name: pick(CLIENTS).name,
      job_title: pick(JOB_TITLES),
      source: pick(['website', 'referral', 'event', 'outbound', 'partner']),
      status,
      score: intBetween(15, 96),
      estimated_value: Math.round(between(0.4, 12)) * 1_000_000,
      owner_id: team[intBetween(0, team.length - 1)].id,
      notes: 'Development data.',
      created_at: iso(created),
      updated_at: iso(addDays(created, intBetween(0, 20))),
    };
  });
  await insert('leads', leadRows, { returning: false });

  /* The customer timeline, so a company record is not an empty page. */
  const crmRows = shuffle(deals).slice(0, 46).map(d => {
    const when = daysAgo(intBetween(1, 120));
    return {
      organization_id: ORG,
      activity_type: pick(['call', 'email', 'meeting', 'note']),
      subject: pick([
        'Discovery call', 'Commercial review', 'Technical deep dive',
        'Proposal walkthrough', 'Follow-up', 'Contract review', 'Quarterly check-in',
      ]),
      body: 'Development data.',
      company_id: d.company_id,
      deal_id: d.id,
      member_id: team[intBetween(0, team.length - 1)].id,
      created_at: iso(when),
    };
  });
  await insert('crm_activities', crmRows, { returning: false }).catch(() => {});

  return { deals: dealRows.length, leads: leadRows.length, crm_activities: crmRows.length };
}

/* -------------------------------------------------------------------------- */
/*  Support                                                                   */
/* -------------------------------------------------------------------------- */
/**
 * `due_at` is the SLA target and the trigger only fills it when it is NULL, so
 * a ticket that has genuinely breached is created by handing it a deadline in
 * the past — not by setting a flag. The dashboard's "past the response
 * deadline" count is then a real comparison against a real clock.
 */
const TICKET_SUBJECTS = [
  'SSO redirect loop on staging', 'Invoice PDF shows the wrong VAT',
  'Fleet map not loading for depot 4', 'Export times out over 50k rows',
  'Stock count mismatch after transfer', 'Password reset email not arriving',
  'Dashboard chart empty on Safari', 'API returns 500 on bulk update',
  'Attendance clock-in off by an hour', 'Duplicate notification on assignment',
  'Client portal shows archived files', 'Search misses recent records',
  'Timesheet export missing columns', 'Webhook retries never stop',
  'Mobile layout clipped on small screens', 'Rate limit hit during import',
];

async function seedSupport(ORG, team, contacts) {
  const rows = [];

  /* Resolved history, so "resolved this month" and the trend are real. */
  for (let m = 0; m < 12; m++) {
    const n = m === 11 ? 5 : intBetween(1, 4);
    for (let i = 0; i < n; i++) {
      const created = dateIn(MONTHS[m]);
      const resolved = addDays(created, intBetween(1, 9));
      rows.push({
        organization_id: ORG,
        subject: pick(TICKET_SUBJECTS),
        description: 'Development data.',
        status: pick(['resolved', 'resolved', 'closed']),
        priority: pick(['low', 'medium', 'medium', 'high']),
        category: pick(['Billing', 'Platform', 'Hardware', 'Account']),
        contact_id: pick(contacts)?.id ?? null,
        assignee_id: team[intBetween(0, team.length - 1)].id,
        due_at: iso(addDays(created, 2)),
        first_response_at: iso(addDays(created, 0.4)),
        resolved_at: iso(resolved > TODAY ? TODAY : resolved),
        resolution: 'Development data.',
        created_at: iso(created),
      });
    }
  }

  /* The live queue. Five are deliberately past their deadline and one is
     critical, which is what the attention rules are written to notice. */
  const live = [
    { priority: 'high',     hoursOverdue: 122 },
    { priority: 'high',     hoursOverdue: 141 },
    { priority: 'critical', hoursOverdue: 66 },
    { priority: 'medium',   hoursOverdue: 74 },
    { priority: 'medium',   hoursOverdue: 19 },
    { priority: 'high',     hoursOverdue: -6 },
    { priority: 'medium',   hoursOverdue: -28 },
    { priority: 'low',      hoursOverdue: -71 },
    { priority: 'medium',   hoursOverdue: -95 },
  ];

  live.forEach((t, i) => {
    const created = daysAgo(intBetween(1, 9));
    rows.push({
      organization_id: ORG,
      subject: TICKET_SUBJECTS[i % TICKET_SUBJECTS.length],
      description: 'Development data.',
      status: pick(['open', 'open', 'in_progress', 'pending']),
      priority: t.priority,
      category: pick(['Billing', 'Platform', 'Hardware', 'Account']),
      contact_id: pick(contacts)?.id ?? null,
      assignee_id: team[intBetween(0, team.length - 1)].id,
      due_at: iso(new Date(TODAY.getTime() - t.hoursOverdue * 3_600_000)),
      first_response_at: null,
      resolved_at: null,
      resolution: null,
      created_at: iso(created),
    });
  });

  await insert('support_tickets', rows, { returning: false });
  return { support_tickets: rows.length };
}

/* -------------------------------------------------------------------------- */
/*  Inventory                                                                 */
/* -------------------------------------------------------------------------- */
/**
 * Stock arrives through `record_stock_movement`, not by writing `products.stock`.
 * The ledger is the source of truth and the balance is derived from it, so a
 * product seeded by hand would show a quantity its own movement history did not
 * support — which is the sort of inconsistency this dataset exists to avoid.
 */
const PRODUCTS = [
  { sku: 'NM-TRK-001', name: 'Asset tracker (indoor)',  category: 'Hardware', price: 48_000,  cost: 21_500, reorder: 40 },
  { sku: 'NM-TRK-002', name: 'Asset tracker (rugged)',  category: 'Hardware', price: 86_000,  cost: 39_000, reorder: 25 },
  { sku: 'NM-TRK-003', name: 'Antenna mast',            category: 'Hardware', price: 145_000, cost: 71_000, reorder: 12 },
  { sku: 'NM-GTW-001', name: 'Edge gateway',            category: 'Hardware', price: 320_000, cost: 148_000, reorder: 15 },
  { sku: 'NM-GTW-002', name: 'Edge gateway (LTE)',      category: 'Hardware', price: 410_000, cost: 192_000, reorder: 10 },
  { sku: 'NM-SEN-001', name: 'Temperature sensor',      category: 'Sensors',  price: 18_500,  cost: 7_400,  reorder: 120 },
  { sku: 'NM-SEN-002', name: 'Humidity sensor',         category: 'Sensors',  price: 19_800,  cost: 8_100,  reorder: 120 },
  { sku: 'NM-SEN-003', name: 'Door contact sensor',     category: 'Sensors',  price: 9_600,   cost: 3_900,  reorder: 200 },
  { sku: 'NM-POS-001', name: 'POS terminal',            category: 'Retail',   price: 265_000, cost: 128_000, reorder: 20 },
  { sku: 'NM-POS-002', name: 'Card reader',             category: 'Retail',   price: 74_000,  cost: 31_000, reorder: 30 },
  { sku: 'NM-POS-003', name: 'Receipt roll (box)',      category: 'Consumables', price: 12_400, cost: 5_200, reorder: 60 },
  { sku: 'NM-POS-004', name: 'Cash drawer',             category: 'Retail',   price: 58_000,  cost: 24_500, reorder: 18 },
  { sku: 'NM-CBL-001', name: 'Industrial cable (50m)',  category: 'Consumables', price: 34_000, cost: 15_800, reorder: 45 },
  { sku: 'NM-CBL-002', name: 'Patch lead pack',         category: 'Consumables', price: 8_900,  cost: 3_400, reorder: 150 },
  { sku: 'NM-PWR-001', name: 'Backup power unit',       category: 'Hardware', price: 198_000, cost: 92_000, reorder: 14 },
  { sku: 'NM-PWR-002', name: 'Solar charge kit',        category: 'Hardware', price: 240_000, cost: 118_000, reorder: 10 },
  { sku: 'NM-MNT-001', name: 'Wall mount bracket',      category: 'Accessories', price: 6_400, cost: 2_300, reorder: 250 },
  { sku: 'NM-MNT-002', name: 'Pole mount kit',          category: 'Accessories', price: 11_200, cost: 4_600, reorder: 180 },
];

async function seedInventory(ORG) {
  const [warehouse] = await insert('warehouses', [{
    organization_id: ORG,
    name: 'Lagos Distribution Centre',
    location: 'Oregun, Lagos',
    capacity: 24_000,
  }]);

  const suppliers = await insert('suppliers', [
    { organization_id: ORG, name: 'Ardent Components', contact_name: 'Bode Salami', email: 'orders@ardentcomp.example', lead_time_days: 21, city: 'Lagos', country: 'Nigeria' },
    { organization_id: ORG, name: 'Kestrel Industrial', contact_name: 'Nadia Mensah', email: 'supply@kestrelind.example', lead_time_days: 14, city: 'Accra', country: 'Ghana' },
  ]);

  const products = await insert('products', PRODUCTS.map(p => ({
    organization_id: ORG,
    sku: p.sku,
    name: p.name,
    category: p.category,
    unit: 'unit',
    price: p.price,
    cost: p.cost,
    reorder_level: p.reorder,
    warehouse_id: warehouse?.id ?? null,
    supplier_id: pick(suppliers)?.id ?? null,
    is_active: true,
  })));

  /*
     Three below their reorder point and two at zero, so the stock panel and
     the attention queue both have something true to report. Everything else
     sits comfortably above. The receipts and issues are separate movements so
     the ledger reads like a history rather than an opening balance.
  */
  const SHORT = new Set(['NM-TRK-003', 'NM-POS-002', 'NM-CBL-001']);
  const OUT = new Set(['NM-POS-003', 'NM-SEN-003']);

  /*
    ── Why this does not call `record_stock_movement` ─────────────────────

    That function is the right way to move stock, and it is what the
    application calls. It is also `SECURITY DEFINER` with
    `IF NOT public.is_org_member(org) THEN RAISE` at the top, and
    `is_org_member` resolves through `auth.uid()` — which is null for the
    service key. A seed run has no session, so the RPC refuses it. Signing the
    script in as the owner to get one would mean a password in a checked-in
    file, which is a worse trade than this.

    So the two statements the function performs are performed here instead,
    with the same invariant: every movement carries the running balance after
    it, and `products.stock` ends equal to the last one. The ledger and the
    balance cannot disagree, which is the only thing the function was
    protecting.
  */
  const movements = [];
  const balances = [];

  for (const p of products) {
    const spec = PRODUCTS.find(x => x.sku === p.sku);
    const target = OUT.has(p.sku) ? 0
      : SHORT.has(p.sku) ? Math.max(1, Math.round(spec.reorder * between(0.2, 0.7)))
        : Math.round(spec.reorder * between(1.6, 4.2));

    let balance = 0;
    const history = [];

    // Two or three receipts over the year, then issues that draw it down.
    const receipts = intBetween(2, 3);
    let received = 0;
    for (let i = 0; i < receipts; i++) {
      const qty = Math.max(4, Math.round((target + intBetween(30, 140)) / receipts));
      received += qty;
      history.push({ qty, type: 'receipt', reason: i === 0 ? 'Opening stock' : 'Restock', at: dateIn(MONTHS[i * 4]) });
    }

    // Issues, in a few tranches, ending exactly on the target balance.
    let toIssue = received - target;
    const tranches = Math.max(1, Math.min(5, Math.round(toIssue / Math.max(1, target || 20))));
    for (let i = 0; i < tranches && toIssue > 0; i++) {
      const qty = i === tranches - 1 ? toIssue : Math.max(1, Math.round(toIssue / (tranches - i)));
      toIssue -= qty;
      history.push({ qty: -qty, type: 'issue', reason: 'Customer shipment', at: dateIn(MONTHS[intBetween(4, 11)]) });
    }

    history.sort((a, b) => a.at - b.at);
    for (const h of history) {
      balance += h.qty;
      movements.push({
        organization_id: ORG,
        product_id: p.id,
        type: h.type,
        quantity: h.qty,
        balance_after: balance,
        reason: h.reason,
        reference: 'SEED',
        member_id: null,
        created_at: iso(h.at),
      });
    }
    balances.push({ id: p.id, stock: balance });
  }

  await insert('stock_movements', movements, { returning: false });
  for (const b of balances) {
    await rest('PATCH', `products?id=eq.${b.id}&organization_id=eq.${ORG}`,
      { stock: b.stock }, { Prefer: 'return=minimal' });
  }

  return {
    products: products.length,
    stock_movements: movements.length,
    warehouses: 1,
    suppliers: suppliers.length,
  };
}

/* -------------------------------------------------------------------------- */
/*  Calendar                                                                  */
/* -------------------------------------------------------------------------- */

async function seedCalendar(ORG, team, companies) {
  const at = (dayOffset, hour, minutes = 0) => {
    const d = addDays(TODAY, dayOffset);
    d.setUTCHours(hour, minutes, 0, 0);
    return d;
  };

  const spec = [
    [0, 9, 30, 'Delivery stand-up', 'Studio floor 2', 45],
    [0, 11, 0, 'Corvo portal — clinical review', 'Lagos (remote)', 60],
    [0, 14, 0, 'Halden telemetry — steering', 'Meet — Delivery', 60],
    [0, 16, 30, 'Design system critique', 'Studio floor 2', 45],
    [1, 10, 0, 'Meridian migration workshop', 'Meridian, Lagos', 120],
    [1, 15, 0, 'Pipeline review — August close', 'Boardroom', 60],
    [2, 9, 0, 'Pallas POS — go-live readiness', 'Meet — Pallas', 90],
    [3, 11, 30, 'Quarterly business review', 'Boardroom', 120],
    [4, 10, 0, 'Kestrel dashboard handover', 'Meet — Kestrel', 60],
    [5, 13, 0, 'Sable commerce — discovery', 'Meet — Sable', 90],
    [6, 9, 30, 'Sprint planning', 'Studio floor 2', 60],
  ];

  const rows = spec.map(([d, h, m, title, location, mins]) => ({
    organization_id: ORG,
    title,
    description: 'Development data.',
    starts_at: iso(at(d, h, m)),
    ends_at: iso(new Date(at(d, h, m).getTime() + mins * 60_000)),
    all_day: false,
    location,
    colour: pick(['#2d9572', '#2c6fa7', '#d4a93f', '#b8730a']),
    visibility: 'organization',
    created_by: team[intBetween(0, team.length - 1)].id,
  }));

  await insert('calendar_events', rows, { returning: false });
  return { calendar_events: rows.length };
}

/* -------------------------------------------------------------------------- */
/*  Leave                                                                     */
/* -------------------------------------------------------------------------- */

async function seedLeave(ORG, team) {
  const rows = shuffle(team.slice(1)).slice(0, 3).map(m => {
    const start = daysAhead(intBetween(6, 40));
    return {
      organization_id: ORG,
      member_id: m.id,
      type: pick(['vacation', 'personal', 'sick']),
      start_date: day(start),
      end_date: day(addDays(start, intBetween(1, 9))),
      status: 'pending',
      days_requested: intBetween(1, 9),
      reason: 'Development data.',
      created_at: iso(daysAgo(intBetween(1, 9))),
    };
  });

  await insert('leave_requests', rows, { returning: false }).catch(() => {});
  return { leave_requests: rows.length };
}

/* -------------------------------------------------------------------------- */
/*  Activity                                                                  */
/* -------------------------------------------------------------------------- */
/**
 * The feed the dashboard reads is `activity_log`, and it is written by the
 * application rather than by a trigger — so it has to be written here too, or
 * a workspace that has plainly been busy for a year shows nothing under "what
 * changed". Every row points at a record that exists, because the panel opens
 * the entity it names and a feed of dead links is worse than an empty one.
 */
async function seedActivity(ORG, team) {
  const [projects, deals, invoices, tickets] = await Promise.all([
    select('projects', `select=id,name&organization_id=eq.${ORG}`),
    select('deals', `select=id,name,stage&organization_id=eq.${ORG}`),
    select('invoices', `select=id,invoice_number,status&organization_id=eq.${ORG}&order=issue_date.desc&limit=40`),
    select('support_tickets', `select=id,subject,ticket_number&organization_id=eq.${ORG}&limit=40`),
  ]);

  const templates = [
    () => { const p = pick(projects); return p && ['projects', 'updated', `${p.name} moved to in progress`, 'project', p.id]; },
    () => { const p = pick(projects); return p && ['projects', 'created', `Milestone completed on ${p.name}`, 'project', p.id]; },
    () => { const d = pick(deals);    return d && ['crm', 'updated', `${d.name} moved to ${String(d.stage).replace('_', ' ')}`, 'deal', d.id]; },
    () => { const d = pick(deals);    return d && ['crm', 'created', `New deal — ${d.name}`, 'deal', d.id]; },
    () => { const i = pick(invoices); return i && ['finance', 'created', `Invoice ${i.invoice_number} raised`, 'invoice', i.id]; },
    () => { const i = pick(invoices); return i && ['finance', 'updated', `Payment recorded against ${i.invoice_number}`, 'invoice', i.id]; },
    () => { const t = pick(tickets);  return t && ['support', 'created', `Ticket ${t.ticket_number} — ${t.subject}`, 'ticket', t.id]; },
    () => { const t = pick(tickets);  return t && ['support', 'updated', `${t.ticket_number} assigned`, 'ticket', t.id]; },
  ];

  /* One line per event, and never the same line twice.
     The templates pick a record at random, so without this the feed printed
     "Invoice INV-000847 raised" in two different columns of the same panel —
     which reads as a rendering fault rather than as a busy week. */
  const seen = new Set();
  const rows = [];
  for (let i = 0; i < 400 && rows.length < 150; i++) {
    const made = pick(templates)();
    if (!made) continue;
    const [module, action, title, entityType, entityId] = made;
    if (seen.has(title)) continue;
    seen.add(title);
    rows.push({
      organization_id: ORG,
      member_id: team[intBetween(0, team.length - 1)].id,
      module,
      action,
      title,
      description: '',
      entity_type: entityType,
      entity_id: entityId,
      metadata: {},
      /*
        Denser in the last few days, thinning out over three weeks — and a
        fifth of it inside the last twelve hours, so the panel's newest band
        is genuinely "today". Without that the feed reads as though the
        company stopped working yesterday, because the endpoint takes the
        eighteen most recent rows and the curve alone rarely puts any of them
        in the current day.
      */
      created_at: iso(
        rand() < 0.2
          ? daysAgo(rand() * 0.5)
          : daysAgo(Math.pow(rand(), 1.6) * 20 + rand() * 0.9),
      ),
    });
  }

  await insert('activity_log', rows, { returning: false });
  return { activity_log: rows.length };
}

/* -------------------------------------------------------------------------- */
/*  Undo: the colleagues and departments this script invented                 */
/* -------------------------------------------------------------------------- */
/**
 * Removes only what `ensureStaff` and `ensureDepartments` created.
 *
 * The eleven provisioned profiles are matched on the exact
 * `@northwind-demo.example` addresses this file generates — never on a
 * pattern, never on "everyone in the org", and never on anybody who can sign
 * in. The owner and the two real `dash-demo-*` members are not in that list and
 * are not touched.
 *
 * `General` is kept: it is the department the workspace had before this script
 * ran, and the six subject departments are the ones it added.
 */
async function removeSeededPeople(ORG) {
  const emails = STAFF.map(s => `${s.first}.${s.last}@northwind-demo.example`.toLowerCase());
  const list = emails.map(e => `"${e}"`).join(',');

  const profiles = await select('profiles', `select=id,email&email=in.(${list})`);
  if (profiles.length) {
    const ids = profiles.map(p => `"${p.id}"`).join(',');
    // Memberships first: the profile FK to auth.users was dropped in 0025, but
    // organization_members still references profiles.
    await rest('DELETE', `organization_members?organization_id=eq.${ORG}&user_id=in.(${ids})`,
      undefined, { Prefer: 'return=minimal' });
    await rest('DELETE', `profiles?id=in.(${ids})`, undefined, { Prefer: 'return=minimal' });
  }

  const added = DEPARTMENTS.map(([name]) => `"${name}"`).join(',');
  await rest('DELETE', `departments?organization_id=eq.${ORG}&name=in.(${added})`,
    undefined, { Prefer: 'return=minimal' }).catch(() => {});

  console.log(`Removed ${profiles.length} provisioned colleagues and the departments this script added.`);
}

/* -------------------------------------------------------------------------- */
/*  Notifications                                                             */
/* -------------------------------------------------------------------------- */
/**
 * The inbox a year of history creates when you insert it in ten seconds.
 *
 * `trg_notify_task_assignment` and its siblings are triggers: assigning two
 * hundred and seventy tasks raises two hundred and seventy notifications, all
 * unread, all stamped with the moment the seed ran. The sidebar then showed
 * "99+" against Finance and Projects — which is not a year of accumulated
 * work, it is one INSERT statement wearing a badge.
 *
 * They are marked read rather than deleted: they are legitimate records of
 * what happened, the tray should not be empty, and an owner who has been
 * running this business for a year would have read them. Three recent ones are
 * left unread and backdated over the last few hours, so the bell has a
 * believable count and something to open.
 */
async function settleNotifications(ORG, team) {
  const all = await select(
    'notifications',
    `select=id&organization_id=eq.${ORG}&order=id.desc`,
  );
  if (!all.length) return { notifications: 0 };

  await rest('PATCH', `notifications?organization_id=eq.${ORG}`,
    { is_read: true, read_at: iso(TODAY) }, { Prefer: 'return=minimal' });

  const keep = all.slice(0, 3);
  for (const [i, n] of keep.entries()) {
    await rest('PATCH', `notifications?id=eq.${n.id}&organization_id=eq.${ORG}`, {
      is_read: false,
      read_at: null,
      created_at: iso(addDays(TODAY, -(0.05 + i * 0.12))),
      recipient_id: team[0].id,
    }, { Prefer: 'return=minimal' });
  }

  return { notifications: `${all.length} (${keep.length} left unread)` };
}

main().catch(e => {
  console.error('\nFAILED:', e.message);
  process.exit(1);
});
