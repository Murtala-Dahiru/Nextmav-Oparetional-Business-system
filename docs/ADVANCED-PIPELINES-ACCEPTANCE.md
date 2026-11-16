# Advanced Sales Pipelines — implementation and acceptance

## Initial audit
- Existing: configured board/table/forecast, pipeline/stage editor, guarded transition RPC, revision-bound approvals, execution details, company context, activities and documents.
- Existing database protections: tenant checks, own-record visibility, stage requirements, transition allow-lists, occupied-stage protection and optimistic stage revisions.
- Gaps: workspace summaries and richer filters; configured history is not exposed; audit lacks amount/owner/probability changes; pipeline lifecycle controls are absent; saved filters omit pipeline/view; cards lack ownership and risk context.
- Initial currency model had no per-deal currency. Migration 0093 now persists native currency and updates currency-safe reporting contracts (see continuation evidence).
- Preserve the extensive pre-existing uncommitted work. No unrelated redesign.

## Implementation checklist
- [x] Batch 1 implementation (rendered acceptance pending): workspace hierarchy, summaries, filters, cards, table and saved views.
- [x] Batch 2 implementation and API/database checks: lifecycle controls, stage governance and verification.
- [x] Batch 3 implementation and API/database checks: configured-stage history and auditable commercial changes.
- [x] Batch 4 implementation and calculation checks: explainable risk and forecast definitions/drill-down.
- [ ] Batch 5: database, unit, TypeScript, lint, build and rendered acceptance.

Acceptance results and outstanding requirements will be recorded after execution. Code presence alone is not a passing acceptance result.

## Evidence recorded on 2026-10-28

- `pipeline-live-results-2.txt`: 19 live API assertions in an isolated organization.
- `pipeline-security-results.txt`: 12 live authorization, stakeholder-plan and concurrent-write assertions.
- `pipeline-final-live-results.txt`: 12 live saved-view, duration, forecast drill-down, stage-race, engagement and stale-approval assertions.
- `pipeline-realtime-results.txt`: authorized event delivery and resubscription both passed.
- `pipeline-regression-results.txt`: 13 targeted CRM regression tests passed.
- `pipeline-final-unit.txt`: latest pipeline PostgreSQL and filter tests: 3 passed.
- `pipeline-layout-check.txt`: 118 existing layout-model checks passed; these are not visual acceptance.
- `pipeline-navigation-check.txt`: 44 navigation checks passed.
- `pipeline-security-check.txt`, `pipeline-db-check.txt`: security and migration checks passed at recorded revision; rerun passed through migration 0092.
- `pipeline-final-build.txt`: final production compilation, TypeScript and standalone packaging passed, including the continuation UI fixes.
- Native Chrome: inspected the configured workspace empty state at desktop width and existing CRM navigation at a narrower viewport. Populated board/table/detail and mobile acceptance are NOT verified.
- User explicitly chose native Chrome read-only inspection. In-app browser returned “Local browser use is disabled in Work settings.” Native capture subsequently timed out and the user changed Chrome tabs. No production records were created for visual inspection.

## Requirement-by-requirement audit

