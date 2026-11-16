# Production notification repair — 16 November 2026

Production: https://nextmav-oparetional-business-system-six.vercel.app

Application repair commits: `8029562` and `38a8eca`. The latter was deployed READY as `dpl_4geDpzjm6FxD3HvgbSPxnsDMFxV4`. This report supersedes earlier instructions requiring a separate always-running notification worker.

## Root cause

The GitHub deployment did not start the separate Node worker. Production Vercel also lacked the VAPID configuration and dispatcher credential. The initial database inspection found five retired devices and no active subscription. Existing historical provider acceptances were not evidence that the deployed application could deliver new notifications. Both the worker and service worker intentionally used generic presentation. Additionally, a broad `test` gitignore pattern excluded the notification test API route from deployment.

The first repaired deployment returned HTTP 503 before recording a worker heartbeat. A dedicated, verified `NOTIFICATION_DATABASE_URL` resolved the connection/configuration problem. The old sensitive Vercel database value could not be inspected, so its exact defect is not established.

## Deployed delivery architecture

Existing business transaction → notification and durable delivery rows → after-commit Supabase `pg_net` wake → bearer-authenticated Vercel Node function → existing atomic claim/lease and access checks → encrypted Web Push → registered service worker → `showNotification`.

Messages do not wait for cron. Supabase `pg_cron` runs reminder sweeps and recovery once per minute, waking the same function only when work is due. The durable queue retains retry state and expired leases across interruptions. Dispatch is bounded and can request another invocation when work remains. No separate host, public unauthenticated worker, or browser-tab-dependent dispatcher was introduced.

The existing VAPID pair was retained. Private keys remain server-side. Preview text is minimal and encrypted in transit to the push service; notification display itself can be visible on a locked screen. Users must opt into message/business previews. HR, Finance, commercial and signing detail remains private even when general previews are enabled. Current recipient authorization and preferences are checked before sending. A push already accepted by the provider cannot be recalled after a later access revocation; short expiry limits stale delivery. Clicking uses the existing authenticated notification resolver rather than exposing a confidential record in a public preview endpoint.

## Configuration completed

Vercel production now has `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NOTIFICATION_DISPATCH_SECRET`, `NEXT_PUBLIC_APP_URL` and `NOTIFICATION_DATABASE_URL`. Sensitive values were supplied securely; none are included in this report. The existing VAPID contact subject was preserved.

Supabase migrations 0160–0162 were applied. `pg_net`, `pg_cron` and Vault are available. Vault contains `notification_dispatch_url` and `notification_dispatch_secret`; the secured endpoint was verified before activation. The `nextmav-push-recovery` cron job is active. Preview deployment configuration was not changed.

No further Vercel or Supabase setup is required for the deployed path. For disaster recovery, restore the above production configuration securely, apply missing migrations with `node scripts/notifications-migrate.mjs --from=0160 --apply`, deploy, then run `scripts/notifications-configure.mjs` with the protected VAPID environment file and production URL configured. Do not generate a replacement VAPID pair for routine redeployment. Inspect the script's environment requirements before running it.

## Verification evidence

| Layer / test | Observed result |
| --- | --- |
| Production build and TypeScript | Local production build, TypeScript check and Vercel build passed. |
| Notification tests | Policy/privacy, dispatch/auth/retry and service-worker suites passed. |
| Database | 52 assertions passed, including RLS, tenant isolation, revoked access, atomic claims, lease recovery, reminders and existing business integrations. |
| Production authenticated API | 12 checks passed using two isolated authorized accounts. |
| Worker authentication | Missing/invalid bearer rejected with 401. |
| Windows Edge subscription | Actual PushManager subscription; HTTPS, granted permission, active root-scope service worker. |
| Real server push | Provider HTTP 201 and actual service-worker notification receipt for test, messages, task assignment and leave approval. No injected push event or local worker was used. |
| Message | Persisted actual message, correct recipient, delivery job, provider acceptance, sender and authorized preview verified; recipient API could read the message. |
| Task | Real assignment to recipient; actual task title and push receipt verified. |
| Approval | Real leave request and approval; descriptive approval title with private generic body verified. |
| Privacy off | Message preview hidden; generic message presentation verified on actual push receipt. |
| Closed NextMav tabs | Zero NextMav tabs during real pushes; service worker received and displayed notification objects. Edge itself remained running. |
| Windows visible display | Owner confirmed seeing the preview and clicking the Windows notification. |
| Click destination | Authenticated resolver returned the correct conversation destination. Automated observation of the physical notification click timed out; confirmation that the conversation actually opened is still pending. |
| Hidden background tab | Attempt reported `visibilityState=visible`; a genuinely hidden tab was not independently verified. |
| Latency | Sample production event creation to provider acceptance was approximately 1.62–2.21 seconds; this is not a load-test or latency SLA. |
| Android | Owner has a physical device; production subscription and display test requested, result pending. |
| iPhone/iPad and macOS | No physical-device test performed. |

