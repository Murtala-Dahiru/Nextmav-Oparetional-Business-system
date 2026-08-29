import { LEAD_STATUSES } from '@/lib/constants';
import type { ImportField } from '@/lib/import/mapping';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  From spreadsheet rows to CRM records - and to the duplicates they may be
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The three jobs, kept apart on purpose ────────────────────────────────
 *
 *   1. **Shape.** Turn one row plus a mapping into a company and a person.
 *      Split a full name, pull a domain out of a URL, read "1,250,000" and
 *      "₦1.25m" as the same number.
 *   2. **Judge.** Say what is wrong with it - an address that is not an
 *      address, a row with no name of any kind - in a sentence a person can
 *      act on, before anything is written.
 *   3. **Match.** Say what it might already be, and how strongly. Never
 *      decide: a match is a proposal the user accepts, and the default for an
 *      uncertain one is to leave the existing record alone.
 *
 * ── Why matching is conservative ─────────────────────────────────────────
 *
 * The two failure modes are not symmetrical. Creating a duplicate company is
 * annoying and reversible: somebody notices two Acmes and merges them. Merging
 * two *different* companies because their names looked alike destroys data -
 * the deals, contacts and invoices of one customer are now attached to
 * another, and no undo exists for that.
 *
 * So an email, a web domain or an exact name is a match; anything softer is
 * offered as "possible" with the existing record named, and the user decides.
 * Nothing here ever merges on its own.
 */

/* -------------------------------------------------------------------------- */
/*  Normalising                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The legal suffixes a company's name may or may not carry on any given day.
 *
 * "ABC Ltd", "ABC Limited" and "ABC" are one customer, and a spreadsheet from
 * a different department will spell it a different way. Stripped only from the
 * end, and only where something is left over - "Limited" on its own stays.
 */
const SUFFIXES = [
  'ltd', 'limited', 'plc', 'inc', 'incorporated', 'llc', 'llp', 'lp',
  'gmbh', 'bv', 'nv', 'sa', 'ag', 'pty', 'co', 'company', 'corp', 'corporation',
  'group', 'holdings', 'enterprises', 'ventures', 'international',
];

export function normaliseCompany(name: string): string {
  let n = name.toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let changed = true;
  while (changed) {
    changed = false;
    for (const s of SUFFIXES) {
      if (n.endsWith(` ${s}`) && n.length > s.length + 1) {
        n = n.slice(0, -(s.length + 1)).trim();
        changed = true;
      }
    }
  }

  /**
   * Spaces go last, after the suffixes have been stripped.
   *
   * They have to survive that long, because "acme ltd" is only recognisable as
   * a suffix while the boundary is still there. Once it is gone the spacing
   * itself is noise: "A.B.C." arrives as "a b c" because the full stops became
   * separators, and it is the same company as "ABC". Collapsing to "abc" makes
   * the two agree, which is the whole job of this function.
   */
  return n.replace(/\s+/g, '');
}

/** The registrable part of a web address, for comparing two of them. */
export function domainOf(website: string): string {
  const raw = website.trim().toLowerCase();
  if (!raw) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//.test(raw) ? raw : `http://${raw}`;
  try {
    const host = new URL(withScheme).hostname.replace(/^www\./, '');
    return host.includes('.') ? host : '';
  } catch {
    return '';
  }
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Digits only, last nine kept - which is what survives a country code. */
export function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D+/g, '');
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