| Area | Status | Evidence / remaining work |
|---|---|---|
| 1. Pipeline workspace | Partially completed | Shared filters, complete-dataset summary, owner/team search, saved views and board/table/forecast implemented. Empty-state desktop inspected; populated visual acceptance outstanding. |
| 2. Multiple pipelines | Completed and verified (API/database) | Create, rename, purpose, description, default, active/inactive, safe empty archive; occupied archive denied. Optional editable templates implemented, not browser-tested. Pipeline visibility follows existing CRM record permissions; no new team ACL engine. |
| 3. Stage configuration | Completed and verified (database) | Names/order/probability, required entry/exit evidence, guidance, approval rules and occupied-stage protection. Closed-outcome probabilities validated. |
| 4. Kanban | Partially completed | Compact cards, owner, real engagement recency, close/next-action warnings, drag overlay, keyboard sensor and guarded transition dialog. Bounded 50 cards/stage with per-stage pagination and direct non-drag stage selector. Actual drag and keyboard movement not browser-tested. |
| 5. Deals table | Partially completed | Server filtering/sort/pagination, stable tie-breaker, column chooser, bulk revision-guarded assignment/stage changes, current-page CSV with spreadsheet-formula neutralization. API filtering/pagination passed; browser column/bulk/export tests outstanding. |
| 6. Deal 360 | Partially completed | Identity brief, activities/follow-ups, explicit stakeholders, qualification, close plan, execution/team/services, documents, custom-stage durations and separate audit. API plan and activity tests passed; populated visual acceptance outstanding. |
| 7. Forecasting | Completed and verified (calculations/API) | Expected-close period, owner/team/stage filters, categories, weighted values, contributing-deal drill-down, explicit current-snapshot limitation. Known fixtures verified. Historical forecast accuracy intentionally not claimed without snapshots. |
| 8. Intelligence | Partially completed | Explainable overdue/next-action/engagement/approval/stage-duration signals, aging, stage progression, cycle and loss reasons. Recorded-history cohorts are labelled. No invented prediction. Browser action-path acceptance outstanding. |
| 9. Stage rules | Completed and verified (database/API) | Entry/exit requirements, explicit buyer/qualification evidence, direct-update enforcement, edits cannot remove currently required evidence. |
| 10. Approvals | Completed and verified (API/database) | Request, reject, approve, consume, revision binding and authorization tested. Stale approval decisions also rejected live with HTTP 409. |
| 11. Won/lost | Completed and verified (API/database) | Outcomes, actual close date, loss reason, outcome notes and audit. Known won/lost totals tested. Custom-stage ambiguity directs users to exact-stage controls. |
| 12. CRM integration | Partially completed | Company/contact association and Customer 360 verified live. Existing attribution, document and activity infrastructure preserved. Authorized customer projects/financial records clearly identified as customer context. Full unrelated-module browser regression outstanding. |
| 13. Security | Completed and verified for executed paths | Tenant and own-scope denial, concurrent writes, plan/saved-view revisions, lifecycle rules, RLS and API checks passed. Further browser role acceptance is unexecuted. |
| 14. Performance | Partially completed | Bounded lists, risk queue, history and exports; aggregate RPCs and indexes; stable ordering. Production-scale latency/load tests not executed. |
| 15. Responsive design | Partially completed | Responsive layout classes and limited native inspection. Populated desktop/laptop/tablet/mobile acceptance remains blocked by available browser session constraints. |
| 16. Realtime | Partially completed | Deal subscription and reconnect verified live; custom tables added to publication. Full rendered invalidation and organization-switch behavior not browser-tested. |
| 17. End-to-end acceptance | Partially completed | API/database tests below passed; complete interactive acceptance cannot be claimed. |

## Mandatory scenario accounting

| # | Scenario | Result |
|---|---|---|
| 1 | Create pipeline/stages | Passed live API |
| 2 | Opportunity with real company/contact | Passed live API |
| 3 | Valid stage movement | Passed live API |
| 4 | Missing stage requirement | Passed live API + PostgreSQL |
| 5 | Submit/approve/reject approval | Passed live API |
| 6 | Kanban and non-drag movement | Guarded API passed; actual UI interaction unexecuted |
| 7 | Filter/sort/paginate | Passed live API |
| 8 | Save/reopen view | Passed live API; browser reopen unexecuted |
| 9 | Call/task/next action | Call, scheduled follow-up, next action and deal-linked My Work task intake passed live API; task UI unexecuted |
| 10 | Stage history | Passed live API + PostgreSQL |
| 11 | Won and lost | Passed live API |
| 12 | Win/loss reporting | Passed known-fixture live API |
| 13 | Weighted forecast | Passed known-fixture live API |
| 14 | Mixed currencies | Passed live: USD/EUR native amounts and weighted forecasts remain separate; GBP currency edit is audited and invalidates stale approvals. Customer 360 groups amounts by currency. No exchange rates applied. |
| 15 | Restricted/cross-tenant denial | Passed live API + PostgreSQL |
| 16 | Concurrent stage updates | Stale stage denied live; simultaneous commercial writes produced one winner; simultaneous stage writes produced exactly one winner live |
| 17 | Company 360 context | Passed live API |
| 18 | Responsive behavior | Partial empty-state/native inspection only |
| 19 | Realtime/reconnect | Passed transport delivery/resubscription; rendered behavior unexecuted |
| 20 | Existing CRM/unrelated modules | Targeted regressions, build, navigation and security checks passed; full browser regression unexecuted |

