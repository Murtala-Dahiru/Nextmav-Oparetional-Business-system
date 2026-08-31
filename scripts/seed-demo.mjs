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
import zlib from 'node:zlib';
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
    /*
       Communication. `message_saves`, `message_reactions` and `files` carrying
       a `message_id` all cascade from `messages`; `messages`, `channel_members`
       and `meeting_participants` cascade from their channel or meeting. The
       two parents are listed for the same reason as the rest of this list:
       depending on cascade behaviour without stating it is how a seed script
       breaks silently when a constraint changes.

       `channels` is wiped last of the three because a meeting references one.
    */
    'meetings', 'messages', 'channels',
    // Versions, shares, sheet columns, sheet rows, links, filed resources and
    // page comments all cascade from `workspace_pages`.
    'workspace_page_links', 'workspace_pages',
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

  /* -- 9b. The company's written knowledge -------------------------------- */
  Object.assign(summary, await seedWorkspace(ORG, team));

  /* -- 9b2. One face each, so identity can be seen at all ----------------- */
  Object.assign(summary, await seedAvatars(ORG, team));
  /* -- 9c. How the company talks ------------------------------------------ */
  Object.assign(summary, await seedCommunication(ORG, team, companies));

  /* ── 10. What happened ────────────────────────────────────────────────── */
  Object.assign(summary, await seedActivity(ORG, team, {
    ...finance, ...delivery, ...crm,
  }));

  /* ── 10b. Targets, the commission rule, and the ledger it produces ───── */
  Object.assign(summary, await seedPerformance(ORG, team));

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
  /**
   * Clear the event spine before the records that produced it are replaced.
   *
   * `business_events` deliberately holds no foreign key to `deals`: an
   * achievement outlives the record it came from, which is right for a
   * product that only ever soft-deletes. The seeder is the one thing that
   * *hard* deletes, so without this every re-seed leaves the previous
   * generation's events behind and the earnings ledger shows each commission
   * twice, then three times. The entries go first: they reference the events.
   */
  await rest('DELETE', `incentive_entries?organization_id=eq.${ORG}`, undefined,
    { Prefer: 'return=minimal' }).catch(() => null);
  await rest('DELETE', `business_events?organization_id=eq.${ORG}`, undefined,
    { Prefer: 'return=minimal' }).catch(() => null);

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

  /**
   * Backdate the stage history the trigger just wrote.
   *
   * 0028's `record_deal_stage_change()` writes one `deal_stage_events` row per
   * deal on INSERT, stamped `now()` - which is correct for a deal somebody
   * creates and wrong for a year of history inserted in ten seconds. Left
   * alone, every deal in the demo reads "0d" in its stage, and the panel whose
   * whole point is "eleven days in proposal" says nothing.
   *
   * The event is moved to the deal's own `created_at`. It is still the honest
   * claim the backfill makes - "this is where it was when we started keeping
   * track" - just dated from when the deal existed rather than from when the
   * seeder ran.
   */
  for (const deal of deals) {
    await rest(
      'PATCH',
      `deal_stage_events?deal_id=eq.${deal.id}`,
      { created_at: deal.created_at },
      { Prefer: 'return=minimal' },
    ).catch(() => {});
  }
  note('deal_stage_events', deals.length);

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
/*  The workspace                                                             */
/* -------------------------------------------------------------------------- */
/**
 * A company's written knowledge.
 *
 * Added with Phase 13. Every other module here had a year of data and the
 * workspace had none, so its screens - Home, the library, the template
 * gallery - could only ever be judged against their empty states, which is
 * precisely the reason this seeder exists (see the note at the top of the file).
 *
 * What it writes is what a real workspace holds: an area per function, real
 * documents with headings and tables in them, three spreadsheets with typed
 * columns and rows, links to the business records the documents are about, a
 * discussion on the policy people always argue about, and two external links
 * standing in for the material that lives in Drive and Figma.
 *
 * No uploads. A file needs bytes in storage, and a seeder that writes metadata
 * for objects that do not exist produces a file list where every row fails to
 * open. A link needs no bytes, which is exactly the case it was added for.
 */
