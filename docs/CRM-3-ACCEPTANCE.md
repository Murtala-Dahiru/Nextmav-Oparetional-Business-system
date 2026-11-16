> Latest continuation evidence: [CRM-3-CONTINUATION-AUDIT.md](CRM-3-CONTINUATION-AUDIT.md). Earlier missing-schema statements below are historical: foundation deployment was freshly verified and reporting migrations 0065–0066 added. Prompt 1 remains subject to the acceptance gates in that report.

# CRM Prompt 1 — requirement acceptance ledger

Updated 25 October 2026. **Not accepted for production; Prompt 2 has not begun.** Source implementation, isolated tests and deployment acceptance are separate states. The original user Prompt 1 controls scope; the older eight-phase roadmap does not.

## Exact recovery checkpoint

The latest usage interruption was during `crm-merge.test.mts` after adding preservation checks for qualification data, captured submissions and storage-backed attachments. That test passed on resumption. Earlier paragraphs claiming pipeline wiring, capture, qualification and profiles were still missing were stale documentation, not the actual implementation checkpoint. Existing uncommitted changes across the platform were preserved.

The app runs locally at http://localhost:3000/dashboard. The user signed in successfully. Existing CRM records and charts render. New qualification data could not load because the configured database lacks pending CRM migrations. The user selected an existing staging project and offered its configuration; `.env.staging` was still absent at the latest check. No pending migration has been committed to the configured database. Tests use embedded PostgreSQL fixtures, and remote schema preflights roll back.

## Requirement matrix

“Source + tests” means implemented locally, with the specified isolated evidence; it does not mean live deployment is certified.