## Remaining acceptance limitations

Do not label this transformation fully complete until populated browser acceptance, drag/non-drag operations, saved-view/columns/bulk actions, mobile layouts and rendered reconnect behavior have been executed. Per-deal currencies are now implemented and verified by API/database checks. Revenue Command Centre and Executive Overview monetary deal totals are explicitly organization-currency-only; Customer 360 exposes separate native-currency groups. Historical currency is recovered from existing immutable deal events where available, otherwise the pre-existing organization currency is retained. No historical exchange rates or conversions are inferred.

## Continuation fixes

- Per-stage board pagination now exposes every matching deal in bounded pages of 50. Filter or pipeline changes reset the page scope.
- Cards expose a native accessible stage selector using the same guarded confirmation and backend as drag movement.
- Pipeline insight data now invalidates after realtime events, including opportunity-plan evidence changes.
- View controls wrap at narrow widths.
- TypeScript and final production build passed. Full lint passed with zero errors and five pre-existing warnings. Populated interactive acceptance is still outstanding.
- Live-update connection status and manual refresh are visible; offline conditions no longer appear silently current.
- `pipeline-task-results.txt`: three live My Work integration assertions passed on the final production build.
- Restored the local app on port 3010 using the final standalone build. An isolated private Chrome sign-in is prepared on port 3013; user sign-in is pending because the native Computer Use skill prohibits authentication automation. After sign-in, inspect the updated build on port 3010 (same localhost authentication cookie).


## Multicurrency continuation — 2026-10-28

### Changed contracts and preservation
- Migration 0093 adds native `deals.currency`, defaults new opportunities to organization currency, validates supported currency codes on direct writes, indexes scoped currency queries and audits currency changes.
- A before/after fingerprint verified existing deal IDs, amounts, revisions, updated timestamps, and business/pipeline event counts remained unchanged during backfill.
- Creation/editing, Kanban, tables, Deal 360, CSV, pipeline filters, saved views, weighted forecasts and drill-down carry native currency. Currency changes do not perform conversion; the form asks the user to confirm the negotiated amount.
- Forecasts select one currency; available pipeline currencies are surfaced as quick switches. Creating a deal adopts the selected reporting currency.
- Customer 360 grouped totals and related opportunity amounts use their actual currencies. Layouts remain intact.
- Existing overview report contracts retain organization-currency monetary totals with explicit labels. Counts in database summary views still include all outcomes. No mixed amount totals or invented exchange rates.
- Newly emitted won/lost events freeze the opportunity currency. Narrow downstream Performance calculations use the selected/organization currency and retain outcome counts; monetary target comparisons use the target currency.

### Executed evidence
- `pipeline-currency-migration.txt`: verified target and applied additive migration 0093.
- `pipeline-currency-preservation.json`: pre-migration preservation fingerprint; comparison passed after application.
- `pipeline-currency-db-check.txt`: migration parsing and cross-file checks passed.
- `pipeline-currency-base-live.txt`: 19 live core workflow assertions passed in a fresh isolated organization.
- `pipeline-currency-security-live.txt`: 12 role, tenant, planning and concurrency assertions passed.
- `pipeline-currency-regression-live.txt`: 12 saved-view, forecast, validation, stage race, engagement and stale-approval assertions passed.
- `pipeline-currency-task-live.txt`: 3 opportunity-task integration assertions passed.
- `pipeline-currency-realtime-live.txt`: delivery and reconnect assertions passed.
- `pipeline-currency-live-results.txt`: 14 multicurrency assertions passed, including direct database validation and immutable won-event currency.
- `pipeline-currency-unit.txt`: 5 pipeline, filter and lead-conversion tests passed.
- `pipeline-currency-contract-tests.txt`: 2 currency contract/downstream rollup tests passed.
- Latest full lint: zero errors, five pre-existing warnings. Final build/typecheck results are recorded separately; do not infer completion while a process remains running.

