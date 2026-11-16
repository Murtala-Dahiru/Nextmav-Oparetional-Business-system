# NextMav Sign implementation and acceptance audit

Date: 29 October 2026. Scope: Commercial Hub extension only.

## Release assessment

A working document-agreement and electronic-signature implementation exists, with
real passwordless recipient access, signed PDFs, authenticated evidence, and tested
Commercial Hub integration. **The complete original specification is not yet fully
satisfied.** The remaining gaps below must not be represented as completed, globally
certified, or production-approved. Email signing is deliberately disabled for this
trial at the user's request. The patched final production build passed and produced
a standalone bundle (`sign-delivery-build.txt`).

## Preserved and reused infrastructure

- Existing CRM/Commercial Hub, approvals, immutable quote/proposal/contract versions,
  private commercial files, PDF export, membership authorization and CRM RLS scope.
- Existing commercial lifecycle RPC for quote/proposal acceptance and contract execution.
  An authorized internal user records commercial completion after signing. The
  approval, execution-evidence and effective-date rules remain intact.
- Existing Automation Studio durable dispatcher/worker, notifications and CRM tasks.
  Implemented agreement triggers: sent, completed, declined and changes requested.
  Supported actions: notify, wait and condition checks. Unsupported agreement actions
  are rejected by both the application and database validators.
- Existing Company/Contact/Deal commercial-related component now includes associated
  signing status. No automatic won-deal transition or Finance revenue creation.
- Existing uncommitted work was preserved. No Git reset or application recreation.

## Routes and workspace

Commercial Hub → NextMav Sign contains overview, agreement directory, preparation,
templates and settings. Agreement sections: document, recipients, activity, evidence,
settings. `/client-portal` is independent of BOS login.

Internal API: `/api/sign`, `/api/sign/[id]`, `/api/sign/settings`,
`/api/sign/templates`. External capability endpoint: `/api/sign-portal` only.

## Database and storage

Additive migrations **0105–0119** were applied against the configured database after
project-identity validation. They introduce envelopes, hashed credentials, shared
rate counters, settings, templates/version history, reminders, access/archival audit,
RLS, state integrity guards and existing-automation integration.

The envelope stores recipients, normalized fields, consent, actions and chained
events as a versioned JSON aggregate. Service-only compare-and-swap mutations lock
the row. The database rejects invalid transitions, premature completion, removal of
recorded actions and changes to completed recipients. Internal reads remain subject
to tenant/owner/commercial visibility. Credentials carry an enforced tenant/envelope
foreign key and are inaccessible to normal authenticated users.

`nextmav-sign` is a private bucket without anonymous/authenticated object policies.
Original, completed and certificate objects have distinct content-addressed paths.
Downloads authorize scope and verify bytes against their recorded hash. No public
storage URLs are used. Archiving revokes recipient capabilities and retains evidence.

## Signing and evidence

- 256-bit random invitation/session capabilities; only SHA-256 token hashes stored.
  Invitation tokens are URL fragments removed immediately by the browser.
- Email OTP implementation uses hashed, challenge-bound codes with expiry, attempt
  limits, atomic one-time consumption, resend cooldown and shared rate limits.
  No configured provider means required-email agreements cannot be sent.
- One-hour HttpOnly scoped recipient sessions, expiration/revocation checks on access,
  same-origin mutation checks, no-store/no-referrer/noindex and a nonce-based portal CSP.
- Server-enforced field ownership, required values, consent, sequential groups and
  idempotent completion. Signing action persists before artifact generation.
- Original byte hash, preparation digest, signer identity, values, method, consent and
  UTC action time are evidence-bound. Completion binds final-PDF and certificate hashes.
  Canonical action serialization survives PostgreSQL JSON key ordering.
- HMAC-authenticated event chain. Verification is authorized and server-mediated.
  A downloaded file can be hashed locally and checked without uploading its contents.
- Completed recipient access can be revoked independently of immutable execution
  evidence. The operation has a separate database access-audit record.
- Typed/drawn/uploaded signature marks, initials, UTC signed date, name, email, company,
  text and checkbox fields. PNG/JPEG signatures are decoded and re-encoded server-side.
- A bounded maintenance command retries pending finalization and records expiration;
  production scheduling still requires deployment configuration.

## Executed verification

Evidence logs are in this directory. Tests use isolated organizations and synthetic
recipients, not customer records.

