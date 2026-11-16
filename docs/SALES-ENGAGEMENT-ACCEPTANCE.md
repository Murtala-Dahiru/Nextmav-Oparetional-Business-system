> Historical record. Sales Engagement was retired by migration 0148. These instructions describe the former release.

# Sales Engagement acceptance audit — 5 November 2026

## Release assessment

**This is a verified internal sales-execution increment, not completion of the full Sales Engagement brief.** OAuth, provider adapters, private messages, manual compose/reply and CRM reply-stop now exist. Live provider behavior remains unverified because credentials are absent. Automated email sequences and calendar synchronization still require implementation. No real email was sent and no calendar invitation was issued.

Existing customer records and prior uncommitted development were preserved. Additive migrations 0121–0129 were applied to the configured application database. No general-purpose worker, customer database, revenue dashboard or signing engine was introduced.

## Product audit

| Category | Classification | Evidence / remaining work |
|---|---|---|
| Sales workspace | Partially implemented | Real owner-scoped paginated queue, overdue/today/upcoming, first contact, quiet deals, meeting filter, completed work, search, contextual navigation. Unanswered provider conversations and a distinct sequence-intervention filter remain unavailable. |
| Communication Centre | Partially implemented | Record-aware persisted CRM history and commercial context. Private paginated mailbox list, safe text detail, compose/reply and explicit CRM thread association now exist; a grouped conversation presentation remains unfinished. |
| Business email | Blocked / partially implemented boundary | OAuth/PKCE callbacks, private encrypted credentials, concrete Gmail/Graph adapters, manual bounded/incremental synchronization, compose/reply and idempotent acceptance ledger implemented. 12 provider-contract checks and 11 database security checks pass. Live providers blocked by absent credentials. Unattended polling, drafts, signatures, reply-all, forwarding and attachments remain missing. |
| Sales activities | Partially implemented | Existing activity infrastructure reused; structured call direction/duration/outcome, manually chosen interaction time, manual WhatsApp logging, create/edit/complete, administrator reassignment. Low/normal/high priorities persist in existing activity details, affect ordering within queue urgency groups, and remain visible in timelines. Explicit cancellation state remains missing. |
| Follow-ups | Completed and verified for implemented flow | Create, complete, snooze, edit/reschedule and reminder reuse. Concurrent completion commits once; stale actions fail. Next-action save failure is distinguished from successfully saved interaction. |
| Sales sequences | Partially implemented | Publish immutable manual call/follow-up/wait sequences; eligible enrollment; unique active recipient; pause/resume/stop/opt-out; durable Automation Studio execution and recovery. Explicitly associated private-thread reply-stop passes 7 real database checks, including out-of-order evidence. Live reply detection remains unverified. Real RLS-scoped enrolled/active/completed/paused/replied/failed/opted-out/stopped counts are implemented and pass database checks. Email steps and business-hour sending remain missing. |
| Templates | Completed and verified for implemented flow | Personal/shared templates; create/edit/duplicate/archive/search/categories; selected-record preview; explicit missing variables; optimistic concurrency; database privacy. Composer now consumes authorized template previews and blocks missing variables; 11 production mailbox browser checks now verify private association, responsive layout, safe rendering, correct contact personalization and blocked missing values. No live provider operations were tested. |
| Meeting management | Partially implemented | Internal meeting activity with participants, timezone, start/end, duration, location, HTTPS video link, notes/outcome and CRM association. No attendee invitations or booking service. |
| Calendar integration | Blocked / missing | No OAuth credentials; calendar adapters and external event synchronization are not implemented. UI explicitly states no invitation is sent. |
| Scheduling links | Missing / optional scope deferred | No public availability or booking endpoint exists; no double-booking claim is made. |
| CRM integration | Partially implemented | Uses existing Lead/Contact/Company/Deal activities and shared ActivityDialog, record navigation, Customer 360 visibility, Commercial Hub/Sign context. Direct email and sequence enrollment actions on all record views remain missing. |
| Automation Studio integration | Completed and verified for manual scope | Existing activity events and existing worker reused; active minute cron verified. Concurrent task execution once, pause/resume, opt-out and real-clock recovery tested. No verified email events exist. |
| Permissions / tenant isolation | Completed and verified for implemented endpoints | Authorization plus RLS/security-invoker reads; personal templates private; direct foreign-tenant RPC denial; record-scope preview/history denial; admin-only publication and reassignment. |
| Mailbox privacy / tokens / attachments | Partially verified | Real PostgreSQL tests enforce employee-only mailbox/message access, deny authenticated credential/OAuth reads and direct mailbox writes, serialize leases, prevent duplicate sync and delete data on disconnect. Provider attachments are not served. Live OAuth token lifecycle remains unverified. |
| Data integrity | Completed and verified for implemented mutations | Stale revisions, row locks, unique enrollment, meeting time constraints, immutable published sequence steps. Applied additive migrations passed PostgreSQL validation and parser/cross-file checks. |
| Reliability | Partially implemented | Durable manual sequence recovery, duplicate prevention, bounded reads, visible API errors. Private mailbox leases, bounded cursors, expired-history reset, uncertain-send no-retry behavior and local disconnect deletion are implemented. Unattended sync and send reconciliation remain missing. |
| Performance | Partially implemented | Queue/template/history pagination and targeted indexes. No production-scale load benchmark has been run for the new queue. |
| Responsive UX | Verified for exercised flows | Production browser widths 1440/1280/768/390; no page overflow or runtime errors. Final production run also verifies persisted mobile call logging and follow-up creation/completion. |
| Accessibility | Partially verified | Labeled navigation, action controls and activity form inputs; keyboard-native buttons/selects; loading/error states. No complete screen-reader or WCAG conformance audit. |
| Existing CRM regression | Verified for selected suites | 19 record-access tests, 5 automation validation tests, 2 lead acceptance tests and 23 Sign assertions pass. This does not represent every BOS workflow. |
| Production build | Completed and verified | Final optimized webpack build and TypeScript passed. Network DNS/font-download failures are retained; successful build used a temporary native-fetch transport override for actual Google font downloads, not mocked font assets. |

