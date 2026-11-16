# NextMav Sign operations

The Sign workspace lives inside Commercial Hub; `/client-portal` is the external,
account-free recipient experience. Internal `/api/sign` routes require normal BOS
authentication and CRM authorization. Only the exact `/api/sign-portal` endpoint
accepts recipient sessions. Recipient credentials never authorize BOS APIs.

## Deployment

1. Apply migrations 0105–0119, in order, after the existing 0104 schema. The provided
   `node scripts/sign-migrate.mjs --apply` checks application/database project identity.
2. Build using `npm run build`. Deploy the public assets, including the PDF.js worker
   and the licensed Liberation Sans font. Use HTTPS and a trusted reverse proxy.
3. Set a stable, randomly generated `SIGN_EVIDENCE_KEY` of at least 32 bytes before
   creating real agreements. Preserve it in backed-up secret management. Existing
   evidence depends on its signing key; do not rotate it without a key-version migration.
   Development falls back to the service-role key; production should not use this fallback.
4. Set `SIGN_RESEND_API_KEY` and `SIGN_FROM_EMAIL` with a verified sender to enable
   real email OTP and invitation submission. Provider acceptance is not delivery.
   Delivery webhooks and read receipts are not implemented. OTP must not be disabled
   to compensate for a missing provider.
5. For mandatory malware screening set `SIGN_REQUIRE_SCAN=1`, `SIGN_SCAN_URL` and
   `SIGN_SCAN_TOKEN`. The scanner receives PDF bytes and must return `{ "clean": true }`.
   Use a trusted private scanner endpoint. Parsing/active-content rejection alone is
   not an antivirus scan. Without the required-scan flag, scanner integration is optional.
6. Invoke `npx tsx scripts/sign-worker.mts` from the existing host job scheduler every
   minute from a protected source checkout with Node and the `tsx` runtime installed.
   The standalone web bundle does not automatically install this job. It retries finalizing documents and expires pending invitations in bounded
   batches. An optional organization UUID scopes a diagnostic run. Alert on nonzero
   exits. This is document maintenance, not a second workflow automation system.
7. Keep existing Automation Studio database worker/schedule jobs enabled. Sign's
   completed/sent/declined/change-request events reuse that dispatcher and worker.
8. Verify secure cookies, nonce CSP, no-store, no-referrer, noindex, and HTTPS at the
   deployed hostname. Configure the edge to strip untrusted forwarded-address headers
   and add independent request/body/connection limits. Do not log request bodies,
   cookies, invitation fragments, OTPs or authorization headers.

## Storage and recovery

`nextmav-sign` is private and has no anonymous/authenticated object policies. Routes
authorize every download. Content-addressed original/final/certificate paths use
insert-only uploads; existing objects are only reused if their bytes match. A final
artifact becomes authoritative when its hashes are committed to the envelope.
Duplicate finalization attempts use optimistic revisions; one transition wins.
Unreferenced intermediate artifacts can remain following a crash and must not be
served as authoritative output.

Signing actions and consent commit before generation. Closing the browser does not
undo them. The maintenance job or the authorized retry button resumes generation.
Back up database and storage together. Restrict service-role credentials to servers.
Database/service administrators remain in the trust boundary; this is not a public
key trust service or hardware-backed immutable archive.

## Retention and privacy

Access expiry and revocation are independent of retention: they deny recipient
access while preserving agreement/evidence records. The current retention policy is
retain-until-authorized-administrative-deletion. No automatic deletion of signed
records is enabled. Establish the organization's jurisdiction-specific retention,
legal-hold and deletion process before production. Automated legal-hold-aware purge
and configurable retention enforcement are not implemented.

The evidence contains recipient names/emails, actions, verification method, consent
version/text, timestamps, source/final hashes and an HMAC-authenticated event chain.
Signature images are private agreement data. IP/user-agent evidence is deliberately
not collected in this version. Minimize access and exports accordingly.

## Assurance boundaries

Possession links identify control of a private link. Email OTP demonstrates access to
the addressed inbox. Neither establishes certified personal identity or signing
authority. Signature images are marks, not identity proof. File SHA-256 hashes and
server-authenticated evidence detect tampering within the system's trust model;
they are not qualified digital signatures, qualified timestamps, notarization, or
guarantees of enforceability. Obtain jurisdiction/document-specific review before
using this for transactions requiring witnesses or stronger identity assurance.

Commercial execution remains an explicit authorized internal action after signing.
It invokes the existing lifecycle RPC and respects its role/approval/version guards.
Signing does not mark a deal won or automatically activate a contract before its
effective date.
