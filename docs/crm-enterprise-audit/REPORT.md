# NextMav CRM 3.0 enterprise release assessment

14 November 2026 · Existing Windows checkout · **NO-GO for general commercial release**

## A. Executive summary

A real synthetic lead progressed through conversion, linked commercial records, external approval and contract signing. The browser independently completed an agreement with a separate witness. Four governance objects accepted custom values through the browser. Production dependency scanning, database transport verification, signing behind a reverse proxy, and CRM navigation all improved during this audit.

The release decision remains open on privileged-route review, accessibility, provider certification, commercial provisioning, and incomplete control-level coverage. This report records the independent runs in this directory. Historical acceptance reports elsewhere in the checkout were excluded from pass counts.

## B. Coverage

[inventory.json](inventory.json) maps 13 state-driven CRM destinations on /dashboard and the separate /client-portal. It indexes 102 directly identified or CRM-referencing route files, the remaining shared route paths, 137 CRM/Sign source units, 74 SQL table definitions, five SQL schedules, the signing worker, 114 associated scripts and 1,191 JSX control occurrences. The per-screen import graph maps source locations and literal API references. Indirect runtime calls, shared components, and controls instantiated from data require additional manual coverage. The inventory is a source index, not a claim that each occurrence passed a test.

| Screen | Exercised scope |
|---|---|
| Overview | Owner revenue dashboard, populated acquisition chart, five widths. Full source-to-ledger reconciliation outstanding. |
| Leads | Browser creation, required field, detail, filtering, bulk edit, import/export, API conversion retry. |
| Contacts and Companies | Browser creation and typed persistence, API guarded changes, custom filters, import validation, related-record views. |
| Deals and Pipeline | Browser deal creation, opportunity associations, stage requirements, approvals, weighted forecast. |
| Activities | Logged call, reminders, keyboard filter, activity completion and timeline checks. |
| Engagement | Queue, templates, sequences, internal meetings, disconnected mailbox states. |
| Automation | Live publishing, conditional execution, worker concurrency, retries, effects and rollback load test. |
| Commercial Hub | Quote, proposal, contract, PDF, approval, signing and renewal. |
| Partners | Owner navigation and empty queue. Partner submission through acceptance outstanding. |
| Import | Browser navigation and keyboard access, API preview, validation, commit, duplicate detection and export. |
| Settings | Fields, layout publication, saved views, bulk editing, authorization, existing BOS role-management entry. |
| Client Portal | Recipient sessions, signed field rendering, confirmation, completion, five-width captures. |

Owner was the principal visual-test role. Restricted roles were tested separately. See [governance role checks](crm-governance-role-browser.log), [restricted access checks](crm-governance-authorization.log) and [final screen measurements](final-screens/measurements.json). A complete role-by-control matrix, degraded-network matrix and screen-reader pass remain outstanding.

## C. Defects found

Counts are for the grouped findings in this register. Dependency advisories and repeated axe violations are counted by their respective tools separately. **P0 0 confirmed, P1 4 groups, P2 4 groups, P3 1 group.** Untested paths have no assigned pass or severity.

| ID | Severity | Reproduction and cause | Repair, evidence and status |
|---|---|---|---|
| SEC-01 | P1 | Production npm audit found seven high dependency entries. The lockfile retained affected releases and an editor pinned an affected YAML parser. | Updated eight installed packages through package.json and package-lock.json, including a same-major parser override. Production build and CRM regression rerun. High/critical closed, four moderate entries open. [Before](dep.log) and [after](dep-final.log). |
| SEC-02 | P1 | Database scripts connected with peer verification disabled. Default verified TLS rejected the provider chain on this machine. | scripts/db-connect.mjs now validates hostname and chain, adds the provider root for Supabase hosts and keeps SNI for fallback addresses. Added scripts/supabase-root-2021.crt and scripts/db-tls-verify.mjs. Live verified query passed. [Result](database-tls.log). |
| SIGN-01 | P1 | Browser PDF upload displayed “Cross-origin request denied” when the public browser origin and the standalone server's reconstructed origin differed. | src/lib/sign/server.ts accepts the configured public application origin and continues to reject cross-site requests. scripts/sign.test.mts covers public origin, internal origin, untrusted origin and cross-site metadata. Deployment must set NEXT_PUBLIC_APP_URL to its own public origin. [Regression](sign-regression.log). |
| SEC-03 | P1 release gate | npm run security:check failed four rules covering the public portal, its proxy exemption, service-role routes and policy-less tables. | Open. Some credential tables intentionally deny direct access, and the recipient portal has its own authentication. Live isolated assertions cover specific paths. Review every privileged read/write and anonymous/recipient grant before changing checker expectations. [Raw findings](security.log). |
| UI-01 | P2 | With the sidebar present, the 1280px screen had a 980px CRM navigation area and 1146px of navigation content. | src/components/modules/crm/navigation.tsx uses container width and a more compact desktop row. Five-width regression in scripts/crm-navigation-responsive-browser.mjs. [Result](regression-final.log). |
| UI-02 | P2 | The mobile activity-type control lacked an accessible name. Import progress and a commercial table had scrollable content without keyboard entry. | Named the activity trigger and made the two regions focusable in activities.tsx, import-center.tsx and commercial-hub.tsx. Keyboard regression and repeated axe scans passed those rules. |
| UI-03 | P2 | Directory KPI hints used low-contrast text. Other panels and the shared shell also returned contrast violations. | Darkened directory hints in directory-summary.tsx and import step text in import-center.tsx. Remaining contrast findings span all 13 section captures. Open. [Rule and DOM target samples](final-screens/measurements.json). |
| UI-04 | P2 | Populated acquisition chart has SVG items exposed to accessibility tools without alternative text. | Open. Recheck accessible names and equivalent data at 390px with populated source categories. [Overview result](final-screens/measurements.json). |
| UX-01 | P3 | Linked deal account context said quotes, contracts and renewals were unavailable alongside the working Commercial Hub. | Removed the obsolete text in deal-account-context.tsx. Linked deal workflow checked in [lead-to-sign.log](lead-to-sign.log). No separate copy assertion. |