## Evidence

- `sales-engagement-live.txt`: 22 real application/database checks.
- `sales-sequences-live.txt`: 10 durable sequence checks, including concurrent workers and opt-out.
- `sales-sequence-recovery.txt`: persisted real one-minute wait, closed connection, recovery and exactly one task.
- `sales-engagement-security.txt`: 10 direct database authorization/integrity checks; rollback-only security fixtures.
- `sales-engagement-reassignment.txt`: authorized persisted reassignment and departure from original owner's queue.
- `sales-engagement-unit.txt`: 10 personalization/meeting validation assertions.
- `sales-mail-contract.txt`: encryption binding, OAuth entropy, provider URL restrictions, ambiguous matching, rate limits and unknown-send outcome tests. **No live provider testing.**
- `sales-engagement-regression.txt`: selected pre-existing CRM, automation, lead and Sign regression suites.
- `sales-engagement-db-check.txt`: SQL parser and cross-file consistency through 0124.
- `sales-engagement-lint.txt`, `sales-engagement-types.txt`: relevant lint and TypeScript evidence.
- `sales-engagement-browser-production.txt`: initial 9 successful production browser checks.
- `sales-engagement-browser-final.txt` and `sales-engagement-browser-release.txt`: 11 production browser checks each, including mobile writes and the release mobile filter layout.
- `sales-sequence-owner-security.txt`: suspended enrollment owner rejection and failed-run visibility, in a rollback-only transaction.
- `sales-engagement-replay.txt`: two clean replays of migrations 0121–0124 against existing PostgreSQL schema, rolled back. Full historical migration replay was not run.
- `sales-template-lifecycle.txt`: 3 live template duplication, archival and source-preservation checks.
- `sales-engagement-evidence/`: desktop, laptop, tablet and mobile screenshots with synthetic records.
- `sales-engagement-build.txt`: successful initial optimized build. `sales-engagement-build-final.txt` and `sales-engagement-build-release.txt` confirm successful builds after usability and mobile layout changes.
- `sales-engagement-browser.txt`: failed development-browser attempt; retained rather than hidden. Repeated development navigation was avoided by testing production.

## Remaining acceptance work

The complete brief cannot be signed off from this evidence. Implement provider lifecycle and actual communication workspace, integrate safe outbound sequence actions and verified replies, implement calendar operations, complete remaining activity states and record-level actions, and then run authorized provider, attachment, concurrency, load, accessibility and broader regression acceptance. See `SALES-ENGAGEMENT-OPERATIONS.md` for exact operational prerequisites and reviewed provider references.

Final evidence totals: 52 live application/database assertions (including recovery, null-revision rejection, suspended-owner guards and template lifecycle), 11 final production browser assertions, 10 focused personalization/meeting assertions, provider security contract checks, and 49 selected existing regression assertions. Relevant lint and final production TypeScript/build passed. No live provider operations were verified.

## Business mail continuation evidence

