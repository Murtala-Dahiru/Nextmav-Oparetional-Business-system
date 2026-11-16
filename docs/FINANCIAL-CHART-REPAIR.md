# Financial Report repair — 15 November 2026

## Root cause

The Executive Overview's `FinancialPerformance` in `src/components/modules/dashboard/money.tsx` uses Recharts 2.15.4, React 19.2.3 and Recharts' resolved react-is 18.3.1. Recharts' child discovery could not identify React 19 fragments. Both mode branches wrapped their series in fragments, so axes rendered without their financial series. A direct runtime reproduction returned one discovered Bar as a direct child and zero inside a fragment.

The one/two-month fallback also bypassed mode state entirely. Zero-only histories were removed from the chart, and sparse trend points had no visible dots.

## Implementation

- Made every financial series a direct chart child. Keyed the chart by mode to clear incompatible graphical/hover state while retaining the period and series selection in the parent.
- Kept the same selected monthly dataset and window totals for both modes; no fetching or recalculation is triggered by switching.
- Grouped bars with restrained spacing; linear area/lines with visible points and exact currency tooltips.
- Include zero and negative values in the domain. Compact locale-aware ticks support fractional and large amounts.
- Render one/two-month histories normally. Keep zero histories visible with a clear message; distinguish an absent history.
- Explicit payload currency for tooltip and accessible table values; retain existing organization-aware summary formatting.
- Added local active/focus/reduced-motion styling without changing the dashboard layout or KPI cards.

## Data trace

`src/app/api/dashboard/route.ts` authorizes dashboard access and includes finance only for organization-wide finance viewers. Queries retain authenticated Supabase access, organization predicates and currency predicates.

- Collected: payments.amount, grouped by paid_at in organization timezone, joined to invoice currency. Includes partial payments.
- Invoiced: issued, nondeleted invoices, excluding draft/cancelled, by issue_date.
- Spend: nondeleted approved/reimbursed expenses.amount by expense_date.
- `financialHistory` zero-fills twelve calendar months and excludes dates after the organization's current day. The UI slices the last 3/6/12 months.
- The current-month collections KPI and report use the same monthly aggregation. Window summaries intentionally describe the selected range, rather than the current-month KPI.
- Errors or truncated financial queries withhold financial totals and show the existing unavailable notice. No query, permission, migration or record was changed.

## Files changed in this task

- src/components/modules/dashboard/money.tsx
- src/components/modules/dashboard/command-centre.css
- scripts/dashboard-finance.test.mts
- scripts/financial-chart-browser.mjs
- This report, financial-chart validation logs and docs/financial-chart-evidence screenshots.

Existing uncommitted work in these files and elsewhere was retained. Temporary Next.js test-directory entries were removed from tsconfig after verification.

## Verification

- `npx tsc --noEmit`: passed.
- Targeted ESLint for money.tsx: passed.
- `npx tsx scripts/dashboard-finance.test.mts`: passed (timezone boundary, partial payment, currency exclusion, drafts, missing months, aging, signed/fractional/large amounts, future exclusion and selected-range sums).
- `npm run build`: passed, including TypeScript, 188 generated pages and standalone packaging.
- Authenticated API reads: history sums reconcile to revenue and expense totals; latest month reconciles to current-month collections KPI.
- Browser suite: repeated Bar/Trend switching at 1440, 768 and 390 pixels, each at 3/6/12 months; pressed state and period preserved; expected SVG series present; exact tooltip collections verified; responsive dimensions and no document/section horizontal overflow.
- Browser edge cases: zero, absent history, one-month data, negative/fractional/large amounts, loading, API failure and withheld partial results. No unexpected console/runtime errors. Deliberate HTTP 500 errors are expected in failure tests.

## Evidence and limitations

Populated screenshots are explicitly labelled browser-only TEST FIXTURE data. No demonstration values were added to application code or persisted to business records. The existing authorized test account had zero financial activity, so populated rendering and tooltip tests used intercepted responses, while calculation tests used controlled source records. This does not claim a populated production-ledger reconciliation or a new cross-tenant penetration test. Existing tenant/permission enforcement was inspected and left unchanged.

The existing report supports up to twelve months and withholds totals when a financial query exceeds its existing safe record limit; this repair does not change that reporting policy.

Screenshots: bars-1440.png, trend-1440.png, bars-390.png, trend-390.png in financial-chart-evidence. Browser script accepts APP_URL and FINANCE_TEST_SESSION (an existing authorized test-session JSON path). It performs no financial writes.

The full browser suite also passed against the production standalone server; see financial-chart-production-browser.txt. Final screenshots were captured from that production run.
