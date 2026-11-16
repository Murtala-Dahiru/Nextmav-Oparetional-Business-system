# Web Push activation verification

Verified on 16 November 2026 against the configured Supabase database and the local production application at http://127.0.0.1:3017, using isolated acceptance accounts and organizations.

## Configuration and repair

The existing P-256 public/private pair was verified by deriving the public point from the private scalar. The web application's public key matches. The operator explicitly approved `mailto:admin@nextmav.com`, which is now set in the protected worker file at `%LOCALAPPDATA%\NextMav\Notifications\vapid.env`. Its ACL grants access to the current Windows account. The application environment contains the public key and has no private VAPID key. The key pair was preserved.

The earlier subscription denial was reproduced in a headed Edge private browser context even with notification permission granted and background networking enabled. A persistent regular profile subscribed successfully in both headed and headless Edge. The headless persistent profile also succeeded with Playwright's default networking flags. These controlled comparisons identify the private context as the cause of the observed failure. No machine policy override or security bypass was needed.

The test now uses a fresh persistent profile. The settings UI gives an actionable explanation when permission is granted but subscription still returns NotAllowedError. The browser reported a secure origin, PushManager support, root service-worker scope, a correctly encoded 65-byte uncompressed public key and no stale subscription. Real subscription registration and provider acceptance establish connectivity for the tested machine and network.

## Evidence by stage

| Stage | Observed result |
| --- | --- |
| Permission | Granted through the browser automation permission API. The native permission prompt itself remains a manual deployment check. |
| Subscription | Actual Edge PushManager subscription created and saved through the authenticated NextMav API. |
| Durable queue | Send test and business triggers created notification and delivery records. |
| Worker | Actual CLI claimed and completed jobs. Scoped to the isolated organization during device tests. |
| Push provider | HTTP 201 acceptance recorded in PostgreSQL for the tested scenarios. |
| Service worker | Matching notification IDs observed through the actual worker's getNotifications after server dispatch. No push event was injected. |
| Windows display | User confirmed a real NextMav Windows notification was visible. This observation is user-reported. |
| Windows click | User reported clicking the alert opened the test conversation. The automated click URL assertion timed out, so it is not a passing automated assertion. |
| Closed tab | Zero NextMav pages were open when the message was dispatched. The running Edge profile received the matching notification. |
| Background tab | Delivery succeeded, but the automated page still reported visible after switching/minimizing. Dedicated hidden-tab verification remains pending. |
| Installed PWA | Installation/launch commands ran and a test notification arrived, but standalone display mode reported false. Installed-PWA delivery remains unverified. |
| Continuous deployment | CLI execution verified locally. No continuously supervised production worker has been deployed or observed. |
| Other devices | Android, iOS/iPadOS, macOS and a fully exited browser have no device evidence from this run. |

The retained transcript is `notifications-activation-results.txt`. An earlier batch checked notifications only after all dispatches finished and missed individual receipts. The final test observes retained notification IDs continuously during asynchronous worker execution and passed all seven additional scenarios.

## Business event coverage

| Event | Producer exercised | Record and queue | Provider | Worker receipt | Authorized destination |
| --- | --- | --- | --- | --- | --- |
| User A sends User B a message | Authenticated messaging API | Verified | 201 | Verified with all NextMav tabs closed | Exact conversation via API, user confirmed OS click |
| Task assigned | Real tasks insert and existing trigger | Verified | 201 | Verified | Exact task link |
| Reminder due | Current task deadline and durable task sweep | Verified | 201 | Verified | Exact task link |
| HR leave approval requested | Real pending leave request and existing trigger | Verified | 201 | Verified | HR leave list |
| CRM lead assigned | Real lead insert and existing trigger | Verified | 201 | Verified | Exact lead link |
| Commercial proposal approved | Real proposal status transition and existing trigger | Verified | 201 | Verified | Exact commercial record link |
| NextMav Sign completed | Real envelope status transition and existing completion capture | Verified | 201 | Verified | Exact agreement link |
| Support ticket assigned | Real ticket insert and existing trigger | Verified | 201 | Verified | Exact ticket link |

Business fixture transitions use real database tables and triggers inside the isolated organization. Individual source-module forms and external signing ceremonies were not replayed. Destination checks verify the authenticated redirect. Windows display and clicks were individually confirmed for the message scenario only.

## Security and reliability

The live PostgreSQL suite passed 48 assertions, including cross-tenant denial, recipient-only reads, unauthorized device removal, arbitrary notification creation denial, conversation revocation, inactive membership, deduplication, two-device queue fan-out, lease recovery, assignment changes and obsolete reminder cancellation. The additional assertion covers commercial approval.

