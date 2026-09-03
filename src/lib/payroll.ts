/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The payroll engine.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One pure function. Given a person's compensation, their recurring
 * allowances, and the organisation's ruleset, it returns the lines that make
 * up a payslip and the totals over them. It reads nothing, writes nothing and
 * has no clock, so the same inputs always produce the same payslip - which is
 * what lets `payroll_items.workings` freeze the result and still be defensible
 * a year later.
 *
 * ── The one decision that matters ────────────────────────────────────────
 *
 * **No jurisdiction's rules are in this file.**
 *
 * There is no `if (country === 'NG')`. A ruleset is an ordered list of steps,
 * each naming a basis, a method and a rate, and this evaluates them. Nigerian
 * PAYE with its consolidated relief, a flat pension contribution and a UK-style
 * banded system are three rows in `payroll_rulesets`, not three branches here.
 *
 * That is the whole reason the schema stores `rules` as JSONB rather than
 * columns: a table with `paye_rate` and `pension_rate` in it is a product that
 * ships to exactly one country, and adding the second one means a migration,
 * a deployment, and a schema that grows a column per tax authority for ever.
 *
 * ── And the honest half ──────────────────────────────────────────────────
 *
 * A ruleset carries `isStatutoryComplete`, defaulted to false by the database.
 * This engine will happily evaluate an empty ruleset and return gross = net;
 * what it will not do is let a screen imply that is a legal calculation.
 * `describeRuleset()` below is what every payroll surface renders, and it says
 * plainly when nobody has implemented the jurisdiction.
 *
 * ── Bases, and why `net_so_far` exists ───────────────────────────────────
 *
 * A step's `basis` names what it is computed over:
 *
 *   base           the contracted base pay for the period
 *   gross          base plus every earning, including untaxed ones
 *   taxable_gross  base plus taxable earnings only
 *   net_so_far     gross less every deduction applied before this step
 *   <step code>    the amount an earlier step produced
 *
 * The last two are what make ordering meaningful. A pension computed on base
 * and a tax computed on "gross less pension" are the ordinary shape of a
 * payslip in most of the world, and neither is expressible without naming what
 * came before.
 */

// ─── The declarative vocabulary ────────────────────────────────────────────

export type PayComponentKind = 'earning' | 'deduction' | 'employer_cost';

export type StepMethod = 'fixed' | 'percent' | 'bands';

export type StepBasis =
  | 'base'
  | 'gross'
  | 'taxable_gross'
  | 'net_so_far'
  | (string & {});

/**
 * A relief reduces the basis before a banded calculation runs.
 *
 * Two shapes, because those are the two that exist in practice: a percentage
 * of the basis, and a flat allowance. Nigeria's consolidated relief is both at
 * once, which is why this is a list rather than one field.
 */
export interface StepRelief {
  kind: 'percent_of_basis' | 'fixed';
  rate?: number;
  amount?: number;
  /** Floors a percentage relief, e.g. "20% or ₦200,000, whichever is greater". */
  minimum?: number;
}

export interface RuleBand {
  /** Top of this band on the annualised basis. `null` is "everything above". */
  upTo: number | null;
  rate: number;
}

export interface RuleStep {
  code: string;
  label: string;
  kind: PayComponentKind;
  method: StepMethod;
  basis?: StepBasis;

  /** method: 'fixed' */
  amount?: number;
  /** method: 'percent' */
  rate?: number;
  /** method: 'bands' */
  bands?: RuleBand[];
  reliefs?: StepRelief[];

  /**
   * Evaluate the bands on the *annual* basis and divide the answer by the
   * number of periods in the year.
   *
   * Tax bands are annual figures everywhere. Running a monthly salary through
   * annual bands puts everybody in the lowest one and understates the tax by
   * an order of magnitude, which is the single most common way a hand-rolled
   * payroll is wrong.
   */
  annualise?: boolean;

  min?: number;
  max?: number;
  /** For an earning: does it enter `taxable_gross`. Default true. */
  taxable?: boolean;
  /** Skip the step unless the employment type is in this list. */
  employmentTypes?: string[];
}

export interface PayrollRules {
  /** Decimal places every produced amount is rounded to. Default 2. */
  roundTo?: number;
  steps: RuleStep[];
}

export interface RulesetSummary {
  id: string | null;
  name: string;
  countryCode: string;
  currency: string;
  isStatutoryComplete: boolean;
  statutoryNote: string;
  rules: PayrollRules;
}

// ─── Inputs ────────────────────────────────────────────────────────────────

export interface ComponentInput {
  code: string;
  label: string;
  kind: PayComponentKind;
  calculation: 'fixed' | 'percent_of_base';
  amount?: number | null;
  rate?: number | null;
  isTaxable?: boolean;
}

