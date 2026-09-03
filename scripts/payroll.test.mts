/**
 * The payroll engine.
 *
 *     npm run test:payroll             (no server or database needed)
 *
 * Payroll is the one calculation in this product whose failure is both silent
 * and unrecoverable: a wrong figure is paid, and the person finds out from
 * their bank rather than from the screen. So the properties asserted here are
 * the ones that produce a plausible number rather than an error.
 *
 * The Nigerian ruleset below is used as a *fixture* and not as a claim: it
 * exercises consolidated relief, marginal bands and annualisation together,
 * which is the hardest shape the engine has to evaluate. Whether it is
 * currently correct law is exactly what `isStatutoryComplete` exists to say,
 * and this file does not assert that it is.
 */
const {
  computePayroll,
  amountForPeriod,
  describeRuleset,
  validateRules,
} = await import('../src/lib/payroll');

type Rules = Parameters<typeof computePayroll>[0]['rules'];

let pass = 0, fail = 0;

const check = (ok: boolean, label: string, detail = '') => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} | ${label}${ok || !detail ? '' : `  (${detail})`}`);
};

const near = (a: number, b: number, tolerance = 0.02) => Math.abs(a - b) <= tolerance;
const section = (t: string) => console.log(`\n${t}\n${'-'.repeat(t.length)}`);

const EMPTY: Rules = { steps: [] };

// ───────────────────────────────────────────────────────────────────────────
section('1. An empty ruleset pays gross, and says nothing else happened');
// ───────────────────────────────────────────────────────────────────────────
{
  const r = computePayroll({
    basePerPeriod: 500_000,
    components: [],
    periodsPerYear: 12,
    rules: EMPTY,
  });

  check(r.gross === 500_000, 'gross is the base when nothing else applies');
  check(r.net === 500_000, 'and net equals gross');
  check(r.lines.length === 1 && r.lines[0].code === 'BASE',
    'one line, and it is the base');

  const verdict = describeRuleset({
    id: null, name: 'Untitled', countryCode: 'NG', currency: 'NGN',
    isStatutoryComplete: false, statutoryNote: '', rules: EMPTY,
  });
  check(!verdict.trustworthy, 'an empty ruleset is never trustworthy');
  check(/no steps/i.test(verdict.headline), 'and says so in the headline', verdict.headline);
}

// ───────────────────────────────────────────────────────────────────────────
section('2. Components: fixed, percentage, taxable and not');
// ───────────────────────────────────────────────────────────────────────────
{
  const r = computePayroll({
    basePerPeriod: 400_000,
    periodsPerYear: 12,
    rules: EMPTY,
    components: [
      { code: 'HOUSING', label: 'Housing', kind: 'earning',
        calculation: 'percent_of_base', rate: 0.25, isTaxable: true },
      { code: 'TRANSPORT', label: 'Transport', kind: 'earning',
        calculation: 'fixed', amount: 50_000, isTaxable: false },
      { code: 'ADVANCE', label: 'Salary advance', kind: 'deduction',
        calculation: 'fixed', amount: 20_000 },
    ],
  });

  check(r.gross === 550_000, 'gross counts every earning', String(r.gross));
  check(r.taxableGross === 500_000,
    'a non-taxable allowance stays out of taxable pay', String(r.taxableGross));
  check(r.totalDeductions === 20_000, 'a component deduction is counted');
  check(r.net === 530_000, 'net is gross less deductions', String(r.net));
  check(r.lines.filter(l => l.source === 'component').length === 3,
    'each component produces one line');
}

// ───────────────────────────────────────────────────────────────────────────
section('3. Marginal bands are marginal, and annualisation is real');
// ───────────────────────────────────────────────────────────────────────────
{
  /** A single 10% band above 1,000,000 a year, nothing below. */
  const rules: Rules = {
    steps: [{
      code: 'TAX', label: 'Tax', kind: 'deduction',
      method: 'bands', basis: 'taxable_gross', annualise: true,
      bands: [{ upTo: 1_000_000, rate: 0 }, { upTo: null, rate: 0.1 }],
    }],
  };

  const low = computePayroll({
    basePerPeriod: 50_000, components: [], periodsPerYear: 12, rules,
  });
  check(low.totalDeductions === 0,
    'somebody under the threshold pays nothing', String(low.totalDeductions));

  /* 200,000/month is 2,400,000/year: 1,000,000 at 0% and 1,400,000 at 10%
     = 140,000 a year = 11,666.67 a month. Not 10% of the whole. */
  const high = computePayroll({
    basePerPeriod: 200_000, components: [], periodsPerYear: 12, rules,
  });
  check(near(high.totalDeductions, 11_666.67),
    'only the slice above the threshold is taxed', String(high.totalDeductions));
  check(high.totalDeductions < 20_000,
    'and it is not a flat rate on the whole amount');

  const notAnnualised = computePayroll({
    basePerPeriod: 200_000, components: [], periodsPerYear: 12,
    rules: { steps: [{ ...rules.steps[0], annualise: false }] },
  });
  check(notAnnualised.totalDeductions === 0,
    'without annualisation a monthly salary falls in the lowest band - which is '
    + 'the bug annualise exists to prevent');
}

// ───────────────────────────────────────────────────────────────────────────
section('4. Bases compose: a tax computed on pay after pension');
// ───────────────────────────────────────────────────────────────────────────
{
  const rules: Rules = {
    steps: [
      { code: 'PENSION', label: 'Pension', kind: 'deduction',
        method: 'percent', basis: 'base', rate: 0.08 },
      { code: 'TAX', label: 'Tax', kind: 'deduction',
        method: 'percent', basis: 'net_so_far', rate: 0.1 },
    ],
  };

  const r = computePayroll({
    basePerPeriod: 100_000, components: [], periodsPerYear: 12, rules,
  });

  check(r.lines.find(l => l.code === 'PENSION')?.amount === 8_000, 'pension is 8% of base');
  /* net_so_far is 100,000 - 8,000 = 92,000; 10% of that is 9,200. */
  check(r.lines.find(l => l.code === 'TAX')?.amount === 9_200,
    'tax reads the deduction that ran before it',
    String(r.lines.find(l => l.code === 'TAX')?.amount));
  check(r.net === 82_800, 'and net accounts for both', String(r.net));
}

// ───────────────────────────────────────────────────────────────────────────
section('5. A step may name an earlier step');
// ───────────────────────────────────────────────────────────────────────────
{
  const rules: Rules = {
    steps: [
      { code: 'PENSION_EE', label: 'Pension (employee)', kind: 'deduction',
        method: 'percent', basis: 'base', rate: 0.08 },
      { code: 'PENSION_ER', label: 'Pension (employer)', kind: 'employer_cost',
        method: 'percent', basis: 'PENSION_EE', rate: 1.25 },
    ],
  };

  const r = computePayroll({
    basePerPeriod: 100_000, components: [], periodsPerYear: 12, rules,
  });

  check(r.employerCost === 10_000,
    'the employer contribution is computed from the employee one', String(r.employerCost));
  check(r.net === 92_000, 'and an employer cost never touches net pay', String(r.net));
  check(r.gross === 100_000, 'nor gross');
}

// ───────────────────────────────────────────────────────────────────────────
section('6. Reliefs, and the greater-of rule');
// ───────────────────────────────────────────────────────────────────────────
{
  const rules: Rules = {
    steps: [{
      code: 'PAYE', label: 'PAYE', kind: 'deduction',
      method: 'bands', basis: 'taxable_gross', annualise: true,
      reliefs: [{ kind: 'percent_of_basis', rate: 0.2, minimum: 200_000 }],
      bands: [{ upTo: null, rate: 0.1 }],
    }],
  };

  /* 100,000/month = 1,200,000/year. 20% is 240,000, above the 200,000 floor,
     so relief is 240,000 and the taxed amount is 960,000 -> 96,000/year. */
  const higher = computePayroll({
    basePerPeriod: 100_000, components: [], periodsPerYear: 12, rules,
  });
  check(near(higher.totalDeductions, 8_000),
    'the percentage applies when it exceeds the floor', String(higher.totalDeductions));

  /* 50,000/month = 600,000/year. 20% is 120,000, below the floor, so relief is
     200,000 and the taxed amount is 400,000 -> 40,000/year. */
  const lower = computePayroll({
    basePerPeriod: 50_000, components: [], periodsPerYear: 12, rules,
  });
  check(near(lower.totalDeductions, 3_333.33),
    'and the floor applies when the percentage is smaller', String(lower.totalDeductions));
}

// ───────────────────────────────────────────────────────────────────────────
section('7. Employment type gates a step, and says why it was skipped');
// ───────────────────────────────────────────────────────────────────────────
{
  const rules: Rules = {
    steps: [{
      code: 'PENSION', label: 'Pension', kind: 'deduction',
      method: 'percent', basis: 'base', rate: 0.08,
      employmentTypes: ['full_time'],
    }],
  };

  const intern = computePayroll({
    basePerPeriod: 100_000, employmentType: 'intern',
    components: [], periodsPerYear: 12, rules,
  });
  check(intern.totalDeductions === 0, 'the step does not apply to an intern');
  check(intern.skipped.some(s => s.code === 'PENSION'),
    'and the payslip records that it was skipped');
  check(/intern/i.test(intern.skipped[0]?.reason ?? ''),
    'with a reason a person can read', intern.skipped[0]?.reason);

  const staff = computePayroll({
    basePerPeriod: 100_000, employmentType: 'full_time',
    components: [], periodsPerYear: 12, rules,
  });
  check(staff.totalDeductions === 8_000, 'and it does apply to a full-time employee');
}

// ───────────────────────────────────────────────────────────────────────────
section('8. Converting a contract to the period being run');
// ───────────────────────────────────────────────────────────────────────────
{
  check(amountForPeriod(12_000_000, 'annual', 12) === 1_000_000,
    'an annual salary in a monthly run');
  check(amountForPeriod(1_000_000, 'monthly', 12) === 1_000_000,
    'a monthly salary in a monthly run is itself');
  check(amountForPeriod(1_000_000, 'monthly', 24) === 500_000,
    'and halves in a fortnightly one');
  check(near(amountForPeriod(12_000_000, 'annual', 52), 230_769.23),
    'an annual salary in a weekly run goes through the year, not through months');
}

// ───────────────────────────────────────────────────────────────────────────
section('9. Rounding is money rounding, not float rounding');
// ───────────────────────────────────────────────────────────────────────────
{
  const r = computePayroll({
    basePerPeriod: 100.5, components: [], periodsPerYear: 12,
    rules: { steps: [{ code: 'X', label: 'X', kind: 'deduction',
      method: 'percent', basis: 'base', rate: 0.01 }] },
  });
  /* 1.005 rounds to 1.01, not to 1.00 as naive Math.round(x*100)/100 gives. */
  check(r.lines.find(l => l.code === 'X')?.amount === 1.01,
    'a half-penny rounds up rather than falling to the float below it',
    String(r.lines.find(l => l.code === 'X')?.amount));
}

// ───────────────────────────────────────────────────────────────────────────
section('10. A ruleset with steps but no certification is still not trusted');
// ───────────────────────────────────────────────────────────────────────────
{
  const populated: Rules = {
    steps: [{ code: 'TAX', label: 'Tax', kind: 'deduction',
      method: 'percent', basis: 'gross', rate: 0.1 }],
  };

  const uncertified = describeRuleset({
    id: 'x', name: 'Nigeria PAYE', countryCode: 'NG', currency: 'NGN',
    isStatutoryComplete: false, statutoryNote: '', rules: populated,
  });
  check(!uncertified.trustworthy,
    'a plausible ruleset nobody has confirmed is the dangerous case, and is flagged');
  check(/estimate/i.test(uncertified.detail),
    'and the wording says estimate', uncertified.detail);

  const certified = describeRuleset({
    id: 'x', name: 'Nigeria PAYE', countryCode: 'NG', currency: 'NGN',
    isStatutoryComplete: true, statutoryNote: 'Finance Act 2023.', rules: populated,
  });
  check(certified.trustworthy, 'and a confirmed one is trusted');
  check(describeRuleset(null).trustworthy === false, 'no ruleset at all is never trusted');
}

// ───────────────────────────────────────────────────────────────────────────
section('11. Validation catches the shapes that would pay too much');
// ───────────────────────────────────────────────────────────────────────────
{
  check(validateRules({ steps: [] }).length === 0, 'an empty ruleset is valid, if useless');
  check(validateRules(null).length === 1, 'a non-object is rejected');
  check(validateRules({}).length === 1, 'so is one with no steps array');

  const noCode = validateRules({ steps: [{ label: 'x', kind: 'deduction', method: 'fixed', amount: 1 }] });
  check(noCode.some(p => /needs a code/.test(p)), 'a step with no code is caught');

  const dupes = validateRules({ steps: [
    { code: 'A', label: 'A', kind: 'deduction', method: 'fixed', amount: 1 },
    { code: 'A', label: 'A', kind: 'deduction', method: 'fixed', amount: 1 },
  ] });
  check(dupes.some(p => /duplicate/.test(p)), 'a duplicate code is caught');

  const openEnded = validateRules({ steps: [{
    code: 'T', label: 'T', kind: 'deduction', method: 'bands',
    bands: [{ upTo: 100, rate: 0.1 }],
  }] });
  check(openEnded.some(p => /open-ended/.test(p)),
    'a banded step whose top band is closed is caught - without it the highest '
    + 'earners pay nothing above the last ceiling');

  const descending = validateRules({ steps: [{
    code: 'T', label: 'T', kind: 'deduction', method: 'bands',
    bands: [{ upTo: 500, rate: 0.1 }, { upTo: 100, rate: 0.2 }, { upTo: null, rate: 0.3 }],
  }] });
  check(descending.some(p => /does not rise/.test(p)), 'bands that go backwards are caught');

  const missingRate = validateRules({ steps: [
    { code: 'P', label: 'P', kind: 'deduction', method: 'percent' },
  ] });
  check(missingRate.some(p => /needs a rate/.test(p)),
    'a percentage step with no rate is caught - the engine would treat it as zero '
    + 'and deduct nothing');
}

// ───────────────────────────────────────────────────────────────────────────
section('12. A full run, end to end');
// ───────────────────────────────────────────────────────────────────────────
{
  const rules: Rules = {
    roundTo: 2,
    steps: [
      { code: 'PENSION_EE', label: 'Pension (employee)', kind: 'deduction',
        method: 'percent', basis: 'base', rate: 0.08 },
      { code: 'PENSION_ER', label: 'Pension (employer)', kind: 'employer_cost',
        method: 'percent', basis: 'base', rate: 0.1 },
      { code: 'PAYE', label: 'Income tax', kind: 'deduction',
        method: 'bands', basis: 'taxable_gross', annualise: true,
        reliefs: [{ kind: 'percent_of_basis', rate: 0.2, minimum: 200_000 }],
        bands: [
          { upTo: 300_000, rate: 0.07 },
          { upTo: 600_000, rate: 0.11 },
          { upTo: null, rate: 0.19 },
        ] },
    ],
  };

  const r = computePayroll({
    basePerPeriod: 400_000,
    employmentType: 'full_time',
    periodsPerYear: 12,
    rules,
    components: [
      { code: 'HOUSING', label: 'Housing', kind: 'earning',
        calculation: 'percent_of_base', rate: 0.2, isTaxable: true },
    ],
  });

  check(r.gross === 480_000, 'gross includes the housing allowance', String(r.gross));
  check(r.lines.find(l => l.code === 'PENSION_EE')?.amount === 32_000, 'pension on base');
  check(r.employerCost === 40_000, 'employer cost is separate from both', String(r.employerCost));
  check(r.net < r.gross && r.net > 0, 'net is between zero and gross', String(r.net));
  check(near(r.gross - r.totalDeductions, r.net),
    'and net is exactly gross less the deductions listed');

  const sumEarnings = r.lines.filter(l => l.kind === 'earning')
    .reduce((s, l) => s + l.amount, 0);
  check(sumEarnings === r.gross,
    'the earning lines add up to the gross printed above them', `${sumEarnings} vs ${r.gross}`);

  const sumDeductions = r.lines.filter(l => l.kind === 'deduction')
    .reduce((s, l) => s + l.amount, 0);
  check(near(sumDeductions, r.totalDeductions),
    'and the deduction lines add up to the deductions total',
    `${sumDeductions} vs ${r.totalDeductions}`);

  check(r.lines.every(l => l.explanation.length > 0),
    'every line explains how it was arrived at');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