| Evidence | Executed result |
|---|---|
| `sign-live-final.txt` | 21 final patched-production live assertions: PDF rejection/upload, draft persistence, order, consent, ownership, concurrency, completion, hashes, downloads, revoked access |
| `sign-browser-final.txt` | 23 final patched-production browser assertions: internal preparation, field placement/zoom, actual PDF rendering, typed/drawn/uploaded signatures, parallel completion, no uncaught browser errors |
| `sign-integrations.txt` | 23 integration/security assertions: approved sources, quote/proposal acceptance, contract execution, reminder idempotency, durable automation, tenant isolation, OTP invalid/expired/consumed-code checks |
| `sign-security.txt` | 18 extended assertions: provider fail-closed, Unicode/eight field types, expiry, rotation/correction, CSRF, replay, decline/change request, template reuse/archive, private storage |
| `sign-recovery.txt` | Simulated interrupted finalization recovered: completed=1, failed=0 |
| `sign-unit.txt` | Focused parsing, bounds, identity, canonicalization, signature substitution, certificate substitution and evidence-tampering assertions |
| `sign-commercial-regression.txt` | 30 existing Commercial Hub live assertions passed |
| `sign-navigation.txt` | 44 navigation assertions passed |
| `sign-layout.txt` | 118 existing layout assertions passed |
| `sign-db-check.txt` | SQL parsing and cross-file migration consistency checks |
| `sign-full-lint.txt` | Repository lint; existing warnings are recorded rather than concealed |
| `sign-delivery-build.txt` | Patched Next.js 16.4.3 production build; success requires the final standalone-ready line |

Browser screenshots cover **1440, 1280, 768, 390 and 360 px** in `sign-evidence/`.
They establish rendered layouts and lack of horizontal page overflow at those sizes.
They do not establish universal device compatibility or a formal accessibility audit.
Completed PDF and certificate were rendered with Poppler and visually inspected.

The default Turbopack release rebuild encountered an existing Google-font resolver
error in public-site code; its failure is retained in `sign-release-build.txt`.
A webpack build passed, then patched Next.js 16.4.3 restored the default Turbopack
build. Final acceptance uses the patched production artifact.

The final patched production bundle passed 23 browser assertions and 21 live
signing assertions. `sign-release.txt` separately records 15 release-management
assertions. No uncaught browser errors were observed. Email was not configured or
simulated. These results do not close the partial categories listed below.

## Mandatory category audit