| Original objective | Existing capability / work completed | Status and remaining validation |
|---|---|---|
| 1: preserve platform, shell, sidebar, contextual navigation, Executive Overview, marketing | Existing Next.js/React architecture retained. Pre-existing unrelated modifications preserved. | No redesign in this continuation. Full unrelated-module live regression remains. |
| 1: preserve authentication, tenancy, permissions, RLS, records, APIs | Existing routes retained; additive migrations 0050–0064; authenticated invoker reports and narrow role-checked commands. | Isolated role/tenant tests pass; deployed role matrix pending. |
| 1: preserve Projects, Finance, Support, Portal | Existing integrations retained. Timeline reads actual relationships and module permissions. | Cross-module live acceptance pending. No new integration credentials assumed. |
| 1: no fake business data, analytics or decorative controls | New UI uses actual APIs, explicit missing-schema errors and defined report semantics. | Existing demo records were read; no new business fixtures written remotely. |
| 2: audit all 24 capability areas | Original capability matrix and source audit retained in handoff/audit documents; this ledger supersedes stale statuses. | Source audit complete; live functionality cannot all be classified working yet. |
| 3.1–3.2: premium design, card sizing and composition | Existing tokens, refined chart surfaces and varied overview grid; compact record sections. | Overview previously reviewed at four widths. New complete forms/workspaces require deployed responsive review. |
| 3.3: preserve contextual navigation | Existing destinations retained; configuration within CRM. | Global sidebar unchanged. |
| 3.4: lead/contact/deal workspaces | Identity, ownership, status, actions, notes, related links; Overview/Activity/Qualification or Sales/Relationship/Documents sections. Drafts stay mounted between sections. | Source implemented; lead sections observed in local browser. Remaining full record QA pending. |
| 3.4: loading/error/empty/responsive | Abortable reads, loading/empty/error states, retry; missing migrations return explicit unavailable messages. | More error-injection and mobile form checks required. |
| 4.1: pipeline/won/average/cycle/forecast metrics | Existing authorized aggregates and distinct pipeline/won values retained. | Existing reporting tests; complete live date/currency reconciliation pending. |
| 4.1: new/qualified/conversion/response metrics | SQL cohort counts, preceding equal-length counts, real conversion links and response timing. | SQL tested; response metrics labeled all-time. Qualified comparison presentation remains refinement work. |
| 4.2: closed business trend | Large interactive area chart, six/twelve-month periods, exact-data table. | Existing records render; historical pipeline snapshots unavailable and never fabricated. |
| 4.2: pipeline distribution | Existing stage chart plus configurable-stage complete SQL totals and filtered board/table. | SQL tested; live configured-stage drill-down pending. |
| 4.2: lead sources | Donut with grouped display plus exact data; source cohort conversion table. | Pure aggregation and SQL tests; full browser drill-down pending. |
| 4.2: conversion funnel | True created-period cohort, converted/contact/opportunity/won linked outcomes. Current lifecycle distribution labeled separately. | SQL tested; full live visualization pending schema. |
| 4.2: deal aging | Creation-age bars; stage age from real custom/canonical history with disclosed creation fallback. | Boundaries and deterministic rules tested. |
| 4.2: performance against targets | 0063 reuses Performance member targets and immutable events, full target periods, same-currency values and final recorded deal outcomes. | Isolated period/currency/reopen tests pass; team/department targets not included and labeled as member targets. |
| 4.2: forecast versus actual | Current weighted open opportunity totals separated from closed value; forecast category recorded. | Historical forecast snapshots not available. Category-specific chart and period comparison remain refinement work. |
| 4.2: activity trends and completion | Existing eight-week chart, period activity-type/completion counts. | Calendar tests and SQL checks; live completion drill-down pending. |
| 4.2: win/loss | Real closure charts/loss reasons; competitor, outcome notes, dates and stage history retained. | Embedded original closure trigger tests pass. |
| 4.2: account acquisition | Monthly account creation and actual lead conversion counts, clamped to exact selected dates. | Partial-month regression passes. |
| 4.3–4.4: chart polish, exact formatting/accessibility/grid | Refined shared colors/tooltips/axes, descriptions, exact tables and responsive grid. | Full keyboard and newest chart visual QA pending. |
| 4.5: revenue priorities | Existing stale/overdue/closing queues, full counts where added; SQL missing next step/contact, postponements, approvals and stage thresholds. | Deterministic source implemented; missing qualification/decision-maker completeness rules need further review. Renewals require actual renewal records. |
| 5.1: manual/API/import/integrations | Existing CRUD, CSV mapping/preview/commit, partner inbox preserved; new campaign metadata. | Existing import and ownership tests; full live regression pending. |
| 5.1: inbox search/filter/sort/views | Existing server-paged lead table and detail views retained. | Lead bulk workflow and saved segment refinements still outstanding. |
| 5.2: configurable capture | 0057 + hosted /capture/[id], field mapping, required/type validation, consent snapshot, source/campaign, duplicate checks and transactional assignment. | Embedded SQL/challenge tests pass; public HTTP end-to-end pending staging. |
| 5.2: secure public boundary | Signed time-limited challenge, honeypot, bounded request body, per-address/form DB limits; service-only submission RPC. | Deployment must configure trusted proxy/address behavior and capture secret. No CAPTCHA or external integration falsely claimed. |
| 5.3: duplicate detection | Exact normalized email/phone and possible company/domain/contact evidence, explicit confidence and bounded candidates. | Source + tests; broader candidate pagination/relationship review remains. |
| 5.3: merge/conflicts/relationships/audit | Explicit field choices, immutable snapshots, serialized/idempotent/version-checked lead merge; notes, activities, partner links, qualification and capture/file relationships preserved. | Embedded merge/storage authorization tests pass. Converted-lead merges are explicitly rejected; contact/company merging not implemented. |
| 5.4: configurable qualification | 0055 org framework, typed fields, required rules, metadata, immutable revisions and version conflicts. | Source + tests, ISO date validation; live setup/save/conflict QA pending. |
| 5.5: six assignment modes | 0056 persistent rules, eligible pools, round-robin/workload/territory/industry/service/account ownership, fallback, retry identity, org serialization. | Pure + SQL tests. Capture invokes automatically; explicit manager action supported. General orchestration remains Prompt 2. |
| 5.5: account ownership | Explicit contact relationship or exact email resolving to one account; ambiguous accounts fall back. | Added SQL regression passes. |
| 5.6: response intelligence | Logged first/last engagement, 24-hour unanswered and 14-day quiet thresholds, unassigned and source cohorts. | Transparent recorded-activity semantics; no assertion that logged email was delivered. |
| 5.7: conversion | 0050 atomic company/contact/opportunity reuse/creation, ownership/source/history relationships, conflict resolution and idempotency. | Isolated conversion/RLS tests pass; live deployment and concurrent connections pending. |
| 6.1: account profile | Identity/industry/location/size preserved; 0058 parent/domain/team/tags/segment/custom fields/preferences/consent/owner versioned editing. | Cycle/foreign-team/stale-write tests pass; subsidiary listing refinement pending. |
| 6.2: contact intelligence | Existing multiple company contacts; department/relationship role/influence/preferred method/owner/notes/consent. | Source implemented; live QA pending. |
| 6.3: unified timeline | 0060 actual leads/deals/activities/projects/invoices/payments/tickets, module permission and owner constraints, server paging. | Added tenant/module/owner/pagination test passes. Email integrations and commercial/renewal sources absent, honestly disclosed. |
| 6.4: Account 360 sections | Existing Overview/People/Deals/Work/Money/Support/Activity retained; Account plan/profile/files added. | Contract/renewal lifecycle unavailable until later prompts; no invented sections with fake records. Complete UI QA pending. |
| 6.5: account plans | 0052 objectives/stakeholders/opportunities/risks/actions/owner/review dates, immutable revisions and optimistic versions. | SQL tested. Stakeholders/actions currently text; structured linkage remains a refinement. |
| 7.1: multiple pipelines | 0054 shared model for new business/enterprise/renewal/partnership/expansion and arbitrary names. | Wired to creation/selection/board/table/forecast; live QA pending. |
| 7.2: configurable stages and rules | Names/order/probability/guidance/required fields/owner/inactivity/allowed transitions, current-version approvals enforced in DB. | Compatibility, stale approvals, forbidden transitions, rollback and original closure/history tests pass. |
| 7.3: board/table/forecast/filter/sort/bulk | DnD confirmation, server-paged table, exact summary, scoped saved filters, own/date filters and sequential guarded bulk movement. | Live DnD/keyboard/bulk/error paths pending. Board caps 50 per lane and links workflow to table. |
| 7.4: deal workspace | Core fields preserved; next step/category/competitor/outcome/approvals/files; 0064 team and priced products/services with optimistic save. | SQL stale-write and foreign-team tests pass. Currency follows existing org deal currency. Quotes/contracts unavailable; customer/project context still needs review. |
| 7.5: deal intelligence | Stalls/missing next step/contact/postponements/stage age/current approvals. | Qualification and decision-maker-specific signals remain incomplete. |
| 7.6: outcome and history | Won/lost stamps, required loss reason, competitor/outcome notes, canonical and custom stage events. | Embedded trigger integration passes; live concurrent moves pending. |
| 8: realtime | Existing shared sockets/invalidation reused; configured tables publication additions, record/activity targeted subscriptions, cancellation on record change. | Reconnect/permission/org-switch/browser multi-session verification pending; no added polling or unsupported live claim. |
| 9: security/performance | RLS, narrow commands, role/tenant checks, required schemas, indexes, bounded reads, SQL aggregation, advisory/row locks and optimistic versions. | Scale/concurrency and deployed storage/role matrix pending. Some existing overview complete reads remain bounded rather than a single SQL snapshot. |
| 10: tests/build/lint | Isolated CRM suite, schema checks, rollback preflight, TypeScript, build and targeted lint repeatedly run. | Final exact results below; live 18-gate acceptance and complete responsive inspection not yet passed. |
| 11: boundary | No Automation Studio, Commercial Hub, advanced retention or full delivery orchestration built. | Preserve their existing integration points; Prompt 2 remains gated. |

