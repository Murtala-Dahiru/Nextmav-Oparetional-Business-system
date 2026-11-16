# Commercial Hub implementation and acceptance

Date: 2026-10-29. Existing repository and uncommitted development retained. Tests use newly created, isolated `Commercial Hub isolated acceptance` organizations. No customer records were deleted. No Git reset, checkout replacement, or unrelated module redesign was performed.

## Delivery status

Commercial Hub has a working integrated core. **The full prompt is not yet completely satisfied.** This is not a claim of certification, legal sufficiency, universal internationalization, or measured production scale. The requirement matrix below distinguishes delivered behavior from gaps.

## Implemented

- One CRM Commercial Hub destination with Commercial Overview, Quotes & Pricing, Proposal Studio, Contracts, and Renewals & Obligations. Contextual approval queue and administrator settings.
- Authorized, server-paginated directories with title/number search, status, customer, owner, date and sorting controls; explicit loading/error/empty states.
- Customer/contact/deal associations validated in SQL. Bounded related-commercial panels in Company 360, Contact 360 and Deal 360. Existing pipeline mutation paths are untouched.
- Quotes with line editing, duplication/removal/reorder, explicit currency, taxes, discounts, non-taxable charges, terms and internal notes. Product catalog selection added, with no implicit currency conversion.
- PostgreSQL numeric pricing, currency precision validation, explicit half-up rounding per line, line discount followed by document discount, inclusive/exclusive taxes and exact string pricing results. No browser total is accepted as authority.
- Row-lock/expected-revision concurrency, server-enforced lifecycle, independent approval by default, configurable self-approval, immutable submitted/approved/issued/executed snapshots and audit events.
- Revisions create new records; replacement issue/activation supersedes the old offer/agreement without deleting its snapshots. Internal acceptance requires authorized recording and an evidence note.
- Structured plain-text proposal editor, reorderable sections, six editable starter structures, reusable organization template storage and version-conflict protection. Proposals can reference an approved/issued quote snapshot.
- Authenticated PDF exports and internal preview. PDF pagination, repeated identity/page footer, full section order, item pricing and terms. Internal notes excluded.
- Contract legal parties, type, term dates, billing/termination terms, private supporting files and execution evidence. Internal approval cannot execute a contract. Only effective executed agreements can be activated.
- Structured obligations create actual CRM follow-ups; completion requires evidence. Renewal records require an executed source agreement; marking renewed requires a newly executed revision of that agreement.
- Configurable expiration-offset reminders create durable CRM follow-ups idempotently. Existing activity-overdue automation handles notifications/escalation; no new scheduler.
- Five supported lifecycle events added to the existing Automation Studio validator/worker: quote submitted/approved/rejected, proposal approved, contract executed. Existing task/notification/wait/condition infrastructure retained.
- Private PDF/PNG/JPEG uploads with size and magic-byte validation, SHA-256 metadata, authorized downloads and immutable evidence retention. Direct evidence metadata requires a corresponding private storage object.
- Currency-separated overview values, effective active-contract values, expiring agreements, review/action queues, overdue obligations and an explicitly defined trailing-90-day recorded-decision denominator.

## Screens/files changed

New `commercial-hub`, `commercial-editor`, `commercial-controls`, `commercial-related`, `commercial-reminders`, `commercial-catalog` and `commercial-template-library` CRM components; new `/api/crm/commercial` routes and `src/lib/crm/commercial.ts`.

Small integrations in CRM navigation/module types, Company/Contact/Deal workspaces and Automation Studio trigger vocabulary/navigation. `pdfkit` and its TypeScript declarations added; configured as a server external package. Database/static security checkers now recognize index column lists and generated policy loops accurately.

## Database migrations

| Migration | Purpose |
|---|---|
| 0098 | Commercial records, versions, audit, policies, taxes, obligations, files, currency precision, pricing and save RPC |
| 0099 | Lifecycle, approvals, obligations, settings, private storage constraints and realtime publication |
| 0100 | Currency-separated, RLS-invoker commercial overview |
| 0101 | Typed role comparison and activity-column integration corrections |
| 0102 | Existing automation worker extension, durable reminder tasks and snapshot identity |
| 0103 | Reusable templates, private-object metadata check and catalog association guard |
| 0104 | Supersession and direct-RPC content integrity |

