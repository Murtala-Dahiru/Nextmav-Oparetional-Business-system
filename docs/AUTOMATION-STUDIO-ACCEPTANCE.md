# Automation Studio implementation and acceptance audit

Updated 29 October 2026 (Africa/Lagos). This is an evidence report, not a claim of 100% completion.

## Scope and preservation

The existing application and substantial uncommitted CRM work were preserved. No Git reset or replacement application was used. Product changes are restricted to Automation Studio, the established CRM destination list/navigation guard, supporting CRM APIs, and additive database hooks. The older record-access test fixture was corrected to use the UUID/revision contract already required by the existing pipeline implementation; no deal authorization was weakened.

Reused: `authorize('crm','manage')`, authenticated Supabase clients and RLS helpers, `crm_assign_lead_internal`, CRM follow-up activities, existing notifications, guarded pipeline transitions, `crm_save_account_plan`, relationship-profile validation, shared realtime subscriptions and CRM navigation.

## Implemented surface

- Directory with real status counts, recent executions/failures, search, status/trigger/owner filters, sorting, pagination, ownership, cumulative run counts, last outcome and audit activity.
- Structured visual editor with connected cards, AND/OR condition groups, explicit matched/unmatched paths, sequential actions, delays/rechecks, keyboard reorder/remove, draft/save/validate/publish, unsaved navigation guard, duplication, pause/resume/archive.
- Immutable published versions; draft editing does not change in-flight definitions. Pause stops intake and holds pending runs. Resume continues held runs. Archive cancels pending runs. Republishing affects future events only.
- Event capture in the same transaction as CRM writes. Five CRM table hooks cover supported lead/company/contact/deal/activity events, including guarded deal-stage changes, contact profile changes and scheduled CRM meetings.
- Scheduled checks: untouched new leads, open deals with old record updates, approaching close dates, overdue incomplete CRM follow-ups. These are explicitly bounded semantics; they do not claim to infer customer email replies.
- Actions: assign/reassign through existing lead rules, assign company/deal owner, create and assign follow-up with due date, create structured account-plan action, update lead status/deal next step, add company/contact tag, in-app notification, wait, recheck conditions.
- Monitoring with run/version/event identity, timestamps, conditions, step outcomes/affected IDs, redacted error codes, retry status and manual retry. Conditions expose field/operator/result, not private values.
- Owners/administrators only, using existing CRM manage permission. Publishing identity is rechecked at every step, including active profile/membership/organization. Executions cannot acquire access from a more privileged background identity.

## Database and operations

`0094_crm_automation_studio.sql`: workflow/draft/version/event/run/step/audit/origin tables; RLS; constrained configuration commands; durable capture; atomic worker; retry; metrics; health and retention.

`0095_crm_automation_schedules.sql`: timer deduplication, indexed candidate queries and scheduled sweep.

`0096_crm_automation_account_timers.sql`: event-maintained account engagement and structured action timers, initial projections and account scheduler.

`0097_crm_automation_monitoring_integrity.sql`: indexed published-trigger filtering and condition explanations retained for every newly committed step. Historical step explanations remain null rather than being reconstructed.

All four were applied to the verified application Supabase project using `scripts/automation-migrate.mjs --apply`. The live project has `pg_cron`; worker, scheduled-check, account-timer and retention jobs are active. Deployment elsewhere must apply all four migrations and have an active scheduler before publishing.

Worker behavior: database transactions commit action effects and cursor together; crashes roll both back. `FOR UPDATE SKIP LOCKED`, tenant advisory locks and unique run/step identities prevent duplicate effects. Account clocks update on recorded calls/emails/completed meetings and plan changes; a stale timer is rechecked before executing. At most 100 steps per invocation, 10 per tenant, 20 steps/workflow, 48 conditions, 100 nonarchived workflows/tenant, 1,000 captured runs/workflow/hour, five automatic attempts and three manual retries. Excess intake is retained as failed work, not silently discarded. Transient SQL conflicts use bounded exponential backoff. Business revision conflicts use `PT409` rather than a retryable serialization code.

