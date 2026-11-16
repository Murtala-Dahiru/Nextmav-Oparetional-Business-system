> Latest continuation evidence: [CRM-3-CONTINUATION-AUDIT.md](CRM-3-CONTINUATION-AUDIT.md). Earlier missing-schema statements below are historical: foundation deployment was freshly verified and reporting migrations 0065–0066 added. Prompt 1 remains subject to the acceptance gates in that report.

# CRM 3.0 progress

## Current Prompt 1 continuation — 2026-10-25

See `CRM-3-PROMPT-1-HANDOFF.md` for the current capability matrix, implementation report, verification and mandatory goal achievement audit. Prompt 1 remains incomplete; the previous eight-phase roadmap does not authorize starting Prompt 2 or Prompt 3.

This continuation adds real-data won-value, source, deal-aging and loss-reason charts, accessible chart data, complete follow-up/new-lead/stale counts, explicit preview labels and activity-view navigation. It preserves the existing platform and does not deploy schema changes. Existing conversion/account-summary migrations passed rollback-only preflight but their functions are absent from the configured database. A separate staging environment is recommended before write acceptance tests.

## Scope of this pass — 2026-10-24

Completed a source audit and recorded the capability matrix, preservation boundaries, risks and phased delivery gates in `CRM-3-AUDIT-AND-PLAN.md`. Preserved the full request in `CRM-3-MASTER-BRIEF.md`.

Implemented an initial Phase 1 analytics reliability slice. Phase 1 as a whole and Phases 2–8 remain outstanding.

## Changes

- Overview aggregate inputs use exact-count pagination instead of silently stopping at PostgREST row limits. Reads fail explicitly when incomplete, when counts change during pagination, or when a source exceeds the 50,000-row safety budget.
- Secondary query errors now fail the report instead of masquerading as empty queues or zero activity. A refresh failure keeps the last successful UI visible with an explicit warning and retry action.
- Deal movement uses an inner deal relation, excludes deleted deals and respects the caller's current deal ownership scope.
- Twelve-month closures include organization-local dates at the UTC boundary. Future local days are excluded from report calculations.
- Activity and movement windows cover the same 56 local calendar days. All eight activity buckets are seven days long, including today.
- Closed-business chart totals, win-rate counts and average-deal supporting counts use the chart's twelve-month population. Owner results are explicitly all-time. Activity volume is explicitly organization-wide. Won deal value is distinguished from invoiced/collected revenue.
- Existing overview response fields and all CRM navigation remain intact.

Files changed: `src/app/api/crm/overview/route.ts`, `src/components/modules/crm/home.tsx`; added `src/lib/crm/reporting.ts` and `scripts/crm-reporting.test.mts`. The pre-existing `crm/index.tsx` changes were not edited by this pass.

No new database tables, migrations, APIs, providers, integrations, workflows or fabricated records. No deployment performed.

## Verification

- Five reporting tests pass: more than 2,000 records with a lower server cap; empty/error/oversized/incomplete reads; later-page failure/count changes; all 56 days counted exactly once; timezone, leap-day and DST boundaries.
- Existing navigation suite: 44 passed.
- Existing import suite: 69 passed.
- TypeScript check passed, including the final KPI-label refinement.
- Targeted ESLint passed, including the final KPI-label refinement.
- `git diff --check` passed (line-ending warnings only).
- Signed into the existing Northwind Studio development account through the browser. `/api/crm/overview` returned 200; CRM rendered existing records.
- Browser evidence confirmed 19 won / 10 lost in the twelve-month window and an average of ₦8,421,053, with ₦160,000,000 won value. These are existing development records, not production metrics or new seed data.
- Reviewed overview at 1440×1000 and 390×844. Mobile document width equals viewport width (390px). KPI supporting labels truncate at narrow width; full text remains in the DOM. Broader responsive/accessibility review is outstanding.
- Screenshots: `.design-review/crm-3/desktop.png`, `.design-review/crm-3/mobile.png`.

## Limits and next work

