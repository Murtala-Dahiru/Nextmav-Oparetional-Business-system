# Sales Engagement removal report

15 November 2026. Evidence applies to the existing working tree, the configured database, and the production artifact served locally on port 3061.

## 1. Executive summary

Sales Engagement has been removed from the active application. Its HTTP handlers, mailbox adapters, OAuth callbacks, workspace, sequence and template interfaces are absent. Forward migrations 0148 and 0149 were applied to the configured database. Historical records remain protected, and existing sequence workflows are archived with administrator-visible audit events.

Application and database removal is completed and verified within this environment. Production rollout across external deployments and provider grant revocation remain operational dependencies. This report does not certify those external systems as retired. The unchanged repository security checker still reports four finding groups, so the overall repository quality gate is not wholly green.

## 2. Components removed

Removed five exclusive UI components for the workspace, mailboxes, sequences, template library and template picker, seven mail implementation files, the sales-template helper, eleven route handlers and eighteen exclusive test/operational scripts. The 42-file pre-removal manifest is in [exclusive-files.txt](exclusive-files.txt). Original files were backed up outside the repository before removal, including untracked work.

The former activity-detail component and validation remain under native activity names. Existing CRM record panels now expose activity reassignment through the native activity endpoint.

## 3. Routes and APIs removed

All handlers below `/api/crm/engagement` were removed, including the root, `actions`, `history`, `templates`, `templates/preview`, `sequences`, `mailboxes`, `mailboxes/connect`, `mailboxes/callback`, `mailboxes/messages` and `mailboxes/associate`.

Authenticated GET and POST requests to each return 404. The Engagement destination was removed from the CRM section union, navigation and rendering. CRM destinations use the existing dashboard shell. No replacement destination was introduced. The similarly named `/api/crm/leads/engagement` remains because it reads native lead activity history.

## 4. Background processing

Discovery found request-driven mailbox processing and sequences running through the shared Automation Studio worker. There was no dedicated Engagement cron job. Three sequence definitions were archived and received retirement audit entries. Applicable live enrollments and nonterminal runs are retired by the migration. No runnable sequence definition, active enrollment or pending sequence run remained in the verification.

All four shared automation cron jobs remain active. Two concurrent worker sessions committed a wait step once. Cron subsequently resumed the persisted one-minute wait and the run reached `succeeded` with cursor 2 and no error. See [automation-concurrency.log](automation-concurrency.log) and [automation-clock.log](automation-clock.log).

## 5. Provider integrations

Removed dedicated Google/Microsoft mailbox adapters, OAuth connection/callback code, refresh, threading, association, synchronization and sending paths. No independent calendar provider adapter or SDK dependency was found. There were no dedicated provider variables in the checked environment examples.

The configured database had zero mailboxes, credential rows, OAuth states, messages, associations and outbox rows. Provider-side grants can outlive database rows. Provider-console revocation and external secret-manager retirement remain blocked on authorized operator access. [OPERATIONS.md](OPERATIONS.md) identifies the six obsolete `SALES_MAIL_*` variables, shared-consumer checks and required verification receipts.

## 6. Database objects

Migration 0148 removes twenty exclusive functions and seven triggers, archives affected workflows, retires executions and replaces the mixed activity RPC with `crm_activity_action`. Nine exclusive tables retain their records and RLS policies. Table privileges are revoked from PUBLIC, anon, authenticated and service_role. A service-role RLS bypass does not grant table access.

Migration 0149 preserves historical sequence runs and events during ordinary automation retention, preventing enrollment foreign keys from blocking unrelated retention batches. The retained archive reference is intentional. Other live database functions no longer depend on the exclusive tables.

## 7. Historical data retention

Retained three enrollments, three sequence records and four templates, plus related automation versions, runs, events, steps and native activity history. Six mail tables were empty. Migration replay preserved table row counts. Historical migrations remain intact. Read-only export must use an approved tenant-scoped custodian process. No customer-record deletion was performed.

