# NextMav Sign document customization — Phase 1

## Scope and baseline

Continued from the existing uncommitted repository; no reset or cleanup of prior work. Governance and the final CRM-wide audit remain deferred.

The inspected baseline supported signature, initials, automatic date, name, email, company, text and checkbox. Name/email were overwritten with recipient identity at completion. Fields were restricted to Signer recipients. Quick Send inserted a linked date by default. Normalized page coordinates, drag/resize, transparent signature cleanup, signature appearance controls, private PDFs, capability hashes, scoped portal sessions, consent, optimistic locking, immutable actions, document hashes, evidence seals, sequential/parallel actions and template revisions already existed and were reused.

## Implementation

- Shared collapsible field editor in Advanced Send and Quick Send. Independent field toolbar; explicit Signature + Date; witness shortcuts using ordinary fields and the Witness recipient role.
- Signer, Witness, Countersigner, Approver and Viewer roles use the same signing engine. Viewer fields are rejected. Internal countersigner is a capacity label, not separate identity verification.
- Field selection, movement, corner resizing, keyboard positioning, duplication, independent deletion, reassignment, page/position/size controls and recipient-specific preview.
- Editable full name/email, manual date, safe defaults/read-only values, placeholders, maximum length, name/number validation, font size, alignment and multiline text. New name fields are distinct from intentional electronic signatures.
- Actual signing dates are generated from each action's server timestamp. Date Input stores a distinct recipient-entered calendar date, suitable for an effective date when labeled accordingly.
- Completed PDF uses only actual values; text fitting, line wrapping and alignment reuse the embedded font. Existing image sanitization, aspect ratio, size slider and Reset to Fit remain intact.
- Existing issued fields without inputMode retain legacy automatic name/email behavior. No existing evidence is migrated or rewritten.
- Existing database-backed template revisions preserve role placeholders and field definitions without capability tokens. Saving from the editor first persists the current draft. Reuse creates a separate unsigned draft; new versions cannot alter an issued agreement.

## Files changed in this phase

Application: src/lib/sign/model.ts; src/lib/sign/server.ts; src/lib/sign/text-rendering.ts; src/app/api/sign-portal/route.ts; src/components/sign/field-editor.tsx; src/components/sign/workspace.tsx; src/components/sign/quick-send.tsx; src/components/sign/client-portal.tsx; src/components/sign/pdf-viewer.tsx.

Database: supabase/migrations/0130_nextmav_sign_customization_roles.sql. This only extends the existing overview's pending-signature role predicate. Fields remain in existing tenant-scoped envelope/template JSON; no duplicate tables or engine.

Verification: scripts/sign-customization.test.mts; scripts/sign-customization-live.mjs; scripts/sign-customization-regression-browser.mjs; scripts/sign-customization-quick-browser.mjs; scripts/sign-customization-migrate.mjs. Next build adds its generated type include paths to the existing tsconfig.json.

## Deferred connected capabilities (limited source/configuration inspection)

At the time of this signing audit, Google and Microsoft sales mailbox adapters existed (subsequently retired in migration 0148), but GOOGLE/MICROSOFT client IDs and secrets and SALES_MAIL_ENCRYPTION_KEY are absent in this environment. No real provider connection, send, receive or synchronization is verified. Mail OAuth scopes contain no calendar scopes. Sequence migration 0122 explicitly leaves provider-backed automated email unavailable. External calendar synchronization and provider-backed meeting scheduling remain deferred. No provider credentials were invented and no unrelated Sales Engagement changes were made.

## Constraints

Supported PDFs retain the existing limits: 20 MB, 100 pages; encrypted, unsafe active-content and unsupported rotated documents are rejected. Unicode is limited by the bundled Liberation Sans font; this is not universal script shaping. New text fields fit down to 6 points. Before recording consent, the server rejects unsupported characters and values that cannot fit at a readable size. Senders can enlarge the field or recipients can shorten an editable value. Recipient preview is illustrative and records no consent. Existing templates reuse their source PDF; arbitrary cross-document role/layout remapping is not introduced. Witness role and countersigner role do not establish legal witnessing formalities or verified employment. Existing deployment requirements in NEXTMAV-SIGN-OPERATIONS.md remain applicable.

