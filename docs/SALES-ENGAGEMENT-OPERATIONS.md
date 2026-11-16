> Historical record. Sales Engagement was retired by migration 0148. These instructions describe the former release.

# Sales Engagement operations

## Installed scope

Migrations 0121–0129 add the daily queue, sales templates, manual sequences and meeting integrity. They preserve existing CRM records and the Automation Studio worker. The deployed database was checked against the application's configured Supabase project before 0121 and 0122 were applied. Migrations 0123 and 0124 were applied through the same configured connection.

The active `crm-automation-worker` cron runs every minute. Existing schedule, account-schedule and retention jobs are also active. A sequence creates ordinary `crm_activities` through that worker. It does not run in a browser timer. Completed enrollment means its configured steps executed; a generated manual task can still be open.

Sequence publication requires an owner or administrator. Record owners or administrators may enroll eligible leads/contacts with a documented lawful basis. Only one active or paused enrollment is permitted per recipient in an organization. Pause cancels eligibility for worker execution while retaining the cursor and due time. Resume retains the original schedule. Stop is terminal. Opt-out updates the authoritative lead/contact preferences and prevents re-enrollment. Every generated task checks current suppression state. Published steps are immutable; create a new sequence to change the plan.

Manual sequence tasks do not send emails. Provider-backed replies stop active/paused enrollment only for the same owner and explicitly associated CRM thread, after enrollment, with prior outbound evidence and a matching CRM email. Out-of-order sync is reconciled. Email steps and business-hours sending remain unavailable. Without that provider evidence, stop the enrollment manually.

## Business mail and calendar prerequisites

Provider credentials and the dedicated encryption key are absent in this environment. The Connections screen reports unavailable. No live provider connection or real email send has been verified.

Configure server-only deployment secrets (never NEXT_PUBLIC variables):

- `SALES_MAIL_APP_ORIGIN`: exact application HTTPS origin (HTTP permitted only for localhost development).
- `SALES_MAIL_ENCRYPTION_KEY`: 64 hex characters representing a cryptographically generated 256-bit key, managed in the deployment secret store. Retain it for existing ciphertext; changing it without re-encryption invalidates stored credentials.
- `SALES_MAIL_GOOGLE_CLIENT_ID`, `SALES_MAIL_GOOGLE_CLIENT_SECRET` for Google.
- `SALES_MAIL_MICROSOFT_CLIENT_ID`, `SALES_MAIL_MICROSOFT_CLIENT_SECRET` for Microsoft.
- Register the exact callback `<origin>/api/crm/engagement/mailboxes/callback` with each provider.

Google requests gmail.readonly and gmail.send, offline access and explicit consent. Microsoft uses the organizations authority and offline_access, User.Read, Mail.Read and Mail.Send. Scope approvals and restricted-scope compliance must be completed with the provider before deployment. No calendar scopes are requested.

Implemented boundaries include single-use expiring state plus a browser proof, PKCE, AES-256-GCM credentials bound to organization/member/mailbox, server-only credential tables, a five-minute operation lease, refresh rotation, bounded initial synchronization over 30 days, Gmail history and Microsoft folder delta cursors, rate-limit delays, private paginated message reads, plain-text rendering, manual compose/reply, explicit private CRM thread association, and an idempotent outbound ledger. Microsoft messages currently show body previews. Sync is manual, one bounded page per request; there is no unattended poller or webhook receiver. Gmail history expiration resets the bounded sync window. Sends with uncertain outcomes are never retried automatically; check the provider Sent folder.

Sending requires a matching authorized CRM lead/contact and recorded email permission. A mailbox allows 50 send attempts per rolling 24 hours. A send response reports provider acceptance, never delivery. Templates can be personalized from the selected authorized CRM record; missing variables block application. Draft persistence, signatures, reply-all, forwarding, attachment handling and calendar synchronization remain unimplemented.

Disconnect deletes local credentials, messages, outbound status records and private CRM associations. Google grant revocation is attempted after deletion. Microsoft users must remove the app grant in their account. The UI reports whether provider revocation was confirmed. Reauthorization currently requires disconnect and reconnect, which deletes local synchronized content.

Before enabling production use, run authorized provider-account tests for consent/callback, refresh, send, receive, reply threading, incremental pagination, expired cursors, revocation and disconnect. Fetch doubles and synthetic SQL messages are not live provider verification. Never send acceptance messages to customer addresses.

Official references reviewed: [Microsoft sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0), [Microsoft authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [Gmail sending](https://developers.google.com/workspace/gmail/api/guides/sending), [Gmail synchronization](https://developers.google.com/workspace/gmail/api/guides/sync). A provider acceptance response must not be labeled delivery.

## Verification

Run `npx tsx scripts/sales-engagement.test.mts`, `npx tsx scripts/sales-mail-contract.test.mts`, and `npm run db:check` for local checks. Live scripts create synthetic records and use the configured development database. `scripts/sales-engagement-live.mjs` creates an isolated test organization and writes a temporary fixture outside the repository for subsequent browser, security and sequence scripts. Current test scripts do not send real email; provider contract tests use fetch doubles. Synthetic fixtures are intentionally retained for review; no customer cleanup operation is performed.

Do not run the live scripts against a production customer tenant. They derive new isolated tenant identifiers and never accept a customer tenant as test input.

Sequence outcome counts use the enrollment RLS policies and include stopped separately from completed. Refresh the enrollment panel to update counts after background execution.

Activity priority is stored in the existing engagement details. Existing records default to normal. The queue preserves urgency grouping and uses explicit high/normal/low priority within each group; priority never advances a deal stage.

If the encryption key is unavailable or ciphertext cannot be decrypted, sends and synchronization fail closed. The owner can still disconnect to delete local secrets/content. In that case provider grant revocation cannot be confirmed; remove the grant directly in the provider account.