Irreversible archive deletion, including retained credential storage in other deployments, requires an explicit data-deletion decision. Synthetic regression tenants and records were retained for evidence and are identified by the local test fixtures. No automated customer cleanup was attempted.

## 8. Shared infrastructure preserved

Native activities retain calls, notes, meetings, follow-ups, reminders, assignments, completion and links to leads, contacts, companies and deals. Native reassignment uses tenant/visibility checks, active-member validation and optimistic concurrency. A stale reassignment returned 409 without overwriting the current assignee.

Customer 360, revenue insights and targets, suppression preferences, Automation Studio, Commercial Hub, NextMav Sign, BOS authentication, ordinary notifications and calendar infrastructure retain their existing implementations. Archived unsupported workflows remain visible to administrators while duplication is unavailable.

## 9. Files changed

The removal manifest lists every deleted exclusive file. Refactored or edited application files are `src/components/modules/crm/index.tsx`, `navigation.tsx`, `types.ts`, `record-parts.tsx`, `automation-studio.tsx`, native `activity-details.tsx`, `src/lib/crm/activity-details.ts`, `src/lib/validations.ts`, `src/app/api/crm/automations/route.ts`, and the new `src/app/api/crm/activities/assign/route.ts`.

Supporting changes include `scripts/crm-governance-api.mjs`, native activity validation and live regression scripts, the three `crm-decommission-*` verification scripts, `tsconfig.json`, README, backend architecture and the CRM master brief. Historical Sales Engagement reports were labelled retired. This directory contains the inventory, evidence and operational instructions. Existing unrelated working-tree changes were preserved.

Removed-source backup is `C:\Users\murta\AppData\Local\NextMav-audit-backups\engagement-ca024c3db487434baddd0e35649f7ad6`. It also contains the stale generated development route types that were moved before regeneration.

## 10. Migrations added

- `supabase/migrations/0148_retire_sales_engagement.sql`
- `supabase/migrations/0149_preserve_sequence_execution_history.sql`

Both were applied forward. Replay, archive access, row-count preservation, workflow retirement and the native activity RPC passed in a rollback verification transaction. Migration parsing and cross-file consistency passed. See [migration-replay-final.log](migration-replay-final.log), [database-before.json](database-before.json), [database-after.json](database-after.json), [migrations.log](migrations.log) and [db.log](db.log).

## 11. Dependencies and configuration

Provider code used shared fetch, crypto and validation facilities. No npm package was exclusively owned by Engagement, so package dependencies remain. Removed obsolete Engagement build-directory references from TypeScript configuration. Active product documentation no longer advertises the feature. Historical evidence and migrations retain their original technical references with retirement notices on the principal reports.

## 12. Navigation verification

All twelve remaining CRM destinations and the signing workspace opened at 1440px and 390px in Edge against the production artifact. The navigation contains no Engagement option or empty group. No uncaught browser exception, retired endpoint request or CRM API failure was detected during this pass. See [browser-final.log](browser-final.log).

Screenshots in `screens/` were inspected as desktop/mobile montages. Commercial Hub received a separate loaded-state capture and inspection at both widths. Its mobile tabs and wide data table retain horizontal scrolling. The populated commercial screen shows quote balances and active contracts. See [browser-commercial.log](browser-commercial.log). This pass verifies removal-related layout integrity, rather than every existing control in the product.

## 13. Regression results