| Category | Classification | Scope / remaining limitation |
|---|---|---|
| Sign Overview | Partially implemented | Real my-action/signature/approval/completion/decline/expiration/failure counts and filtered directory; final-release verification pending for expanded counters |
| Agreement directory | Partially implemented | Search/status/sort/pagination and recipient/owner/date filters; owner lookup added; safe bulk actions remain |
| Document upload | Completed and verified | Bounded PDF parsing, magic/MIME checks, page bounds, digest and private storage; live malware service separately blocked |
| Commercial document selection | Completed and verified | Immutable issued proposal/quote and approved contract sources tested |
| PDF preparation | Partially implemented | Accurate page placement and normalized properties; thumbnail rail added; drag/resize polish remains |
| Signature field placement | Completed and verified | Per-page fields, bounds validation, zoom-preserved placement and final PDF placement tested |
| Recipient management | Completed and verified | Roles, multiple recipients, correction, access invalidation and completed-identity protection |
| Sequential / parallel signing | Completed and verified | Sequential API and parallel three-signer browser journeys tested |
| Secure links | Completed and verified | Hash-only storage, expiry, revocation, scoped sessions, fragment transport and access checks |
| Recipient verification | Partially implemented | OTP storage/consumption/abuse controls tested; real inbox delivery deliberately deferred |
| Passwordless Client Portal | Completed and verified | No BOS account required; document review, consent, signing, decline/change requests and downloads |
| Document viewer | Partially implemented | PDF.js, multipage navigation, zoom, lazy pages, extracted assistive text; thumbnail rail added; no searchable selectable text layer |
| Signature capture | Completed and verified | Type, draw, upload browser journeys and server image sanitization |
| Consent | Completed and verified | Unchecked explicit consent plus separate confirm action; exact consent snapshot retained |
| Signing state machine | Completed and verified | Application checks plus database transition/action guards, optimistic revision concurrency and duplicate protection |
| Completed PDF | Completed and verified | Exact source copied and assigned values rendered; rotated/cropped/offset PDFs explicitly rejected to avoid misalignment |
| Completion certificate | Completed and verified | Recipient actions/methods/timestamps, envelope and document hashes; separate immutable artifact |
| Cryptographic integrity | Completed and verified | HMAC chain, canonical signed values and substitution checks; server trust/key management boundary applies |
| Document verification | Completed and verified | Authorized stored-object verification; local-file-digest match/substitution checks passed in the final release |
| Delivery / sharing | Partially implemented | Manual copy link and WhatsApp composition; no delivery/read receipts; real email disabled |
| Templates | Partially implemented | Create/reuse/archive, versioned edit, duplication and prior-envelope preservation tested; no commercial-source template reuse |
| Agreement management | Partially implemented | Activity/evidence, access revocation and archive; full safe bulk operations and broader management UX remain |
| Commercial Hub integration | Completed and verified | Lifecycle safeguards and prior versions preserved; commercial completion requires explicit authorized internal action |
| Automation Studio integration | Completed and verified | Actual completion events and idempotent worker effects tested; only supported trigger/action choices exposed |
| Organization settings | Partially implemented | Access policy, expiration, sender/support identity and consent addendum; reminder defaults, notification preferences and enforced retention policy remain |
| Global readiness | Partially implemented | UTC storage, local display, Unicode tested, mobile sizes; full localization, internationalized email and broad font/script coverage remain |
| Security / privacy | Partially implemented | Tenant isolation and focused abuse checks pass; independent penetration test, sandboxed PDF processing, live antivirus and retention enforcement remain |
| Performance / reliability | Partially implemented | Bounded inputs, indexes, lazy pages, optimistic concurrency and tested recovery; production scheduler deployment/load measurements remain |
| Premium UI / UX | Partially implemented | Coherent internal/recipient flows and screenshots; remaining preparation/table polish and full accessibility review |
| Responsive design | Completed and verified | Specified five viewport sizes tested; touch drawing exercised with pointer input, not every physical device |
| End-to-end acceptance | Partially implemented | Core signing/approval/evidence scenarios pass; real email/malware and some later management additions remain |
| Existing CRM regression | Completed and verified | 30 Commercial Hub, 44 navigation and 118 existing layout assertions |

## Production prerequisites and unresolved work

Use `NEXTMAV-SIGN-OPERATIONS.md` for deployment/key/scheduler/storage instructions and
`NEXTMAV-SIGN-EMAIL-LATER.md` for the explicit deferred-email checklist.

Before treating the full specification as done: finish the partial categories above,
execute final-release tests, configure the required deployment services, perform an
independent security/accessibility review, establish jurisdiction-specific consent and
retention policies, and measure production workloads. No production-scale throughput,
universal legal enforceability, qualified eIDAS service, certified identity,
notarization or guaranteed court admissibility is claimed.

## Final release checks

`sign-release.txt`: 15 final-production assertions passed for organization settings,
template duplicate/versioning, preparation identity, access disable, local-file
verification, completed-access revocation, archive and restore.
`sign-db-hardening.txt`: 4 additional database race/immutability assertions passed.
`sign-generated-types.txt`: dedicated source/current-generated-route typecheck passed.
`sign-standalone-native.txt`: packaging now includes the installed Sharp native
platform package; its DLL omission was detected by a real standalone-server test.
The repository lint rules are pinned to the prior React Hooks plugin 7.0.1; the
latest run has zero errors and five existing warnings.

## Dependency hardening

The initial dependency audit reported critical Next.js advisories and high-severity
Sharp/libvips advisories. Next.js was updated to 16.4.3,
Sharp to 0.35.5, and the existing unused NextAuth dependency to 4.24.15. The last
installation audit reported no critical vulnerabilities, but 19 other repository
findings remained (1 low, 7 moderate, 11 high). These are not a clean bill of health.
The final build and regression tests must use the patched versions. The established eslint-config-next 16.1.3 rules were retained to avoid unrelated
lint migrations. Stale isolated build directories are excluded from the main
TypeScript project; `tsconfig.sign.json` additionally checks the current generated
routes. No force audit fix or unrelated framework rewrite was performed.

A final browser rerun initially rejected a malformed PNG fixture after the Sharp
security update. The fixture was replaced with a valid generated PNG; validation
was not weakened. A Windows DLL lock also prevented rebuilding over a running
standalone bundle, so final delivery uses a fresh isolated output directory.

