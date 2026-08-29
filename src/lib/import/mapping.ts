/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Working out what a spreadsheet column means
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The claim this makes, and the one it refuses to make ──────────────────
 *
 * Nobody exports a file whose headings match a CRM's field names. They export
 * "Business Name", "Web Address", "Mobile", "Sector", "Contact Person". A tool
 * that asks the user to map twelve columns by hand before it will read one row
 * is a tool people abandon on the mapping screen.
 *
 * So this guesses - and then says out loud what it guessed and how sure it is.
 * That second half is the whole design. A confident wrong mapping that imports
 * silently is the worst outcome available here: it writes hundreds of records
 * with an email address in the phone field and nobody notices for a month.
 * Every suggestion arrives at the screen with its confidence attached, the
 * screen shows the ones it is unsure about differently, and nothing is written
 * until a person has confirmed the mapping.
 *
 * ── How it guesses ───────────────────────────────────────────────────────
 *
 * Two passes, and the order matters:
 *
 *   1. **The heading.** Normalised - lowercased, punctuation stripped - and
 *      matched against a list of aliases per field. An exact alias is a strong
 *      match; a heading that *contains* an alias is a weaker one, because
 *      "company email" contains "company" and is not the company name.
 *
 *   2. **The values.** Where the heading says nothing useful, the data often
 *      does: a column where four fifths of the values contain an `@` is an
 *      email column whatever it is called. This only ever *raises* confidence
 *      in a heading match or supplies one where there was none - it never
 *      overrules a clear heading, because a column headed "Billing email"
 *      full of addresses is still the billing email.
 *
 * Nothing here is machine learning and nothing pretends to be. It is a list of
 * names people actually use and two shape tests, which is what the problem
 * actually is.
 */

/** Every CRM field an import can fill. */
export type ImportField =
  | 'companyName' | 'website' | 'industry' | 'companyPhone' | 'companyEmail'
  | 'city' | 'country' | 'employeeCount' | 'annualRevenue'
  | 'firstName' | 'lastName' | 'fullName' | 'email' | 'phone' | 'jobTitle'
  | 'source' | 'status' | 'estimatedValue' | 'score' | 'notes';

export interface FieldSpec {
  field: ImportField;
  /** How it reads on the mapping screen. */
  label: string;
  /** Which record this column feeds. */
  target: 'company' | 'person';
  kind: 'text' | 'email' | 'phone' | 'url' | 'number' | 'money' | 'choice';
  aliases: string[];
}

/**
 * The fields, in the order they are offered.
 *
 * Company first, then person, because that is the order the records are
 * created in and the order the preview lists them. `fullName` exists because
 * most exports have one name column and splitting it is this tool's job, not
 * the user's.
 */