- `sales-mail-adapters.txt`: 11 fetch-double provider contract checks; no real provider requests.
- `sales-mail-security.txt`: 11 PostgreSQL mailbox security checks, isolated rollback fixture.
- `sales-mail-associations.txt`: 7 PostgreSQL CRM association/reply-stop checks, isolated rollback fixture.
- `sales-mail-replay.txt`: additive migrations 0121–0127 replayed twice and rolled back.
- `sales-mail-migration-check.txt`: migration parser and cross-file checks through 0127.
- `sales-mail-lint.txt`: mailbox API/library/UI lint results.
- New mailbox UI/build evidence must be assessed separately from the earlier release browser/build results above.

No claim of global standards certification, full WCAG conformance, live provider acceptance or full brief completion is made.

## Resumed continuation

- `sales-mail-regression-browser.txt`: 11 existing Sales Engagement browser checks pass against the mailbox production build, including mobile call/follow-up writes.
- `sales-sequence-metrics.txt`: 3 PostgreSQL tests verify owner and employee totals match their RLS-visible enrollment rows and inaccessible tenants expose no counts.
- `sales-sequence-metrics-lint.txt`, `sales-sequence-metrics-types.txt`: targeted lint and TypeScript verification for metrics.
- Migrations 0121–0128 replay twice successfully; 0128 adds only RLS-scoped sequence counts and an index.
- `sales-engagement-continuation-build.txt` retains the Windows EBUSY build failure caused by reusing a running standalone directory. The subsequent build uses a fresh output directory.

## Latest verified browser and activity increment

- `sales-mail-browser.txt`: 11 production browser checks passed using an explicitly synthetic mailbox fixture. Tests send no email and do not claim provider connectivity.
- `sales-engagement-validated-browser.txt`: 12 production browser checks passed, including mobile sequence outcome totals matching the authorized API.
- `sales-engagement-validated-build.txt`: optimized build, TypeScript and static-page generation passed through migration 0128.
- `sales-activity-priorities.txt`: 3 PostgreSQL tests verify persisted priority ordering, explainable urgency reasons and direct-write validation; fixtures rolled back.
- `sales-activity-priority-lint.txt`, `sales-activity-priority-types.txt`: priority implementation lint and TypeScript checks.
- Migration 0129 extends activity details and the existing priority queue; it creates no new task table.

## Priority and scope hardening

- `sales-engagement-mail-final-build.txt`: production build passed through migration 0129 with reduced OAuth scopes.
- `sales-engagement-mail-final-browser.txt`: 13 production browser checks pass, including persisted high-priority follow-up creation/completion and RLS-scoped sequence totals.
- `sales-mail-adapters.txt`: now 12 provider-contract checks, including exact read/send scopes with no unused draft/write permission.
- Mailbox local-disconnect recovery now tolerates a lost/unreadable encryption key. Provider revocation is explicitly unconfirmed in that case; the final production application test verifies local deletion and an explicitly unconfirmed provider revocation.

## Remaining implementation work (not credential blockers)

1. Durable unattended mailbox synchronization, including recovery of dense provider history pages and operational monitoring.
2. Provider-backed drafts, forwarding, reply-all, signatures and safe authorized attachments; grouped conversations and unanswered-reply queue integration.
3. Authorized automated email sequence steps with business hours/timezone rules, approval controls, suppression and send reconciliation integrated with Automation Studio.
4. Calendar adapters and external create/update/cancel operations; internal meeting records already persist. Public availability booking remains optional and unimplemented.
5. Explicit activity cancellation, direct email/sequence actions across record views, shared communication logging with deliberate privacy controls, and additional scale/accessibility verification.

These are actual product gaps. Missing OAuth credentials prevent live provider verification but do not account for all unfinished scope. Full Sales Engagement completion and global-standards certification are not claimed.

## Final verification of this continuation

- `sales-engagement-recovery-build.txt`: successful optimized production build, TypeScript, page generation and standalone packaging for the latest source.
- `sales-mail-recovery-browser.txt`: 13 production browser/application checks pass, including readable private mail, CRM association, responsive widths, safe personalization, unavailable providers, invalid OAuth callback, unreadable-credential disconnect and persisted-content deletion.
- `sales-mail-disconnect-lint.txt`: disconnect recovery lint passes.
- `sales-engagement-mail-final-browser.txt`: 13 sales-workspace regression checks pass; mobile activity priority and sequence metrics are exercised.
- The latest production test server is at localhost:3030. It has no Google/Microsoft credentials; synthetic mailbox/template fixtures are deleted after browser verification.

The full product brief remains partially implemented for the reasons listed above. This continuation is verified; it is not a declaration that all requested functionality is finished.