### Final requirement audit update
The 17-area audit and 20-scenario accounting above remain applicable. Currency support is now completed and verified at API/database level. Populated Kanban/table/Deal 360 rendering, interactive drag and keyboard movement, browser saved views/bulk/CSV, organization switching, and four-width responsive acceptance remain partially completed—not verified by tests alone. Historical forecast accuracy remains unavailable because no historical snapshots exist. Performance improvements are bounded-query/index changes, not a production-scale load-test result. Pipeline-specific team ACLs are not added; established CRM permissions remain authoritative.

### Browser evidence and concise manual acceptance checklist
The in-app browser still returned “Local browser use is disabled in Work settings.” Native Chrome exposed a signed-in Stunmark workspace, not the isolated acceptance organization; navigation to the currency-enabled build retained stale document state while loading. No test business records were added to Stunmark. This is not populated visual acceptance.

Run in the isolated acceptance organization at 1440×900, 1280×800, 768×1024 and 390×844:
1. Board/table/forecast: inspect spacing, wrapping, horizontal scroll, readable amounts and visible currency; switch USD/EUR/GBP and confirm cards, totals and drill-down agree.
2. Move a deal by drag and by its stage selector; verify missing requirements, approval gating, failed-write recovery and an explicit won/lost close date.
3. Filter/sort/page; save/reopen a view; select columns; bulk assign/move; export CSV and verify full amounts plus currency.
4. Open Deal 360; edit currency/value, next action, stakeholders and plan; log an activity; inspect documents, related company and separate audit.
5. Use two sessions: verify stale saves/approvals are denied, live changes refresh, reconnect recovers and organization switching never retains the previous tenant’s data.
6. Smoke-check Revenue Command Centre, Leads, Customer 360 and unrelated module navigation. Verify base-currency report labels and separate Customer 360 currency groups.

No full completion claim is made until the remaining rendered acceptance is executed.


### Final validation totals and precision boundary
The fresh isolated suite passed 62 live assertions (19 core, 12 security, 12 final workflow, 3 tasks, 2 realtime, 14 currency). The pipeline/conversion/filter suite and linked reporting/Customer 360/currency suite passed 21 tests in total. The additional currency-only rerun covers the last amount-validation change.

Amounts retain the established `numeric(14,2)` precision. The API rejects finer precision instead of silently rounding it; currencies needing three fractional digits are not fully supported at their smallest denomination. This is an explicit remaining model limitation, not an exchange-rate conversion. Existing stored amounts are preserved.

Full lint passed earlier with zero errors and five existing warnings; the final production build/lint files (`pipeline-currency-final-build.txt`, `pipeline-currency-final-lint.txt`) are authoritative for the latest source state.


### Production verification
The final currency build completed compilation, TypeScript, all 165 static pages and standalone packaging. Final lint passed with zero errors and five existing warnings. The latest standalone build now serves localhost:3010. All 14 multicurrency live assertions passed again against this production build (`pipeline-currency-production-live.txt`).


### Native demo visual acceptance — subsequent successful session
After explicit user authorization to sign into the demo account, Northwind Studio (Demo) opened on the latest production build at localhost:3010. No business records were modified.
- Observed populated Executive Overview and Revenue Command Centre rendering; base-currency labels visible.
- Observed configured pipeline empty state (demo has no configured pipelines), controls, and connected realtime status.
- Opened Sales overview and inspected populated legacy stage columns/cards at 1536-pixel window width.
- Opened the Quillon Media opportunity and verified populated Deal 360 identity, native NGN currency, owner, expected close, risk message and linked company/contact.
- Switched to Sales details and inspected next action, forecast category, team/services and stakeholder/qualification/close-plan controls. No save was attempted.
- Enabled Chrome responsive inspection through its UI. At 400×608 the populated Deal 360 panel reflowed with wrapped action/tab rows and stacked form fields, without the initial transient overflow after resize.
- Observed the populated legacy board at 390×608 with horizontal column scrolling and responsive CRM navigation.
- Further viewport editing was interrupted twice by “user input was detected in this window”; browser actions paused to avoid competing with the user.
This is limited desktop/mobile visual evidence, not a complete four-width or configured-pipeline acceptance pass. Exact tablet/laptop dimensions, configured populated board/table/forecast, save/drag/bulk interactions and rendered reconnect still need the manual checklist above.
