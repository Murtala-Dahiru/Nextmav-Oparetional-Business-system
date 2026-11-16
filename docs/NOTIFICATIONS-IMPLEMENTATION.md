# NextMav Notifications implementation inventory

The activation follow-up on 16 November configured the approved operator subject and verified real Edge subscriptions, provider acceptance and closed-tab receipt. The user confirmed Windows display and the conversation click. See [the activation report](NOTIFICATIONS-ACTIVATION.md) for current evidence and remaining deployment gates. The discovery and initial acceptance results below retain their original test context.

Discovery (2026-11-15): existing working tree contains extensive unrelated changes; retained in place. Next.js route-handler and PWA guides read from installed package before implementation.

| Area | Existing capability | Gap / implementation direction |
| --- | --- | --- |
| Storage | `notifications`, recipient membership IDs, unread indexes, recipient RLS | Extend, never replace; durable push outbox |
| In-app | Shared Header bell, Zustand store, Supabase Realtime with polling/reconnect reconciliation, read/delete APIs | History, settings, update synchronization |
| Identity | Supabase cookies, active organization memberships, module and record RLS | Recheck recipient membership and record access before dispatch |
| Preferences | `organization_members.notification_prefs` | Reuse with narrowly authorized RPC |
| Messaging | Channels, direct conversations, membership/mute/read state, mentions, threads | Transactional message fanout; membership-safe mentions |
| Projects | Task assignment/progress and project triggers; route-side membership/milestone notifications | Move remaining route-side capture into transactions; durable deadline sweep |
| HR | Leave submission/decision, cases, document/review/payroll triggers | Reuse; private push previews |
| CRM | Lead/deal assignment, stage events, durable followup sweep, Automation Studio outbox | Reuse; no Sales Engagement restoration |
| Commercial | Transactional state history and automation capture; renewal reminders become CRM activities | Direct owner notification for supported state changes |
| Sign | Transactional status capture; existing internal notifications; external signing delivery and worker | Reuse internal notifications; never subscribe external signers |
| Finance / Support | Invoice/expense and ticket fanout | Reuse meaningful events; no new business workflows |
| Scheduling | `sweep_todo_reminders`, `sweep_crm_reminders`, optional pg_cron; signing CLI | Bounded server worker; never depend on browser timers |
| PWA | No root application service worker or manifest found; PDF worker is unrelated | One root push service worker, no caching changes |
| Delivery | No Web Push transport/subscriptions found | Real VAPID Web Push; credentials must be supplied by deployment |

Security discovery: legacy `notify_members` is executable by authenticated callers and legacy notifications INSERT permits staff to target arbitrary recipients. Recipient UPDATE is not column-restricted. These must be closed while moving legitimate route-side producers to database triggers. A provider acceptance is not evidence of OS display.

## Delivery and deployment status

The repository contains the implementation and a successful standalone production build. Migrations 0150–0159 were applied to the configured Supabase project. The web application was tested locally. No public application deployment or continuously running production push worker was established in this run.

The durable unit of in-app delivery is one existing `notifications` row per membership. PostgreSQL business triggers resolve recipients inside the transaction that changes the business record. Device jobs and attempt records have tenant foreign keys and private RLS. Definer functions that generate notification contents are unavailable to ordinary clients. Authenticated clients can change read state, dismiss their own rows, manage their devices and request a rate-limited device test. The shared bell uses Realtime and server reconciliation. History, filtering, pagination, read/unread controls, preferences and device management live at `/settings/notifications`.

`src/lib/notifications/model.ts` supplies the dispatch contract, family registry, preference schema, priority and safe destination handling. `public/sw.js` handles real Push API events and notification clicks. Only an opaque notification reference, organization, grouping tag and sound preference travel in the encrypted push payload. A click goes through a recipient- and record-authorized server route. The worker checks the current member, profile, device, preferences, expiration and RLS-visible record before sending. A recipient removed from a private conversation loses access. Unknown record types are skipped for push until their access rules are mapped.

