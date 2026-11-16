# CRM decommission operations

Deploy migrations 0148 and 0149 transactionally, then the application artifact. Drain old application instances before declaring the deployment retired. The old HTTP handlers are absent from the new build. Existing SQL routines and browser/service table grants are removed on migration. Shared authentication, CRM, automation, business notifications and signing continue to use their existing paths.

## Custody and retention

Nine original tables remain in public with RLS enabled and their tenant/owner policies intact. Application, anonymous and service roles have no table grants. Service-role bypass of RLS cannot replace a missing table privilege. Enrollments preserve original owner, basis, run and sequence links. Native activity rows retain meeting metadata, associations and timeline entries. Terminal outcomes remain historical. The migration closes live enrollments, archives definitions, cancels only applicable nonterminal runs and adds an audit event under the original organization. Existing administrators can inspect archived workflows and execution history in Automation Studio. The retention worker skips historical sequence runs so that their foreign keys cannot abort unrelated retention batches.

For an approved export, the data custodian must identify the organization and entitled mailbox owner, confirm the retention period and purpose, and use a read-only database-owner transaction scoped by organization_id and mailbox owner. Verify tenant joins on mailbox and enrollment IDs, export only approved business columns, encrypt the export, compare row counts and log the handoff. Never export OAuth states, access tokens or refresh tokens as customer records. Keep original RLS grants closed. No retention period or customer purge is implied by this release. Table removal, credential-row destruction or customer-record deletion requires a separate explicit decision.

## Provider and environment checklist

1. In each deployment, verify application version, all replica instances, scheduled invocations and OAuth callback configuration. Remove dedicated out-of-repository sales jobs and disconnect any staging copies.
2. Identify the former dedicated Google and Microsoft application registrations. Check for shared BOS consumers before revoking anything. Inventory grants at the provider, including grants for previously disconnected mailboxes.
3. Have authorized provider administrators revoke dedicated delegated grants and refresh tokens, invalidate sessions where supported, remove the retired callback, and disable dedicated app secrets. Confirm an old grant cannot refresh or send. Store provider audit receipts by deployment. Do not revoke unrelated integrations.
4. Retire SALES_MAIL_GOOGLE_CLIENT_ID, SALES_MAIL_GOOGLE_CLIENT_SECRET, SALES_MAIL_MICROSOFT_CLIENT_ID, SALES_MAIL_MICROSOFT_CLIENT_SECRET and SALES_MAIL_APP_ORIGIN from deployment secret managers after provider checks. Handle SALES_MAIL_ENCRYPTION_KEY through the approved credential-retention procedure. This release made no secret-manager or provider account changes.
5. Keep ordinary BOS email, Supabase authentication, calendar, NextMav Sign delivery and evidence configuration in place. Verify each authorized delivery channel separately.