export interface PayrollInput {
  /** The base for *this period*, already converted from the contract's period. */
  basePerPeriod: number;
  employmentType?: string | null;
  components: ComponentInput[];
  periodsPerYear: number;
  rules: PayrollRules;
}

export interface ComputedLine {
  code: string;
  label: string;
  kind: PayComponentKind;
  amount: number;
  source: 'base' | 'component' | 'rule' | 'manual';
  explanation: string;
  sequence: number;
}

export interface PayrollResult {
  lines: ComputedLine[];
  base: number;
  gross: number;
  taxableGross: number;
  totalDeductions: number;
  net: number;
  employerCost: number;
  /** Every step that was skipped, and why. Rendered on the payslip's detail. */
  skipped: Array<{ code: string; reason: string }>;
}

// ─── Converting a contract to a period ─────────────────────────────────────

const PERIODS_PER_YEAR: Record<string, number> = {
  annual: 1,
  monthly: 12,
  weekly: 52,
  daily: 260,
  hourly: 2080,
};

/**
 * A contracted amount expressed for the pay period being run.
 *
 * An annual salary of 12,000,000 in a monthly run is 1,000,000; the same
 * salary in a weekly run is 12,000,000 / 52. Going through the annual figure
 * rather than a table of pair-wise conversions is what keeps a quarterly or
 * fortnightly period from needing new code.
 *
 * `daily` and `hourly` use 260 working days and 2,080 hours, the conventional
 * full-time year. They are approximations by nature - a person paid hourly
 * should be paid for hours worked, which is a timesheet question this function
 * cannot answer - so a caller with real hours should pass the amount directly.
 */
export function amountForPeriod(
  amount: number,
  contractPeriod: string,
  periodsPerYear: number,
): number {
  const perYear = PERIODS_PER_YEAR[contractPeriod] ?? 12;
  const annual = amount * perYear;
  return annual / Math.max(1, periodsPerYear);
}

// ─── Arithmetic ────────────────────────────────────────────────────────────

function round(value: number, places: number): number {
  const f = 10 ** places;
  /**
   * `Math.round(x * 100) / 100` is wrong for exactly the values money is made
   * of: 1.005 * 100 is 100.49999999999999 in binary floating point, so it
   * rounds down. Nudging by an epsilon proportional to the magnitude fixes the
   * representation error without moving a value that is genuinely below the
   * midpoint.
   */
  const scaled = value * f;
  const nudged = scaled + (scaled >= 0 ? 1e-8 : -1e-8);
  return Math.round(nudged) / f;
}

/**
 * Marginal bands, applied cumulatively.
 *
 * Each band's rate applies only to the slice of the basis that falls inside
 * it, which is what "marginal" means and what a flat lookup gets wrong: a
 * person one naira over a threshold pays the higher rate on that one naira,
 * not on everything.
 */
function applyBands(basis: number, bands: RuleBand[]): number {
  let remaining = Math.max(0, basis);
  let previousCeiling = 0;
  let total = 0;

  for (const band of bands) {
    if (remaining <= 0) break;
    const ceiling = band.upTo ?? Number.POSITIVE_INFINITY;
    const width = ceiling - previousCeiling;
    const slice = Math.min(remaining, width);
    total += slice * band.rate;
    remaining -= slice;
    previousCeiling = ceiling;
  }

  return total;
}

function applyReliefs(basis: number, reliefs: StepRelief[] | undefined): number {
  if (!reliefs?.length) return basis;

  let relieved = basis;
  for (const relief of reliefs) {
    if (relief.kind === 'percent_of_basis') {
      const byRate = basis * (relief.rate ?? 0);
      relieved -= Math.max(byRate, relief.minimum ?? 0);
    } else {
      relieved -= relief.amount ?? 0;
    }
  }
  return Math.max(0, relieved);
}

// ─── The engine ────────────────────────────────────────────────────────────

/**
 * Compute one person's pay for one period.
 *
 * Order is significant and is the ruleset author's to choose: components are
 * applied first (they are contractual), then the steps in the order they are
 * written. A step's basis may name any earlier step, and naming a later one is
 * treated as zero rather than an error, because a payslip that refuses to
 * compute is worse than one that shows an obviously wrong line somebody can
 * see and fix.
 */