export function normaliseName(first: string, last: string): string {
  return `${first} ${last}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * A number out of whatever a spreadsheet put in the cell.
 *
 * Thousand separators, a currency symbol, a trailing "m" or "k", parentheses
 * for negatives, and the European convention where the comma is the decimal
 * mark. Returns null rather than 0 for something unreadable, because 0 is a
 * real value and "we could not read this" is not.
 */
export function readNumber(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;

  const negative = /^\(.*\)$/.test(s);
  let body = s.replace(/^\(|\)$/g, '').replace(/[^\d.,kKmMbB-]/g, '');
  if (!body) return null;

  let multiplier = 1;
  const unit = /([kmb])$/i.exec(body);
  if (unit) {
    multiplier = unit[1].toLowerCase() === 'k' ? 1e3 : unit[1].toLowerCase() === 'm' ? 1e6 : 1e9;
    body = body.slice(0, -1);
  }

  /**
   * Which of the comma and the full stop is the decimal mark.
   *
   * If both appear, the rightmost one is the decimal mark and the other is a
   * grouping separator - true for both "1,234.56" and "1.234,56". If only a
   * comma appears, it is a decimal mark only when it is followed by exactly
   * one or two digits and there is no second comma; otherwise "1,250" is one
   * thousand two hundred and fifty, which is what people mean far more often.
   */
  const lastComma = body.lastIndexOf(',');
  const lastDot = body.lastIndexOf('.');

  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? ',' : '.';
    body = body.replace(new RegExp(`\\${decimal === ',' ? '.' : ','}`, 'g'), '');
    if (decimal === ',') body = body.replace(',', '.');
  } else if (lastComma >= 0) {
    const after = body.length - lastComma - 1;
    const single = body.indexOf(',') === lastComma;
    body = single && after > 0 && after <= 2 ? body.replace(',', '.') : body.replace(/,/g, '');
  }

  const n = Number(body);
  if (!Number.isFinite(n)) return null;
  return (negative ? -n : n) * multiplier;
}

/**
 * Split a name written as one field.
 *
 * "Ahmed Musa" is two parts and obvious. "Musa, Ahmed" is the same person
 * written the way a database exports them. Everything after the first token is
 * the surname, because double-barrelled surnames are common and middle names
 * are not worth a third field here.
 */
export function splitName(full: string): { first: string; last: string } {
  const s = full.trim().replace(/\s+/g, ' ');
  if (!s) return { first: '', last: '' };

  if (s.includes(',')) {
    const [last, first] = s.split(',', 2).map(p => p.trim());
    if (last && first) return { first, last };
  }

  const parts = s.split(' ');
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

/* -------------------------------------------------------------------------- */
/*  Shaping a row                                                             */
/* -------------------------------------------------------------------------- */

export interface CandidateCompany {
  name: string;
  website: string;
  industry: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  employeeCount: number | null;
  annualRevenue: number | null;
}

export interface CandidatePerson {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  source: string;
  status: string;
  estimatedValue: number | null;
  score: number | null;
  notes: string;
}

export type Problem = { field: string; message: string; severity: 'error' | 'warning' };

export interface Candidate {
  /** Zero-based position in the file's data rows, for naming it on screen. */
  row: number;
  company: CandidateCompany | null;
  person: CandidatePerson | null;
  problems: Problem[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** `{ field: columnIndex }`, which is what the mapping screen produces. */
export type Mapping = Partial<Record<ImportField, number>>;

export function buildCandidate(row: string[], mapping: Mapping, index: number): Candidate {
  const at = (f: ImportField): string => {
    const i = mapping[f];
    return i === undefined ? '' : (row[i] ?? '').trim();
  };

  const problems: Problem[] = [];

  /* ── The person ──────────────────────────────────────────────────────── */

  let first = at('firstName');
  let last = at('lastName');
  const full = at('fullName');
  if (!first && !last && full) ({ first, last } = splitName(full));

  const email = normaliseEmail(at('email'));
  if (email && !EMAIL.test(email)) {
    problems.push({
      field: 'email', severity: 'warning',
      message: `"${at('email')}" is not an email address, so it will not be saved.`,
    });
  }

  const rawStatus = at('status').toLowerCase().trim();
  let status = 'new';
  if (rawStatus) {
    const known = (LEAD_STATUSES as readonly string[]).find(
      s => s === rawStatus || rawStatus.startsWith(s),
    );
    if (known) status = known;
    else {
      problems.push({
        field: 'status', severity: 'warning',
        message: `"${at('status')}" is not a lead status here, so this lead comes in as New.`,
      });
    }
  }

  const estimatedValue = mapping.estimatedValue !== undefined ? readNumber(at('estimatedValue')) : null;
  if (mapping.estimatedValue !== undefined && at('estimatedValue') && estimatedValue === null) {
    problems.push({
      field: 'estimatedValue', severity: 'warning',
      message: `"${at('estimatedValue')}" is not a number, so no value is recorded.`,
    });
  }

  const scoreRaw = mapping.score !== undefined ? readNumber(at('score')) : null;
  const score = scoreRaw === null ? null : Math.max(0, Math.min(100, Math.round(scoreRaw)));

  /**
   * A person needs something that identifies a person.
   *
   * The email is counted only when it is a real address. A row whose sole
   * content is the word "unknown" in the email column is not a lead with a bad
   * address, it is a blank row with a note in it, and creating a nameless
   * unreachable lead from it is the sort of import debris that makes people
   * stop trusting the feature.
   */
  const validEmail = EMAIL.test(email) ? email : '';
  const hasPerson = Boolean(first || last || validEmail || at('phone'));

  const person: CandidatePerson | null = hasPerson
    ? {
      firstName: first,
      lastName: last,
      email: validEmail,
      phone: at('phone'),
      jobTitle: at('jobTitle'),
      source: at('source') || 'import',
      status,
      estimatedValue: estimatedValue === null ? null : Math.max(0, estimatedValue),
      score,
      notes: at('notes'),
    }
    : null;

  /* ── The company ─────────────────────────────────────────────────────── */

  const companyName = at('companyName');
  const website = at('website');
  const companyEmail = normaliseEmail(at('companyEmail'));

  const hasCompany = Boolean(companyName || website);

  if (companyEmail && !EMAIL.test(companyEmail)) {
    problems.push({
      field: 'companyEmail', severity: 'warning',
      message: `"${at('companyEmail')}" is not an email address, so it will not be saved.`,
    });
  }

  const company: CandidateCompany | null = hasCompany
    ? {
      /**
       * A company known only by its web address still gets a name, because
       * `companies.name` is NOT NULL and a blank one would be a row nobody
       * can find again. The domain is the best name available and is what the
       * user sees in the preview, so the guess is visible before it is saved.
       */
      name: companyName || domainOf(website) || '',
      website,
      industry: at('industry'),
      email: EMAIL.test(companyEmail) ? companyEmail : '',
      phone: at('companyPhone'),
      city: at('city'),
      country: at('country'),
      employeeCount: mapping.employeeCount !== undefined
        ? clampInt(readNumber(at('employeeCount')))
        : null,
      annualRevenue: mapping.annualRevenue !== undefined
        ? nonNegative(readNumber(at('annualRevenue')))
        : null,
    }
    : null;

  if (!hasPerson && !hasCompany) {
    problems.push({
      field: 'row', severity: 'error',
      message: 'Nothing to import from this row: no name, company, email or phone.',
    });
  }

  if (hasPerson && !first && !last && !validEmail) {
    problems.push({
      field: 'name', severity: 'warning',
      message: 'This person has only a phone number, so the lead will be unnamed.',
    });
  }

  return { row: index, company, person, problems };
}

function clampInt(n: number | null): number | null {
  if (n === null) return null;
  const v = Math.round(n);
  return v >= 0 ? v : null;
}

function nonNegative(n: number | null): number | null {
  if (n === null) return null;
  return n >= 0 ? n : null;
}

/* -------------------------------------------------------------------------- */
/*  Matching                                                                  */
/* -------------------------------------------------------------------------- */

export type MatchStrength = 'exact' | 'possible';

export interface Match {
  id: string;
  label: string;
  /** Which signal produced it, said in the words the review screen shows. */
  on: string;
  strength: MatchStrength;
}

export interface ExistingCompany {
  id: string; name: string; website: string | null; email: string | null;
}

export interface ExistingPerson {
  id: string;
  kind: 'contact' | 'lead';
  firstName: string; lastName: string;
  email: string | null; phone: string | null;
  companyName: string | null;
}

/**
 * An index over what the workspace already holds, built once per import.
 *
 * A map lookup per row rather than a query per row: an import of three hundred
 * records would otherwise be nine hundred round trips, and the duplicate check
 * would take longer than the import.
 */
export class ExistingIndex {
  private companyByName = new Map<string, ExistingCompany>();
  private companyByDomain = new Map<string, ExistingCompany>();
  private companyByEmail = new Map<string, ExistingCompany>();
  private personByEmail = new Map<string, ExistingPerson>();
  private personByName = new Map<string, ExistingPerson>();
  private personByPhone = new Map<string, ExistingPerson>();

  constructor(companies: ExistingCompany[], people: ExistingPerson[]) {
    for (const c of companies) {
      const key = normaliseCompany(c.name);
      if (key && !this.companyByName.has(key)) this.companyByName.set(key, c);
      const d = domainOf(c.website ?? '');
      if (d && !this.companyByDomain.has(d)) this.companyByDomain.set(d, c);
      const e = normaliseEmail(c.email ?? '');
      if (e && !this.companyByEmail.has(e)) this.companyByEmail.set(e, c);
    }

    for (const p of people) {
      const e = normaliseEmail(p.email ?? '');
      if (e && !this.personByEmail.has(e)) this.personByEmail.set(e, p);
      const n = normaliseName(p.firstName, p.lastName);
      if (n && !this.personByName.has(n)) this.personByName.set(n, p);
      const ph = normalisePhone(p.phone ?? '');
      if (ph && !this.personByPhone.has(ph)) this.personByPhone.set(ph, p);
    }
  }

  /** Add a record created during this same import, so the file cannot duplicate itself. */
  remember(company?: ExistingCompany, person?: ExistingPerson) {
    if (company) {
      const key = normaliseCompany(company.name);
      if (key) this.companyByName.set(key, company);
      const d = domainOf(company.website ?? '');
      if (d) this.companyByDomain.set(d, company);
    }
    if (person) {
      const e = normaliseEmail(person.email ?? '');
      if (e) this.personByEmail.set(e, person);
      const n = normaliseName(person.firstName, person.lastName);
      if (n) this.personByName.set(n, person);
    }
  }

  matchCompany(c: CandidateCompany): Match | null {
    const d = domainOf(c.website);
    if (d) {
      const hit = this.companyByDomain.get(d);
      if (hit) return { id: hit.id, label: hit.name, on: `the website ${d}`, strength: 'exact' };
    }

    const e = normaliseEmail(c.email);
    if (e) {
      const hit = this.companyByEmail.get(e);
      if (hit) return { id: hit.id, label: hit.name, on: `the email ${e}`, strength: 'exact' };
    }

    const key = normaliseCompany(c.name);
    if (key) {
      const hit = this.companyByName.get(key);
      if (hit) {
        return {
          id: hit.id, label: hit.name,
          // Named as what it is: "ABC Ltd" and "ABC Limited" normalise to the
          // same key, and the review screen shows both spellings side by side
          // so the user can see why this was proposed.
          on: hit.name.toLowerCase() === c.name.toLowerCase() ? 'the same name' : 'a matching name',
          strength: hit.name.toLowerCase() === c.name.toLowerCase() ? 'exact' : 'possible',
        };
      }
    }

    return null;
  }

  matchPerson(p: CandidatePerson, companyName: string): Match | null {
    const e = normaliseEmail(p.email);
    if (e) {
      const hit = this.personByEmail.get(e);
      if (hit) {
        return {
          id: hit.id, label: `${hit.firstName} ${hit.lastName}`.trim() || e,
          on: `the email ${e}`, strength: 'exact',
        };
      }
    }

    const n = normaliseName(p.firstName, p.lastName);
    if (n) {
      const hit = this.personByName.get(n);
      /**
       * A name on its own is not a person.
       *
       * Two people called Ahmed Musa at two customers is ordinary, so a name
       * match only counts when the company agrees too - and even then it is
       * offered as possible rather than acted on.
       */
      if (hit && companyName && hit.companyName
        && normaliseCompany(hit.companyName) === normaliseCompany(companyName)) {
        return {
          id: hit.id, label: `${hit.firstName} ${hit.lastName}`.trim(),
          on: 'the same name at the same company', strength: 'possible',
        };
      }
    }

    const ph = normalisePhone(p.phone);
    if (ph) {
      const hit = this.personByPhone.get(ph);
      if (hit) {
        return {
          id: hit.id, label: `${hit.firstName} ${hit.lastName}`.trim() || ph,
          on: 'the same phone number', strength: 'possible',
        };
      }
    }

    return null;
  }
}