Applied against the configured live project after confirming application/database project identity. Commercial migrations can be replayed through `scripts/commercial-migrate.mjs`; default mode validates in a transaction and rolls back, `--apply` commits. Replay was tested without rewriting customer data. Do not remove earlier CRM migrations or deploy only the UI.

## Executed evidence

- `commercial-live-results.txt`: **30 live assertions passed**, including create/reopen, pricing precision, add/edit/remove, stale saves, self-approval denial, competing approval requests, immutable issue/revision, JPY currency separation, proposal pricing/order, three PDF exports, private upload/download, execution denial/evidence/activation, obligations, renewal prerequisites, Finance non-interference, RLS and restricted settings.
- `commercial-security-results.txt`: **14 automation/security assertions passed**, covering real durable commercial trigger execution, task/customer links, notification steps, effect idempotency, reminder dates/idempotency, non-member denial across records/versions/files/obligations/history/storage, evidence deletion refusal and inclusive tax.
- `commercial-browser-results.txt`: **16 production-browser assertions passed**, including quote edit/reopen/approval/issue, proposal template/reorder/preview, reminder configuration, existing Leads navigation, no uncaught browser errors and overview/editor overflow checks at 1440/1280/768/390 px.
- `commercial-regression-results.txt`: **28 selected CRM/automation/currency/access regression tests passed**.
- `commercial-types.txt`: standalone TypeScript check passed at the recorded checkpoint.
- `commercial-build.txt` and `commercial-final-build.txt`: production builds and standalone packaging passed, including the final catalog/template refinements. The final build includes its TypeScript validation.
- `commercial-final-acceptance.txt`: **15 additional live assertions passed** for supersession, historical versions, internal customer acceptance, reusable templates/stale updates, mismatched and cross-tenant associations, concurrent saves, invalid file bytes, unauthenticated/restricted PDF denial, KWD rounding and company linkage.
- `commercial-final-browser.txt`: the **16 browser assertions passed again against the final production bundle**.
- `commercial-realtime-browser.txt`: **4 additional browser assertions passed** for realtime arrival, missed-update recovery after disconnect/reconnect, catalog control availability and reusable organization-template saving.
- `commercial-pdf-text-check.txt`: all three PDFs contain extracted document text and exclude the internal-only test note; quote/contract are one page and the long proposal is three pages.
- `commercial-renewal-results.txt`: **3 live assertions passed** for new executed-term activation, prior-term supersession, renewal completion against the new agreement and retention of prior execution evidence. A fresh test login was required by the existing idle-session safeguard.
- `commercial-final-lint.txt`: full repository lint, zero errors and five warnings in existing files.
- `commercial-migration-check.txt`: SQL parsing and cross-file consistency pass.
- `commercial-migration-replay.txt`: commercial migrations validated against the existing live schema and rolled back.
- `commercial-static-security.txt`: repository API/security checks pass.
- `commercial-evidence/`: generated quote/proposal/contract PDFs, rendered PDF pages and desktop/laptop/tablet/mobile screenshots. Quote and multi-page proposal pages were visually inspected; API success alone was not used as visual acceptance.

Browser harness initially timed out while development compilation competed with a production build; it was rerun against the production standalone server. Later harness fixes resolved ambiguous button selectors and local-date conversion in test assertions. Those initial failures are not counted as passes.

## Requirement audit