Remaining dependency findings include direct dependencies `@mdxeditor/editor`,
`next-intl`, `react-syntax-highlighter` and `zod`. Zod has a reported oversized-
collection memory-exhaustion issue; the external signing endpoint bounds its body
before parsing, but this does not replace dependency remediation and broader
internal-route payload limits. Production approval remains blocked on this review.

## Continuation — 30 October 2026

Zod was updated to 4.6.7, removing its reported high-severity oversized-collection
validation finding. `sign-continuation-dependency-audit.json` records 18 remaining
repository findings (0 critical, 10 high, 7 moderate, 1 low); dependency remediation
is still incomplete. The earlier 19-finding report above is historical.

The PDF viewer now clears stale state when its source changes and provides an
explicit retry action after loading failure. Browser acceptance injects a temporary
503 before retrying the original document. The focused signing suite passed all
21 assertions (`sign-continuation-unit.txt`). Build/browser checks for this
continuation must be read from their own logs, not inferred from earlier runs.

Email delivery remains disabled by request; the deferred setup checklist remains
in `NEXTMAV-SIGN-EMAIL-LATER.md`. No new database migration was needed.

The first continuation production build and dedicated typecheck passed; lint
reported zero errors and five existing warnings. Its 21 live assertions passed.
The browser run recovered from a simulated PDF failure and passed all five
viewport checks, but exposed an optimistic-lock conflict between document-open
evidence and signing. That run did **not** pass overall.

The portal now retries revision conflicts at most twice, reloading the credential,
current agreement, expiration, revocation and recipient authorization each time.
No retry bypasses consent, field validation or signing order. A live regression
submits viewed/signing requests concurrently. Final validation for this fix is
recorded in `sign-recovery-build.txt`, `sign-recovery-live.txt`, and
`sign-recovery-browser.txt` when those runs complete.

### Verified continuation outcome

- `sign-recovery-build.txt`: production build, TypeScript and standalone packaging passed.
- `sign-recovery-live.txt`: 22 assertions passed, including concurrent viewed/completion.
- `sign-recovery-browser.txt`: 24 assertions passed, including failed-PDF retry, five
  viewport widths, typed/drawn/uploaded signatures and three-signer completion.
- `sign-recovery-lint.txt`: modified route/viewer lint passed without findings.
- `sign-continuation-lint.txt`: full repository lint, zero errors/five existing warnings.
- `sign-continuation-types.txt`: dedicated source/generated-route typecheck passed
  before the retry fix; the recovery production build typechecked the final fix.
- `sign-continuation-unit.txt`: 21 focused assertions passed.

Current local trial: `http://localhost:3020/dashboard` → CRM → Commercial Hub →
NextMav Sign. This continuation has no database migration. The prior category
matrix remains applicable; its partial categories are not promoted to complete.
Email is deliberately deferred. Remaining retention enforcement, localization,
management/preparation features, dependency remediation, external security and
accessibility reviews, scanner and scheduler deployment still prevent claiming
that the entire original specification is complete or production approved.

## Quick Send usability upgrade — 31 October 2026

See `NEXTMAV-SIGN-QUICK-SEND.md` for the scoped implementation report. Setup-free
Standard Signing, optional manual-link email, Quick Send, practice documents and
pointer field positioning are implemented. Existing mandatory settings remain
enforced; migration 0120 only changes future settings defaults. Final production
build passed; 27 live, 23 unit, 23 integration/security, 24 advanced browser and
two separate 16-assertion Quick Send browser runs passed. Full lint has zero errors
and five existing warnings. These usability results supersede earlier setup
instructions but do not close unrelated production gaps in this audit.

## Document finishing upgrade — 4 November 2026

See `NEXTMAV-SIGN-DOCUMENT-FINISHING.md` for files, implementation, exact logs,
rendered-PDF evidence and limits. The scoped upgrade adds border-free final
rendering, sanitized/cropped transparent image fitting, signature size/position
controls, field duplication and associated server-generated signing dates.
Final build/TypeScript passed, as did 28 live, 30 capture-browser, 18 combined-field
browser, 7 new image/date and 23 existing unit assertions. Commercial/security
integration, CRM navigation/layout and lint passed as detailed in that report.
Latest local trial is http://localhost:3024/dashboard. Email stays disabled.
Previously documented broader production prerequisites remain applicable.