The authenticated API suite passed 12 checks. Notification policy tests passed 18 assertions for quiet hours, timezone, preferences, URL filtering and retry classification. Seven service-worker unit assertions passed. Unit tests are recorded independently of actual provider/device evidence. TypeScript and targeted lint passed. The final production build passed. Repository-wide lint finished with zero errors and five existing warnings. Migration parse and cross-file consistency checks passed through 0159.

The dispatcher checks current membership and record authorization before sending, retires HTTP 404/410 subscriptions, records attempts and permanent failures, and retries transient failures with bounded exponential backoff. Actual transient provider outages and provider-generated 404/410 responses were not induced. Multiple profiles received provider acceptance, while simultaneous physical-device display remains unverified.

The push payload contains notification and organization identifiers, grouping and silence settings. Lock-screen text is generic. No message, HR details, financial amount or document content is sent in the push preview.

The existing repository security scanner has four previously documented findings involving Sign's public portal/service-role conventions and private RLS tables. See `notifications-security-check.txt`. This activation does not resolve those broader findings.

All acceptance account passwords were rotated and logins disabled. Their push devices were retired and non-owner memberships deactivated. The owner membership remains to satisfy the database's last-owner invariant. Test business records remain isolated for audit. Temporary credentials and browser profiles were removed.

## Deployment configuration

| Variable | Application host | Worker host |
| --- | --- | --- |
| VAPID_PUBLIC_KEY | Import existing public value | Import same public value |
| VAPID_PRIVATE_KEY | Omit | Import protected private value through secret management |
| VAPID_SUBJECT | Optional | mailto:admin@nextmav.com |
| VAPID_ENV_FILE | Omit | Optional absolute path to protected worker environment file |
| DIRECT_URL or DATABASE_URL | Existing server configuration | Authorized PostgreSQL connection |

Use the existing keys across deployments. Never paste private material into source, command-line arguments, build logs or Git. The authenticated settings endpoint supplies the public key to the browser. Production requires HTTPS, accessible root `/sw.js`, manifest and icons, and the existing migrations through 0159.

The Linux systemd service/timer in `deploy/notifications` invokes the bounded worker again two seconds after it finishes. Follow the installation instructions in `NOTIFICATIONS-IMPLEMENTATION.md`. Provision Node 24 and the locked dependencies, including tsx and pg. Store worker secrets in a mode-0600 environment file. Observe service exit codes, logs, oldest pending age and terminal failures after deployment.

A Windows host can use `deploy/notifications/run-worker.ps1` with Windows Task Scheduler. Supply absolute `-NodePath` and `-WorkerEnvFile` arguments. The protected worker file must include VAPID settings and the database connection, or the scheduler's identity must have access to the existing server environment. Configure an approved service identity, a one-minute repeating trigger, restart on failure, start when available, and the setting that prevents overlapping instances. Set a suitable execution limit for a bounded 50-job run. Keep the machine awake and connected. Enable task history and inspect Last Run Result. This alternative is prepared but has not been registered as a persistent task. A one-minute schedule cannot establish a sub-five-second dispatch target.

`NOTIFICATION_DISPATCH_ORG` is an optional UUID filter for isolated verification. When set, the worker claims only that organization and omits global reminder sweeps. Leave it unset on a worker responsible for all organizations. The ordinary worker continues to execute durable reminder sweeps.

The worker is independent of browser tabs and Vercel request lifetime. Queue leases fence concurrent claims. External transport has at-least-once semantics. Production throughput and dispatch p95 require measurement on the deployed worker.

## Remaining acceptance steps

1. Import public configuration on the application host and worker secrets on the selected worker host. Deploy the web app and supervised worker.
2. In a regular browser profile on the deployed HTTPS origin, enable notifications through the native permission prompt and confirm the saved device.
3. Send test, inspect the worker attempt and provider code, inspect the Windows alert, and click it. Record each stage.
4. Repeat while another tab is active and confirm the NextMav page is hidden. Repeat with every NextMav tab closed.
5. Install through the browser's normal PWA installation flow. Confirm standalone mode, repeat delivery and click checks, and then test Android and an eligible iOS Home Screen installation.
6. Exercise temporary provider failures, expired subscriptions, multiple physical devices and deployed-worker restart recovery. Verify queue age and capacity under expected load.

Local regular-profile Edge background delivery with NextMav tabs closed is verified through provider acceptance, worker receipt and the user's Windows display/click confirmation. Production readiness remains conditional on supervised deployment and the outstanding device/reliability checks above.

## Git delivery scope

The user requested a direct commit and push to main. The working tree already contained the earlier BOS module changes and migrations required by these integrations, and main was twelve commits ahead of origin/main. The delivery includes that accumulated repository source, migrations, documentation and acceptance evidence. The protected VAPID file and local application environment are excluded. No branch or key rotation is part of this delivery.