| Area | Classification | Evidence / remaining gap |
|---|---|---|
| Commercial Overview | Partially implemented | Authorized real data, currencies, queues and decision counts verified. Overview-wide owner/company/date filters and fuller action-center categorization remain. |
| Quote directory | Partially implemented | Search/filter/pagination implemented; full owner/opportunity/next-action columns and saved views remain. |
| Quote creation/editing | Completed and verified for core | Live and browser save/reopen/items/terms. Catalog selector added in final refinement; separate acceptance required. |
| Pricing calculations | Completed and verified for supported currencies | Decimal/precision/discount/exclusive and inclusive tax tests. Supported currency list is explicit, not every world currency. |
| Quote lifecycle | Partially implemented | Review/approval/issue/send-recording/accept/revise/expiry/cancel guards. No verified customer-view tracking or external acceptance portal. |
| Quote versioning | Completed and verified for core | Immutable snapshots, new revision records and replacement supersession tested. |
| Proposal Studio | Completed and verified for core | Structured safe text, sections, reorder, preview and save. Rich text intentionally omitted. |
| Proposal templates | Completed and verified for core | Editable starters plus persistent shared template creation/browser saving, updates and stale-update rejection tested. |
| Proposal PDF | Partially implemented | Real multi-page PDF generated and inspected. Broad Unicode/script/font coverage and organization logo/color/footer controls remain. |
| Contract management | Partially implemented | Practical terms/lifecycle/workspaces delivered; richer party-role and amendment negotiation UX remains. |
| Contract execution evidence | Completed and verified for internal recording | Private executed PDF plus administrator evidence note required; no e-signature claims. Matching uploaded execution text against reviewed terms is a human review responsibility. |
| Contract versioning | Partially implemented | Approved/executed snapshots and controlled revision records; formal amendment comparison/diff and linked-amendment UI remain. |
| Obligations | Partially implemented | Create/assign/complete with evidence and real activity verified. More comprehensive edit/cancel/individual reminder configuration remains. |
| Commercial approvals | Partially implemented | Server authorization, default no-self-approval, revision binding and approval race protection verified. Named approver assignment, multi-step routing, value/discount/risk/deviation policy rules and policy-change audit remain. |
| Renewals | Partially implemented | Source contracts, explicit types, lifecycle, notice calculation and durable reminders implemented; complete new executed-term renewal verified through live API. Richer risk/notice directory and complete renewed-term browser flow remain. |
| Automation integration | Completed and verified for exposed events | Existing durable worker used; five supported commercial events. Native quote-expiring/contract-expiring/obligation-overdue trigger vocabulary is not exposed; configured CRM activity reminders are used. |
| Intelligence | Partially implemented | Currency-separated positions and defined recorded-decision counts; turnaround, proposal conversion, renewal completion and approval SLA metrics remain. |
| Customer/deal integration | Partially implemented | Bounded related panels and focus routing delivered; full Company/Contact/Deal browser navigation regression remains. |
| Finance boundaries | Completed and verified | No invoice/payment creation; currency-separated commercial totals. No claim that commercial value equals revenue. |
| Documents/storage | Partially implemented | Private uploads/downloads and evidence retention tested. Safe archival workflow, antivirus scanning, full-content PDF validation and persistent rendered-version files remain. |
| Security/tenant isolation | Partially implemented | RLS, role denial, immutable writes, concurrency, private storage tested. Additional independent security review and all cross-role/association combinations remain. |
| Performance/realtime | Partially implemented | Bounded queries/indexes; browser-tested realtime arrival and reconnect invalidation. Measured scale/latency acceptance remains. |
| Premium UI/UX | Partially implemented | Actual desktop/mobile screenshots inspected; broad editor/directory acceptance passed. Some advanced controls use native confirm/prompt and require further polish. |
| Responsive design | Completed and verified for overview/quote editor | Four requested widths passed overflow checks. Every dialog, panel, table and keyboard path has not been exhaustively tested. |
| End-to-end acceptance | Partially implemented | Core live/browser/regression evidence above; not every mandatory scenario or unrelated module was exercised. |

## Remaining manual/automated acceptance

- Confirm organization-specific approval rules, reviewers, tax rules, currency coverage and branding requirements before production rollout.
- Execute the remaining linked Company/Contact/Deal, renewed-contract, approval rejection/request-changes, keyboard focus and notification-link journeys.
- Validate representative international text, long legal documents and organization branding in PDF exports.
- Extend the passing restricted-owner PDF export, cross-tenant association, concurrent revision and realtime tests to a complete multi-role/multi-record access matrix and sustained reconnect/load behavior.
- Run load/latency measurements against a representative authorized dataset and independently review commercial RLS/storage/policy governance.
- No external customer email delivery, tracked view, secure public share, customer acceptance portal or e-sign provider is claimed.

The test organizations and evidence are retained for reproducibility. Credentials are stored only in local temporary fixture files, not this report or the repository.