const WORKSPACE_TREE = [
  {
    title: 'Company', icon: 'book-open', colour: '#2d9572',
    summary: 'How the business is run, and what it has decided.',
    children: [
      {
        title: 'Strategy', icon: 'target', colour: '#2c6fa7',
        summary: 'Where we are going, and what we have chosen not to do.',
        children: [
          {
            title: '2026 strategy', icon: 'target', colour: '#2c6fa7', starred: true,
            summary: 'The three-year position, the choices behind it, and how we will know.',
            body: [
              '# Strategy',
              '',
              '**Horizon** 2026 to 2028  ',
              '**Owner** Ada Okonkwo',
              '',
              '## Where we are now',
              '',
              'Delivery revenue is concentrated: the four largest engagements are 61% of',
              'the book, and two of them renew in the same quarter. Utilisation is healthy',
              'and the pipeline is not - weighted forecast covers about half of next year',
              'at current win rates.',
              '',
              '## Where we are going',
              '',
              'A services business with a recurring floor under it. Two thirds project',
              'work, one third retained, and the retained half sold to customers we',
              'already deliver for.',
              '',
              '## The choices that get us there',
              '',
              '| Choice | Instead of | Because |',
              '| --- | --- | --- |',
              '| Retainers with existing customers | New-logo growth | The cost of sale is already paid |',
              '| Two verticals, deeply | Every sector | Reusable delivery, higher margin |',
              '| Hire delivery leads | Hire generalists | The constraint is supervision, not hands |',
              '',
              '## What we will not do',
              '',
              '- Fixed-price work beyond ++twelve weeks++ without a phased contract.',
              '- Staff augmentation. It looks like revenue and is not a business.',
              '',
              '## How we will know',
              '',
              '| Measure | Today | In 12 months |',
              '| --- | ---: | ---: |',
              '| Retained share of revenue | 11% | 30% |',
              '| Revenue from the top four | 61% | under 45% |',
              '| Gross margin | 18.4% | 24% |',
              '',
            ].join('\n'),
          },
          {
            title: 'Business case: regional expansion', icon: 'lightbulb', colour: '#b8730a',
            summary: 'The argument for a second delivery office, including doing nothing.',
            body: [
              '# Business case',
              '',
              '## The decision being asked for',
              '',
              'Approve setup and twelve months of running cost for a second delivery',
              'office, by the end of Q1.',
              '',
              '## The problem',
              '',
              'Delivery capacity is the binding constraint on revenue, and the local',
              'market for senior engineers is priced above what our margin supports.',
              '',
              '## Options considered',
              '',
              '| Option | Cost | Benefit | Risk |',
              '| --- | ---: | --- | --- |',
              '| Do nothing | 0 | None | Capacity flat, two renewals at risk |',
              '| Pay above market locally | 31m a year | Fast | Margin falls below 15% |',
              '| Second office | 48m setup | 14 more delivery heads | Supervision at distance |',
              '',
              '## Recommendation',
              '',
              'The second office. The margin arithmetic works from month nine, and the',
              'supervision risk is answerable by hiring the lead first.',
              '',
              '## What happens if we do nothing',
              '',
              'Two renewals are delivered by a team already at capacity, and this',
              'conversation happens again in six months with less time.',
              '',
            ].join('\n'),
          },
        ],
      },
      {
        title: 'Policies', icon: 'book-open', colour: '#8b5cf6',
        summary: 'What applies to everybody, with an owner and a review date.',
        children: [
          {
            title: 'Leave policy', icon: 'book-open', colour: '#8b5cf6', starred: true,
            summary: 'Annual leave, notice, carry-over and how to request it.',
            comments: [
              'Does the four-week notice apply to a single day, or only to a block?',
              'A single day needs 48 hours. The four weeks is for anything over five days, and I will make that explicit in the next revision.',
            ],
            body: [
              '# Leave policy',
              '',
              '**Applies to** all employees  ',
              '**Owner** People team  ',
              '**Next review** 1 July',
              '',
              '## Purpose',
              '',
              'To set out how much leave people have, how to take it, and what happens',
              'to what they do not use.',
              '',
              '## Scope',
              '',
              'Every employee on a permanent contract. Contractors are covered by their',
              'own agreement and are ++not++ covered here.',
              '',
              '## Entitlement',
              '',
              '| Length of service | Days per year |',
              '| --- | ---: |',
              '| Under 2 years | 20 |',
              '| 2 to 5 years | 24 |',
              '| Over 5 years | 28 |',
              '',
              '## Requesting leave',
              '',
              '1. Raise the request in NextMav under People.',
              '2. Your manager approves or declines within three working days.',
              '3. Anything over five consecutive days needs four weeks of notice.',
              '',
              '## Carry-over',
              '',
              'Up to five days carry into the following year and must be used by',
              '31 March. Nothing beyond five days carries.',
              '',
              '> Leave is not a bonus to be saved. A team where nobody takes their',
              '> entitlement has a supervision problem, not a saving.',
              '',
              '## Exceptions',
              '',
              'A department head may approve one in writing. Send it to the People team',
              'so the record is complete.',
              '',
            ].join('\n'),
          },
          {
            title: 'Expense policy', icon: 'book-open', colour: '#8b5cf6',
            summary: 'What the company pays for, what it does not, and the limits.',
            body: [
              '# Expense policy',
              '',
              '**Applies to** everyone who spends company money  ',
              '**Owner** Finance  ',
              '**Next review** 1 October',
              '',
              '## The policy',
              '',
              'The company pays for what it asked you to do. Anything you would not be',
              'comfortable explaining to a colleague, do not claim.',
              '',
              '## Limits',
              '',
              '| Category | Limit | Approval |',
              '| --- | ---: | --- |',
              '| Meals while travelling | 18,000 a day | Manager |',
              '| Accommodation | 85,000 a night | Manager |',
              '| Software | 50,000 | Manager |',
              '| Anything above 250,000 | - | Finance |',
              '',
              '## What we do not pay for',
              '',
              '- Fines, penalties and parking tickets.',
              '- Upgrades bought after the booking was approved.',
              '- Alcohol, other than at a client dinner.',
              '',
              '## Claiming',
              '',
              'Raise it in Finance within 30 days with a receipt. A claim older than',
              'that needs a written reason.',
              '',
            ].join('\n'),
          },
          {
            title: 'Information security policy', icon: 'code', colour: '#c0392b',
            summary: 'Access, devices, customer data, and what to do after an incident.',
            body: [
              '# Information security policy',
              '',
              '**Applies to** all staff and contractors  ',
              '**Owner** Engineering  ',
              '**Next review** 1 December',
              '',
              '## Access',
              '',
              'Least privilege, always. Access is granted by role and reviewed quarterly,',
              'and nobody keeps an account after their last day.',
              '',
              '## Devices',
              '',
              '- Full-disk encryption on every machine that touches customer data.',
              '- Screen lock at five minutes.',
              '- No customer data on personal devices.',
              '',
              '## Customer data',
              '',
              'Production data does not leave production. Use generated data for demos',
              'and for development, without exception.',
              '',
              '## If something goes wrong',
              '',
              '1. Tell the engineering lead. Do not wait until you understand it.',
              '2. Preserve the evidence: do not delete logs or reimage a machine.',
              '3. The lead decides whether it is an incident and who is told.',
              '',
              'Reporting something that turns out to be nothing is always the right call.',
              '',
            ].join('\n'),
          },
        ],
      },
      {
        title: 'Finance', icon: 'table', colour: '#d4a93f',
        summary: 'Budgets, forecasts, and the numbers behind them.',
        children: [
          {
            title: '2026 operating budget', kind: 'sheet', icon: 'table', colour: '#d4a93f',
            summary: 'Planned against actual by line, with the variance calculated.',
            columns: [
              { name: 'Line', type: 'text', width: 230, is_frozen: true },
              { name: 'Category', type: 'select', width: 140,
                options: ['People', 'Software', 'Marketing', 'Facilities', 'Travel'] },
              { name: 'Budget', type: 'currency', width: 150, aggregate: 'sum', decimals: 0 },
              { name: 'Actual', type: 'currency', width: 150, aggregate: 'sum', decimals: 0 },
              { name: 'Variance', type: 'currency', width: 150, aggregate: 'sum', decimals: 0,
                formula: '=Budget - Actual' },
            ],
            rows: [
              ['Delivery salaries', 'People', 148000000, 141200000],
              ['Engineering salaries', 'People', 96000000, 98400000],
              ['Cloud and hosting', 'Software', 14400000, 15900000],
              ['Design and product tools', 'Software', 3600000, 3180000],
              ['Recruitment', 'People', 12000000, 7450000],
              ['Office and utilities', 'Facilities', 18000000, 18240000],
              ['Client travel', 'Travel', 9600000, 11700000],
              ['Brand and campaigns', 'Marketing', 22000000, 14850000],
            ],
          },
        ],
      },
      {
        title: 'Operations', icon: 'code', colour: '#0f766e',
        summary: 'How the work actually gets done.',
        children: [
          {
            title: 'SOP: client onboarding', icon: 'code', colour: '#0f766e',
            summary: 'From signed contract to first delivery stand-up, in nine steps.',
            body: [
              '# Standard operating procedure',
              '',
              '**Owner** Delivery  ',
              '**Review every** 6 months',
              '',
              '## Purpose',
              '',
              'To take a signed engagement to a running project without anybody having',
              'to ask what happens next.',
              '',
              '## When this applies',
              '',
              'Every new engagement, and every renewal that changes the scope.',
              '',
              '## Before you start',
              '',
              '- The contract is signed and filed against the company record.',
              '- A delivery lead is named.',
              '',
              '## Steps',
              '',
              '1. Create the project in NextMav and link this document to it.',
              '2. Add the client company and the primary contact.',
              '3. Set the phases from the statement of work.',
              '4. Invite the delivery team and set allocations.',
              '5. Raise the first invoice against the payment schedule.',
              '6. Open the client portal and share the first deliverable folder.',
              '7. Book the kickoff and send the agenda 48 hours ahead.',
              '8. Record the kickoff decisions in a meeting-notes page here.',
              '9. Start the weekly status report.',
              '',
              '## How to tell it worked',
              '',
              'The first stand-up happens with everybody knowing what they are doing,',
              'and the first invoice goes out on the day the schedule says.',
              '',
              '## When it goes wrong',
              '',
              '| Symptom | Cause | What to do |',
              '| --- | --- | --- |',
              '| No delivery lead named | Sale closed without a capacity check | Escalate before step 3 |',
              '| Scope unclear at kickoff | The statement of work is a summary | Rewrite it before phase 1 |',
              '',
            ].join('\n'),
          },
          {
            title: 'SOP: incident response', icon: 'code', colour: '#c0392b',
            summary: 'Who does what in the first hour of a production incident.',
            body: [
              '# Standard operating procedure',
              '',
              '**Owner** Engineering  ',
              '**Review every** 3 months',
              '',
              '## Purpose',
              '',
              'To make the first hour of an incident predictable.',
              '',
              '## Steps',
              '',
              '1. Whoever notices declares. Declaring costs nothing.',
              '2. The declarer is incident lead until somebody takes it explicitly.',
              '3. Open a channel and put the customer name in the title.',
              '4. Post the position every fifteen minutes, even when it has not changed.',
              '5. Mitigate first, diagnose second.',
              '6. Write the timeline while it is happening, not afterwards.',
              '',
              '## Escalation',
              '',
              '| Elapsed | Who is told |',
              '| --- | --- |',
              '| 15 minutes | Engineering lead |',
              '| 45 minutes | Delivery lead and the account owner |',
              '| 2 hours | Managing director |',
              '',
              '## Afterwards',
              '',
              'A review within five working days, blameless, written up here. An incident',
              'with no write-up will happen again.',
              '',
            ].join('\n'),
          },
        ],
      },
    ],
  },
  {
    title: 'Projects', icon: 'map', colour: '#2c6fa7',
    summary: 'What each engagement decided, in its own words.',
    children: [
      {
        title: 'Corvo patient portal', icon: 'folder', colour: '#2c6fa7',
        summary: 'Requirements, notes and the plan for the Corvo engagement.',
        linkProject: 'Corvo',
        children: [
          {
            title: 'Requirements', icon: 'file-text', colour: '#2c6fa7', starred: true,
            summary: 'What the portal has to do, and what is out of scope.',
            linkProject: 'Corvo', linkCompany: 'Corvo',
            body: [
              '# Product requirements',
              '',
              '## Summary',
              '',
              'A portal where a patient can see their appointments, their documents and',
              'their outstanding balance, without calling the practice.',
              '',
              '## Problem',
              '',
              'Reception spends most of the morning answering three questions that a',
              'screen could answer.',
              '',
              '## Proposed solution',
              '',
              '### Must have',
              '',
              '- [x] Sign in with an emailed code, so there is no password to forget.',
              '- [x] Appointments, past and future.',
              '- [ ] Documents released by the practice.',
              '- [ ] Outstanding balance, and a way to pay it.',
              '',
              '### Should have',
              '',
              '- [ ] Rescheduling inside the practice rules.',
              '- [ ] Reminders by SMS.',
              '',
              '## Out of scope',
              '',
              'Clinical records. The portal shows what the practice releases, and nothing',
              'the practice has not released.',
              '',
              '## Success measures',
              '',
              '| Measure | Today | Target | By when |',
              '| --- | ---: | ---: | --- |',
              '| Calls to reception before 11am | 47 a day | under 20 | 90 days after launch |',
              '| Balances settled within 14 days | 38% | 65% | 6 months |',
              '',
            ].join('\n'),
          },
          {
            title: 'Kickoff notes', icon: 'file-text', colour: '#2c6fa7',
            summary: 'Decisions and actions from the Corvo kickoff.',
            linkProject: 'Corvo',
            body: [
              '# Meeting notes',
              '',
              '**Date** ' + day(daysAgo(46)) + '  ',
              '**Attendees** Ada Okonkwo, the delivery lead, the Corvo product owner',
              '',
              '## Purpose',
              '',
              'Agree the scope, the phases, and who decides what.',
              '',
              '## Decisions',
              '',
              '| Decision | Made by | Date |',
              '| --- | --- | --- |',
              '| Passwordless sign-in, not passwords | Corvo product owner | ' + day(daysAgo(46)) + ' |',
              '| Payments in phase 2, not phase 1 | Both | ' + day(daysAgo(46)) + ' |',
              '',
              '## Actions',
              '',
              '- [x] Send the phased statement of work.',
              '- [x] Name the practice contact for document release.',
              '- [ ] Confirm the accessibility standard to test against.',
              '',
              '## Not decided',
              '',
              'Whether reminders go by SMS or by email. Corvo is checking what their',
              'patients have consented to.',
              '',
            ].join('\n'),
          },
        ],
      },
      {
        title: 'Halden telemetry', icon: 'folder', colour: '#b8730a',
        summary: 'The at-risk engagement, and the plan to recover it.',
        linkProject: 'Halden',
        children: [
          {
            title: 'Recovery plan', kind: 'sheet', icon: 'table', colour: '#b8730a',
            summary: 'Tasks, owners, dates and status for the recovery.',
            linkProject: 'Halden',
            columns: [
              { name: 'Task', type: 'text', width: 250, is_frozen: true },
              { name: 'Phase', type: 'text', width: 140 },
              { name: 'Status', type: 'select', width: 140,
                options: ['Not started', 'In progress', 'Blocked', 'Done'] },
              { name: 'Due', type: 'date', width: 130 },
              { name: 'Days', type: 'number', width: 90, align: 'right', aggregate: 'sum' },
              { name: 'Done', type: 'checkbox', width: 80 },
            ],
            rows: [
              ['Re-baseline the schedule with the client', 'Recovery', 'Done', day(daysAgo(12)), 2, true],
              ['Cut phase 3 to the agreed minimum', 'Recovery', 'Done', day(daysAgo(8)), 3, true],
              ['Second engineer onto ingest', 'Capacity', 'In progress', day(daysAhead(4)), 5, false],
              ['Device certification with the vendor', 'Blocked', 'Blocked', day(daysAhead(9)), 8, false],
              ['Weekly written status to the client', 'Governance', 'In progress', day(daysAhead(2)), 1, false],
            ],
          },
        ],
      },
    ],
  },
  {
    title: 'Sales', icon: 'star', colour: '#6366f1',
    summary: 'Proposals, pricing, and what we said we would do.',
    children: [
      {
        title: 'Proposal: Quillon Media renewal', icon: 'file-text', colour: '#6366f1',
        summary: 'The licence renewal proposal, valid to the end of the quarter.',
        linkCompany: 'Quillon', linkDeal: 'Quillon',
        resources: [
          ['Signed contract (Drive)', 'https://drive.google.com/drive/folders/quillon-renewal'],
        ],
        body: [
          '# Proposal',
          '',
          '**Prepared for** Quillon Media  ',
          '**Date** ' + day(daysAgo(9)) + '  ',
          '**Valid until** ' + day(daysAhead(21)),
          '',
          '## What you told us',
          '',
          'The current licence covers three properties and you now run seven. Reporting',
          'is assembled by hand every month and takes two people the better part of a',
          'week.',
          '',
          '## What we propose',
          '',
          'A group licence across all seven properties, with the monthly reporting',
          'produced automatically and delivered on the second working day.',
          '',
          '## Scope of work',
          '',
          '| Workstream | What it includes | Deliverable |',
          '| --- | --- | --- |',
          '| Licence | Seven properties, unlimited seats | Signed agreement |',
          '| Reporting | An automated monthly pack | The first pack in month one |',
          '| Migration | The four properties not yet on the platform | A cutover plan |',
          '',
          '## Investment',
          '',
          '| Item | Amount |',
          '| --- | ---: |',
          '| Group licence, 12 months | 14,400,000 |',
          '| Migration, one off | 2,800,000 |',
          '',
          '## Assumptions',
          '',
          'Property data is available in the format supplied for the pilot. Anything',
          'that has to be re-keyed is outside this price.',
          '',
          '## Next steps',
          '',
          'Confirm the property list, and we will issue the agreement the same week.',
          '',
        ].join('\n'),
      },
      {
        title: 'Rate card', kind: 'sheet', icon: 'table', colour: '#6366f1',
        summary: 'Day rate by role, with the effective rate at expected utilisation.',
        columns: [
          { name: 'Role', type: 'text', width: 200, is_frozen: true },
          { name: 'Day rate', type: 'currency', width: 150, decimals: 0 },
          { name: 'Utilisation', type: 'number', width: 130, align: 'right' },
          { name: 'Effective', type: 'currency', width: 150, aggregate: 'avg', decimals: 0,
            formula: '=Day rate * Utilisation / 100' },
        ],
        rows: [
          ['Delivery lead', 210000, 70],
          ['Senior engineer', 175000, 85],
          ['Engineer', 130000, 90],
          ['Designer', 145000, 75],
          ['Analyst', 110000, 80],
        ],
      },
    ],
  },
  {
    title: 'People', icon: 'star', colour: '#0f766e',
    summary: 'Joining, growing, and being reviewed.',
    children: [
      {
        title: 'Onboarding: the first two weeks', icon: 'star', colour: '#0f766e',
        summary: 'What a new joiner does, with an owner against every line.',
        resources: [
          ['Brand kit (Figma)', 'https://figma.com/file/northwind-brand-kit'],
        ],
        body: [
          '# Onboarding',
          '',
          '**Manager** the joiner\'s own  ',
          '**Buddy** named before day one',
          '',
          '## Before day one',
          '',
          '- [x] Accounts and access requested',
          '- [x] Equipment ordered',
          '- [ ] First-week calendar sent',
          '',
          '## Day one',
          '',
          '- [ ] Welcome and introductions',
          '- [ ] Tools and accounts working',
          '- [ ] The handbook and the three policies',
          '',
          '## Week one',
          '',
          '- [ ] Meet the team, one to one',
          '- [ ] Read the strategy and the onboarding SOP',
          '- [ ] A first small piece of real work, shipped',
          '',
          '## 30 / 60 / 90',
          '',
          '| By | What good looks like |',
          '| --- | --- |',
          '| 30 days | Delivering small pieces without supervision |',
          '| 60 days | Owning a workstream on one engagement |',
          '| 90 days | Trusted with a client conversation |',
          '',
        ].join('\n'),
      },
      {
        title: 'Half-year review', icon: 'file-text', colour: '#0f766e',
        template: 'People',
        summary: 'The review this company actually runs: evidence, then judgement.',
        body: [
          '# Performance review',
          '',
          '**Period** half year  ',
          '**Reviewer** the line manager',
          '',
          '## What they were working towards',
          '',
          '| Goal | Agreed | Outcome |',
          '| --- | --- | --- |',
          '|  |  |  |',
          '',
          '## What went well',
          '',
          'With examples. A review without examples is an opinion.',
          '',
          '## What did not',
          '',
          '## How they work with others',
          '',
          '## Their own view',
          '',
          '## Agreed for next period',
          '',
          '| Goal | Measure | By when |',
          '| --- | --- | --- |',
          '|  |  |  |',
          '',
          '## Support they need',
          '',
        ].join('\n'),
      },
    ],
  },
];