1. Pagination is an interim correctness fix, not a transactional snapshot. Stable-count edits during a multipage read can still change the underlying data. Replace report inputs with permission-aware SQL aggregates for scale and snapshot consistency; the 50,000-row ceiling intentionally returns an error rather than a false total.
2. Attention and diary lists remain bounded previews (12/60 rows); their displayed counts are not guaranteed organization-wide totals. Add explicit totals and filtered drill-downs in the next foundation slice.
3. Full ownership enforcement across detail/conversion/history/company overview and direct database access remains a priority. This pass fixes only overview movement scope; it does not certify tenant/record isolation end-to-end.
4. Transactional lead conversion with exact contact reuse, ambiguous-match review and concurrent retry tests is the next major backend change. Existing conversion remains non-transactional.
5. No cross-tenant/concurrent database mutation tests or full CRM write harness were run. Those must use an isolated fixture workspace.
6. Error-state UI was implemented but not fault-injected in the browser. Charts, input permissions, organization switching and keyboard workflows still need full scenario coverage.
7. Automation Studio, Commercial Hub, multi-pipeline configuration, durable imports, account plans, renewal workflows and deal-to-delivery orchestration remain planned, not implemented.

Resume with the ownership consistency review and isolated regression fixtures, then complete the remaining Phase 1 foundation work before proceeding through the master plan.

## Final build result

Production build passed using `NEXT_DIST_DIR=.next-crm-check npm run build`: compilation, TypeScript and all 150 static pages completed. The existing standalone preparation script uses `.next` regardless of `NEXT_DIST_DIR`; the alternate output verifies compilation, not a deployment package. Build-added tsconfig includes were removed and development route types restored. The generated `.next-crm-check` directory remains because automatic command review blocked recursive cleanup; no source cleanup was needed.

## Continuation — 2026-10-25: record ownership foundation

Rechecked the existing audit against the collection scopes, record-handler factory, lead conversion, deal history and company overview implementations before editing. Continued the existing Phase 1 plan; no redesign or new CRM implementation.

### Implemented

- Added an opt-in scope callback to shared record handlers. Only CRM lead/deal routes opt in; other modules retain their existing behavior.
- Lead/deal GET, PATCH, PUT and DELETE now constrain the database operation by the caller's existing ownership scope and exclude soft-deleted records. Hidden and absent records return the same 404 response. Denied mutations do not write activity entries.
- Deal history filters through an inner deal relationship by organization, active status and current owner for own-scoped roles. The internal relationship is removed from the response to preserve its existing shape. Hidden deals return an empty history.
- Company overview deal previews and their derived figures now use the same ownership scope as the deal list. Shared companies, contacts and activity timelines retain their established sharing rules.
- Added `scripts/crm-record-access.test.mts`, which bundles the real lead/deal routes with isolated authentication, response and database adapters. These fixtures exercise real handler validation and query construction without accessing a live database.

### Verification

- 17 isolated record-access tests passed (GET/PATCH/PUT/DELETE for leads and deals; other-owner, other-tenant, deleted and absent rows; owner and administrator success; unchanged unscoped handler behavior).
- 5 reporting tests, 44 navigation checks and 69 import checks passed.
- TypeScript and targeted ESLint passed. `git diff --check` passed with existing line-ending warnings.
- No UI changes, live data writes, migrations or deployment in this continuation. No browser review was needed for these API-only changes.

### Remaining acceptance gates and next steps

Phase 1 remains incomplete. These fixture tests do not certify Postgres RLS, PostgREST relationship behavior, real authentication, or concurrent database behavior. Deal-history and company-overview filters still require isolated database integration coverage.

1. Audit direct database policies, joined relationship disclosures, imports and conversion together. Ownership checks in HTTP routes alone are not an end-to-end security boundary.
2. Replace the existing non-transactional conversion with an authorized atomic RPC, including exact-contact reuse, ambiguous-match review, lock/retry handling and cross-tenant tests. This endpoint was deliberately not represented as fixed by the record-handler work.
3. Finish the Phase 1 work already listed above: organization-switch cancellation, complete attention totals/drill-downs, scalable aggregates, and scenario/browser verification.
4. Proceed through the existing Smart Leads, Automation Studio, Commercial Hub and integration phases with their acceptance gates. Those capabilities remain outstanding.
