# Enable signing email later

**Decision:** Keep email signing disabled during the current trial. Do not simulate
email delivery or downgrade required OTP verification. Standard manual links work without setup for newly initialized organizations.
Existing administrator restrictions remain enforced. Advanced Settings controls
whether an organization requires email verification.

## When ready

1. Verify a sender domain/address with Resend and configure its SPF/DKIM records.
2. Set `SIGN_RESEND_API_KEY` and `SIGN_FROM_EMAIL` securely in the deployment
   environment. Never put the key in browser configuration, source control or chat.
3. Deploy with HTTPS. Confirm sender identity and support email in Sign settings.
4. Test a real invitation and email OTP with authorized test inboxes: accepted
   submission, actual arrival, expiry, incorrect code, five-attempt lockout,
   resend cooldown, consumed-code replay and session expiration.
5. Test provider rejection/outage. The user must see a failure; mandatory OTP
   must remain required. Provider acceptance must never be labelled “delivered.”
6. Test sequential signing with real inboxes, link revocation and completed copies.
7. Only then enable email-dependent signing for business users. Disable
   possession-only access where stronger verification is required.

Provider integration: `src/lib/sign/server.ts`. OTP/session endpoint:
`src/app/api/sign-portal/route.ts`. Internal invitations:
`src/app/api/sign/[id]/route.ts`.

Delivery webhook verification, bounce status and provider-confirmed delivery
receipts are not implemented. Add and test them before displaying those statuses.
Email OTP demonstrates control of an inbox; it is not certified identity proof.

See `NEXTMAV-SIGN-AUDIT.md` for implementation/test status and
`NEXTMAV-SIGN-OPERATIONS.md` for storage, key management, recovery and retention.