## Verification checkpoint

### Latest recovery batch — 25 October 2026

- The supplied project configuration matches the existing configured project. A separate staging target and an isolation/recovery arrangement have not been confirmed. No migration was applied. Credential values are deliberately excluded from this report; the exposed service credential and database password need rotation.
- Actual CRM UI changes: `home.tsx` now presents a Revenue command centre header, six compact KPI cards, prominent existing insight charts, and expandable detailed reports; `ui.tsx` and `leads.tsx` refine CRM page headings and the lead inbox; `record-sheet.tsx` refines record identity and section controls; `company-detail.tsx` separates Profile, Account plan and Documents while preserving mounted drafts. These are connected components, but the latest rendered layouts have not been visually accepted.
- Current combined CRM suite: **49 tests passed, zero failed**. Navigation/import/dashboard/public-preview regression files passed, as did layout/attendance/rate-limit/observability files. This is isolated evidence, not live workflow acceptance.
- Current full lint: **exit 0**, zero errors and five warnings (four existing test expressions and the shared TanStack Table compiler compatibility warning).
- Current production build: **exit 0**, compilation, TypeScript, 158 generated pages and standalone asset packaging completed using `.next-crm-prompt1`.
- Static security check: **exit 0**. The checker now recognizes the narrow public capture boundary and verifies its two allowed RPCs, signed challenge, payload/body limits and database rate-limit handling. It also correctly distinguishes public tables from dynamic/schema-qualified policy names and checks capture counter access revocations. No RLS policy was weakened.
- Schema contract check: **failed**, with create/update deal schemas requiring columns absent from the configured database. This remains an actual deployment gap, not a suppressed check.
- Browser inspection is currently blocked because local browser use is disabled in Work settings. No desktop/laptop/tablet/mobile visual acceptance is claimed for this batch. Live HTTP, storage, concurrency, tenant isolation and realtime acceptance remain pending an authorized isolated target.

