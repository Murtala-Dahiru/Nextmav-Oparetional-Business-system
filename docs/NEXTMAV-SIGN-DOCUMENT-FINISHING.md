# NextMav Sign — signature fields and document finishing

## Implementation

The permanent PDF renderer no longer draws field rectangles, white fills, borders,
resize handles or labels. It copies the immutable source and adds completed values
only. Preparation retains interactive dashed boundaries; recipient placeholders
remain interactive and display the applied mark. Existing completed artifacts are
not regenerated or altered.

Signature appearance is a bounded representation (mark, scale, horizontal and
vertical placement) inside the existing signed values. The HMAC action digest
therefore binds appearance as well as content. Legacy plain signature strings and
PNG values continue to render. Appearance cannot expand outside its assigned field.

Server processing decodes bounded PNG/JPEG images, converts grayscale/RGB inputs
to RGBA, handles orientation, rejects invalid/oversized/animated inputs, removes
edge-connected near-white neutral backgrounds, crops empty margins, and emits a
sanitized PNG. Light coloured strokes and enclosed white details are retained.
Aspect ratio is preserved during resizing and PDF placement. Blank images fail.

The signature modal retains Type/Draw/Upload and adds size, position, Reset to Fit
and a preview using the assigned field aspect ratio. Processing previews require
a valid scoped recipient session and rate limits; completion revalidates images.
Stale processing responses cannot replace a newer preview after mode changes.

Preparation supports pointer/touch drag and corner resize, numeric dimensions,
remove and duplicate. The combined Signature + Date option creates two independently
editable fields linked to the same signer. Quick Send includes this option without
an advanced-settings requirement. Advanced preparation provides an illustrative
final-appearance preview, explicitly marked as a sample.

Date fields persist timezone/date format and optional signature association in the
existing field JSON. Completion records a UTC timestamp and derives the date from
that server timestamp. The browser shows “Added when you sign”; its clock is not
the authority. Name/email fields use recorded recipient identity, with email
verification labelled only when OTP was used. Next-required-field navigation is
available in the recipient panel.

## Files

- src/lib/sign/appearance.ts: validated appearance, proportional geometry, date formatting.
- src/lib/sign/image.ts: bounded server image normalization, transparent background, crop.
- src/lib/sign/model.ts: field metadata, appearance validation, automatic field rules.
- src/lib/sign/server.ts: sanitized immutable values and border-free PDF generation.
- src/app/api/sign-portal/route.ts: scoped preview and authoritative dates.
- src/components/sign/signature-pad.tsx: preview, fit/scale/position and capture.
- src/components/sign/pdf-viewer.tsx: dashed preparation and applied signature display.
- src/components/sign/workspace.tsx: combined field, duplication, date configuration, sample preview.
- src/components/sign/quick-send.tsx: combined signature/date placement.
- src/components/sign/client-portal.tsx: authoritative-date disclosure and field guidance.
- scripts/sign-finishing*.mts / .mjs: image/date, live and browser acceptance.

No schema migration or data reset is required; optional metadata lives in existing
field/value JSON. Consent, recipient authorization, immutable actions, source/final
hashes, token restrictions, order and completion certificates remain enforced by
the existing engine. Email delivery remains disabled as previously requested.

## Verification evidence

Refer to sign-finishing*.txt for exact executed outcomes. The first production
build passed; a subsequent final build ran out of disk space. The user freed space
and final verification resumed. Failed build logs are retained.

The rendered first-page evidence is sign-evidence/finishing-rendered.png. The live
fixture intentionally places a signature over blue source content beside existing
text to expose opaque overlays. Finishing PDF and certificate artifacts are kept
separately in sign-evidence.

## Limits

Background removal is conservative, not a general image segmentation service.
Off-white/coloured paper or white regions enclosed by strokes may remain to avoid
erasing real content. Typed signatures use the embedded document font; the preview
uses the browser's sans-serif font and is illustrative. Precise final appearance
is verified in the generated PDF. Mobile tests use browser viewport/pointer
simulation, not a fleet of physical devices. Dates support ISO or English medium
format with an IANA timezone; broader localization remains separate work.

This focused upgrade does not establish qualified signatures, certified identity,
notarization or universal enforceability. Existing production deployment/security
prerequisites and broader audit limitations remain in NEXTMAV-SIGN-AUDIT.md.

## Final executed results — 4 November 2026

- Production build, TypeScript and standalone packaging passed:
  `sign-finishing-final-build-retry.txt`. The prior disk-space failure remains
  recorded in `sign-finishing-final-build.txt`.
- Existing signing assertions: 23 passed (`sign-finishing-unit.txt`).
- New image/geometry/date assertions: 7 passed (`sign-finishing-image-tests.txt`).
- Final live API acceptance: 28 passed (`sign-finishing-final-live.txt`). Includes
  uploaded appearance at 80% scale, date from server timestamp, field ownership,
  concurrency, consent, immutable source, evidence/hash verification and revocation.
- Final capture browser acceptance: 30 passed (`sign-finishing-final-browser.txt`).
  Type/draw/upload, size controls, Reset to Fit, five viewport widths, three-signer
  completion and no uncaught browser errors.
- Combined Signature + Date Quick Send: 18 passed
  (`sign-finishing-quick-browser.txt`). Includes drag, resize, undo, zoom, field
  association, server date, completion artifacts and account-free signing.
- Commercial/security integration: 23 passed (`sign-finishing-integrations.txt`).
  Proposal/quote/contract lifecycle, Automation Studio, reminder idempotency, tenant
  isolation, OTP/replay checks. Email delivery was not simulated.
- CRM navigation: 44 passed (`sign-finishing-navigation.txt`); layout: 118 passed
  (`sign-finishing-layout.txt`).
- Full lint: zero errors/five existing warnings (`sign-finishing-lint.txt`).
  Final changed signing files: zero findings (`sign-finishing-final-lint.txt`).

Rendered and visually inspected with Poppler:

- `sign-evidence/finishing-rendered.png`: uploaded signature over blue source
  content at 80% fit; no white rectangle or placeholder border, original text
  remains visible, signing date visible. Its matching PDF is
  `sign-evidence/finishing-completed.pdf`.
- `sign-evidence/finishing-multi-rendered.png`: typed and uploaded signatures.
- `sign-evidence/finishing-drawn-rendered.png`: drawn signature on page two.
  Both come from `sign-evidence/finishing-image-signatures.pdf`.
- `sign-evidence/finishing-upload-preview.png`: mobile upload/fit modal.
- `sign-evidence/quick-preparation.png`: latest combined field preparation.

Poppler emitted fallback font warnings for Symbol/ArialUnicode but completed
rendering successfully. Visual inspection checked the actual produced page images.

Local trial: http://localhost:3024/dashboard → CRM → Commercial Hub → NextMav Sign.
No migrations, existing-document rewrites or data deletion were performed.
