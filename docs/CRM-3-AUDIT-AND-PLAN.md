# CRM 3.0 audit and delivery plan

Date: 2026-10-24. Evidence: current working tree, including existing uncommitted improvements. This is a source audit, not certification of deployed behavior.

## Preservation boundary

Keep the application shell, global sidebar, contextual navigation, Executive Overview, marketing site and unrelated modules unchanged. Preserve the CRM's existing APIs, response fields, imports, partner queue, record sheets, account view, pipeline, reminders and stage history. Do not reset the working tree. No database deployment is part of this initial pass.

## Architecture

Next.js 16 / React 19 / TypeScript; Supabase Postgres, cookie authentication, organization context, role capabilities and RLS. CRM UI lives in `src/components/modules/crm`; API handlers in `src/app/api/crm`. Shared CRUD lives in `src/lib/supabase/crud.ts`; `crm-scope.ts` narrows lead/deal collections by owner. Organization-wide contacts and companies are intentional shared reference data. Recharts and shared readout components supply existing analytics; list queries already use server pagination and realtime invalidation.

Primary database evidence: migrations 0003–0007 (business tables, logic, RLS and reports), 0028 (follow-ups, stage events and CRM views), 0029 (business events), 0030–0032 (targets and performance), 0033 (partner workspace), 0034 (project delivery), 0035–0038 (knowledge and communication). Later HR migrations must not be confused with CRM commercial contracts or workflows.

## Capability matrix

Status means source-level implementation only; no capability is certified fully working without execution evidence.

| Capability | Status | Evidence and disposition |
| --- | --- | --- |
| CRM overview / analytics | Implemented, requires improvement | `home.tsx`, overview API, pipeline-owner and lead-funnel views. Preserve charts and actionable queues; correct capped reads, hidden failures, date windows and scope before adding charts. |
| Leads | Implemented, requires improvement | `leads.tsx`, CRUD APIs, owner filtering, manual scores, source/status and record sheets. Extend qualification and assignment; do not fabricate intelligence. |
| Contacts | Implemented, requires improvement | `contacts.tsx`, forms, relationships and CRUD. Preserve shared address book; extend consent, decision roles and merge review. |
| Companies / accounts | Partially implemented | `companies.tsx`, `company-detail.tsx`, company overview API. Connected view exists; account teams, plans and hierarchy need development. |
| Deals / pipeline | Implemented, requires improvement | `deals.tsx`, `pipeline.tsx`, stage history API and migration 0028. Preserve optimistic movement and closure dialogs. Stages are fixed; configurable pipelines, transition requirements and approvals are missing. |
| Activities / tasks | Implemented, requires improvement | Activities, activity dialog, next actions, timeline; scheduled reminders with sweep RPC. Preserve; improve date/scope consistency and reliable synchronization. |
| Notes / history / attachments | Partially implemented | Record parts, CRM activities, stage events, activity log and platform knowledge links. Preserve existing history; attachment authorization and unified timeline require deeper integration testing. |
| Proposals / quotes | Missing CRM lifecycle | No dedicated CRM quote/proposal API or workspace found. Build versioned line items, calculations and approvals; reuse platform documents where appropriate. |
| Contracts | Missing CRM lifecycle | HR document contracts are not commercial contracts. Add commercial metadata and lifecycle without inventing signature integration. |
| Automation | Partially implemented infrastructure | Reminder RPCs, assignment/change notification triggers and business events exist. No configurable CRM workflow model, durable worker, structured builder or run history found. Extend events rather than replacing them. |
| Segmentation / customization / settings | Partially implemented | Existing filters, source/status/owner data and platform settings. Dedicated saved segments, custom fields and CRM configuration need a model and permissions. |
| Reporting / forecasting | Partially implemented | Weighted pipeline, owner totals, monthly closures and weekly activity exist. Targets exist in platform performance migrations; CRM must establish target scope and unit compatibility before reusing them. |
| Imports / duplicate review / exports | Partially implemented | Import analyze/preview/commit APIs and shared planner, blank-only updates, row errors, ExportButton. Preserve; add durable import history, scale guarantees and controlled merges. |
| Lead capture / attribution | Partially implemented | Manual/API creation and partner referral intake exist. Configurable public forms, consent, abuse prevention and campaign model are missing. |
| Lead conversion | Implemented, requires improvement | Conversion API retains lead and creates company/contact/optional deal. Separate writes are not transactional; contact reuse, concurrent retry safety and complete history linking are insufficient. |
| Authentication / RLS / tenancy | Implemented, requires improvement | `authorize`, organization predicates and database RLS exist. Collection ownership restrictions are not consistently applied to detail, conversion, company-linked deals and history routes. Direct Supabase access requires a DB-level policy review. |
| Project handoff | Partially implemented relationships; orchestration missing | Customer/project links and delivery infrastructure exist. No approved, idempotent won-deal orchestration found. Preserve Projects as execution authority. |
| Finance integration | Partially implemented | Company overview includes invoices behind finance permission. CRM does not own accounting. Bounded lists must not be advertised as complete financial totals. |
| Support integration | Partially implemented | Company contacts connect support tickets behind support permission. Contact and ticket limits can hide older relationships; extend with scoped pagination. |
| Client portal / partner portal | Implemented, requires improvement | Portal project/deliverable routes and partner-lead queue exist. Preserve; external access provisioning requires explicit configured rules. |
| Customer success / renewals | Missing CRM lifecycle | No dedicated health model, renewal records or renewal idempotency found. Build from authorized operational facts, not arbitrary scores. |
| Relationship intelligence | Partially implemented | `attention.ts` computes explainable deal/follow-up priorities. Extend using real relationship IDs and explicit thresholds. |
| Design system / accessibility | Existing foundation | Shared readout, UI primitives, tables, forms and record sheets. Reuse established tokens. Browser review remains necessary; do not infer accessibility from classes alone. |
| Tests / operational verification | Existing foundation | `crm-verify.mjs`, import tests, schema, security and realtime checks. CRM harness writes test records; inspect before running against any shared database. Add focused deterministic tests and isolated tenant/concurrency coverage. |
| Performance / realtime | Implemented, requires improvement | Server pagination and subscriptions exist. Overview caps source rows; conversion scans companies; some search paths fire per keystroke. Aggregate SQL, debouncing, bounded work and organization-change cancellation require staged work. |