| Area | Result and evidence |
| --- | --- |
| Native CRM | Creation, qualification, assignment, conversion, linked company/contact/deal reads, calls/meetings/notes, reminders, reassignment, stale-write rejection, completion and company timeline passed. `native-activities.log` |
| Pipeline | 19 live assertions passed. `pipeline-live.log` |
| Automation | 22 live assertions and 26 rollback reliability assertions passed, plus concurrent worker and real-clock continuation. `automation-live.log`, `automation-reliability.log` |
| Commercial | 30 live assertions and three executed-contract renewal assertions passed. `commercial-live.log`, `commercial-renewal-acceptance.log` |
| Signing | 27 live acceptance, 20 customization and 53 real-browser assertions passed, including separate witness completion, editor persistence, assigned fields, signature input and completed-document evidence checks. `sign-live.log`, `sign-customization-live.log`, `sign-customization-regression-browser.log` |
| Sign editor | All twelve field tools, witness ownership, drag/move, rotated page, undo/redo, copy/paste and deletion passed in Edge. `editor.log` |
| Commercial-to-sign | Proposal, quote and contract completed through their approval/issuance lifecycle, with idempotent reminder tasks. Three scoped completion events and notifications passed, with no duplicate worker steps. `sign-integrations.log`, `sign-events-final.log` |
| Governance | 63 rollback database assertions across isolated tenants, ten initial browser/API checks, six saved-view/bulk browser checks and six authorization API checks passed. Custom import validation, commit, persistence and duplicate checks passed for the tested objects. `governance.log`, `crm-governance-*.log` |
| Unit regressions | Selected 29 existing/native test suites exited successfully. `unit.log` |

The first concurrency fixture attempt deadlocked during company-event creation while other suites were active. An isolated retry passed, and cron completion was independently confirmed. One initial saved-view browser attempt timed out, then passed on retry. The signing integration script initially counted five successful events while expecting three because concurrent suites shared a synthetic organization. The final scoped assertion selects the three commercial records and verifies all three successes and notifications. These earlier failures are retained or explained here rather than presented as product passes.

External email delivery and external calendars were not certified by these tests. In-app signing completion notifications and native reminder creation were verified.

## 14. Security results

Retired table grants are closed for application and service roles, RLS remains enabled, exclusive privileged HTTP/RPC entry points are removed, and retired routes return 404. Tenant isolation and authorization regression evidence is included in governance and signing checks. No production-secret values are included in the intended evidence.

The unchanged `security:check` reports four existing finding groups concerning public sign-portal classification, service-role signing routes and policy-less deny-by-default storage tables. Two retained mail credential/state archives appear in the final group with table grants revoked. These checker findings require separate review before claiming a fully green repository security gate. See [security.log](security.log).

## 15. Production build and quality

The production build passed and generated the standalone artifact used by browser tests. TypeScript passed after regenerating stale development route types. Lint passed with zero errors and five existing warnings. Migration consistency passed. Removed Engagement API paths are absent from the build route output. See `build-final.log`, `typecheck-final.log`, `lint.log` and `migrations.log`.

An earlier build/typecheck attempted to import removed handlers through stale generated `.next/dev/types` files. Only generated files were moved to the external backup, then route types were regenerated. The source removal required no security-rule weakening.

## 16. Remaining issues

| Classification | Work and acceptance condition |
| --- | --- |
| Completed and verified | Active application removal, configured-database retirement, native activity refactor, archived workflow protection, regression tests and local production artifact |
| Partially completed | Operational rollout. Deploy both migrations and the tested application to each environment, drain old instances, and repeat retired-route and job checks against the actual deployment |
| Blocked | External Google/Microsoft grants and secret-manager retirement. Authorized provider/deployment administrators must supply revocation receipts and verify former grants cannot refresh or send |
| Partially completed | Four existing repository security-check finding groups and five lint warnings. Review on their own merits before a general production-readiness certification |
| Requires explicit data-deletion approval | Purging retained Engagement tables, historical records or credential archives. Agree tenant scope, export, retention and irreversible deletion separately |

## 17. Final removal status

The repository and configured database have completed the Sales Engagement removal within the verified boundary. Historical archives are deliberately retained with application access revoked. Full operational decommission across external deployments remains pending rollout and provider revocation evidence. No remaining active Sales Engagement application path was found in the final source, API, navigation or database checks.