Claiming a job atomically records an attempt, with `FOR UPDATE SKIP LOCKED`, a lease and a unique fencing token. Temporary errors back off with jitter. Permanent errors reach a terminal state. HTTP 404/410 retires the subscription. A crash after external acceptance and before committing the result can cause another attempt. Conversation tags collapse superseded OS alerts where supported. Provider acceptance records use the term `accepted`. The application has no OS display receipt.

## Event coverage

The verification column describes the specific path exercised. SQL acceptance tests use real tables and triggers in a rolled-back transaction. They do not substitute for complete form-to-browser regression tests of each originating module.

| Business event | Recipient and action | Classification and evidence |
| --- | --- | --- |
| Private channel message | Current conversation members, excluding sender and muted members. A valid mention can override mute. Opens the channel. | **Implemented and verified** in PostgreSQL, authenticated APIs, two Edge contexts and Supabase Realtime. Outsider mentions and revoked access tested. |
| Direct message, thread reply, mention | Same existing `messages` trigger, channel membership, sender and parent message relationships. | **Implemented but not device-verified**. Dedicated direct-message, reply and mention UI scenarios were not individually run. |
| Conversation membership | Added active member receives a channel link. | **Implemented and verified** as part of the private-channel API fixture. No separate invented conversation-assignment workflow. |
| Task assignment, reassignment, overdue and approaching deadline | Current assignee. Changed ownership and completion invalidate dispatch. | **Implemented and verified** in PostgreSQL, including repeated sweep, reassignment and completion. |
| Blocked, completed or review-ready task, project membership, milestone completion | Existing project audience, reporter or new member. | **Implemented but not device-verified**. Individual UI transitions unmeasured. |
| Leave submitted and approved, HR case assigned | Existing authorized approvers, applicant and case assignee. | **Implemented and verified** in PostgreSQL. Leave rejection and HR case/document-request resolution reuse existing state transitions and remain individually unverified. |
| HR checklist action, deadline | Existing assigned checklist item and active employee. | **Implemented but not device-verified**. Item-specific navigation and scheduling need end-to-end verification. |
| Lead assignment, activity assignment, scheduled CRM follow-up, deal stage approval request | Assigned owner/member, or existing organization owner/administrator for stage approval. | **Implemented and verified** in PostgreSQL. Stage decisions and individual reassignment screens were not separately exercised. |
| Deal changes and material Business API events | Existing deal/lead audience. `lead.qualified` and `deal.reopened` consume the existing event ledger and its idempotency key. | **Implemented but not device-verified**. No second copy of existing win/loss or invoice-paid notification. |
| Commercial proposal review and acceptance, contract execution | Independent policy-authorized reviewer or record owner. Opens Commercial Hub record. | **Implemented and verified** at the database producer. User-facing approval/signing journey was not replayed for this test. |
| Quote/contract approval, issuance, rejection, change requests, renewal and obligation reminders | Existing authorized commercial approvers and owners, scheduled CRM activities or open obligations. | **Implemented but not device-verified**. Shared commercial lifecycle rules, individual end-to-end cases pending. |
| Sign sent, witness signature, completion | Internal envelope owner. Completion reuses existing Sign capture. | **Implemented and verified** at the database producer. Existing external signing delivery remains separate. |
| Individual signature, approval, decline, revocation, expiration and signing deadline | Internal envelope owner. No external recipient subscriptions. | **Implemented but not device-verified**. External signer push registration is **not applicable**. |
| Finance expense approval request and decision | Finance approvers, then submitter. Generic lock-screen text. | **Implemented and verified** in PostgreSQL. |
| Invoice sent, paid, overdue, payment deadline | Existing finance audience and invoice owner. | **Implemented but not device-verified**. No transaction-failure notification without an authoritative persisted failure. |
| Support assignment at creation, reassignment, customer/requester reply and service deadline | Current ticket assignee. Resolution follows the existing requester workflow. | **Implemented and verified** in PostgreSQL for assignment, reassignment, requester reply, SLA reminder dedupe and dismissal. Priority and resolution paths individually unverified. |
| Calendar/meeting invitation and upcoming event, project milestone, personal reminders | Existing invitees/attendees, project owner or personal owner. | **Implemented but not device-verified**. |
| Access change | Affected active member. Categorized critical and retained in app independently of category preferences. | **Partially implemented**. Role change connected. The existing invitation precedes authorized membership, so BOS push to an unaccepted invitee is **not applicable**. No verified producer for a generic critical service outage. |

