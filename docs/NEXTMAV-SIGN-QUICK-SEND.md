# NextMav Sign — Quick Send usability upgrade

## Previous friction

New users had to enable manual-link access in Settings, provide an email even for
manual delivery, change the recipient verification type, add recipients in a
separate tab, place fields, enable signing, and separately generate a link.

## New experience

Quick Send is the primary action: choose PDF/commercial document → name (email
optional) → click to place signature → create secure link. The success screen
includes copy, WhatsApp, real recipient preview, status and return to agreements.
No email delivery is claimed. Advanced Send and Advanced Settings retain the
existing enterprise controls and templates.

A new organization's first authorized document creation initializes Standard
Signing, a 14-day default expiry, external access and built-in consent. Initialization
uses insert-on-conflict-do-nothing and reloads persisted settings, preserving
existing administrator restrictions and concurrent updates. Mandatory email
verification still requires an email and configured provider; it is never downgraded.
Migration 0120 changes only the database default for new rows, not existing data.

Signature placement supports pointer/touch movement, a resize corner, keyboard
arrows, remove and undo in Quick Send. Coordinates remain normalized relative to
the PDF page across zoom. Advanced preparation also supports movement/resize.

“Try a practice document” creates a private, clearly labelled TEST ONLY PDF and
agreement with no commercial record relationship. It uses the real portal and
signing/evidence engine. Practice records remain auditable; they can be archived.
The recipient preview opens the real invitation and explicitly warns that signing
there records a real recipient action.

## Preserved controls

Existing authorization/RLS, hash-only credentials, expiry/revocation, consent,
recipient assignment, immutable source PDFs, HMAC evidence, completed artifacts,
commercial approval rules and automation infrastructure are reused. No synthetic
email identities are invented. Multiple recipients without email remain assigned
by unique recipient IDs; supplied email addresses must remain unique.

## Verification

See sign-quick-*.txt logs for executed results. Do not infer a passing test from
this report if the corresponding log records a failure or unfinished run.

## Remaining configuration and boundaries

Standard manual-link signing requires no email provider or signing-policy setup.
Existing organizations with explicit restrictions require administrator action
only if they intentionally choose to change those restrictions. Mandatory OTP
remains unavailable until real email delivery is configured.

Production still requires HTTPS, stable evidence-key management, a maintenance
scheduler, storage/backups and the previously documented operational/security
work. Possession of a link is not certified identity. No universal enforceability,
qualified signature or notarization claim is made. Region/document-specific
consent and retention decisions remain the organization's responsibility.

Email stays disabled by user instruction. Follow NEXTMAV-SIGN-EMAIL-LATER.md when
ready. This upgrade does not claim to close every item in the broader Sign audit.

## Executed acceptance — 31 October 2026

- Migration 0120 applied while preserving existing settings (`sign-quick-migration.txt`).
- Production build including TypeScript and standalone packaging passed
  (`sign-quick-final-build.txt`).
- 23 focused assertions passed (`sign-quick-unit.txt`).
- 27 live assertions passed: fresh organization initialization without Settings,
  PDF upload, recipients without email, consent, sequential/concurrent completion,
  artifacts/evidence, invalid/revoked links and mandatory-policy preservation
  (`sign-quick-live.txt`).
- 23 integration/security assertions passed: commercial sources/lifecycle,
  automation, reminder idempotency, tenant isolation and OTP consumption/replay
  (`sign-quick-integrations.txt`). Real email delivery remains disabled.
- 16 Quick Send browser assertions passed, including movement/resize/undo/zoom,
  five success-screen widths, account-free signing and evidence verification
  (`sign-quick-final-browser.txt`). Automated link generation took 18 seconds
  on the final run; this is not a measured human usability study.
- 24 advanced browser assertions passed, including multi-recipient typed, drawn
  and uploaded signatures (`sign-quick-advanced-browser.txt`).
- Full lint: zero errors, five existing warnings (`sign-quick-lint.txt`).
  Final changed-component lint passed (`sign-quick-final-lint.txt`).

Visual evidence: `sign-evidence/quick-preparation.png` and
`sign-evidence/quick-success.png` (capability link masked).
The first browser run exposed stale status when opening the saved pre-signing
agreement; the final implementation reloads current status and the rerun passes.

Local trial: http://localhost:3022/dashboard → CRM → Commercial Hub → NextMav Sign.
Quick Send is the primary action; existing overview/navigation remain available.

The separate uploaded-PDF Quick Send browser journey also passed all 16 assertions
(`sign-quick-upload-browser.txt`), including no-email link generation, real portal
signing, completed PDF/certificate verification, pointer placement and five
viewport widths. Link generation took 18 seconds in that automated run.