The older checkpoint below records earlier runs; the results above supersede its pending build/lint statements.

- The 47-test combined suite passed before adding timeline/targets; each of those new tests passed independently. Latest pipeline fixture also includes deal execution optimistic/version/team checks and passes.
- Migrations 0050–0064 all parsed, passed cross-file consistency and passed remote rollback-only preflight. No database changes committed.
- TypeScript passed after target and deal execution additions; later minor realtime/label changes require the final rerun/build.
- A production build completed with 157 generated pages before the last targets/execution additions. Standalone packaging now honors NEXT_DIST_DIR and copied assets to the matching output. The final build must be rerun after those additions.
- Targeted CRM lint passed earlier. Full lint found a pre-existing `module` test variable; renamed that test-only variable. Generated build outputs and vendored agent tooling now excluded from lint; application source remains included. Full rerun in progress.
- Local browser: user signed in, existing CRM overview rendered; updated lead sections and missing-schema error inspected. A mobile pass was interrupted by hot recompilation; do not claim four-width acceptance for the latest changes.

## Remaining acceptance sequence

1. Finish current static checks and final production build; keep local preview running.
2. Resolve remaining source/UI refinements explicitly called out above; do not equate source coverage with live completion.
3. Use the user-provided staging configuration, apply reviewed migrations through the repository workflow, then run actual HTTP/storage/conversion/merge/capture/assignment/pipeline/approval/tenant/concurrency/realtime tests against isolated organizations.
4. Inspect every relevant record, form, chart and table at desktop/laptop/tablet/mobile widths; run preserved-module regressions.
5. Only after each gate passes, write final accepted handoff and say ready for Prompt 2.
