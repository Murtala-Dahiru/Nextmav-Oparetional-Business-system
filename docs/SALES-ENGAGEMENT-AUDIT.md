> Historical record. Sales Engagement was retired by migration 0148. These instructions describe the former release.

> Continuation: migrations 0125–0127 now add business-mail foundations and explicit reply-stop. See SALES-ENGAGEMENT-ACCEPTANCE.md and SALES-ENGAGEMENT-OPERATIONS.md for current status; the original repository findings below remain historical.

# Sales Engagement implementation audit

## Repository inspection — 4 November 2026

This is a continuation of the existing working tree. Existing modified and untracked files belong to earlier work and must be preserved. The latest migration at inspection is `0120_nextmav_sign_standard_defaults.sql`. Next.js route documentation was read from the installed package.

Verified reusable code:

- `crm_activities`, activity APIs, ActivityDialog, record timelines and reminders already persist calls, notes and follow-ups. Lead, contact, company and deal views use these records.
- `crm_visible_activities` provides record-aware visibility. New engagement reads must use it, including when the actor has organization membership.
- Lead engagement RPC distinguishes recorded first contact from mere record updates.
- Automation Studio migrations 0094–0097 implement durable events, runs, steps and workers. Activity creation/completion and meeting scheduling already emit events. Do not create another worker.
- Commercial Hub and Sign exist through migration 0120. Navigate to their existing screens.
- Auth context uses user-scoped Supabase clients; database RLS is mandatory. Provider credentials must never be returned through these clients.
- No business-mailbox synchronization or sales-sequence enrollment implementation was found during initial inspection. Sign delivery is not a personal mailbox integration.

## Implementation sequence

1. Add a bounded, paginated daily queue using existing authorized activities, untouched leads and inactive deals. Explain every priority and preserve contextual navigation.
2. Add a communication work view over persisted CRM activity with customer context; clearly identify manually entered records.
3. Introduce an explicit disconnected email boundary. Do not claim send, sync or delivery functionality before provider operations exist and are verified.
4. Reuse existing activity writes, completion, reminders and rescheduling. Add structured internal meetings and call outcomes without duplicating the activity table.
5. Add personal/shared sales templates with optimistic concurrency, database permissions and safe variable preview.
6. Integrate focused sequences with the existing automation worker only after enrollment, suppression and reply-stop transactions are implemented and tested. Existing automation workflows alone do not satisfy sequences.
7. Verify migrations, real isolated database behavior, API behavior, lint, TypeScript, production build and responsive UI where tooling permits. Report missing categories explicitly.

Final verification and limitations are recorded in `SALES-ENGAGEMENT-ACCEPTANCE.md`.