## Configure Web Push

The `web-push` library generated a P-256 key pair. A cryptographic check derived the public key from the private key and compared them successfully. The file lives outside the repository at `%LOCALAPPDATA%\NextMav\Notifications\vapid.env`. The directory ACL was restricted to the current Windows account before writing it. The ignored local `.env` contains the public key. The subject in the protected file is blank. Keep the same key pair across deployments so existing subscriptions remain valid.

| Environment variable | Where to configure it | Value |
| --- | --- | --- |
| `VAPID_PUBLIC_KEY` | Next.js deployment and worker | Public half from the protected file. The authenticated settings API returns this field to the browser. |
| `VAPID_PRIVATE_KEY` | Worker secret store only | Private half from the protected file. Import through the deployment's secret manager without printing it. |
| `VAPID_SUBJECT` | Worker | Approved operator contact URI. Use `mailto:admin@nextmav.com` only after that address is approved. |
| `VAPID_ENV_FILE` | Optional worker setting | Full path to a separately protected environment file. The local worker can use the file above. |
| `DIRECT_URL` or `DATABASE_URL` | Worker secret store | Database connection used by the existing BOS server job tooling. The worker must claim jobs and evaluate record access with the recipient's authenticated role. |

1. Deploy the Next.js application over HTTPS with `/sw.js`, `/manifest.webmanifest` and both icon sizes accessible on the application origin. The standalone build copies these assets. No service-role or private VAPID variable belongs in a `NEXT_PUBLIC_` variable.
2. In another environment, use the existing migration chain. For an established database on 0149, `node scripts/notifications-migrate.mjs` validates then rolls back. `node scripts/notifications-migrate.mjs --apply` commits the notification migrations. `--from=0157` starts at a specific migration. The script checks database/application project identity.
3. Run `npm run notifications:worker` from the repository in a trusted scheduled Node environment with its runtime dependencies, including `tsx` and `pg`. The process handles up to 50 device jobs per invocation. A supervisor or scheduler must invoke it again. A one-minute scheduler can add nearly a minute before dispatch. Sub-five-second dispatch requires a sufficiently frequent worker and measurement under load. A Vercel application deployment alone does not start this CLI.
4. PostgreSQL schedules the task and business deadline sweeps where `pg_cron` is installed. The worker also invokes the sweeps as a fallback. Personal/CRM reminders reuse their existing scheduled timestamps. Date-only deadlines use the organization timezone. Timestamp reminder preferences support at-time, 15 minutes, one hour and one day. Task due/overdue uses a separate calendar-day rule. Schedule `SELECT public.notification_retention(90)` under an authorized maintenance role to prune read history in batches and finished attempts older than 30 days.
5. Open the bell → **History, preferences & devices** → **Enable this browser**. After registration, use **Send test** and check attempts, provider acceptance, OS display and the click destination independently. Test a closed tab, a background tab and an installed PWA. Test iOS/iPadOS from an eligible installed Home Screen app.

For monitoring, inspect queue state, attempt age, oldest pending job and terminal failures. This query contains no subscription endpoints or keys.

```sql
SELECT state, count(*) AS jobs, min(created_at) AS oldest_created,
       max(attempts) AS maximum_attempts, max(last_code) AS highest_provider_code
FROM notification_deliveries GROUP BY state ORDER BY state;
```