export function computePayroll(input: PayrollInput): PayrollResult {
  const places = input.rules.roundTo ?? 2;
  const lines: ComputedLine[] = [];
  const skipped: Array<{ code: string; reason: string }> = [];
  const produced = new Map<string, number>();

  let sequence = 0;
  const base = round(input.basePerPeriod, places);

  lines.push({
    code: 'BASE',
    label: 'Base pay',
    kind: 'earning',
    amount: base,
    source: 'base',
    explanation: 'Contracted base pay for this period',
    sequence: sequence++,
  });

  let gross = base;
  let taxableGross = base;

  // ── Contractual components ──────────────────────────────────────────────
  for (const c of input.components) {
    const raw =
      c.calculation === 'fixed'
        ? Number(c.amount ?? 0)
        : base * Number(c.rate ?? 0);
    const amount = round(raw, places);
    if (amount === 0) continue;

    const explanation =
      c.calculation === 'fixed'
        ? 'Fixed amount'
        : `${(Number(c.rate ?? 0) * 100).toFixed(2)}% of base pay`;

    lines.push({
      code: c.code,
      label: c.label,
      kind: c.kind,
      amount,
      source: 'component',
      explanation,
      sequence: sequence++,
    });
    produced.set(c.code, amount);

    if (c.kind === 'earning') {
      gross += amount;
      if (c.isTaxable !== false) taxableGross += amount;
    }
  }

  gross = round(gross, places);
  taxableGross = round(taxableGross, places);

  // ── Ruleset steps ───────────────────────────────────────────────────────
  let deductionsSoFar = 0;
  let employerCost = 0;

  for (const step of input.rules.steps ?? []) {
    if (
      step.employmentTypes?.length &&
      input.employmentType &&
      !step.employmentTypes.includes(input.employmentType)
    ) {
      skipped.push({
        code: step.code,
        reason: `Does not apply to ${input.employmentType.replace(/_/g, ' ')} employment`,
      });
      continue;
    }

    const basisName = step.basis ?? 'gross';
    const basis =
      basisName === 'base' ? base
      : basisName === 'gross' ? gross
      : basisName === 'taxable_gross' ? taxableGross
      : basisName === 'net_so_far' ? round(gross - deductionsSoFar, places)
      : produced.get(basisName) ?? 0;

    let amount = 0;
    let explanation = '';

    if (step.method === 'fixed') {
      amount = Number(step.amount ?? 0);
      explanation = 'Fixed amount';
    } else if (step.method === 'percent') {
      const rate = Number(step.rate ?? 0);
      amount = basis * rate;
      explanation = `${(rate * 100).toFixed(2)}% of ${basisLabel(basisName)} (${basis.toFixed(2)})`;
    } else {
      const factor = step.annualise ? Math.max(1, input.periodsPerYear) : 1;
      const annualBasis = basis * factor;
      const relieved = applyReliefs(annualBasis, step.reliefs);
      const annualAmount = applyBands(relieved, step.bands ?? []);
      amount = annualAmount / factor;
      explanation = step.annualise
        ? `Banded on annualised ${basisLabel(basisName)} of ${annualBasis.toFixed(2)}` +
          (step.reliefs?.length ? `, ${relieved.toFixed(2)} after relief` : '') +
          `, divided by ${factor} periods`
        : `Banded on ${basisLabel(basisName)} (${relieved.toFixed(2)})`;
    }

    if (step.min !== undefined) amount = Math.max(amount, step.min);
    if (step.max !== undefined) amount = Math.min(amount, step.max);
    amount = round(amount, places);

    if (amount === 0) {
      skipped.push({ code: step.code, reason: 'Computed to zero' });
      continue;
    }

    lines.push({
      code: step.code,
      label: step.label,
      kind: step.kind,
      amount,
      source: 'rule',
      explanation,
      sequence: sequence++,
    });
    produced.set(step.code, amount);

    if (step.kind === 'deduction') {
      deductionsSoFar = round(deductionsSoFar + amount, places);
    } else if (step.kind === 'employer_cost') {
      employerCost = round(employerCost + amount, places);
    } else {
      gross = round(gross + amount, places);
      if (step.taxable !== false) taxableGross = round(taxableGross + amount, places);
    }
  }

  /**
   * Deductions carried on the person's own record, applied after the ruleset.
   *
   * A contractual deduction - a salary advance being repaid, a union
   * subscription - is not part of the jurisdiction's arithmetic and must not
   * change the basis a tax step was computed over. So it is counted here,
   * against net, rather than folded into `deductionsSoFar` above.
   */
  const componentDeductions = lines
    .filter(l => l.source === 'component' && l.kind === 'deduction')
    .reduce((sum, l) => sum + l.amount, 0);

  const componentEmployerCost = lines
    .filter(l => l.source === 'component' && l.kind === 'employer_cost')
    .reduce((sum, l) => sum + l.amount, 0);

  const totalDeductions = round(deductionsSoFar + componentDeductions, places);

  return {
    lines,
    base,
    gross,
    taxableGross,
    totalDeductions,
    net: round(gross - totalDeductions, places),
    employerCost: round(employerCost + componentEmployerCost, places),
    skipped,
  };
}

function basisLabel(basis: string): string {
  switch (basis) {
    case 'base': return 'base pay';
    case 'gross': return 'gross pay';
    case 'taxable_gross': return 'taxable pay';
    case 'net_so_far': return 'pay after earlier deductions';
    default: return basis;
  }
}