## Verification

All live acceptance fixtures used isolated test organizations. Preparation supports click placement, pointer dragging and corner resizing. Templates reuse the original document. Countersigner identifies a stated capacity and does not verify internal employment. The production build uses the repository's existing Next.js build and standalone packaging pipeline.

| Executed check | Result | Evidence |
|---|---|---|
| Production build and TypeScript | Passed, 189 static pages and standalone packaging | sign-customization-verified-build.txt |
| Scoped ESLint | Passed | sign-customization-final-lint.txt |
| Existing signing unit suite | 23 passed | sign-customization-unit.txt |
| Signature image cleanup, fitting and server date tests | 7 passed | sign-customization-image.txt |
| New field validation and rendering tests | 22 passed | sign-customization-fields.txt |
| Existing live signing regression | 28 passed | sign-customization-live.txt |
| Sequential customer and witness with distinct effective date, independent names, evidence and versioned template | 20 passed | sign-customization-replay-acceptance.txt |
| Quick Send with uploaded PDF, keyboard movement, drag, resize, undo, font size, independent fields, real signing and integrity verification | 21 passed | sign-customization-verified-quick-browser.txt |
| Advanced preparation and parallel recipient browser workflow | 39 passed | sign-customization-verified-regression-browser.txt |
| Extended signing security | 18 passed | sign-customization-security.txt |
| Isolated recovery worker | 1 completed, 0 failed | sign-customization-worker.txt |
| Commercial Hub | 30 live checks passed | sign-customization-commercial.txt |
| Commercial, automation, tenant and signing integration | 23 passed | sign-customization-integrations.txt |
| Shared navigation and layout | 44 and 118 passed | sign-customization-navigation.txt and sign-customization-layout.txt |
| Migration | 0130 applied and cross-file checks passed | sign-customization-migration.txt and sign-customization-db-check.txt |

The completed acceptance PDF was rendered and visually inspected. Both actors' intentional marks, entered legal names and server dates are legible at the assigned positions. The effective date appears separately. Original document labels and rules remain, with no editor handles, dashed borders or placeholder backgrounds. See sign-evidence/customization-completed.pdf, customization-completed.png and customization-certificate.pdf. The preparation screenshots are customization-editor-1440.png, customization-editor-768.png and customization-editor-390.png.

### Repository-wide security gate

The repository-wide static checker reports four findings in sign-customization-static-security.txt. It expects a BOS authentication guard on the recipient portal and its exemption list omits that endpoint. The portal authenticates by capability and session. The checker also flags direct service-role use in signing and existing mail routes and five RLS-enabled tables with no client policies. Read-only database inspection confirmed that all five tables have RLS enabled and neither anonymous nor authenticated clients have SELECT privilege (sign-customization-security-review.txt). The scoped live suites exercised recipient ownership, tenant isolation, OTP, immutable issued/completed records, private storage and evidence verification. The static gate remains open pending reconciliation with the project's privileged-access policy. No exemptions or database grants were added to clear it.

Production approval also depends on the deployment controls in NEXTMAV-SIGN-OPERATIONS.md. No jurisdictional or international standards certification was performed. CRM Governance and the final CRM audit remain deferred.

The earlier parallel browser run returned a 409 while issuing another recipient link. The interrupted test envelope subsequently accepted a fresh link and the entire parallel workflow passed on rerun. The underlying cause of the transient rejection was not established.

Final local build: http://localhost:3034/dashboard. Open CRM → Commercial Hub → NextMav Sign. Ready for controlled user acceptance. Production sign-off remains subject to the static security review and deployment requirements above. Both pages of the final parallel PDF were visually inspected. The drawn and uploaded marks fit within their fields, the three names are separately readable, and the final sequential PDF includes exactly the intended values.