async function seedWorkspace(ORG, team) {
  const [projects, companies, deals] = await Promise.all([
    select('projects', `select=id,name&organization_id=eq.${ORG}`),
    select('companies', `select=id,name&organization_id=eq.${ORG}`),
    select('deals', `select=id,name&organization_id=eq.${ORG}`),
  ]);

  const findBy = (rows, needle) =>
    rows.find(r => String(r.name ?? '').toLowerCase().includes(needle.toLowerCase()));

  const pages = [];
  const columnsToWrite = [];
  const rowsToWrite = [];
  const linksToWrite = [];
  const resourcesToWrite = [];
  const commentsToWrite = [];

  /**
   * Written one level at a time.
   *
   * A page's parent has to exist before its children are inserted, and
   * `prevent_page_cycle` walks the ancestry on every write - so a single flat
   * insert with client-generated ids would work only until somebody added a
   * constraint that reads the parent row. One round trip per depth is four
   * round trips for this tree.
   */
  async function writeLevel(specs, parentId, depth) {
    if (!specs.length) return;

    const written = await insert('workspace_pages', specs.map((spec, i) => ({
      organization_id: ORG,
      parent_id: parentId,
      title: spec.title,
      summary: spec.summary ?? '',
      content: spec.body ?? '',
      icon: spec.icon ?? (spec.children ? 'folder' : 'file-text'),
      colour: spec.colour ?? '#2d9572',
      is_folder: !!spec.children,
      kind: spec.children ? 'document' : (spec.kind ?? 'document'),
      is_starred: !!spec.starred,
      is_template: !!spec.template,
      template_category: spec.template ?? null,
      visibility: parentId ? 'inherit' : 'organization',
      sort_order: i,
      created_by: team[i % team.length].id,
      last_edited_by: team[(i + 1) % team.length].id,
      created_at: iso(daysAgo(intBetween(20, 200))),
      updated_at: iso(daysAgo(intBetween(0, 18))),
    })));

    written.forEach((page, i) => {
      const spec = specs[i];
      pages.push({ page, spec });

      for (const [position, column] of (spec.columns ?? []).entries()) {
        columnsToWrite.push({
          organization_id: ORG,
          page_id: page.id,
          name: column.name,
          type: column.type,
          options: column.options ?? [],
          width: column.width ?? 180,
          position,
          align: column.align ?? null,
          decimals: column.decimals ?? null,
          formula: column.formula ?? null,
          aggregate: column.aggregate ?? 'none',
          is_frozen: !!column.is_frozen,
        });
      }

      for (const [name, url] of spec.resources ?? []) {
        resourcesToWrite.push({
          organization_id: ORG,
          page_id: page.id,
          bucket: 'link',
          path: `${ORG}/links/${crypto.randomUUID()}`,
          filename: name,
          external_url: url,
          size_bytes: 0,
          description: 'Development data.',
          uploaded_by: team[0].id,
          created_at: iso(daysAgo(intBetween(2, 40))),
        });
      }

      for (const [n, body] of (spec.comments ?? []).entries()) {
        commentsToWrite.push({
          organization_id: ORG,
          page_id: page.id,
          author_id: team[(n + 1) % team.length].id,
          body,
          mentions: [],
          created_at: iso(daysAgo(6 - n)),
        });
      }

      const targets = [
        ['project', spec.linkProject && findBy(projects, spec.linkProject)],
        ['company', spec.linkCompany && findBy(companies, spec.linkCompany)],
        ['deal', spec.linkDeal && findBy(deals, spec.linkDeal)],
      ];
      for (const [type, row] of targets) {
        if (!row) continue;
        linksToWrite.push({
          organization_id: ORG,
          page_id: page.id,
          entity_type: type,
          entity_id: row.id,
          label: row.name,
          created_by: team[0].id,
        });
      }
    });

    if (depth < 4) {
      for (let i = 0; i < specs.length; i++) {
        if (specs[i].children) await writeLevel(specs[i].children, written[i].id, depth + 1);
      }
    }
  }

  await writeLevel(WORKSPACE_TREE, null, 0);

  const columns = columnsToWrite.length
    ? await insert('workspace_sheet_columns', columnsToWrite)
    : [];

  /*
    A row's cells are keyed by *column id*, which does not exist until the
    columns are written - so the rows are assembled here rather than in the
    tree above. Getting this wrong is silent: the grid renders a full set of
    columns and an entirely empty body.
  */
  const columnsByPage = new Map();
  for (const column of columns) {
    columnsByPage.set(column.page_id, [...(columnsByPage.get(column.page_id) ?? []), column]);
  }

  for (const { page, spec } of pages) {
    if (!spec.rows) continue;
    const cols = (columnsByPage.get(page.id) ?? []).sort((a, b) => a.position - b.position);
    spec.rows.forEach((values, position) => {
      const cells = {};
      values.forEach((value, i) => {
        const column = cols[i];
        // A formula column stores nothing: its values are worked out in the
        // browser from the columns to its left.
        if (column && !column.formula && value !== null && value !== '') cells[column.id] = value;
      });
      rowsToWrite.push({
        organization_id: ORG,
        page_id: page.id,
        cells,
        position,
        created_by: team[0].id,
        updated_by: team[0].id,
      });
    });
  }

  if (rowsToWrite.length) await insert('workspace_sheet_rows', rowsToWrite, { returning: false });
  if (linksToWrite.length) await insert('workspace_page_links', linksToWrite, { returning: false });
  if (resourcesToWrite.length) await insert('files', resourcesToWrite, { returning: false });
  if (commentsToWrite.length) await insert('comments', commentsToWrite, { returning: false });

  return {
    workspace_pages: pages.length,
    workspace_columns: columns.length,
    workspace_rows: rowsToWrite.length,
    workspace_links: linksToWrite.length,
    workspace_resources: resourcesToWrite.length,
    workspace_comments: commentsToWrite.length,
  };
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

/* -------------------------------------------------------------------------- */
/*  Performance: targets, one real rule, and the ledger it produces            */
/* -------------------------------------------------------------------------- */

/**
 * The performance layer, made demonstrable.
 *
 * ── Why this seeds a rule rather than entries ────────────────────────────
 *
 * Entries are not seeded, ever. They are written by `apply_incentive_rules()`
 * from the events the CRM already emitted, and inventing them here would
 * produce rows whose workings did not match any rule - which is precisely the
 * failure the ledger exists to make impossible. Instead this writes the rule
 * and calls `recompute_incentives()`, which is the same path a real company
 * takes when it adds a scheme part-way through a quarter.
 *
 * ── Why the targets are deliberately uneven ──────────────────────────────
 *
 * Everybody comfortably ahead makes the screen look designed rather than
 * observed. These are set as a multiple of what each person has actually
 * closed, so the team list shows somebody ahead, somebody on pace and
 * somebody well behind, which is the state a manager's screen has to be
 * legible in.
 */
async function seedPerformance(ORG, team) {
  await wipe('performance_targets', ORG);

  /* Entries first: they hold a foreign key to the rules. */
  await rest('DELETE', `incentive_entries?organization_id=eq.${ORG}`, undefined,
    { Prefer: 'return=minimal' }).catch(() => null);
  await wipe('incentive_rules', ORG);

  const now = new Date();
  const y = now.getUTCFullYear();
  const q = Math.floor(now.getUTCMonth() / 3);
  const startMonth = q * 3 + 1;
  const periodStart = `${y}-${String(startMonth).padStart(2, '0')}-01`;
  const periodEnd = new Date(Date.UTC(y, startMonth + 2, 0)).toISOString().slice(0, 10);
  const label = `Q${q + 1} ${y}`;

  /* What each person actually closed this quarter, from the event spine. */
  const events = await select(
    'business_events',
    `select=subject_member_id,payload&organization_id=eq.${ORG}`
    + `&event_type=eq.deal.won&occurred_at=gte.${periodStart}`
    + `&occurred_at=lte.${periodEnd}T23:59:59Z&limit=2000`,
  ) ?? [];

  const wonBy = new Map();
  for (const e of events) {
    if (!e.subject_member_id) continue;
    wonBy.set(e.subject_member_id, (wonBy.get(e.subject_member_id) ?? 0) + Number(e.payload?.value ?? 0));
  }

  /* A spread of standings, so the screen is legible rather than uniform. */
  const MULTIPLIER = [0.8, 1.15, 1.6, 2.4];
  const targets = [];
  let i = 0;
  for (const [memberId, won] of wonBy) {
    if (won <= 0) continue;
    targets.push({
      organization_id: ORG,
      subject_type: 'member',
      subject_id: memberId,
      metric: 'revenue_won',
      period_label: label,
      period_start: periodStart,
      period_end: periodEnd,
      target_value: Math.round(won * MULTIPLIER[i % MULTIPLIER.length] / 100_000) * 100_000,
      currency: 'NGN',
      notes: '',
      set_by: team[0]?.id ?? null,
    });
    i += 1;
  }
  if (targets.length) await insert('performance_targets', targets, { returning: false });

  /**
   * One rule, tiered, applying to everybody.
   *
   * Tiered rather than flat because it is the arrangement that makes the
   * ledger's explanation line worth reading: "11,600,000 x 2.5% (tier 2,
   * above 10,000,000)" says something a flat percentage does not.
   */
  const rules = await insert('incentive_rules', [{
    organization_id: ORG,
    name: 'Sales commission',
    description: 'Paid on the value of a deal at the point it is won.',
    basis: 'booked_revenue',
    trigger_event: 'deal.won',
    calculation: {
      kind: 'tiered',
      tiers: [{ from: 0, rate: 1 }, { from: 10000000, rate: 2.5 }],
    },
    effective_from: `${y}-01-01`,
    is_active: true,
    created_by: team[0]?.id ?? null,
  }]);

  /* Now let the engine write the ledger from events that already happened. */
  const written = await rest('POST', 'rpc/recompute_incentives', {
    p_org: ORG,
    p_from: `${y}-01-01T00:00:00Z`,
    p_to: new Date().toISOString(),
  }).catch(() => null);

  return {
    'performance targets': targets.length,
    'incentive rules': rules?.length ?? 0,
    'incentive entries': typeof written === 'number' ? written : 'recomputed',
  };
}

/* -------------------------------------------------------------------------- */
/*  Communication                                                             */
/* -------------------------------------------------------------------------- */

/**
 * How the company talks.
 *
 * -- Why this had to exist -------------------------------------------------
 *
 * The demo workspace carried a year of invoices, deals, projects and tickets
 * and exactly one channel with no messages in it. So Communication was the one
 * module that could not be judged at all: every screen in it was an empty
 * state, which tells you nothing about whether the design works and quite a
 * lot about why it looked unfinished.
 *
 * -- What it writes --------------------------------------------------------
 *
 * Rooms a real studio would have, and traffic shaped like real traffic:
 *
 *   · Six channels - the whole company, announcements, a design room, a
 *     project room, a client room and a private one - plus a direct
 *     conversation between the owner and each of four colleagues.
 *   · Around three hundred messages spread across ten weeks, bunched into
 *     working hours, with the usual long tail of one-line replies.
 *   · Threads under about a fifth of the messages, because a timeline where
 *     nothing has been answered cannot show what threading looks like.
 *   · Mentions of the signed-in owner, so the personal inbox has something in
 *     it, and reactions and pins so the timeline is not uniform.
 *   · Three meetings: one that has ended and has notes, and two scheduled with
 *     the owner invited and not yet answered.
 *
 * -- The two rules it obeys ------------------------------------------------
 *
 * **The read markers are set deliberately.** `channel_members.last_read_at`
 * defaults to the moment the row was written, which here is before every
 * message - so without a second pass the owner would open the module to a
 * badge of three hundred and an inbox of everything. Each membership is moved
 * to just behind the newest message in its channel, and the owner is left
 * behind in a couple of rooms on purpose, which is what makes the unread
 * states on Home and in the sidebar legible.
 *
 * **Nothing here writes a notification by hand.** `notify_message_mentions`
 * fires on insert, and `settleNotifications` at the end of the run marks the
 * resulting rows read exactly as it does for the rest of the seeding.
 */
async function seedCommunication(ORG, team, companies) {
  const owner = team[0];
  const others = team.slice(1);
  if (!others.length) return { channels: 0, messages: 0 };

  const projects = await select(
    'projects', `select=id,name&organization_id=eq.${ORG}&order=created_at.desc&limit=2`);

  /* -- The rooms ---------------------------------------------------------- */

  const client = companies[0];
  const plan = [
    {
      name: 'general', display: 'General', type: 'public', post: 'everyone',
      topic: 'Anything that concerns everybody.',
      description: 'The whole studio. Keep it short and keep it here.',
      members: team,
    },
    {
      name: 'announcements', display: 'Announcements', type: 'announcement', post: 'admins',
      topic: 'Posted by the leadership team.',
      description: 'Company decisions, policy, and anything everyone has to know.',
      members: team,
    },
    {
      name: 'design', display: 'Design', type: 'public', post: 'everyone',
      topic: 'Craft, critique and work in progress.',
      description: 'Where design work is shown before it ships.',
      members: [owner, ...others.slice(0, 6)],
    },
    projects[0] && {
      name: slugOf(projects[0].name), display: projects[0].name, type: 'public', post: 'everyone',
      topic: 'Delivery, blockers and decisions.',
      description: `Everything about ${projects[0].name}.`,
      project_id: projects[0].id,
      members: [owner, ...others.slice(0, 5)],
    },
    client && {
      name: slugOf(client.name), display: client.name, type: 'private', post: 'members',
      topic: 'Account team only.',
      description: `The ${client.name} account: renewals, escalations, commercials.`,
      company_id: client.id,
      members: [owner, ...others.slice(1, 4)],
    },
    {
      name: 'leadership', display: 'Leadership', type: 'private', post: 'members',
      topic: 'Not for wider circulation.',
      description: 'Heads of department.',
      members: [owner, ...others.slice(0, 3)],
    },
  ].filter(Boolean);

  const channels = await insert('channels', plan.map((c, i) => ({
    organization_id: ORG,
    name: c.name,
    display_name: c.display,
    description: c.description,
    topic: c.topic,
    type: c.type,
    post_policy: c.post,
    join_policy: c.type === 'private' ? 'invite' : 'open',
    project_id: c.project_id ?? null,
    company_id: c.company_id ?? null,
    created_by: owner.id,
    created_at: iso(daysAgo(120 - i * 4)),
  })));

  const memberRows = [];
  channels.forEach((row, i) => {
    for (const m of plan[i].members) {
      memberRows.push({
        channel_id: row.id,
        member_id: m.id,
        role: m.id === owner.id ? 'owner' : 'member',
        joined_at: iso(daysAgo(115 - i * 4)),
        /*
          Two of the six are starred for the owner, so the sidebar's Starred
          group and Home's ordering have something to show. Starring is a
          personal fact, so nobody else's row carries it.
        */
        is_favourite: m.id === owner.id && (i === 0 || plan[i].project_id != null),
      });
    }
  });

  /* -- Direct conversations ------------------------------------------------ */

  /*
     `open_direct_channel()` is the function the application uses, and it is
     the only thing that knows the slug convention for a two-person room. It is
     SECURITY DEFINER but resolves the caller through `auth.uid()`, which is
     null for a service-key request - the same trap `record_stock_movement`
     set. So the rows are written here, with the slug built the way that
     function builds it: the two membership ids, sorted, so the pair can only
     ever produce one room.
  */
  const dmWith = others.slice(0, 4);
  const dms = await insert('channels', dmWith.map((m, i) => {
    const pair = [owner.id, m.id].sort();
    return {
      organization_id: ORG,
      name: `dm-${pair[0]}-${pair[1]}`,
      display_name: null,
      description: '',
      topic: '',
      type: 'direct',
      post_policy: 'members',
      join_policy: 'invite',
      created_by: owner.id,
      created_at: iso(daysAgo(60 - i * 5)),
    };
  }));

  dms.forEach((row, i) => {
    for (const m of [owner, dmWith[i]]) {
      memberRows.push({
        channel_id: row.id, member_id: m.id, role: 'member',
        joined_at: row.created_at, is_favourite: false,
      });
    }
  });

  await insert('channel_members', memberRows, { returning: false });

  /* -- What was said ------------------------------------------------------- */

  const messageRows = [];
  const roots = [];

  /*
     Working hours, working days.

     A conversation stamped uniformly across the clock reads as a log file
     rather than as a company: the day separators land in the wrong places, the
     time beside a message means nothing, and a channel looks equally busy at
     three in the morning. This puts each message inside 08:00-18:59 and moves
     weekends back to the Friday.
  */
  const workMoment = (daysBack) => {
    const d = daysAgo(daysBack);
    if (d.getDay() === 0) d.setDate(d.getDate() - 2);
    if (d.getDay() === 6) d.setDate(d.getDate() - 1);
    d.setHours(intBetween(8, 18), intBetween(0, 59), intBetween(0, 59), 0);
    return d;
  };

  const OPENERS = [
    'Morning all. Standup in ten.',
    'Draft is up for review when anyone has a moment.',
    'Client came back on the scope, mostly positive.',
    'Deploy went out at 14:20, nothing on fire.',
    'Can we move the review to Thursday? Wednesday is full.',
    'Numbers for last month are in Finance now.',
    'Heads up: staging will be down for an hour from 16:00.',
    'Anyone got the latest version of the brand guidelines?',
    'Signed off. Invoicing this week.',
    'Two of the milestones slipped, I have moved the dates.',
    'Good call this morning, thanks everyone.',
    'The new onboarding flow is behind a flag if you want to look.',
    'Reminder that Friday is a half day.',
    'Support saw three tickets on the same thing overnight.',
    'Contract is with legal, expecting it back Tuesday.',
    'I have written the decisions up so we stop relitigating them.',
    'Quick one: who owns the analytics dashboard now?',
    'Rescheduled the client call to next Wednesday at 2.',
    'Invoice went out this morning, thirty day terms as usual.',
    'That bug is fixed on main, will go out with the next release.',
  ];

  const REPLIES = [
    'Looks good to me.',
    'Agreed.',
    'Can you send me the link?',
    'I will pick this up after lunch.',
    'Not sure that works, we tried it in March.',
    'Done.',
    'Thanks, that helps.',
    'Let us take it in the meeting rather than here.',
    'One thing: the dates on the second slide are wrong.',
    'Nice work.',
    'I have added it to my list.',
    'Who is covering while she is away?',
    'Yes, Thursday works.',
    'Sorted, thanks.',
  ];

  const ANNOUNCEMENTS = [
    'The office closes at 13:00 on Friday for the quarterly all-hands.',
    'The new expense policy takes effect on the first of next month. Receipts within seven days.',
    'We have signed the Pallas Retail renewal. Well done to everyone who worked on it.',
    'Annual leave requests for December close at the end of this week.',
  ];

  /* Ten weeks of traffic, weighted towards the recent end. */
  channels.forEach((channel, i) => {
    const isAnnouncement = plan[i].type === 'announcement';
    const speakers = plan[i].members;
    const volume = isAnnouncement ? ANNOUNCEMENTS.length : intBetween(28, 46);

    for (let n = 0; n < volume; n++) {
      const daysBack = isAnnouncement
        ? intBetween(2, 50)
        : Math.floor(Math.pow(rand(), 1.7) * 70);
      const sender = isAnnouncement ? owner : pick(speakers);
      const body = isAnnouncement ? ANNOUNCEMENTS[n] : pick(OPENERS);
      const at = workMoment(daysBack);

      /*
         The owner is named now and then, which is what puts anything in the
         personal inbox at all. Never by themselves: `communication_inbox()`
         filters out a message you sent, so seeding one would be misleading.
      */
      const namesOwner = !isAnnouncement && sender.id !== owner.id && rand() < 0.09;
      messageRows.push({
        organization_id: ORG,
        channel_id: channel.id,
        sender_id: sender.id,
        body: namesOwner ? `@${owner.full_name || 'Ada Okonkwo'} ${lowerFirst(body)}` : body,
        parent_id: null,
        mentions: namesOwner ? [owner.id] : [],
        attachments: [],
        is_pinned: !isAnnouncement && rand() < 0.03,
        created_at: iso(at),
      });
      roots.push({ speakers });
    }
  });

  /* Direct conversations: shorter, closer together, and two-sided. */
  const DM_LINES = [
    'Do you have five minutes this afternoon?',
    'Sent you the revised figures.',
    'Yes, that is fine by me.',
    'Can you take the client call tomorrow? I am double booked.',
    'I will have it to you before the end of the day.',
    'Thanks for picking that up.',
    'Have you seen the note from legal?',
    'Let us go with the second option.',
  ];
  dms.forEach((channel, i) => {
    const pair = [owner, dmWith[i]];
    const volume = intBetween(6, 14);
    for (let n = 0; n < volume; n++) {
      messageRows.push({
        organization_id: ORG,
        channel_id: channel.id,
        sender_id: pair[n % 2 === 0 ? 1 : 0].id,
        body: pick(DM_LINES),
        parent_id: null,
        mentions: [],
        attachments: [],
        is_pinned: false,
        created_at: iso(workMoment(Math.floor(Math.pow(rand(), 2) * 30))),
      });
      roots.push({ speakers: pair });
    }
  });

  const inserted = await insert('messages', messageRows);

  /*
     Replies, in a second pass.

     A thread's `parent_id` has to point at a row that exists, and an insert
     cannot reference the ids it is itself producing. So the roots go in first
     and their answers follow, stamped after the message they answer.
  */
  const replyRows = [];
  inserted.forEach((row, index) => {
    const meta = roots[index];
    if (!meta || rand() > 0.22) return;
    const count = intBetween(1, 4);
    for (let n = 0; n < count; n++) {
      const at = new Date(new Date(row.created_at).getTime()
        + (n + 1) * intBetween(3, 90) * 60_000);
      if (at > TODAY) continue;
      replyRows.push({
        organization_id: ORG,
        channel_id: row.channel_id,
        sender_id: pick(meta.speakers).id,
        body: pick(REPLIES),
        parent_id: row.id,
        mentions: [],
        attachments: [],
        is_pinned: false,
        created_at: iso(at),
      });
    }
  });
  if (replyRows.length) await insert('messages', replyRows, { returning: false });

  /* -- Reactions ----------------------------------------------------------- */

  const EMOJI = ['👍', '🎉', '👀', '✅', '❤️', '🙏'];
  const reactionRows = [];
  const seen = new Set();
  for (const row of inserted) {
    if (rand() > 0.18) continue;
    for (let n = 0; n < intBetween(1, 3); n++) {
      const who = pick(team);
      const emoji = pick(EMOJI);
      const key = `${row.id}:${who.id}:${emoji}`;
      // The table's unique index refuses a repeat, and one conflict fails the
      // whole chunk it is in.
      if (seen.has(key)) continue;
      seen.add(key);
      reactionRows.push({ message_id: row.id, member_id: who.id, emoji });
    }
  }
  if (reactionRows.length) await insert('message_reactions', reactionRows, { returning: false });

  /* -- Where everybody has read to ----------------------------------------- */

  const latestByChannel = new Map();
  for (const row of inserted) {
    const at = new Date(row.created_at).getTime();
    if (at > (latestByChannel.get(row.channel_id) ?? 0)) latestByChannel.set(row.channel_id, at);
  }

  for (const row of memberRows) {
    const latest = latestByChannel.get(row.channel_id);
    if (!latest) continue;
    /*
       The owner is left behind in about a third of their rooms and caught up
       in the rest, so both states are on the screen. Everybody else is caught
       up, because nobody is looking at their screen.
    */
    const behindHours = row.member_id === owner.id && rand() < 0.35
      ? intBetween(6, 40)
      : 0;
    await rest(
      'PATCH',
      `channel_members?channel_id=eq.${row.channel_id}&member_id=eq.${row.member_id}`,
      { last_read_at: iso(new Date(latest - behindHours * 3_600_000)) },
      { Prefer: 'return=minimal' },
    ).catch(() => null);
  }

  /* -- The owner's shelf ---------------------------------------------------- */

  const saveable = shuffle(inserted.filter(r => r.sender_id !== owner.id)).slice(0, 4);
  const NOTES = ['For the Thursday review', '', 'Check this against the contract', ''];
  if (saveable.length) {
    await insert('message_saves', saveable.map((row, i) => ({
      organization_id: ORG,
      member_id: owner.id,
      message_id: row.id,
      note: NOTES[i] ?? '',
      created_at: iso(daysAgo(intBetween(1, 12))),
    })), { returning: false });
  }

  /* -- Meetings ------------------------------------------------------------ */

  const projectRoom = channels.find((_, i) => plan[i].project_id) ?? channels[0];
  const general = channels[0];

  const meetingPlan = [
    {
      title: 'Weekly delivery review',
      agenda: 'Where each project stands, what is blocked, and what moves.',
      channel_id: projectRoom.id,
      status: 'ended',
      scheduled_at: iso(daysAgo(6)),
      started_at: iso(daysAgo(6)),
      ended_at: iso(new Date(daysAgo(6).getTime() + 47 * 60_000)),
      notes:
        'Decisions\n'
        + '- Halden telemetry moves to the 18th. Client informed.\n'
        + '- No new scope on Corvo until the portal ships.\n'
        + '\n'
        + 'Actions\n'
        + '- Redo the delivery plan with the new dates.\n'
        + '- Write the migration risks up for the client.\n',
    },
    {
      title: 'Pallas renewal, commercial call',
      agenda: 'Pricing, term, and the support tier they asked about.',
      channel_id: general.id,
      status: 'scheduled',
      scheduled_at: iso(atHour(daysAhead(2), 14)),
      notes: '',
    },
    {
      title: 'Design critique',
      agenda: 'Three screens, twenty minutes each. Bring questions, not opinions.',
      channel_id: channels[2]?.id ?? general.id,
      status: 'scheduled',
      scheduled_at: iso(atHour(daysAhead(5), 10)),
      notes: '',
    },
  ];

  const meetings = await insert('meetings', meetingPlan.map(m => ({
    organization_id: ORG,
    channel_id: m.channel_id,
    title: m.title,
    agenda: m.agenda,
    /*
       A colleague hosts the two that are still to come. An invitation the
       signed-in person has not answered is what puts anything in Home's
       attention band, and you cannot be invited to your own meeting.
    */
    host_id: m.status === 'ended' ? owner.id : others[0].id,
    status: m.status,
    mode: 'video',
    scheduled_at: m.scheduled_at ?? null,
    started_at: m.started_at ?? null,
    ended_at: m.ended_at ?? null,
    duration_minutes: 45,
    waiting_room: m.status !== 'ended',
    notes: m.notes,
  })));

  /*
     `seed_meeting_host()` writes the host's own participant row on insert, so
     only the guests are added here. Inserting the host again would collide
     with the unique index on (meeting_id, member_id) and fail the batch.
  */
  const participantRows = [];
  meetings.forEach((meeting, i) => {
    const spec = meetingPlan[i];
    const hostId = spec.status === 'ended' ? owner.id : others[0].id;
    for (const guest of [owner, ...others.slice(0, 5)]) {
      if (guest.id === hostId) continue;
      participantRows.push({
        meeting_id: meeting.id,
        member_id: guest.id,
        role: 'attendee',
        state: spec.status === 'ended' ? 'left' : 'invited',
        joined_at: spec.status === 'ended' ? spec.started_at : null,
        left_at: spec.status === 'ended' ? spec.ended_at : null,
      });
    }
  });
  if (participantRows.length) {
    await insert('meeting_participants', participantRows, { returning: false });
  }

  return {
    channels: channels.length + dms.length,
    messages: inserted.length + replyRows.length,
    'message reactions': reactionRows.length,
    'saved messages': saveable.length,
    meetings: meetings.length,
  };
}

/** A channel slug, the same shape the create endpoint produces. */
function slugOf(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

/** A date at a whole hour, without mutating the one passed in. */
function atHour(date, hour) {
  const d = new Date(date);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/**
 * "Draft is up" after an @mention, so the sentence still reads as a sentence.
 * Left alone when the first word is a name or an acronym.
 */
function lowerFirst(text) {
  if (/^[A-Z]{2,}/.test(text)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/* -------------------------------------------------------------------------- */
/*  Faces                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A photograph for everybody in the demo workspace.
 *
 * -- Why the demo needs this ------------------------------------------------
 *
 * `profiles.avatar_url` is rendered by the sidebar, the CRM, Projects, the
 * workspace, HR, the client portal and - since the Communication pass - every
 * message, mention, meeting tile and people picker. Nobody in the demo
 * workspace had one, so every one of those surfaces was judged on its fallback
 * and the "one profile, used everywhere" behaviour could not be seen at all.
 *
 * -- Why generated marks rather than photographs ---------------------------
 *
 * Because a demo dataset must not ship pictures of real people, and inventing
 * faces is worse than not having them. These are deterministic geometric marks
 * drawn from the person's membership id, in the product's own chart ramp: they
 * are unmistakably *images* rather than initials, which is the thing being
 * demonstrated, and they are honest about being generated.
 *
 * -- The path is the security model ----------------------------------------
 *
 * `storage_org_id()` reads the first segment of the object name and the upload
 * policy checks it against the caller's memberships, so an avatar has to live
 * under an organisation id. The same shape the settings page uploads to.
 */
async function seedAvatars(ORG, team) {
  const TINTS = [
    '#2d9572', '#2c6fa7', '#d4a93f', '#b8730a',
    '#8b5cf6', '#0f766e', '#6366f1', '#c0392b',
  ];

  let written = 0;

  for (const member of team) {
    const seed = hashOf(member.id);
    const tint = TINTS[seed % TINTS.length];
    const png = identicon(seed, tint);
    const path = `${ORG}/${member.user_id ?? member.id}/avatar.png`;

    try {
      const res = await fetch(`${URL}/storage/v1/object/avatars/${path}`, {
        method: 'POST',
        headers: {
          apikey: KEY,
          Authorization: `Bearer ${KEY}`,
          'Content-Type': 'image/png',
          'x-upsert': 'true',
        },
        body: png,
      });
      if (!res.ok && res.status !== 409) {
        throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      }
    } catch (e) {
      console.log(`  ! avatar for ${member.id}: ${String(e.message).slice(0, 120)}`);
      continue;
    }

    const url = `${URL}/storage/v1/object/public/avatars/${path}`;
    /*
       Written against the profile, which is the one place identity lives. A
       membership does not carry a face; a person does, and the same person in
       two organisations is the same face in both.
    */
    if (member.user_id) {
      await rest('PATCH', `profiles?id=eq.${member.user_id}`, { avatar_url: url },
        { Prefer: 'return=minimal' }).catch(() => null);
      written += 1;
    }
  }

  return { avatars: written };
}

/** A small stable integer from an id. */
function hashOf(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (id.charCodeAt(i) + ((h << 5) - h)) | 0;
  return Math.abs(h);
}

/**
 * A five-by-five symmetric mark, as a PNG.
 *
 * -- Why PNG and not SVG --------------------------------------------------
 *
 * The `avatars` bucket allows jpeg, png, webp and gif, and refuses
 * `image/svg+xml` with a 415. That restriction is right and worth keeping:
 * an SVG is a document that can carry script, and this bucket is public and
 * rendered in `<img>` tags across the product.
 *
 * So the mark is rasterised here. A PNG is a signature, three chunks and a
 * zlib stream, and `zlib.deflateSync` is in the standard library - which is
 * cheaper than a dependency for eleven images that never change.
 *
 * Symmetric because an asymmetric grid of squares reads as noise at 28px,
 * which is the size these are seen at almost everywhere. Two shades of one
 * hue rather than several, so a column of them in a message list stays calm.
 */
function identicon(seed, tint) {
  const SIZE = 99;
  const CELL = 15;
  const PAD = 12;

  const ink = [
    parseInt(tint.slice(1, 3), 16),
    parseInt(tint.slice(3, 5), 16),
    parseInt(tint.slice(5, 7), 16),
  ];
  // The background is the same hue at 14% over white, which is what the
  // fallback initials use, so a generated face and a drawn one match.
  const wash = ink.map(c => Math.round(255 - (255 - c) * 0.14));

  const on = new Set();
  let bits = seed;
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      bits = (bits * 1103515245 + 12345) & 0x7fffffff;
      if ((bits >> 8) % 100 < 48) { on.add(`${x},${y}`); on.add(`${4 - x},${y}`); }
    }
  }

  /* Raw scanlines: one filter byte per row, then RGB triples. */
  const raw = Buffer.alloc(SIZE * (1 + SIZE * 3));
  let o = 0;
  for (let py = 0; py < SIZE; py++) {
    raw[o++] = 0;
    for (let px = 0; px < SIZE; px++) {
      const gx = Math.floor((px - PAD) / CELL);
      const gy = Math.floor((py - PAD) / CELL);
      const inside = gx >= 0 && gx < 5 && gy >= 0 && gy < 5 && on.has(`${gx},${gy}`);
      const c = inside ? ink : wash;
      raw[o++] = c[0]; raw[o++] = c[1]; raw[o++] = c[2];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type: truecolour

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** One PNG chunk: length, type, payload, CRC32 of type and payload. */
function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