// ─── Saying what a ruleset is, and is not ──────────────────────────────────

export interface RulesetVerdict {
  /** Safe to show a figure without a caveat. */
  trustworthy: boolean;
  headline: string;
  detail: string;
}

/**
 * What every payroll surface renders beside its numbers.
 *
 * Three states, and the middle one is the important one: a ruleset with steps
 * in it that nobody has certified computes something plausible, which is
 * exactly when a person is most likely to believe it. The brief is explicit
 * that a calculation must not claim compliance it does not have, and a
 * caveat that only appears when the ruleset is empty would miss that case
 * entirely.
 */
export function describeRuleset(rs: RulesetSummary | null): RulesetVerdict {
  if (!rs) {
    return {
      trustworthy: false,
      headline: 'No payroll rules configured',
      detail:
        'Gross pay is the sum of base and allowances. No tax or statutory ' +
        'deduction is applied because none has been defined for this ' +
        'organisation.',
    };
  }

  const stepCount = rs.rules?.steps?.length ?? 0;

  if (stepCount === 0) {
    return {
      trustworthy: false,
      headline: `${rs.name} defines no steps`,
      detail:
        'This ruleset applies no deductions, so net pay equals gross pay. ' +
        'Add the statutory steps for ' + rs.countryCode + ' before running a ' +
        'live payroll.',
    };
  }

  if (!rs.isStatutoryComplete) {
    return {
      trustworthy: false,
      headline: 'Not marked as statutory-complete',
      detail:
        `${rs.name} applies ${stepCount} step${stepCount === 1 ? '' : 's'}, but ` +
        'nobody has confirmed that these are the full statutory rules for ' +
        `${rs.countryCode}. Treat these figures as an estimate.` +
        (rs.statutoryNote ? ` ${rs.statutoryNote}` : ''),
    };
  }

  return {
    trustworthy: true,
    headline: `${rs.name} - ${rs.countryCode}`,
    detail:
      rs.statutoryNote ||
      `${stepCount} step${stepCount === 1 ? '' : 's'}, confirmed against the ` +
      `statutory rules for ${rs.countryCode} by whoever marked this ruleset complete.`,
  };
}

/**
 * Validate a ruleset before it is stored.
 *
 * Returns the problems rather than throwing, so the endpoint can report all of
 * them at once. A ruleset that fails here would still evaluate - the engine
 * treats missing fields as zero - and would silently pay everybody too much,
 * which is why this is strict about shapes the engine tolerates.
 */
export function validateRules(rules: unknown): string[] {
  const problems: string[] = [];
  const r = rules as PayrollRules;

  if (!r || typeof r !== 'object') return ['Rules must be an object.'];
  if (!Array.isArray(r.steps)) return ['Rules must carry a `steps` array.'];

  const seen = new Set<string>();

  r.steps.forEach((step, i) => {
    const where = `Step ${i + 1}${step?.code ? ` (${step.code})` : ''}`;
    if (!step?.code) problems.push(`${where}: needs a code.`);
    else if (seen.has(step.code)) problems.push(`${where}: duplicate code.`);
    else seen.add(step.code);

    if (!step?.label) problems.push(`${where}: needs a label.`);
    if (!['earning', 'deduction', 'employer_cost'].includes(step?.kind)) {
      problems.push(`${where}: kind must be earning, deduction or employer_cost.`);
    }

    if (step?.method === 'fixed' && typeof step.amount !== 'number') {
      problems.push(`${where}: a fixed step needs an amount.`);
    }
    if (step?.method === 'percent' && typeof step.rate !== 'number') {
      problems.push(`${where}: a percentage step needs a rate.`);
    }
    if (step?.method === 'bands') {
      if (!Array.isArray(step.bands) || step.bands.length === 0) {
        problems.push(`${where}: a banded step needs at least one band.`);
      } else {
        let last = 0;
        step.bands.forEach((band, bi) => {
          if (typeof band?.rate !== 'number') {
            problems.push(`${where}: band ${bi + 1} needs a rate.`);
          }
          if (band?.upTo !== null && typeof band?.upTo === 'number') {
            if (band.upTo <= last) {
              problems.push(`${where}: band ${bi + 1} does not rise above the one before it.`);
            }
            last = band.upTo;
          }
        });
        /* An open-ended top band, or the highest earners fall off the end and
           pay nothing on everything above the last ceiling. */
        if (step.bands[step.bands.length - 1]?.upTo !== null) {
          problems.push(`${where}: the last band must be open-ended (upTo: null).`);
        }
      }
    }
    if (!['fixed', 'percent', 'bands'].includes(step?.method)) {
      problems.push(`${where}: method must be fixed, percent or bands.`);
    }
  });

  return problems;
}
