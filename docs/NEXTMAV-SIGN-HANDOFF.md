# NextMav Sign — short handoff

## What is working

Commercial Hub now contains a Sign workspace for private PDFs and immutable issued/
approved commercial documents. Recipients use secure links without BOS accounts.
The implemented journey supports multiple signers/approvers, sequential or parallel
signing, eight field types, explicit consent, typed/drawn/uploaded marks, completed
PDFs, evidence certificates, integrity checks, revocation and recovery.

Quote/proposal acceptance and contract execution use the existing commercial
lifecycle safeguards. Automation Studio completion events and duplicate-safe CRM
follow-ups were tested. Existing Commercial Hub, navigation and layout regressions
passed. Exact evidence and remaining gaps are in `NEXTMAV-SIGN-AUDIT.md`.

## Important decision: email stays disabled

The user requested manual-link trial use first. Keep signing email disabled until
the checklist in `NEXTMAV-SIGN-EMAIL-LATER.md` is completed. The provider abstraction
and OTP controls already exist; no fake delivery or verification is used. A required
OTP request fails closed while no provider is configured.

## Before production

- Apply migrations 0105–0119 and deploy the full build/public assets.
- Configure a stable evidence key, HTTPS, trusted proxy limits and backups.
- Configure the required malware-scanning policy/provider.
- Schedule the bounded Sign maintenance worker for interrupted finalization/expiry.
- Establish jurisdiction-specific consent, retention and deletion procedures.
- Complete the partial items in the audit and perform independent security and
  accessibility review. The original full specification is not yet wholly complete.

`NEXTMAV-SIGN-OPERATIONS.md` contains the operational details. Do not describe this as
a qualified digital-signature service, certified identity verification, notarization,
or universally enforceable signing. Do not mark a deal won from a document action.

## Preserve the repository

The repository had extensive existing uncommitted work. No reset or replacement was
performed. Sign changes are additive; do not discard earlier CRM/Commercial Hub work.
The trial production server was started separately from the existing application.
The latest delivery build log is `sign-delivery-build.txt`; the final browser log is
`sign-browser-final.txt`. Check their last lines for executed outcomes.

Trial entry point: `http://localhost:3020/dashboard` → CRM → Commercial Hub →
NextMav Sign. This is a local verification server, not a production deployment.
External recipients open their generated `/client-portal#...` invitation. Do not
include private invitation URLs in reports or shared screenshots.

Final verification: patched production build passed; 23 browser signing assertions
and 21 live signing assertions passed against the delivery bundle. Release-management
tests passed 15 assertions. Repository lint has zero errors and five pre-existing
warnings. Full original-specification gaps remain explicitly listed in the audit.

## Latest continuation — 30 October 2026

Zod was patched to 4.6.7; its high-severity audit finding is resolved. Eighteen
other dependency findings remain. PDF loading now has a working retry control.
A browser test exposed a document-open/signing revision race; bounded server
retries now reload and revalidate access before retrying.

Latest evidence: `sign-recovery-build.txt` passed (including TypeScript),
`sign-recovery-live.txt` passed 22 assertions, and `sign-recovery-browser.txt`
passed 24 assertions. The browser run covered PDF failure recovery, all five
viewport sizes and all three signature capture methods. Final modified-file
lint passed; full repository lint remains at zero errors/five existing warnings.

The full original specification is still not complete. Use the category matrix
in `NEXTMAV-SIGN-AUDIT.md` as the remaining-work checklist. Email stays disabled;
follow `NEXTMAV-SIGN-EMAIL-LATER.md` before enabling it.

## Quick Send upgrade — 31 October 2026

Use `NEXTMAV-SIGN-QUICK-SEND.md` for the latest usability report and evidence.
Quick Send now guides PDF/commercial source → recipient → signature placement →
secure link. Standard Signing initializes automatically for new organizations,
with optional email for manual links; existing administrator restrictions are
preserved. Advanced Send/Settings remain available. A TEST ONLY practice PDF
uses the real engine without a commercial relationship. Migration 0120 is applied.
Latest local build is at http://localhost:3022/dashboard. Email remains disabled.

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