Generated events retain causation and cannot fan out. Origin tracking excludes automation-generated records from scheduled cascades until a subsequent independent edit. Retention removes up to 1,000 completed/skipped/cancelled run details per hourly sweep after 90 days. Failed/pending work and scheduled-event deduplication identities are retained. Audit/version retention is not yet configurable.

## Executed evidence

- `automation-live.mjs`: 22 live HTTP/database assertions passed in a newly created isolated organization (draft, publish, real assignment/tasks, duplicates, conditions, pause/resume, delay/reconnect/versioning, loops, revoked permission, failure/retry, RLS).
- `automation-reliability.mjs`: 26 transactional live database assertions passed, including all four timers, stale timer recheck, injected transient error/backoff, rollback of effects, worker interruption/recovery, branches, direct RPC denial, actual foreign organization denial, contact relationship/tag execution, meeting execution account-plan action, account inactivity invalidation and structured overdue action execution, per-step explanations, and published-trigger filtering across draft edits/republishing. Fixtures roll back.
- `automation-pipeline-live.mjs`: 11 live assertions passed: stage requirement/approval preservation, no event on rejected transition, actual follow-up on valid transition, five CRM endpoint regressions, revision conflict and real-clock fixture.
- `automation-load.mjs`: 200 actual events and 200 actual notifications, 20 batches of exactly 10 steps, and no extra effects on replay. Capture: 384 ms; batches: 154–957 ms (mean 362 ms). Single isolated tenant/connection; all fixtures rolled back. This does not establish cross-tenant or production-scale throughput.
- `automation-concurrency.mjs`: two independent worker connections processed a shared pending run; exactly one wait-step commit.
- Independent real-clock check: wait recorded at 23:05:00 UTC and task at 23:07:00 UTC on 28 October. Both worker connections had closed. Cron completed the persisted run with exactly two steps and one task effect. This verifies a restarted worker connection, not a full managed PostgreSQL service restart.
- `automation-browser.mjs`: 14 actual Chromium/Edge browser assertions passed, covering configure/reorder/save/reopen/publish, desktop/tablet/mobile widths, pause/resume, realtime refresh, run detail, templates and navigation cancellation. No page runtime errors. Screenshots are in `docs/automation-evidence`; desktop/mobile editor, directory and run detail were visually inspected.
- 39 relevant automated tests passed across automation validation, assignment, pipeline, currency, record access and Customer 360 signals.
- TypeScript passed. Repository lint passed with five existing warnings (four test expressions and TanStack React Compiler compatibility). Migration parsing/consistency and API security check passed. The final production build passed after migration 0097 and the per-step condition-history UI changes; standalone output was generated successfully.

## Mandatory acceptance scenarios

| # | Scenario | Result |
|---|---|---|
| 1 | Create draft | Completed and verified: HTTP and browser |
| 2 | Configure trigger/condition/action | Completed and verified: browser |
| 3 | Save/reopen | Completed and verified: HTTP and browser |
| 4 | Publish valid | Completed and verified |
| 5 | Reject invalid | Completed and verified: Zod and direct SQL |
| 6 | Lead automatic assignment | Completed and verified with existing rules |
| 7 | Automatic follow-up | Completed and verified against actual activity rows |
| 8 | Nonmatching condition | Completed and verified: skipped run |
| 9 | Guarded deal-stage workflow | Completed and verified: real transition API |
| 10 | Delay after worker restart | Completed and verified: closed/reopened worker connections and independent real cron delivery; database-host restart untested |
| 11 | Duplicate event | Completed and verified: unique event/run plus unchanged effects |
| 12 | Transient retry | Completed and verified with transaction-scoped fault injection |
| 13 | Permanent failure inspection | Completed and verified via history/API; failure-specific browser interaction still manual |
| 14 | Pause/resume | Completed and verified via HTTP/browser |
| 15 | Republish with in-flight run | Completed and verified: old task text/version retained |
| 16 | Loop prevention | Completed and verified for activity and relationship chains |
| 17 | Tenant isolation | Completed and verified: real foreign tenant, RLS and RPC |
| 18 | Restricted-role denial | Completed and verified for API/direct RPC/execution identity |
| 19 | Monitoring | Completed and verified with real runs and browser detail |
| 20 | Responsive behavior | Completed and verified at 1440, 768 and 390 CSS pixels; limited visual scope, not every interaction |
| 21 | Organization switching/realtime | Partially implemented: realtime verified; workspace identity remount and abort handling exist. Existing BOS has no organization-switch API/UI, so interactive switching cannot be verified without separate platform work |
| 22 | Existing CRM regressions | Partially verified: endpoints, pipeline rules and relevant tests passed; full interactive CRM-wide acceptance remains |