## D. Repairs and regression

The production build completed TypeScript, route generation and standalone asset packaging. Full lint returned zero errors and five warnings. The package default test passed 30 assertions. Both migration parse and cross-file checks passed. Thirty-two selected CRM and supporting test scripts ran again after the application and dependency edits. The full BOS verify:all command and every historical browser script have not been certified. The new DB transport test was run after the application build. [Build](build-final.log) · [Lint](lint-final.log) · [Default tests](base.log) · [CRM regressions](unit-final.log) · [Migration checks](migrations.log).

## E. Cross-module integration

An isolated Sign acceptance organization supplied the test owner. A new uniquely named, assigned, qualified lead received a logged call. Conversion created a contact, company and deal. Retrying returned the same contact and deal IDs. The three commercial documents all referenced that deal and customer. Signing bound each envelope to the approved or issued record version. Proposal and quote acceptance and contract execution propagated back through existing lifecycle operations. Three completion events succeeded, and a worker replay produced no extra effects. A final deal-filtered read returned exactly three documents. [17 assertions](lead-to-sign.log).

That run began with qualified status and an assigned owner. Custom-field qualification, stage guards, witness sessions and Customer 360 timeline were tested in separate fixtures. There is no single browser recording proving all of those steps, a revenue reconciliation, an organization-wide orphan scan, or every audit entry for the same lead. [Pipeline assertions](pipeline-live.log) · [Governance workflow](crm-governance-workflow-rerun.log).

## F. Sales engagement

Internal meeting persistence, timeline propagation, restricted queues and member-private templates passed. Browser checks covered the daily queue across widths, template editing, mobile sequence counts and disconnected mailboxes. [22 live assertions](sales-engagement-live.log) · [13 browser checks](engagement-browser.log).

Google and Microsoft adapter tests ran locally. Neither provider had a configured test mailbox, client ID and secret, shared SALES_MAIL_APP_ORIGIN and SALES_MAIL_ENCRYPTION_KEY in this environment. Real OAuth consent, sending, receiving, reply correlation, opt-out propagation, token refresh, delivery failure and provider-backed sequence recovery remain unverified. The UI explicitly describes external calendar sync, invitations and attachment downloads as unavailable. Test internal meetings separately from provider scheduling. No external test mail was sent.

## G. Commercial Hub

Thirty live assertions covered pricing, approval, immutable versions, proposal ordering, PDF output, evidence-gated contract execution, isolated visibility and restricted settings. Three renewal assertions preserved prior executed versions. The linked journey separately proved automatic commercial completion. [Commercial lifecycle](commercial-live-prod.log) · [Renewals](commercial-renewal-acceptance-rerun.log) · [Generated PDFs](commercial/).

## H. NextMav Sign

The editor harness exercised all 12 field tools, drag, resize, mobile placement, copy, delete, grouped undo/redo and rotated pages. The production browser suite saved and reopened overlays, gave the witness its own session, completed signer and witness actions, and compared new PDF ink to saved field positions. Three parallel recipients used typed, drawn and uploaded signatures. Separate runs checked revocation, consent, hashing, sequential ordering, server dates and completion certificates. Pixel placement passed at 0, 90, 180 and 270 degrees. [Editor](editor.log) · [53 browser checks](witness-browser.log) · [27 live checks](sign-live-prod.log) · [20 customization checks](sign-customization-live.log) · [Rotation](sign-editor-pdf-rerun.log).

Rendered agreement and certificate pages were visually inspected. The sparse synthetic source placed its own page title at the bottom edge; the more detailed editor fixture and pixel comparison supply the useful position evidence. An older browser script still expects the retired “Assigned signer” control. Its failure is retained alongside the current suite. [PDF evidence](sign/).