## Priority risks

1. Ownership policy consistency across direct records, relationships and database access. Resolve intended sharing boundaries before extending sensitive data.
2. Non-transactional conversion can leave orphaned records or duplicate contacts/deals on concurrency or retry. Replace with an authorized transactional RPC, with explicit exact-match reuse and ambiguous-match review.
3. Overview reads capped at 1,000/2,000 rows can report incorrect totals. PostgREST can impose a lower server cap than the requested limit. Errors from secondary queries currently become empty data.
4. The twelve-month query begins at UTC midnight rather than organization midnight; the eight-week chart starts seven days later than its query. Chart legends mix all-time totals with a twelve-month chart.
5. Company overview uses bounded contacts, projects, deals and invoices and suppresses several errors. Do not call its derived figures comprehensive.

## Phased implementation and acceptance gates

0. **Audit and preservation** — this matrix and plan; retain the master brief alongside it. Record baseline tests and changes.
1. **CRM foundation** — first fix truthful analytics and refresh errors; then ownership consistency, organization-switch cancellation, debounced lists, record UX, CRM-only visual refinement and chart drill-downs. Gate: deterministic analytics tests, isolated API authorization tests, existing CRM regression checks and desktop/mobile browser review. This first pass is only a foundation slice, not completion of Phase 1.
2. **Smart leads** — transactional conversion, exact/possible duplicate review, import history/jobs, qualification configuration, capture endpoints with rate limits/consent, assignment and response tracking. Gate: concurrent conversion/assignment tests, rollback and tenant-isolation tests.
3. **Automation Studio** — versioned workflow definitions; reuse real events; transactional outbox/queue, idempotent actions, retries/backoff, dead-letter visibility, cancellation and execution logs; then structured builder and templates. Gate: duplicate events, crash/retry, disabled workflows, authorization and loop prevention. Do not proceed until core execution is reliable.
4. **Commercial Hub** — quote/proposal versions, currency-safe calculations, approvals and contracts; no unconfigured signing/email claims. Gate: calculation and approval-bypass tests.
5. **Deal-to-delivery** — approved handoff snapshot with stable source IDs, configured templates, idempotent project/billing preparation and recoverable partial failures. Gate: retry/concurrency tests; no automatic invoice issue or portal grants without configured authority.
6. **Customer intelligence** — authorized account timeline, plans, evidence-based customer health, renewal workflow and relationship signals. Gate: restricted-module and tenant tests.
7. **Revenue intelligence** — historical aggregates, source cohorts, aging, forecasting, targets and saved reports. Gate: reconciliation against complete source data and timezone/currency fixtures.
8. **Enterprise refinement** — RLS and permission audit, audit history, customization, background-job scale, accessibility, responsive layouts and operational monitoring. Gate: full agreed regression suite and realistic browser review.

## Initial pass progress

See `CRM-3-PROGRESS.md` for implemented changes and verification. Remaining phases are intentionally outstanding. Missing product capabilities must not be represented by decorative screens.

## Audit update — 2026-10-25

Reinspection confirmed the ownership discrepancy in single lead/deal handlers, history and company-linked deal previews. The continuation adds application query constraints to those paths (see `CRM-3-PROGRESS.md` for exact scope and verification). Change the disposition of these specific routes from **unscoped** to **application-scoped, awaiting database integration verification**. The broader authentication/RLS capability remains **implemented, requires improvement**: direct database policies, conversion, imports and relationship disclosures are not certified. The existing phase order and preservation boundaries remain unchanged.