export const FIELDS: FieldSpec[] = [
  {
    field: 'companyName', label: 'Company', target: 'company', kind: 'text',
    aliases: ['company', 'company name', 'business', 'business name', 'organisation',
      'organization', 'org', 'account', 'account name', 'client', 'client name',
      'customer', 'customer name', 'firm', 'employer'],
  },
  {
    field: 'website', label: 'Website', target: 'company', kind: 'url',
    aliases: ['website', 'web', 'web address', 'url', 'site', 'web site', 'homepage',
      'domain', 'company website'],
  },
  {
    field: 'industry', label: 'Industry', target: 'company', kind: 'text',
    aliases: ['industry', 'sector', 'vertical', 'category', 'business type', 'segment'],
  },
  {
    field: 'companyPhone', label: 'Company phone', target: 'company', kind: 'phone',
    aliases: ['company phone', 'office phone', 'switchboard', 'main line', 'business phone'],
  },
  {
    field: 'companyEmail', label: 'Company email', target: 'company', kind: 'email',
    aliases: ['company email', 'info email', 'general email', 'office email'],
  },
  {
    field: 'city', label: 'City', target: 'company', kind: 'text',
    aliases: ['city', 'town', 'location', 'locality'],
  },
  {
    field: 'country', label: 'Country', target: 'company', kind: 'text',
    aliases: ['country', 'nation', 'region'],
  },
  {
    field: 'employeeCount', label: 'Employees', target: 'company', kind: 'number',
    aliases: ['employees', 'employee count', 'headcount', 'staff', 'size', 'company size',
      'number of employees'],
  },
  {
    field: 'annualRevenue', label: 'Annual revenue', target: 'company', kind: 'money',
    aliases: ['annual revenue', 'revenue', 'turnover', 'annual turnover', 'company revenue'],
  },
  {
    field: 'fullName', label: 'Full name', target: 'person', kind: 'text',
    aliases: ['name', 'full name', 'contact', 'contact name', 'contact person', 'person',
      'lead', 'lead name', 'prospect'],
  },
  {
    field: 'firstName', label: 'First name', target: 'person', kind: 'text',
    aliases: ['first name', 'firstname', 'first', 'given name', 'forename', 'fname'],
  },
  {
    field: 'lastName', label: 'Last name', target: 'person', kind: 'text',
    aliases: ['last name', 'lastname', 'last', 'surname', 'family name', 'lname'],
  },
  {
    field: 'email', label: 'Email', target: 'person', kind: 'email',
    aliases: ['email', 'e mail', 'email address', 'mail', 'work email', 'contact email'],
  },
  {
    field: 'phone', label: 'Phone', target: 'person', kind: 'phone',
    aliases: ['phone', 'phone number', 'mobile', 'mobile number', 'cell', 'cell phone',
      'telephone', 'tel', 'contact number', 'msisdn', 'whatsapp'],
  },
  {
    field: 'jobTitle', label: 'Job title', target: 'person', kind: 'text',
    aliases: ['job title', 'title', 'role', 'position', 'designation', 'job'],
  },
  {
    field: 'source', label: 'Source', target: 'person', kind: 'choice',
    aliases: ['source', 'lead source', 'channel', 'origin', 'came from', 'referrer'],
  },
  {
    field: 'status', label: 'Lead status', target: 'person', kind: 'choice',
    aliases: ['status', 'lead status', 'stage', 'lifecycle', 'lifecycle stage'],
  },
  {
    field: 'estimatedValue', label: 'Estimated value', target: 'person', kind: 'money',
    aliases: ['estimated value', 'value', 'deal value', 'opportunity value', 'budget',
      'potential value', 'amount', 'worth'],
  },
  {
    field: 'score', label: 'Score', target: 'person', kind: 'number',
    aliases: ['score', 'lead score', 'rating', 'grade'],
  },
  {
    field: 'notes', label: 'Notes', target: 'person', kind: 'text',
    aliases: ['notes', 'note', 'comment', 'comments', 'description', 'remarks', 'details'],
  },
];

const BY_FIELD = new Map(FIELDS.map(f => [f.field, f]));
export const fieldSpec = (f: ImportField) => BY_FIELD.get(f);

/** Lowercase, strip punctuation, collapse whitespace. */
function normalise(s: string): string {
  return s.toLowerCase().replace(/[_\-./\\]+/g, ' ').replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}

export type Confidence = 'certain' | 'likely' | 'unsure';

export interface ColumnSuggestion {
  /** Position in the file. */
  index: number;
  /** The heading as written. */
  header: string;
  /** What this column appears to be, or null for "do not import". */
  field: ImportField | null;
  confidence: Confidence;
  /** Why, in the few words the mapping screen shows under the select. */
  reason: string;
  /** Up to three non-empty values, for the preview. */
  sample: string[];
  /** How many of the rows have a value here. */
  filled: number;
}