## I. Governance and customization

Migrations 0131–0147 were replayed twice inside a rolled-back transaction. Sixty-three assertions covered field validation, archived values, isolation, layouts, visibility, personal defaults and proposal of invalid changes. The four objects accepted browser-entered custom values subsequently read through their APIs. API tests also covered protected edits, bulk stale retries, import mapping, duplicate checks and selected-record export. Restricted settings requests returned 403. Role changes and restoration used the existing owner administration path. [Database](db.log) · [Lead browser](crm-governance-browser-prod.log) · [Other three objects](record-browser-verified.log) · [API](crm-governance-api.log) · [Views and bulk](crm-governance-views-browser-rerun.log).

One replay targeted the wrong synthetic organization because its recorded fixture ID differed from the active login membership. After selecting the authenticated session's synthetic organization the custom-field automation matched and skipped the expected records. Two owner memberships were independently observed on that test identity. Workspace selection for users with multiple memberships needs an explicit product test.

## J. Security and data integrity

The production dependency audit moved from 13 entries to four moderate entries across next-intl, prismjs, react-syntax-highlighter and refractor. Service-role authorization and static guard coverage remain release gates. The database script repair verified a real query with an authenticated TLS peer. The CA came from the provider's download endpoint. [Supabase SSL guidance](https://supabase.com/docs/guides/platform/ssl-enforcement).

Customer records and signing evidence were preserved. No Git reset, blanket record cleanup or migration deployment was performed. Some live browser/API suites retain synthetic organizations, auth identities and documents. Seven temporary fixture files generated specifically for this audit were removed after verification. Rollback-only suites removed their own rows. The checkout contained older fixture material before the audit. Historical cleanup and full fixture reconciliation remain outstanding.

## K. UI, UX and accessibility

All 13 workspace destinations were captured twice at 1440, 1280, 768, 390 and 360px. The final 65 captures were visually reviewed in contact sheets. Document and CRM navigation widths fit all 65 measurements. Keyboard verification exercised the activity select, focus return and import step list. The populated partner queue, every menu, larger text zoom, all screen-reader announcements, motion preferences and every dialog error state remain unverified. At phone widths, list customization controls occupy substantial space before the customer records. Some commercial and pipeline screenshots show sparse data. Separate populated engagement, Sign and governance evidence is available. [Final screenshots and axe targets](final-screens/) · [Baseline](screens/) · [Keyboard results](regression-final.log).

## L. Performance and reliability

The 50,000-row temporary-table custom filter returned 50 matches in 0.87 ms. An isolated 200-event automation workload captured events in 483 ms. Twenty worker batches averaged 378 ms, ranging from 163 to 770 ms, produced 200 notifications and introduced no replay effects. Two concurrent worker sessions committed the wait step once. Twenty-six reliability assertions covered rollback, backoff and scheduling. These measurements do not establish end-user p95 latency, large-directory responsiveness under concurrent writes, fleet connection limits or provider throughput. [Query](perf.log) · [Worker load](automation-load.log) · [Concurrency](automation-concurrency-rerun.log) · [Reliability](automation-reliability.log).

## M. Standalone CRM readiness

Workspace creation, organization membership, authorization and shared administration function in the tested BOS installation. The tests did not demonstrate a purchaser moving from a CRM-only trial through checkout, entitlement activation, invitation, suspension, retention/offboarding and module upgrade. No new billing platform was added. Treat standalone SKUs, ownership of lifecycle events, operational alerts and data retention as separate commercial acceptance work.

## N. Release decision

**NO-GO for general availability.** Commercial completion and signing evidence are materially stronger than at discovery. Release requires an accepted privileged-route review, closure of the identified accessibility defects, defined and tested commercial entitlements, and an explicit decision on the provider functionality included in the sold product.

## O. Remaining work and acceptance criteria

1. Close SEC-03 with per-endpoint authorization, ownership and revocation evidence, including recipient versus workspace access. Resolve the four checker groups without blanket exemptions.
2. Certify each advertised provider using isolated Google and Microsoft accounts. Verify delivery and inbound synchronization on both sides, reply-driven stop, disconnect, refresh and retry. Specify the separate calendar integration boundary.
3. Verify one browser-led lead-to-revenue journey with the same identifiers through custom-field qualification, stage validation, independent approval, witness, Customer 360, audit history and reporting. Reconcile source totals and foreign keys in that tenant.
4. Close remaining axe targets with populated data, run manual screen-reader and focus tests, and certify nested dialogs, hidden menus and responsive error states. Link each obligation in the source inventory to observed evidence.
5. Establish CRM-only provisioning, billing/entitlement, suspension and offboarding acceptance. Verify durable scheduling, alert delivery, backup restore and multi-user load under deployment-equivalent conditions.
6. Reconcile synthetic fixture IDs, preserve signed evidence, and remove eligible test-only records under a scoped retention decision. Retire stale acceptance selectors and rerun the full release suite on the candidate artifact.