## Acceptance evidence and release limits

| Capability | Actual result |
| --- | --- |
| Database acceptance | 47 live PostgreSQL assertions in `notifications-db-results.txt`. Includes tenancy, read/write isolation, two-device fan-out, lease recovery, business transitions and current ownership. DDL and SQL test fixtures rolled back. |
| Authenticated APIs | 12 checks in `notifications-api-results.txt`, including two independent accounts, send, read/unread, mark all, preferences, authorized click and sign-in return. The isolated acceptance accounts were subsequently disabled, their passwords rotated, and temporary credentials removed. |
| Realtime latency | 20 exact message IDs, sender insert request start to recipient Realtime callback. p50 **541 ms**, p95 **1,367 ms**, maximum **9,519 ms**. Durable reconciliation after disconnect passed. Browser paint and OS latency were not measured. |
| Browser | Windows headless Microsoft Edge rendered the history, supported the APIs, activated the service worker, passed the unread filter and showed the real message after clicking the bell. Two independent browser contexts and 1366-pixel / 390-pixel layouts tested. Evidence in `notifications-browser-production.txt` and `notifications-evidence/`. |
| Web Push | **Implemented but not device-verified.** In the isolated Edge profile, notification permission was `granted`. `PushManager.subscribe()` reported registration permission denied and no subscription was created. The approved VAPID subject and deployed worker are also outstanding. **Blocked** for provider acceptance, service-worker receipt of a provider message, OS display, and notification-click verification from the OS. No physical Android/iOS, macOS or installed-PWA delivery evidence. |
| Handler / policy checks | Service-worker handler and notification-policy assertions passed. Handler invocations are unit tests and carry no device-delivery claim. CLI ran the actual reminder sweeps and reported zero provider attempts with incomplete VAPID configuration. |
| Regression | Production build, TypeScript, migration parse/consistency, layout, navigation, dashboard, import, rate-limit, payroll, observability and schema checks passed. The repository-wide security scanner still reports four checks involving existing Sign portal/service-role conventions and intentionally private legacy Sign/mail tables. See `notifications-regression.txt`. |

**Production readiness is partial.** The verified in-app path is suitable for a controlled rollout. Release gates for background push are a configured contact subject, a deployed supervised worker, a real provider subscription, measured delivery acceptance and OS-level click/display checks. Sustained queue capacity, actual 404/410 and transient provider failures, multi-organization browser switching, every record-specific deep link, keyboard-only journeys and all device permutations remain incompletely exercised. Application screens for some existing events resolve only to the module or list. The measured Realtime p95 applies to this 20-message run. No production push-dispatch p95 is available.

## Final concurrency and deployment handoff

Two independent PostgreSQL sessions claimed different device jobs simultaneously. Both leases remained exclusive after commit. The separate rollback suite verified recovery after lease expiry. See `notifications-concurrency-results.txt`.

For a Linux worker host, the repository includes a systemd service and timer under `deploy/notifications/`. Install Node and the locked dependencies (including tsx and pg), place the checkout at `/opt/nextmav`, and provision the `nextmav` OS account. Put the approved VAPID settings and database connection in a root-owned mode-0600 `/etc/nextmav/notifications.env` using the host's secret-management process. Adjust paths if your installation uses different locations. Install both unit files into `/etc/systemd/system/`, run `systemctl daemon-reload` and `systemctl enable --now nextmav-notifications.timer`. Inspect `journalctl -u nextmav-notifications.service` for attempt counts and `systemctl list-timers nextmav-notifications.timer` for the next run. Each run drains a bounded batch. The timer starts the next run two seconds after the previous invocation finishes. These unit files have not been exercised on a Linux deployment host.

Actual OS notification acceptance still requires the worker's approved contact subject and a real browser subscription. The generated private key remains outside the repository. No standards certification or production delivery SLA has been established.