const EMAILISH = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URLISH = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/|$)/i;
const PHONEISH = /^[+(]?[\d][\d\s().-]{6,}$/;

/** What the values in a column look like, where enough of them agree. */
function shapeOf(values: string[]): { kind: FieldSpec['kind'] | null; share: number } {
  const live = values.filter(v => v !== '');
  if (live.length < 3) return { kind: null, share: 0 };

  const share = (test: RegExp) => live.filter(v => test.test(v)).length / live.length;

  const email = share(EMAILISH);
  if (email >= 0.7) return { kind: 'email', share: email };

  const phone = share(PHONEISH);
  if (phone >= 0.7) return { kind: 'phone', share: phone };

  const url = share(URLISH);
  if (url >= 0.7) return { kind: 'url', share: url };

  return { kind: null, share: 0 };
}

/**
 * Suggest a field for every column in the sheet.
 *
 * ── Why a column can only be claimed once ────────────────────────────────
 *
 * Two columns mapped to `email` means the second silently overwrites the
 * first, and the user has no way to see it happened. The strongest match wins
 * the field and the loser is offered as unmapped, which puts the decision back
 * where it belongs.
 */
export function suggestMapping(columns: string[], rows: string[][]): ColumnSuggestion[] {
  type Scored = { index: number; field: ImportField; score: number; reason: string };
  const candidates: Scored[] = [];

  const columnValues = columns.map((_, i) => rows.map(r => r[i] ?? ''));

  columns.forEach((header, index) => {
    const n = normalise(header);
    if (!n) return;

    for (const spec of FIELDS) {
      let score = 0;
      let reason = '';

      if (spec.aliases.includes(n)) {
        score = 100;
        reason = 'Matched by name';
      } else {
        // A heading that is an alias plus a qualifier - "primary email",
        // "company website (main)". Scored below an exact match so that where
        // both exist the exact one wins the field.
        const hit = spec.aliases.find(a => n === `${a}s` || n.startsWith(`${a} `) || n.endsWith(` ${a}`));
        if (hit) { score = 70; reason = 'Matched by name'; }
        else if (spec.aliases.some(a => a.length > 4 && n.includes(a))) {
          score = 45; reason = 'Similar heading';
        }
      }

      if (!score) continue;

      // The values agreeing with the heading is the strongest signal there is.
      const shape = shapeOf(columnValues[index]);
      if (shape.kind && shape.kind === spec.kind) {
        score += 25;
        reason = 'Heading and values agree';
      }

      candidates.push({ index, field: spec.field, score, reason });
    }
  });

  /* Columns the heading said nothing about, claimed by their contents. */
  columns.forEach((header, index) => {
    if (candidates.some(c => c.index === index)) return;
    const shape = shapeOf(columnValues[index]);
    if (!shape.kind) return;

    const field: ImportField | null =
      shape.kind === 'email' ? 'email'
        : shape.kind === 'phone' ? 'phone'
          : shape.kind === 'url' ? 'website' : null;

    if (field) {
      candidates.push({
        index, field, score: 40,
        reason: `Values look like ${shape.kind === 'url' ? 'web addresses' : `${shape.kind} addresses`}`,
      });
    }
  });

  candidates.sort((a, b) => b.score - a.score);

  const takenField = new Set<ImportField>();
  const takenColumn = new Set<number>();
  const chosen = new Map<number, Scored>();

  for (const c of candidates) {
    if (takenColumn.has(c.index) || takenField.has(c.field)) continue;
    takenColumn.add(c.index);
    takenField.add(c.field);
    chosen.set(c.index, c);
  }

  /**
   * A file with `fullName` *and* `firstName` mapped is a file where the name
   * would be written twice. The split columns win, because they are the more
   * specific statement.
   */
  if (chosen.size) {
    const hasSplit = [...chosen.values()].some(c => c.field === 'firstName' || c.field === 'lastName');
    if (hasSplit) {
      for (const [index, c] of chosen) if (c.field === 'fullName') chosen.delete(index);
    }
  }

  return columns.map((header, index) => {
    const pick = chosen.get(index);
    const values = columnValues[index];
    const filled = values.filter(v => v !== '').length;
    const sample = values.filter(v => v !== '').slice(0, 3);

    if (!pick) {
      return {
        index, header, field: null, confidence: 'unsure' as Confidence,
        reason: 'Not recognised', sample, filled,
      };
    }

    const confidence: Confidence =
      pick.score >= 95 ? 'certain' : pick.score >= 65 ? 'likely' : 'unsure';

    return { index, header, field: pick.field, confidence, reason: pick.reason, sample, filled };
  });
}
