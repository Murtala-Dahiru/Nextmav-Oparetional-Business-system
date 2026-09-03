import type { PayrollRules } from '@/lib/payroll';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Starting points for a payroll ruleset.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Structures, not legal advice, and the difference is the whole reason this
 * file has a header.
 *
 * ── What these are ───────────────────────────────────────────────────────
 *
 * Each is a filled-in form showing the *shape* a jurisdiction's payroll takes:
 * a percentage contribution on base pay, a marginal band table on an annualised
 * taxable figure, a relief applied before the bands, an employer contribution
 * that never touches net pay. Somebody setting up payroll for the first time
 * gets a working example to edit rather than an empty JSON box.
 *
 * ── What they are not ────────────────────────────────────────────────────
 *
 * They are **not** confirmed current law, and nothing in this product says they
 * are. Every ruleset created from one of these lands with
 * `is_statutory_complete = false`, and the create endpoint refuses to accept
 * `true` at all - the flag can only be set later, by a person, on the edit
 * endpoint, after they have checked the numbers against the actual authority.
 * Until then `describeRuleset()` returns "Treat these figures as an estimate"
 * and every payroll screen prints it.
 *
 * That is the brief's rule made mechanical: do not claim a payroll calculation
 * is legally compliant for a jurisdiction unless the required rules actually
 * exist. Rates change with a budget; a file in a git repository does not.
 *
 * ── The flat one is not a placeholder ────────────────────────────────────
 *
 * `flat_percentage` is a real, useful ruleset for an organisation whose
 * obligations genuinely are a single rate, and it is the honest default for an
 * organisation that has not yet worked out what its obligations are - because
 * it computes something explicable rather than pretending to be a tax
 * authority.
 */

export interface StarterRuleset {
  key: string;
  name: string;
  countryCode: string;
  currency: string;
  note: string;
  rules: PayrollRules;
}

export const STARTER_RULESETS: StarterRuleset[] = [
  {
    key: 'flat_percentage',
    name: 'Single-rate deduction',
    countryCode: 'NG',
    currency: 'NGN',
    note:
      'One percentage of gross pay. Correct where that genuinely is the ' +
      'obligation, and an explicable starting point where the statutory rules ' +
      'have not been entered yet.',
    rules: {
      roundTo: 2,
      steps: [
        {
          code: 'TAX',
          label: 'Income tax',
          kind: 'deduction',
          method: 'percent',
          basis: 'gross',
          rate: 0.1,
        },
      ],
    },
  },
  {
    key: 'pension_and_bands',
    name: 'Pension and banded income tax',
    countryCode: 'NG',
    currency: 'NGN',
    note:
      'The common shape: an employee pension contribution on base pay, a ' +
      'matching employer contribution, and a marginal income tax on what is ' +
      'left, annualised so the bands mean what they say. The rates below are ' +
      'illustrative - replace them with the current ones before marking this ' +
      'ruleset statutory-complete.',
    rules: {
      roundTo: 2,
      steps: [
        {
          code: 'PENSION_EE',
          label: 'Pension (employee)',
          kind: 'deduction',
          method: 'percent',
          basis: 'base',
          rate: 0.08,
          employmentTypes: ['full_time', 'part_time', 'contract'],
        },
        {
          code: 'PENSION_ER',
          label: 'Pension (employer)',
          kind: 'employer_cost',
          method: 'percent',
          basis: 'base',
          rate: 0.1,
          employmentTypes: ['full_time', 'part_time', 'contract'],
        },
        {
          code: 'PAYE',
          label: 'Income tax',
          kind: 'deduction',
          method: 'bands',
          /* After the pension, which is the point of naming a basis. */
          basis: 'net_so_far',
          annualise: true,
          reliefs: [{ kind: 'percent_of_basis', rate: 0.2, minimum: 200_000 }],
          bands: [
            { upTo: 300_000, rate: 0.07 },
            { upTo: 600_000, rate: 0.11 },
            { upTo: 1_100_000, rate: 0.15 },
            { upTo: 1_600_000, rate: 0.19 },
            { upTo: 3_200_000, rate: 0.21 },
            /* Open-ended, or the highest earners pay nothing above the last
               ceiling. `validateRules()` refuses a ruleset without this. */
            { upTo: null, rate: 0.24 },
          ],
        },
      ],
    },
  },
  {
    key: 'gross_only',
    name: 'No deductions',
    countryCode: 'NG',
    currency: 'NGN',
    note:
      'Net equals gross. For an organisation that pays contractors, or one ' +
      'recording pay in NextMav while a payroll bureau handles the statutory ' +
      'side.',
    rules: { roundTo: 2, steps: [] },
  },
];