At 20:43 UTC, diagnostics showed a successful scheduler run at 20:43, ten successful HTTP 200 wake responses, no wake errors, no pending/failed deliveries, and 70 accepted deliveries including historical tests. Do not interpret the cumulative count as 70 new production acceptance tests. The dispatcher is event-driven and need not heartbeat when there is no work.

All requested existing event families have database integration coverage: messages, mentions/replies, assignments/reassignments, deadlines/overdue tasks, HR requests/decisions, CRM leads/follow-ups/deal approvals, proposals, contract execution, Sign completion, Finance approvals, support assignments and relevant access changes. Only the message/task/approval/test paths have the real-device pipeline evidence above. Sales Engagement was not recreated. Date-only tasks use actual available date information; the implementation does not invent a due time.

## Files changed

- Dispatcher/runtime: `src/lib/notifications/dispatch.ts`, `dispatch-auth.ts`, `config.ts`; `src/app/api/internal/notifications/dispatch/route.ts`; `src/proxy.ts`; `next.config.ts`; package manifests; `scripts/notifications-worker.mts`.
- Presentation/settings: `src/lib/notifications/model.ts`, `public/sw.js`, `src/app/settings/notifications/page.tsx`, notification settings/test API routes, category icon and bell/history components.
- Database: migrations 0160–0162 for descriptions, health, after-commit wake, Vault integration and scheduler recovery.
- Operations: configure/health/migration scripts, `.env.example`, corrected `.gitignore`, narrowly scoped operational-table migration validation.
- Tests: policy/privacy, dispatch, service worker, database, authenticated API and `scripts/notifications-production-browser.mjs`.

The secure diagnostic equivalent to an administrator health view is `scripts/notifications-health.mjs`. It requires operator database credentials and reports configuration booleans, queue state, device counts, worker/scheduler activity and provider/wake results without notification content, subscription endpoints or secrets.

## Remaining acceptance steps

1. On Android Chrome, sign into production `/settings/notifications`; select **Enable Notifications**, allow notifications, then **Send Test Notification**. Record the displayed provider result and actual Android notification display separately.
2. With the device connected, use a second authorized account to send a message, assign a task and approve a test request. Confirm permitted previews, close the NextMav tab, repeat, then tap notifications and verify the destination and underlying record. Do not force-stop Chrome for the closed-tab test.
3. For iPhone/iPad, use a supported iOS/iPadOS version (Web Push for Home Screen web apps was introduced in 16.4), add NextMav to the Home Screen, launch it there, sign in and enable notifications through the button. Repeat the real-device tests. Reference: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
4. Independently test macOS and a genuinely hidden background tab. Fully quitting/force-stopping the browser is distinct from closing the application tab and has not been verified.
5. Confirm the observed Windows click opened the intended conversation, since the automated observer did not capture it.

## Security and release assessment

Notification-specific tests, tenant isolation and authenticated dispatch passed. The repository security scanner was not weakened. It still reports four pre-existing findings involving Sign portal guard recognition/public routing, service-role usage in Sign routes, and existing deny-all credential tables. These require separate assessment before claiming a clean whole-BOS security release. No formal standards certification, penetration test, broad module regression audit or high-volume performance qualification was performed.

**GO for the repaired production dispatcher and verified Windows message/task/approval push pipeline. NO-GO for an unconditional all-device acceptance or whole-BOS development freeze:** Android/iOS/macOS and physical click-destination acceptance remain incomplete, and existing security findings remain open. Provider acceptance, service-worker receipt, visible OS display and correct click navigation are separate stages and are reported separately above.

The account Settings page and Administration Settings now both link to the personal Notifications page. The bell menu labels the destination **Notification settings**.