## Mandatory final audit categories

| Category | Status and boundary |
|---|---|
| 1 Home | Completed and verified for implemented directory/metrics |
| 2 Visual builder | Completed and verified as bounded structured flow, not arbitrary graph programming |
| 3 Triggers | Completed and verified for the supported event registry, including structured account-plan overdue and relationship-inactivity timers |
| 4 Conditions | Partially implemented: allowlisted typed fields/groups work; arbitrary configurable qualification-answer fields and derived relationship signals are not exposed |
| 5 Actions | Completed and verified for the bounded supported registry; no arbitrary record mutation, stage bypass or external requests |
| 6 Templates | Completed and verified for the supported template registry: eleven executable templates, including customer-relationship inactivity and structured account-plan overdue workflows |
| 7 Durable execution | Completed and verified with transaction recovery/concurrent workers; managed database failover untested |
| 8 Scheduling | Completed and verified for six timer types and waits |
| 9 Retry/idempotency | Completed and verified with injection, duplicate delivery and recovery |
| 10 Loops | Completed and verified with causation and maximum one automated generation |
| 11 Monitoring | Partially implemented: outcomes, conditions, steps and failures visible; no separately observable running state during an atomic SQL transaction, new steps now retain individual condition snapshots; previously recorded steps cannot be reconstructed |
| 12 Governance | Partially implemented: existing manage permission, identity checks, revisions/audit/lifecycle; separate create/publish role grants and ownership transfer UI not implemented |
| 13 Security | Completed and verified within tested boundaries; not an independent penetration test |
| 14 Performance | Partially verified: indexes, limits, pagination and bounded workers exist; 200-event bounded workload measured; production-scale load, cross-tenant fairness/latency and retention throughput remain unmeasured |
| 15 Realtime | Partially verified: browser update/reconnect hooks work; org switching unavailable in existing platform |
| 16 CRM integration | Completed and verified for supported commands/events; full regression interaction pass pending |
| 17 Responsive design | Completed and verified in inspected desktop/tablet/mobile views; screen-reader audit pending |
| 18 End-to-end acceptance | Partially verified: executed evidence above; no claim that all 22 scenarios passed without qualification |

## Review of the original 20 parts

Parts 1–4: inspected repository/live database, preserved prior work, reused foundations and implemented rather than stopping at planning. Parts 5–6: directory and structured builder delivered. Parts 7–10: working bounded registries/templates with the omissions above. Parts 11–15: database execution, monitoring/security/governance and resource bounds delivered; advanced role separation and production-scale load testing remain. Part 16: real UI subscription verified, organization switching blocked by existing platform capability. Part 17: implementation verified incrementally with defects fixed between batches. Parts 18–19: all scenarios/categories explicitly audited above. Part 20: full definition of done is **not yet satisfied** because the partial items and broader manual acceptance remain.

## Remaining acceptance and limitations

1. Account inactivity and structured overdue timers have now been implemented and verified; maintain the event-driven projections when future CRM activity sources are introduced.
2. Extend conditions for configurable qualification answers only with a typed, permission-aware field registry.
3. Decide whether separate author/publisher/owner-transfer governance is required beyond the existing administrator manage permission.
4. Implement or obtain an authorized existing platform organization-switch mechanism, then test in-flight fetch cancellation, subscriptions and unsaved edits across tenants.
5. Conduct production-like queue/load/fairness tests, database failover/restart tests, screen-reader testing and comprehensive existing CRM interaction regression.
6. Verify failure/retry/archive/duplicate flows visually and inspect all editor states. Current evidence is meaningful but bounded.

No email provider delivery, unrestricted HTTP/webhooks, Commercial Hub, campaigns or unrelated revenue intelligence were introduced. Test credentials remain only in the local OS temporary fixture file, not in repository evidence. Isolated acceptance organizations remain available for review; production business records were not used as fixtures.
