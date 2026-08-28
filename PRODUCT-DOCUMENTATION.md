# NextMav Business Operating System — Product Documentation

**What this document is.** A reverse-engineered description of the NextMav Business
Operating System (BOS) as it exists in the codebase today. Everything below was read out
of the source: the 25 SQL migrations, the 116 API route files, the 13 module front-ends,
the shared libraries and the public marketing site. Nothing here is taken from a plan, a
specification or a README claim that the code does not back up. Where documentation in the
repository disagrees with the code, the code wins and the disagreement is noted.

**How implementation status is marked.** Every feature carries one of three labels:

| Label | Meaning |
|---|---|
| **Implemented** | A user with the right role can do this today: there is a screen, an endpoint behind it, and a table behind that. |
| **Partial** | Some of it works. The document says exactly where the line falls. |
| **Not built** | Referenced in a table, a comment, a settings key or a marketing page, but no working path exists through the product. |

---

## 1. What the platform is

NextMav BOS is a **multi-tenant business operating system**: a single web application in
which a company runs its customer relationships, its projects, its people, its money, its
stock, its internal communication and its client-facing reporting — all against one
database, one identity model and one permission model.

It is a SaaS product, not a white-label shell. The platform keeps its own name, mark and
favicon on every screen for every customer (`src/lib/platform.ts`); a tenant's branding
describes *their* company and appears only on surfaces whose audience is the tenant's own
customer — the client portal and their documents.

The defining architectural claim of the product is that the modules are not separate
applications sharing a login. A deal belongs to a company; a project belongs to that
company; an invoice belongs to that project; a support ticket belongs to that customer's
contact; a chat channel can belong to that project; and the client portal is a rendering of
all of it for the customer themselves. One record can be opened from any of the others.

**Technology.** Next.js 16 (App Router) with React 19 and TypeScript on the front; Supabase
(PostgreSQL, Auth, Storage, Realtime) on the back. Styling is Tailwind CSS v4 with
shadcn/ui primitives. State is Zustand plus per-module local state. The build output is a
standalone Node server.

**Scale of the implementation.** ~72,700 lines of TypeScript/TSX across the application,
~12,300 lines of SQL across 25 migrations, 61 tables, 20 database views, ~100 database
functions and 116 HTTP API routes.

---

## 2. Product structure

The product has three distinct surfaces.

### 2.1 The public marketing site

Server-rendered, statically generated, unauthenticated. Thirteen pages under a
`(marketing)` route group: landing, features, solutions, pricing, about, contact, blog,
docs, help, status, privacy, terms, cookies. It uses a **completely separate design
system** from the application — a set of stylesheets scoped to a `.nm-public` wrapper class
so the two never collide (`src/app/(marketing)/layout.tsx`, `src/styles/public/*.css`).

### 2.2 The authentication surface

Seven standalone pages that sit outside both the marketing group and the application shell,
but which share the marketing site's visual language through a two-pane `AuthShell`
component: `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify`,
`/accept-invite`, `/change-password`. Plus `/onboarding` (create your workspace) and
`/settings` (your own account), which are authenticated but deliberately live outside the
module shell.

### 2.3 The application

**A single route — `/dashboard` — that hosts every module.** There is no URL per module and
no URL per record. The whole application is one page containing:

- a **sidebar** listing only the modules the signed-in role may open, with per-module unread
  badges;
- a **header** with a global search trigger, a notification tray, a theme toggle and a user
  menu;
- a **module content area** that lazily imports and mounts exactly one module component at a
  time, wrapped in an error boundary that reports the failure honestly rather than showing a
  spinner forever;
- a **command palette** (⌘K) that searches across modules;
- a **session guard** that warns before the session expires.

The consequence of the single-route design is that cross-module navigation cannot be a link.
It is instead a store action, `openRecord(module, type, id)`, which switches module and
leaves a "focus request" for the target module to pick up as it mounts
(`src/store/app-store.ts`, `src/hooks/use-focus-request.ts`). This is how a command-palette
hit for a company opens the CRM company detail sheet, and how clicking a notification opens
the ticket it is about.

### The thirteen modules

In sidebar order: **Dashboard, My Work, CRM, Projects, Workspace, Communication, Support,
HR, Finance, Inventory, Calendar, Client Portal, Admin** (`src/lib/constants.ts`).

---

## 3. Users, organizations, roles and permissions

### 3.1 The tenancy model

Three tables carry the whole model:

- **`organizations`** — the tenant boundary. Every business row in the database carries
  `organization_id NOT NULL`.
- **`profiles`** — one row per person, 1:1 with Supabase's `auth.users`. Holds name, avatar,
  phone, job title, bio, timezone, locale and last-seen time. Deliberately carries **no role
  and no organization**.
- **`organization_members`** — the junction that *is* tenancy. Role, department, manager
  (reporting line), employee number, employment type and hire date all live here.

The reason role lives on the membership rather than the person: the same individual can own
one company and be an employee of another. Every business table's ownership column
(`owner_id`, `assignee_id`, `sender_id`, …) references `organization_members`, not
`profiles` — which makes it structurally impossible to assign a record to somebody outside
the organization.

A person may belong to several organizations. The API resolves one "active" organization per
request, honouring a requested organization id only when the caller genuinely belongs to it
(`src/lib/auth-context.ts`). **Status: Implemented** at the data and API layer. There is **no
organization-switcher in the UI** — the first membership always wins. *(Partial.)*

### 3.2 The nine roles

| Role | Intended for |
|---|---|
| `owner` | Company owner. Full control of every module. |
| `administrator` | System-wide access to all business operations and user management. |
| `manager` | Department manager: runs a team, approves for their people. |
| `employee` | Standard workplace access. |
| `hr_staff` | People records, leave approvals across the organization. |
| `finance_staff` | Invoices, expenses, purchase orders, stock valuation. |
| `sales_staff` | CRM pipeline. |
| `support_staff` | Ticket queue. |
| `client` | **External.** A customer of the tenant, not an employee. |

Roles are a **fixed capability model in code**, not editable rows (`src/lib/permissions.ts`),
mirrored by a Postgres `org_role` enum. The stated reason: RLS policies are written against
specific role names, so a role invented at runtime would have no policy and would silently
see nothing — a permissions bug that presents as missing data.

Legacy role identifiers (`role-admin`, `super_admin`, `admin`, `user`, `staff`, `member`) are
normalised onto canonical roles, and anything unrecognised falls back to `employee` — never
upward. **Status: Implemented.**

### 3.3 The capability model

Access is expressed as `role → module → { actions, scope }`.

**Actions:** `view`, `create`, `edit`, `delete`, `approve`, `export`, `manage`. `approve` is
deliberately separate from `edit` — authorising someone else's leave, expense or purchase
order is a different responsibility from editing a record, and most roles have one without
the other. `export` is separate from `view` for the same kind of reason: a CSV leaves the
platform's access controls permanently.

**Scopes:** `own` → records where you are owner/assignee/subject; `department` → your
department's records; `organization` → everything in the workspace.

Every internal role receives a base grant: read the dashboard, full rights over their own My
Work list, view/edit their own tasks and projects, read-write Workspace and Communication,
their own calendar, and self-service HR (their own attendance, leave and documents). Roles
then add to that: a manager gets department scope across projects, CRM, support and calendar
with HR *approve* rights and read-only finance; `hr_staff` gets organization-wide HR;
`finance_staff` gets full finance plus inventory write and CRM read; and so on. A `client`
gets the portal, support and read-only projects — and explicitly **no dashboard**, because
granting one produced an empty landing screen; `defaultModuleFor()` sends them to the portal
instead.

**Status: Implemented**, and enforced in three independent places:

1. **`authorize(module, action)`** in every API route — returns a clear 403 with a code
   (`FORBIDDEN_MODULE` / `FORBIDDEN_ACTION`) rather than an empty list.
2. **Row-Level Security** in PostgreSQL — the actual security boundary. Every request carries
   the user's JWT into PostgREST, so policies apply even if a handler is wrong.
3. **The client's capability mirror** — the session endpoint returns a serialised
   `CapabilitySummary` that drives which sidebar entries, buttons and quick actions render.
   This is explicitly documented as *rendering only*, never the basis of a decision.

The role is resolved server-side from the session and is never accepted from the client. A
code comment records that this replaced a client-side "operating role" dropdown that
defaulted to `owner` — meaning any user could previously grant themselves Finance and HR.

### 3.4 Row-Level Security

Two invariants that the migration tooling enforces:

- **`FORCE ROW LEVEL SECURITY`** on every table (plain `ENABLE` does not apply to the table
  owner).
- **`security_invoker = true`** on every view — `npm run db:check` fails the build if one is
  missing it.

**One rule for policies:** no policy may query `organization_members` directly. Tenancy
resolves through `SECURITY DEFINER` helper functions in migration `0002` (`auth_org_ids()`,
`is_org_member()`, `auth_member_id()`, `auth_role_in()`, `has_org_role()`, `is_org_admin()`,
`is_org_owner()`, `auth_department_id()`, `auth_visible_member_ids()`, `can_approve()`,
`can_access_module()`). A policy on that table that reads that table re-enters itself and
Postgres aborts with `42P17: infinite recursion` — which, because every table resolves its
tenant through it, takes the whole platform down.

`auth_visible_member_ids()` is the single definition of "whose people-records may I see":
yourself always; your whole department plus your direct reports if you are a manager;
everyone if you are HR, an administrator or the owner.

### 3.5 Organization integrity

- **An organization can never lose its last owner.** A trigger blocks demoting, deactivating
  or deleting the last owner. **Implemented.**
- **Owner succession on account deletion.** If a sole owner's *user account* is deleted, the
  trigger does not refuse — it promotes the longest-serving administrator, or failing that
  the longest-serving member. If nobody is left, the empty organization is removed.
  **Implemented** (migration `0009`).
- **`create_organization()`** writes the organization and the owner membership atomically and
  refuses callers whose access has been withdrawn. **Implemented.**

### 3.6 The account lifecycle

`account_access_state()` in the database resolves one of nine states, and every entry point —
sign-in, the request guards, onboarding, `create_organization()` — reads that one answer
(`src/lib/account-state.ts`, migration `0025`):

`anonymous` · `no_profile` · `active` · `suspended` · `terminated` · `removed` · `disabled` ·
`invited` · `no_organization`

Four of those are **blocked**: suspended, terminated, removed, disabled. Each produces its own
message naming who can fix it, and a 403 rather than a 401 — so a suspended employee is not
told their password failed and bounced to a login form that lets them straight back in.

**Permanent deletion removes the identity, not the record.** Seventeen columns cascade from a
membership row, sixteen of them `NOT NULL` (messages, comments, meetings, time entries,
attendance, leave, to-dos). Deleting the membership would erase half of every conversation
the person was in. Instead: live responsibilities are reassigned to a named colleague,
rosters are revoked, the membership row survives as a tombstone so history still resolves,
and the **auth user** is deleted — which ends access and frees the email address.
`GET /api/admin/users/[id]/account` reports what a deletion would touch *before* it happens,
via `member_deletion_impact()`. **Implemented.**

Withdrawing access also **revokes the person's sessions** through a `revoke_user_sessions()`
RPC, rather than merely filtering their queries. **Implemented.**

---

## 4. Authentication and security

### 4.1 Sign-up and sign-in

| Flow | Status | Notes |
|---|---|---|
| Email/password sign-up | **Implemented** | Founding a workspace and joining one are one endpoint. Passing an `inviteToken` turns off the organization-name requirement, so an invited person no longer has to found a throwaway company first. |
| Email confirmation | **Implemented** (Supabase-side) | `/verify` is a "check your email" screen with a resend action. It is deliberately *not* an OTP screen — the endpoint sends a link, not a code. |
| Sign-in | **Implemented** | An unconfirmed account is called out by name; every other failure returns a single non-enumerating message. |
| Forgot / reset password | **Implemented** | The forgot-password response deliberately does not confirm whether the address has an account. `/auth/callback` establishes the recovery session. |
| Change password | **Implemented** | Always requires the current password. |
| Invitation | **Partial** | The token is issued, the accept page redeems it, and the membership is created. **Email delivery is not wired up** — the API returns `emailSent: false` and surfaces the invite URL for the administrator to send by hand. |
| Direct provisioning | **Implemented** | An administrator can create an account with a generated 14-character temporary password (unambiguous alphabet, shown once, never stored by the application). The account carries `force_password_change` until replaced. |
| Multi-factor authentication | **Not built** | Nothing in the application offers TOTP enrolment and no policy can require it. |
| SSO / SAML | **Not built** | Referenced only as fabricated copy that was removed from the help page. |

**The forced-password gate is enforced in `authorize()`, not by redirecting.** An account
still holding an administrator-issued password can sign in and do nothing else: every module
endpoint returns `PASSWORD_CHANGE_REQUIRED`. `/api/auth/change-password`, `/settings` and
`/change-password` are the only ways out. **Implemented.**

### 4.2 Route protection

`src/proxy.ts` (Next's `proxy`, formerly middleware) runs before any request is handled:

- Protected pages (`/dashboard`, `/onboarding`, `/change-password`, `/settings`) redirect to
  `/login` with a `next` parameter when there is no session cookie.
- Auth pages redirect to `/dashboard` when there *is* one — except `/reset-password`, which
  must remain reachable because following a reset link establishes a session.
- **Everything under `/api` is protected unless it appears on a short, closed
  pre-authentication allow-list.** This was deliberately inverted from a hand-maintained
  deny-list that had six live namespaces missing from it.
- The landing page redirects signed-in users to their workspace.

**Implemented.**

### 4.3 Session lifetime

Two clocks, both stored as **httpOnly cookies** and enforced server-side in the proxy
(`src/lib/session-policy.ts`):

- **Idle: 30 minutes** (configurable). Protects an unattended screen.
- **Absolute: 12 hours** (configurable). Caps a session however active, so a stolen refresh
  token is not good forever.

Background traffic — the notification poll, presence heartbeats — carries an
`x-nm-background: 1` header and **does not extend the idle window**, so an abandoned tab does
not keep itself signed in. The browser shows a countdown warning two minutes before expiry
(`SessionGuard`, `use-session-timeout`); that is a courtesy, not the control. Expiry
redirects to `/login` with a reason (`timeout` / `session-limit`) and the page the user was
on. **Implemented.**

### 4.4 Rate limiting

`src/lib/rate-limit.ts` — two buckets per policy, **per client address** and **per subject**
(the email being signed in as, the recipient of an email, the acting user). Neither alone is
sufficient: an address limit is defeated by a botnet and punishes an office behind one NAT; a
subject limit does nothing about a script walking a list of addresses.

| Policy | Window | Per address | Per subject |
|---|---|---|---|
| sign-in | 1 min | 30 | 10 |
| sign-up | 1 hour | 20 | 3 |
| email dispatch | 1 hour | 15 | 3 |
| credential change | 15 min | 30 | 10 |
| invitation | 1 hour | 100 | 50 |

Counters are in-process memory with a documented trade-off (with *N* instances the effective
limit is *N*×), a `setRateLimitStore()` seam for a shared store, a `RATE_LIMIT_DISABLED=1`
kill switch, and a **fail-open** guarantee on every error path. `x-forwarded-for` is read
from the right, counting trusted hops, so a client-supplied value cannot defeat it. Applied
to all eight credential endpoints plus `/api/health`. **Implemented**, with 28 assertions in
`npm run test:rate-limit`.

### 4.5 Security headers and storage

Set on every route in `next.config.ts`: `X-Frame-Options: DENY`,
`Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy` that grants
camera/microphone/display-capture only to the routes that host meetings and denies them
everywhere else. API responses carry `Cache-Control: no-store`.

**A full Content-Security-Policy with `script-src` is not built** — it needs per-request
nonces threaded through the proxy because Next inlines hydration scripts, and the loosened
`unsafe-inline` version would look like protection without being it.

**Storage.** Six Supabase Storage buckets with one security rule covering all of them: the
first path segment of every object must be an organization the caller belongs to
(`storage_org_id()`).

| Bucket | Public | Limit | Purpose |
|---|---|---|---|
| `avatars` | yes | 5 MB | Profile pictures (rendered in `<img>` everywhere) |
| `logos` | yes | 5 MB | Tenant company logos |
| `documents` | no | 50 MB | Workspace files |
| `attachments` | no | 25 MB | Task, ticket and chat attachments |
| `hr-documents` | no | 25 MB | Restricted to HR roles and the subject themselves |
| `receipts` | no | 10 MB | Expense receipts (images and PDF only) |

**Implemented.**

---

## 5. The modules

### 5.1 Dashboard — **Implemented**

A **role-composed** landing screen. Sections the caller's role cannot view are absent from
the API payload entirely rather than sent and hidden — an employee's response contains no
revenue figure at all, so there is nothing to read in the network tab.

One endpoint (`GET /api/dashboard`) assembles everything in ~16 parallel queries, most of
them against the reporting views. All date boundaries are computed in the *organization's*
timezone, not UTC.

**What renders:**

- **Headline KPI strip**, assembled from whichever sections the role received: Revenue
  (month-to-date, with trend), Weighted pipeline, Active projects (with at-risk count), Open
  tickets (with SLA breaches), Outstanding receivables (with overdue count), Stock alerts,
  Headcount (with pending leave), and — always — *My open tasks*.
- **Revenue vs spend** — a six-month area chart with collected / spend / net position.
- **Sales pipeline** — weighted forecast and a per-stage value bar.
- **My tasks**, **Project health**, **Upcoming meetings** (next 7 days).
- **Support queue**, **Inventory alerts**, **People**.
- **Team activity** — a cross-module feed, filtered to the modules the role may open, with
  each entry clickable through to its record.
- **Notifications** and **Recent documents**.
- **Quick actions** — filtered to what the role may actually do, so a shortcut is never
  offered that would return 403.

Live: subscribes to `projects`, `tasks`, `milestones`, `leave_requests`,
`attendance_records`, `invoices`, `expenses` and `support_tickets`, and refetches once
(debounced) on any change.

### 5.2 My Work — **Implemented**

A person's own to-do list, deliberately separate from Projects. The design constraint is
stated in the code: *nothing here moves a project metric*. Ticking off "call the client back"
changes no burndown and nobody else's screen — which is what makes people willing to put real
things on it.

The RLS policy admits **only the owner, with no administrator exception**, which is unusual
in this schema and intentional.

- **Capture** — one field and the Enter key. Title, optional note, optional day, optional
  list, and a star.
- **Views** — All open, Today, Upcoming, Starred, Completed, plus per-list filtering.
- **Layouts** — List, **Board** (drag-and-drop across time buckets: overdue / today /
  tomorrow / this week / later / someday), and **Schedule** (a month grid you can drop a
  to-do onto).
- **Lists** — create, rename, recolour, delete; six colours.
- **Manual reordering** — drag-and-drop, persisted via `sort_order`.
- **Search**, debounced.
- **Focus mode** — a single-task view.
- **Recurrence** — daily, weekdays, weekly or monthly. Completing a recurring to-do inserts
  the next occurrence; the completed row keeps its recurrence value so history reads
  honestly. Requires a due date, enforced by constraint.
- **Pin an assigned task** — link a project task to a to-do for context (read-only: title,
  status, due date, project).
- **Convert to a project task** — `POST /api/todos/[id]/convert` promotes a personal note
  into real assigned work.
- **Keyboard shortcuts dialog.**
- **Day progress ring.**

Deliberately excluded, and documented as such: labels, attachments and a priority scale.

### 5.3 CRM — **Implemented**

Six tabs.

| Tab | What it does |
|---|---|
| **Leads** | Full CRUD. Name/company, email, phone, job title, source, status (`new → contacted → qualified → proposal → negotiation → won/lost`), a 0–100 score, estimated value, owner, notes. Unassigned leads default to their creator. |
| **Contacts** | Full CRUD, linked to a company. |
| **Companies** | Full CRUD. Industry, website, email, phone, address/city/country, employee count, annual revenue, owner, notes. |
| **Deals** | Full CRUD. Company, contact, stage, value, probability (0–100), expected close, lost reason, owner. |
| **Pipeline** | A **read-only Kanban board** — one column per deal stage, with per-column count and total value. Cards open the edit dialog. There is **no drag-and-drop between stages**; the stage is changed in the dialog. |
| **Activities** | The customer timeline: calls, meetings, emails and notes logged against a lead, contact, company or deal. A constraint forbids an activity attached to nothing. |

**Company 360 detail sheet** — the feature that makes CRM the hub rather than a list. Opening
a company (from the tab or from global search) loads `GET /api/crm/companies/[id]/overview`
and shows, in one panel: contacts, deals, projects, invoices, support tickets, upcoming
meetings and the activity timeline. Every row is a link that opens that record in its own
module.

**CSV export** of Leads and Deals, gated on the `export` capability.

Table behaviour throughout: server-side pagination, search, sortable columns against a
server-side whitelist, and faceted filters.

### 5.4 Projects — **Implemented**

Two top-level tabs, plus a per-project workspace.

**Tasks tab** — a data table of every task with stat cards (total / in progress / completed),
search, and filters by status, priority and project. Create/edit dialog covers title,
description, project, milestone, status (`todo → in_progress → review → blocked → done`),
priority, assignee, due date and estimated hours.

**Projects tab** — a card grid. Create/edit covers name, description, status (`planning →
active → on_hold → completed → cancelled → archived`), priority, department, owner, **client
company**, budget and start/end dates. A check constraint forbids an end date before a start
date, and the API translates that into a readable message.

**Project workspace** — opening a project gives six tabs:

1. **Overview** — health, progress, budget, counts.
2. **Roadmap** — milestones as delivery **phases**: `planning → development → testing →
   review → deployment → completed`. Each phase has a name, description, owner, due date, its
   own 0–100 progress percentage, and a completion state. Full CRUD.
3. **Team** — project members with a project role (`manager`, `lead`, `contributor`,
   `reviewer`, `observer`) and an **allocation percentage** for capacity planning.
   Add/change/remove.
4. **Timeline** — a chronological view of dates across the project.
5. **Files** — upload, list, download, delete. A file can be marked **client-visible** and
   **requires approval**, which turns it into a *deliverable* the client can sign off in the
   portal.
6. **Discussion** — threaded comments with @-mentions that raise notifications.

**Project progress is computed in the database**, in `v_project_health`, as a single number
every screen reads (the board, the dashboard, the reports and the client portal — which is
why they never disagree). It blends three signals, renormalised over whichever are present:

- **Plan (weight 50)** — completed milestones count 1, in-flight ones count half of the
  progress they claim.
- **Execution (weight 30)** — completed tasks, with tasks in review counting half.
- **Acceptance (weight 20)** — approved client deliverables over total deliverables.

A project in `planning` reports 0 regardless; one marked `completed` reports 100.

**Not built inside Projects:** time tracking (`time_entries` exists as a table with no
endpoint), task dependencies (`task_dependencies` exists with no endpoint), a Gantt chart,
subtasks in the UI (`parent_task_id` exists), and teams (`teams` / `team_members` exist with
no endpoint).

### 5.5 Workspace — **Implemented**

A tree of documents, spreadsheets and files.

- **Page tree** — folders and pages, arbitrarily nested, with icons, per-page colour,
  starring (a property of the page, shared by everyone, like a pinned message), manual sort
  order, drag-to-move, rename and search. A trigger prevents a page becoming its own
  ancestor.
- **Documents** — Markdown content with an editor and a rendered view.
- **Spreadsheets** — a real sheet: typed columns (`text`, `number`, `currency`, `date`,
  `select`, `checkbox`, `member`, `url`), resizable widths, column reordering, and rows whose
  cells are keyed by column id so renaming a column does not rewrite every row. Currency
  columns format using the organization's currency.
- **File vault** — upload, download and delete files attached to a page.
- **Version history** — every save snapshots the previous content. The history dialog lists
  versions and **restores** one (keeping the current version in history). Old versions are
  pruned automatically.
- **Sharing** — per-page grants to an **individual** or a **department**, at `view`, `edit` or
  `manage`. Permission is resolved server-side by walking the tree, so a share on a folder
  covers everything inside it. Pages also carry a visibility of `inherit | organization |
  department | private`.
- **Trash** — soft-deleted pages, listed with a count on the sidebar, restorable. Restoring a
  folder restores everything deleted with it, and restoring a document restores the folders it
  lived in — the toast reports the true count.

Live: subscribes to `workspace_pages` and `files`.

**Note:** `workspace_spaces` exists as a table with visibility rules but has **no endpoint** —
pages are organised by the folder tree, not by spaces. *(Table present, feature not built.)*

### 5.6 Communication — **Implemented** (the largest module, ~5,900 lines)

Two views: **Messages** and **Meetings**.

#### Channels and messaging

- **Channel types** — public, private, direct (1:1) and announcement.
- **The sidebar** is built by one database function, `channel_overview()`, returning every
  channel the caller may see with its last message, unread count and participant count — and,
  for a DM, the other person's name and avatar. Public and announcement channels the caller
  has *not* joined are listed so they can be found and joined, and those correctly show
  **zero unread** (a room you have never entered has not said anything to you).
- **Create, rename, describe, archive, delete** a channel; **join** and **leave**;
  **add/remove members**; **mute**. Who may create a channel is an organization setting
  (`everyone` / `admins`).
- **A channel has a subject.** It can be linked to a **project** and a **client company**, so
  the channel header links out to the work and the work links back to the channel.
- **Direct messages** — `open_direct_channel()` finds or creates the 1:1 conversation.
- **Messages** — rich text, threading (`parent_id`), **@-mentions** that raise notifications,
  **emoji reactions**, **pinning**, **editing** (marked as edited, subject to an organization
  edit window) and **deletion** (author deletion is a policy toggle; moderators can always
  remove).
- **Attachments** — files posted in a channel become rows in the `files` table with the same
  governance as any other file: findable, attributable and revocable, and no more visible than
  the channel they were posted in. Size is capped by an organization setting and by the
  bucket's own 25 MB limit.
- **Record references** — a message can carry a link to a business record.
- **Read receipts** — **asked for, not broadcast**. The sender opens a receipt list for their
  own message; nothing is displayed under every message by default.
- **Search** — a real Postgres full-text index across every message the caller may read, not a
  filter over the loaded page.
- **Unread handling** — per-channel `last_read_at`, an unread filter, a "new messages"
  divider, day separators, and a jump-to-latest control.
- **Typing indicators** and **presence dots**, both over Realtime broadcast rather than tables
  (the data is worthless three seconds later).
- **Live**, with a polling fallback for tabs behind a corporate proxy where the socket cannot
  connect.

#### Meetings — **Implemented**, with one documented infrastructure gap

A meeting is treated as "a conversation with a time attached": it lives in the channel the
team already talks in, and a trigger writes a `calendar_events` row so it also appears in
everybody's week.

- **Schedule** a meeting (title, agenda, channel, participants, mode video/audio, scheduled
  time, duration) or **start one now**.
- **Waiting room** — participants knock; the host admits or denies. Host can **lock** the
  room.
- **Participant states**: `invited`, `knocking`, `admitted`, `joined`, `left`, `removed`,
  `declined`.
- **In-room controls** — camera, microphone, **screen sharing**, **raise hand**, host mute,
  host remove, cohost role.
- **Meeting notes** — readable and editable from the meeting card whatever the meeting's
  state, not only from inside the room.
- **Notifications** on invitation *and* when the host actually starts the meeting.
- **Media handling is unusually careful**: `getUserMedia` is attempted combined first, then
  per-device, so blocking your camera does not also lose your microphone; a
  `Permissions-Policy` refusal is distinguished from a user clicking Block, so the error
  message is actionable.

**The transport is a WebRTC full mesh** — browsers connect directly to each other, signalled
over the Realtime channel the tab already has open. No media server and no third-party SDK;
no audio or video passes through the platform's infrastructure.

**Partial, by explicit statement in the code:** a mesh sends one copy of your camera per
participant, so it suits a team, a client call or a stand-up and becomes bandwidth-bound
somewhere around eight people. And **two participants behind symmetric NAT cannot connect
without a TURN relay**, which is not configured. An SFU plus TURN is the answer to both;
neither is pretended away.

#### Moderation and governance

- **Communication audit trail** (`communication_audit`) — records that a message was removed,
  by whom, in which channel and why, and **never what it said**. Direct conversations resolve
  to "a direct message" rather than naming the two people. Readable only by administrators.
- **Retention** — an administrator sets a retention period in days, is shown how many messages
  it *would* remove, runs it deliberately, and the act is written into the moderation trail
  with their name on it. It is a button, not a nightly job, precisely because it destroys
  conversations.

### 5.7 Support — **Partial**

**Tickets — Implemented.**

- Full CRUD with server-side pagination, search and filters.
- Auto-assigned ticket number (`TKT-…`) from a per-organization counter.
- Requester (internal member *or* external contact/email), assignee, category, priority,
  status.
- **SLA due dates computed by trigger from priority**: critical → 4 hours, high → 8 hours,
  medium → 2 days, low → 5 days. Set in the database so every write path agrees on what the
  promise was.
- A **status workflow** that constrains which transitions are offered (`open → in_progress →
  pending → resolved → closed`, with reopen).
- First-response and resolution timestamps, resolution text.
- Stat cards, CSV export, and a clickable path from search and from notifications.

**Knowledge base — Not built as a product feature.** The "Knowledge Base" tab renders **six
hard-coded help articles about how to use NextMav itself** (getting started, managing your
account, tickets, invoicing, the API, keyboard shortcuts). The `kb_articles` table exists in
the database — with categories, tags, publish state and view counts — and **no endpoint reads
or writes it**. Nothing in the product lets an organization author its own articles.

**`ticket_comments`** exists as a table with an internal/public flag, and is **not exposed by
any endpoint**. Ticket conversation is not implemented.

### 5.8 HR — **Partial**

Six tabs; three are real and three are static mock-ups.

**Employees — Implemented.** The directory, read from `v_org_directory`: name, email, job
title, department, role, employment type, reporting line, status and last-seen. An
administrator can invite someone (returning an invite link), provision an account directly
with a temporary password, edit employment details, reset a password, and
deactivate/suspend/terminate. HR staff can read the directory even though the write
operations remain admin-only.

**Leave — Implemented.**

- Request leave: type (vacation, sick, personal, maternity, paternity, bereavement, unpaid —
  validated against the organization's own leave policy), date range, half-day flag, reason.
- Approve or reject with a decision note. **Self-approval is blocked by a database trigger**,
  and the API also refuses it to produce a clear 403 rather than a raw constraint violation.
- A constraint requires that any decided request records who decided it.
- **On approval, a trigger writes the covered working days into attendance as `on_leave` and
  consumes the leave balance.** Company holidays and non-working days are excluded.
- Notifications on request and on decision.

**Attendance — Implemented.**

- **Personal clock** — clock in / clock out, with a live elapsed timer and a remote-work
  option.
- **Every timestamp is `now()` evaluated by PostgreSQL.** The client never supplies a time,
  and a trigger overwrites one if it tries — a device clock is under the user's control, so
  accepting it would make attendance self-reported. A check-in time is immutable once written,
  except through an attributed adjustment.
- **Classification against the organization's own working hours**: `present`, `late` (past
  `work_start` plus the grace period), `early`, `remote`, `half_day` (under four hours
  worked), `on_leave`, `holiday`, `absent`.
- Clock-in **refuses when you are on approved leave**, and refuses a second check-in on the
  same day.
- Worked minutes are computed on clock-out from the stored check-in and server time, less the
  organization's unpaid break on a shift long enough to have taken one.
- **Manager/HR correction** — an adjustment records who made it, when, and why, so a corrected
  record never masquerades as a clocked one.
- Register view, stat cards, CSV export.

**Internal HR Case Desk — Not built.** The tab renders three hard-coded cases. Submitting one
adds a row to React state and shows a success toast. Nothing is persisted and no endpoint
exists.

**Recruitment & Onboarding — Not built.** Three hard-coded candidate cards with invented
interview stages, scores and checklist percentages. "Add Candidate" has no handler.

**Payroll & Compensation — Not built.** Three hard-coded salary rows with invented figures and
a "Run Payroll Batch" button with no handler. There is no payroll table in the schema.

**`leave_balances`** exists as a table and is written by the leave-approval trigger, but is
read only by `/api/hr/employees/[id]` — an endpoint **no screen calls**. There is no balance
display in the UI. *(Partial.)*

### 5.9 Finance — **Partial**

Four tabs.

**Overview — Implemented.** Total revenue (paid invoices), outstanding (sent + overdue), total
expenses, net income; a revenue-by-month area chart and an expense-by-category pie; recent
invoices. Computed client-side from the invoice and expense lists.

**Invoices — Implemented.**

- Create with **line items** (description, quantity, unit price). `line_total` is a generated
  column, so a line can never disagree with its own inputs.
- **Totals are derived in the database.** `recalculate_invoice()` runs on any change to line
  items or payments, so subtotal, tax, total and paid amount cannot be set by a client. Money
  is `numeric`, never float.
- Auto-assigned invoice number from a per-organization counter.
- Linked to a company, a contact and a project.
- Statuses: `draft`, `sent`, `paid`, `partially_paid`, `overdue`, `cancelled`, `refunded`.
- CSV export.
- **Partial:** editing an invoice can only change company/contact/project, status, dates and
  notes — **line items cannot be edited after creation**, and there is **no payment-recording
  endpoint**. The `payments` table exists and drives recalculation, but nothing writes to it
  through the product. "Paid" is a status somebody selects.

**Expenses — Implemented.**

- Title, amount (in the organization's currency, not a hard-coded one), category (general,
  travel, office, software, marketing, equipment, training), vendor, expense date, project,
  department, receipt path, notes.
- **Every claim enters as `pending`** — a claim that arrives pre-approved is a
  self-authorisation.
- Approve / reject / reimburse with an attributed decision. **Self-approval is blocked by a
  database trigger**, and the update schema deliberately refuses a bare `status` change (which
  would have slipped past the trigger, since it only fires when `approved_by` is set).
- Any employee may submit and track their own claim; only finance roles see the organization's
  full spend — enforced by RLS, not by the handler.
- CSV export.

**Purchase Requests & Approval Workflows — Not built.** The tab renders three hard-coded
requests. Approve/reject mutate React state and toast. No table, no endpoint. (Real purchase
orders exist, but in Inventory.)

**`budgets`** exists as a table (per department or project, with a period and an amount) and
has **no endpoint and no screen**. *(Table present, feature not built.)*

### 5.10 Inventory — **Implemented**

Six tabs.

- **Products** — SKU (unique per organization), name, description, category, unit, price,
  cost, stock, reorder level, warehouse, supplier, active flag. Stat cards including stock
  value and low-stock count.
- **Warehouses** — name, location, capacity, active flag.
- **Suppliers** — name, contact, email, phone, address, lead time in days, payment terms,
  notes.
- **Movements** — an **append-only stock ledger**. Every movement is a signed delta (never
  zero) with a type (`receipt`, `issue`, `transfer`, `adjustment`, `return`, `damage`), a
  reason, a reference, source/destination warehouses and the member who made it.
  `record_stock_movement()` is the only thing that writes `products.stock`, so the ledger and
  the balance cannot disagree, and each row stores the resulting `balance_after`.
- **Purchase orders** — auto-numbered, against a supplier and into a warehouse. Line items
  with quantity, unit cost and a generated line total; totals derived by trigger. Statuses
  `draft → submitted → approved → partially_received → received → cancelled`, with
  **receiving** that records received quantities (constrained so you cannot receive more than
  you ordered) and writes the corresponding stock movements.
- **Reorder** — products at or below their reorder level, with a badge on the tab.

CSV export of products.

### 5.11 Calendar — **Partial**

A **month grid** with day selection and a list of the selected day's events.

- Create/edit/delete events: title, description, start and end (with an all-day toggle),
  location, one of six colours, visibility (`organization` / `department` / `private`), and
  optional department and project links.
- A constraint forbids an event ending before it starts.
- Meetings scheduled in Communication appear here automatically, because the meeting trigger
  writes a `calendar_events` row.
- Live: subscribes to `calendar_events`.

**Partial:** there is **no week view, no day view and no agenda view** — month only. And
**`event_attendees` exists as a table with RSVP states (`pending`/`accepted`/`declined`/
`tentative`) that no endpoint and no screen touches**: you cannot invite anybody to a calendar
event or respond to one.

### 5.12 Client Portal — **Implemented**

What a customer sees of their own engagement, and the only module an external `client` account
can open. Staff reach the same screen with a company picker, so anyone can check what a
customer is being shown without logging in as them.

The design constraint is stated explicitly: this is not the Projects module with buttons
removed. It answers four questions — where is my project, what have you delivered, what do I
owe, who do I talk to — and it does not soften bad news: a project past its end date says so,
and an overdue phase is marked overdue.

**Landing** — company header, stat cards, and three tabs:

- **Projects** — cards with progress, health verdict, milestone counts and dates.
- **Invoices** — their own invoices with status and amounts.
- **Tickets** — their own support tickets.

**Project view** — four tabs:

- **Roadmap** — the delivery phases, grouped by stage, with progress and overdue marks.
- **Deliverables** — client-visible project files. Where a file `requires_approval`, the client
  can **approve or request changes with a note**. That decision feeds back into the project's
  progress calculation and notifies the project team through a trigger. Staff can record a
  decision on the client's behalf, and the audit trail says who entered it.
- **Messages** — a project thread the client can reply on. This is the *only* other write a
  client account has, and RLS (`comments_client_insert`) is what confines it to their own
  project.
- **Timeline** — dates as the plan takes shape.

Enforced in three layers: the capability model (`client` gets portal + support + read-only
projects and nothing else), RLS scoping every table to their own company through
`auth_client_company_id()`, and the endpoint selecting only client-appropriate columns — no
task boards, no budgets, no internal discussion, no other people's records.

The tenant's logo and a `portal_welcome` greeting appear here if the organization enables
them. Live: subscribes to project changes.

### 5.13 Admin — **Implemented**

Nine tabs, owner/administrator only.

- **Users** — the member table with search and filters. Invite (returns a link), provision
  directly with a temporary password, edit role/department/employment details, reset password,
  deactivate, suspend, terminate, and **permanently delete** — the last through a dialog that
  first calls `member_deletion_impact()` to show exactly what the deletion would touch and
  requires a named colleague to take over live responsibilities.
- **Roles** — a **read-only capability matrix**. Every role, its description, how many active
  members hold it, and for each of the thirteen modules whether it is allowed, with which
  actions and at what scope. Roles are system-defined and cannot be created, edited or deleted
  — the endpoint says so and there is no write path.
- **Settings** — company profile (name, logo, phone, address, country), **currency**, locale,
  timezone. Changing currency changes how money renders in every module.
- **Workplace** — working hours (start, end), working days, grace minutes, break minutes;
  attendance policy (allow remote, require a note when remote, half-day threshold,
  auto-absent, overtime threshold); leave policy (which of the seven leave types are offered,
  whether approval is required, minimum notice, maximum consecutive days, half days,
  carry-over).
- **Delivery** — project defaults: statuses, priorities, task categories, milestone stages,
  defaults for new projects, and **project templates** (a name, a description and an ordered
  list of phases created with the project).
- **Communication** — the seven-setting policy (who may create channels, whether messages may
  be edited and for how long, whether authors may delete their own, retention days, whether
  clients may be admitted to meetings, maximum attachment size), the retention runner, and the
  moderation trail.
- **Holidays** — company holidays with a date, a recurring flag and a half-day flag. These are
  excluded from leave calculations and from the attendance register.
- **Announcements** — company-wide notices with a title, body, audience (staff / clients /
  everyone), optional project scope, pinning and an expiry. Publishing raises a notification
  for the audience.
- **Audit log** — the tamper-evident record of row changes: who, what table, which record,
  which fields changed, old and new values, IP and user agent.

Also under Admin: **notification event toggles** (thirteen event types — task, project,
milestone, leave, invoice, expense, ticket, comment, mention, message, channel, meeting,
announcement). Switching one off stops the notification row from being written at all, rather
than filtering it on the way out. **Branding** (accent colour, portal welcome text, whether
the company logo appears on the client portal). **Departments** — create, rename, describe,
nest, assign a head and a cost centre.

---

## 6. Cross-cutting capabilities

### 6.1 Global search and the command palette — **Implemented**

⌘K opens a palette that does two things: navigate to a module, and **search the business**.
`GET /api/search` queries ten record types in parallel — leads, contacts, companies, deals,
projects, tasks, tickets, invoices, workspace pages and products — and **filters each one to
the modules the caller's role may open**. Without that filter the palette would be an oblique
read of data the sidebar hides. Selecting a hit calls `openRecord()`, which switches module
and opens that specific record.

### 6.2 Notifications — **Implemented**

Notifications are **written by database triggers**, not by route handlers, so one cannot be
missed because a caller forgot. Thirteen event types fan out through one function,
`notify_members()`, which reads the organization's notification settings before writing
anything.

Events that raise a notification: task assignment and progress, project changes, milestone
events, leave requested and leave decided, invoice sent/paid/overdue, expense submitted,
ticket raised/reassigned, comment replies, @-mentions in messages and comments, direct
messages, channel invitations, meeting invitations, **meeting started**, deliverable decisions,
and announcements.

**The tray** in the header: unread badge, list with relative times, mark-one-read,
mark-all-read, dismiss, and click-through to the record (a trigger stores a
`link`/`entityType`/`entityId` so the notification is a destination, not just a sentence).
Updates arrive over Realtime with a polling fallback (two minutes when the socket is working,
thirty seconds when it is not), plus a refresh when the tab regains focus.

**Sidebar badges** are counted per module by the server across the whole tray, not derived
from the fetched page. Communication is composed differently on purpose: a notification is
written only for a mention (posting in a channel does not notify everyone in it), so its badge
also carries unread *messages* from each channel's read marker. Opening a module clears its
badge optimistically and then confirms with the server.

### 6.3 Realtime — **Implemented**

Twenty-plus tables are published to Supabase Realtime with `REPLICA IDENTITY FULL` (without
which an UPDATE carries only the primary key and a filter on any other column matches nothing).
One websocket is shared by the whole tab; subscriptions are multiplexed as channels over it.

The design decision is stated: an event means *"your data is stale"*, and the component
refetches — it does not merge the row into local state. Two reasons, both concrete: the screens
render values derived in Postgres (a task moving to `done` changes the project's progress
percentage, which the task row says nothing about), and the event carries raw snake_case
columns without the embedded relations the components read.

Refetches are debounced (400 ms) and collapsed, so a bulk import of five hundred products costs
one refetch per connected client rather than five hundred. No navigation happens, no component
remounts, scroll position and open dialogs survive.

Deliberately **not** published: `audit_log` (append-only, nothing renders it live),
`org_settings` (changes arrive with the session), `invoice_line_items` (the invoice row already
moves when its lines do).

Also over Realtime, as ephemeral broadcast rather than tables: **typing indicators** and
**WebRTC signalling** for meetings.

### 6.4 Presence — **Implemented**

A heartbeat mounted once at the application shell (presence is a property of the session, not
of whichever screen is open), gated on being signed in. `POST /api/presence` on an interval,
and once with `status: 'offline'` on page hide via `sendBeacon`. Status can be `online`, `away`
or `offline`. Feeds the online counts, the presence dots beside people, and the "Last Seen"
column in Admin and HR.

The heartbeat carries the background header, so it does not hold the idle session timeout open.

### 6.5 Activity feed and audit log — **Implemented**, with one unused endpoint

Two deliberately separate records:

- **`activity_log`** — the human-readable "what is happening" stream, scoped to the modules the
  reader's role may open. Rendered on the dashboard.
- **`audit_log`** — the tamper-evident record of every row change, kept for administrators.
  Records only changed columns on update, with old and new values, actor, IP and user agent.

Conflating them, a code comment notes, gives you a feed nobody can read and an audit trail
nobody trusts.

*(A standalone `GET/POST /api/activity-log` endpoint exists and is fully implemented but is
**called by no screen** — the dashboard fetches activity inside `/api/dashboard`.)*

### 6.6 CSV export — **Implemented**

`GET /api/export?dataset=…` produces RFC 4180 CSV for seven datasets: leads, deals, invoices,
expenses, products, tickets and attendance. Every dataset requires the **`export`** capability
on its own module — not merely `view` — because a spreadsheet leaves the platform's access
controls permanently and cannot be un-shared. Rows are still filtered by RLS, so an export can
never contain more than the caller could see on screen.

There is **no PDF export and no scheduled/emailed reporting.**

### 6.7 Reporting views — **Implemented** (as data; partially surfaced)

Twenty `security_invoker` views do the analytical work in the database:

`v_org_directory` · `v_assignable_members` · `v_presence` · `v_attendance_summary` ·
`v_attendance_today` · `v_pipeline_summary` · `v_sales_performance` · `v_project_health` ·
`v_resource_allocation` · `v_finance_monthly` · `v_receivables_ageing` · `v_support_sla` ·
`v_inventory_alerts` · `v_inventory_valuation` · `v_dashboard_stats` ·
`v_client_portal_projects` · `v_workspace_tree` · `v_files` · `v_channel_members` ·
`v_meeting_participants`

Several are surfaced on the dashboard and in the modules. **`v_sales_performance`,
`v_resource_allocation`, `v_receivables_ageing`, `v_support_sla`, `v_attendance_summary` and
`v_inventory_valuation` are computed but have no dedicated screen** — there is no reports
module. *(Partial.)*

---

## 7. AI and intelligence

**Not built. There is no AI functionality in this product.**

- No AI provider is called anywhere in the codebase. There is no OpenAI, Anthropic or other
  model client, no prompt, no embedding, no vector column.
- `z-ai-web-dev-sdk` appears in `package.json` as a leftover dependency and is **never
  imported**.
- No recommendation engine, no scoring model, no summarisation, no natural-language search.
  The CRM lead `score` is a plain integer a person types.
- The marketing site lists **"Operational intelligence" as `planned`**, with the note that
  nothing there would read data a person could not already open themselves.

---

## 8. Data model

### 8.1 The 61 tables, by area

**Tenancy and identity (7)** — `organizations`, `profiles`, `organization_members`,
`departments`, `teams`, `team_members`, `invitations`

**HR (4)** — `attendance_records`, `leave_requests`, `leave_balances`, `holidays`

**CRM (5)** — `companies`, `contacts`, `leads`, `deals`, `crm_activities`

**Projects (6)** — `projects`, `project_members`, `milestones`, `tasks`, `task_dependencies`,
`time_entries`

**Workspace (6)** — `workspace_spaces`, `workspace_pages`, `workspace_page_versions`,
`workspace_page_shares`, `workspace_sheet_columns`, `workspace_sheet_rows`

**Communication (8)** — `channels`, `channel_members`, `messages`, `message_reactions`,
`meetings`, `meeting_participants`, `communication_audit`, `comments`

**Support (3)** — `support_tickets`, `ticket_comments`, `kb_articles`

**Finance (6)** — `invoices`, `invoice_line_items`, `payments`, `expenses`, `budgets`,
`document_counters`

**Inventory (6)** — `warehouses`, `suppliers`, `products`, `stock_movements`,
`purchase_orders`, `purchase_order_items`

**Calendar (2)** — `calendar_events`, `event_attendees`

**Personal (2)** — `todos`, `todo_lists`

**Cross-cutting (6)** — `files`, `notifications`, `activity_log`, `audit_log`, `announcements`,
`org_settings`

Of these, **nine have no endpoint at all**: `teams`, `team_members`, `task_dependencies`,
`time_entries`, `budgets`, `event_attendees`, `kb_articles`, `ticket_comments`,
`workspace_spaces`. `payments` and `leave_balances` are written by triggers but never through
the product.

### 8.2 The important relationships

```
organizations ─┬─< organization_members >─ profiles ─ auth.users
               │        │
               │        └─< (owner_id / assignee_id / member_id on EVERY business table)
               ├─< departments (self-nesting, head = a membership)
               └─< every business table (organization_id NOT NULL)

companies ─┬─< contacts ─< deals
           ├─< deals
           ├─< projects (client_company_id)          ← the customer↔delivery link
           ├─< invoices
           ├─< support_tickets (via contacts)
           └─< channels (company_id)                 ← the conversation↔customer link

projects ─┬─< milestones ─< tasks
          ├─< project_members ─ organization_members
          ├─< tasks ─< comments, files, time_entries
          ├─< files (is_client_visible + requires_approval = a deliverable)
          ├─< channels (project_id)
          ├─< invoices, expenses, calendar_events
          └─  v_project_health  →  dashboard, project board, client portal

channels ─┬─< channel_members (last_read_at drives unread)
          ├─< messages ─< message_reactions
          │        └─ attachments → files
          └─< meetings ─< meeting_participants
                   └─ writes a calendar_events row (trigger)

invoices ─< invoice_line_items       (line_total generated; totals recalculated by trigger)
         └─< payments                (drives amount_paid — no write path in the product)

products ─< stock_movements          (append-only; the only writer of products.stock)
purchase_orders ─< purchase_order_items ─ products

workspace_pages ─┬─ self-nesting tree (cycle-prevented by trigger)
                 ├─< workspace_page_versions
                 ├─< workspace_page_shares (member OR department, view/edit/manage)
                 ├─< workspace_sheet_columns + workspace_sheet_rows
                 └─< files
```

Polymorphic tables — `comments` (page / task / project / deal / ticket), `crm_activities`
(lead / contact / company / deal) and `files` (task / project / page / ticket / expense /
invoice) — exist so that mentions, notifications, timelines and the activity feed have a single
source rather than four near-identical ones.

### 8.3 Schema conventions

- **Enums, not free text**, for every status vocabulary, so a typo is a database error rather
  than a row that silently never matches a filter. The TypeScript constants mirror them
  exactly.
- **Soft delete** (`deleted_at`) on anything a person can remove but an audit trail may need to
  keep pointing at.
- **`updated_at` maintained by trigger**, never by the application.
- **Money is `numeric`**, never float.
- **Generated columns** where a value must never disagree with its inputs:
  `profiles.full_name`, `invoice_line_items.line_total`, `purchase_order_items.line_total`.
- **Every index leads with `organization_id`**, because every tenant query filters on it first.
- **Named check constraints with written explanations** — the API maps constraint names to
  readable sentences ("A project cannot end before it starts", "You cannot approve your own
  leave request") rather than leaking Postgres' own wording.
- **Per-organization document counters** for ticket, invoice and purchase-order numbers, so
  volume is not leaked between tenants by a global sequence.
- **Migrations are idempotent** and safe to re-run.

---

## 9. Backend architecture

### 9.1 Request handling

Every API route follows the same shape:

```
authorize(module, action)  →  RequestContext { supabase, user, org }  or  Response
```

`RequestContext` carries the caller's Supabase client (holding their JWT, so RLS applies),
their profile, their membership id, their role, their department, and the organization's
currency, locale and timezone — the last three because money and dates render in every module
and each one reading them separately is how a workspace ends up showing naira in Finance and
dollars in CRM.

`authenticate()` is the variant for endpoints whose subject is the *person* rather than a
module: your own notification tray, your own profile, your own to-do list, presence and the
company directory.

**Two layers of enforcement, deliberately:** RLS is the security boundary; `authorize()` exists
so a forbidden action returns a clear 403 instead of an empty list, because RLS alone cannot
distinguish "no rows" from "not allowed".

### 9.2 Generic CRUD

Most resources differ only in table name, searchable columns and embedded relations, so
`src/lib/supabase/crud.ts` expresses the shape once (`collectionHandlers` / `recordHandlers`).
About half the routes are four lines long. Each declares its table, module, select expression,
searchable columns, a **whitelist of sortable columns**, filterable keys, soft-delete
behaviour, an optional `prepare` function for creation rules, and an **update schema** listing
exactly which fields a client may set.

The update schema matters: without one these routes wrote whatever the body contained, so
`deleted_at`, `created_at` and the tenant key were all reachable by anyone with edit rights.
Update schemas are built with a custom `toUpdateSchema()` helper rather than Zod's `.partial()`,
which in this codebase silently wiped fields.

### 9.3 The API contract

- **Success:** `{ data, meta? }`, with the payload converted from the database's snake_case to
  the camelCase the UI reads — done once at the boundary rather than in sixty route handlers or
  by renaming Postgres columns.
- **Error:** `{ error: { message, code, details?, requestId? } }`.
- **Pagination:** `{ total, page, pageSize, totalPages }`.

**Database errors are translated, not forwarded.** `translatePgError()` maps PostgreSQL codes to
HTTP status and written messages: `42501` → 403 `RLS_DENIED`; `23505` → 409 `DUPLICATE` (passing
through a raised business rule like "You have already checked in today" but replacing Postgres'
generic duplicate-key text); `23514` → 409 `RULE_VIOLATION` with a written explanation per named
constraint; `22P02` → 422 naming the field and the bad value; `PGRST204`/`PGRST202` → 500
`SCHEMA_MISMATCH` reported as a server fault. The **default branch deliberately does not forward
the message**, because PostgreSQL writes its errors in terms of its own schema and that reply
would describe the database to whoever provoked it. The raw diagnostic goes to the log with the
correlation id.

### 9.4 Business rules that live in the database

Rules that must hold regardless of which client is writing:

- Attendance timestamps are server time, and a check-in is immutable outside an attributed
  adjustment.
- Clocking in while on approved leave is refused; a second check-in the same day is refused.
- Approving leave writes the covered working days into attendance and consumes the balance.
- Self-approval of leave and of expenses is blocked.
- Invoice totals are recalculated from line items and payments.
- Stock is the running total of an append-only ledger.
- Ticket, invoice and purchase-order numbers, and ticket SLA due dates, are assigned by trigger.
- The last owner of an organization cannot be removed or demoted; deleting their *account*
  triggers succession instead.
- A workspace page cannot become its own ancestor.
- Notifications are raised by trigger, gated on the organization's notification settings.
- A meeting writes and updates a calendar event.

### 9.5 Observability

- **Structured JSON logging to stdout** (`src/lib/logger.ts`) with redaction of passwords,
  tokens, cookies and email addresses *before* they are written. Deliberately not a transport —
  every host already collects stdout — with a `setLogSink()` seam for an external provider that
  receives an already-redacted record.
- **Correlation ids.** The proxy mints an `x-request-id` for every request, puts it on the
  forwarded request headers *and* on the response, and every log line written while serving it
  carries it. Error bodies include it so a user can quote it.
- **Framework-level error capture** (`src/instrumentation.ts`, Next's `onRequestError`) —
  catches every server-side exception across route handlers, server components and the proxy
  without a single route opting in. Fifty-two of the routes have no `try`/`catch` of their own;
  this is why that is safe.
- **`pgError()` logs at a level chosen by code** — 5xx at error, RLS denials at warn, and
  ordinary user-facing refusals at debug, so the error log is not made almost entirely of the
  system behaving correctly.
- **`/api`** is liveness and checks nothing; **`/api/health`** is readiness, probes the
  database, and returns detail only to a caller holding `HEALTH_TOKEN`.

### 9.6 Verification harnesses

Eight scripts, run together by `npm run verify:all`:

| Command | What it proves |
|---|---|
| `db:check` | Every migration parsed against the real PostgreSQL grammar, plus cross-file consistency (including that every view is `security_invoker`) |
| `db:verify` | Schema, RLS, storage, realtime and **two-tenant isolation** against a live database |
| `app:verify` | End-to-end checks through the HTTP API as two users |
| `identity:verify` | The identity lifecycle and session behaviour |
| `security:check` | Static checks over every route, policy and header — including that no component under `components/layout` reads tenant branding |
| `schema:check` | The TypeScript↔database contract |
| `contract:check` | API response shapes against what screens declare |
| `realtime:verify` | Drives a real websocket |
| `test:rate-limit`, `test:observability`, `npm test` | Limiter fail-open, logging/redaction/tracing, and the attendance rules |

---

## 10. Frontend architecture

- **One authenticated route.** Modules are lazily imported and mounted by id; switching module
  is a store action, not navigation. Each module is wrapped in an error boundary that shows
  what failed (including the message, because it is usually the only clue a support
  conversation has) and offers Retry and Reload — the boundary previously rendered a loading
  spinner, so every crash in the product presented as a module still loading.
- **State.** One Zustand store (`app-store.ts`) holds the session, the resolved role and
  capability mirror, the organization's presentation settings and policies, navigation,
  notifications and the cross-module focus request. Everything else is local to a module.
- **Data fetching.** A `useApi` hook for paginated tables (page, page size, search, sort against
  a client-side whitelist, filters), plus direct `fetch` for everything else. Mutation helpers
  parse the error body before deciding what to throw, so the server's written explanation
  reaches the toast instead of a bare status code.
- **Live updates.** `useModuleRealtime` per module, `useRealtime` for finer subscriptions,
  `useTyping` and `usePresence` for ephemeral state.
- **Shared components.** `DataTable` (TanStack Table: server-side pagination, sorting, faceted
  filters, row actions), `PageHeader`, `StatCard`, `EmptyState`, `ConfirmDialog`,
  `FileUploader`, `ExportButton`, `PresenceDot`.
- **Forms.** react-hook-form with Zod resolvers against the same schemas the API validates with.
- **UI kit.** shadcn/ui over Radix primitives (~40 components), Lucide icons, Framer Motion for
  module transitions, Recharts for charts, dnd-kit for drag-and-drop, MDXEditor for documents,
  Sonner for toasts.
- **Formatting is configured once** from the session — currency, locale and timezone — so every
  module formats money and dates identically without passing them around.
- **Theming.** Light/dark via `next-themes`, with an emerald accent.
- **Responsive.** A mobile sheet replaces the sidebar; the shell collapses to a 68px rail on
  demand.

---

## 11. The public marketing site

Thirteen statically generated pages using their own scoped design system. Content-wise the site
is unusually careful, and the code records why: a previous version carried fabricated claims
that were removed rather than restyled.

- **Landing** — hero, product mock, capability marquee, a bento capability grid, a
  before/after consolidation section, a showcase, a principles section (which replaced three
  invented customer testimonials with three positions the product takes), an architecture
  diagram, a readiness section and a closing call to action.
- **Features** — the **capability map** (`src/components/marketing/capabilities.ts`), which is
  the single most useful artefact in the repository for understanding what is claimed: sixteen
  capabilities each carrying a status of `live`, `partial` or `planned`, with a note on
  `partial` and `planned` saying exactly where the line falls. The stated rule for promoting an
  entry is that a person with the right role can do the thing today, in a trial account,
  without contacting anyone.
  - **Live (10):** identity & access · CRM & sales · projects & work · people & HR · finance ·
    inventory & supply · communication · support & client portal · calendar · dashboards &
    reporting.
  - **Partial (2):** approvals & workflows (leave, expenses and project sign-off exist; a
    configurable multi-step workflow builder does not) · organization structure (organizations,
    departments and reporting lines exist; business units, branches and cost centres do not).
  - **Planned (4):** procurement · assets · a documents module with version history ·
    operational intelligence.
- **Solutions, About, Pricing** — pricing describes plan tiers; there is **no billing system, no
  payment integration and no subscription enforcement anywhere in the code**.
- **Contact** — a validated form that composes a mail message; there is no inbound endpoint.
- **Blog, Docs, Help, Status** — deliberately **honest empty states**. Each previously carried
  fabricated content (eight non-existent articles including an invented funding round; an API
  reference for an SDK that was never published against a domain the company does not own; 118
  non-existent help articles with view counts and a 24/7 support commitment; six invented
  uptime figures and four fabricated incidents including one claiming a live outage). All of it
  was replaced with pages that say what is actually known and where to look instead. They are
  kept rather than deleted because the footer and the command palette link to them.
- **Privacy, Terms, Cookies** — standard legal pages.

---

## 12. Configuration

An organization is configured through `organizations` columns plus six JSON keys in
`org_settings`, seeded on creation by trigger so a new workspace is immediately usable:

| Key | Controls |
|---|---|
| `attendance_policy` | Remote clock-in, note requirement, half-day threshold, auto-absent, overtime threshold |
| `leave_policy` | Which leave types are offered, approval requirement, minimum notice, maximum consecutive days, half days, carry-over |
| `project_defaults` | Statuses, priorities, task categories, milestone stages, defaults, project templates |
| `notification_events` | Thirteen on/off switches, read by the database before a notification row is written |
| `branding` | Accent colour, portal welcome text, whether the company logo shows on the client portal |
| `communication_policy` | Channel creation rights, message edit/delete rules and window, retention days, client meeting access, attachment size cap |

Every setting is documented as having a named line of code that reads it — the stated test
applied when the set was designed, because "a settings screen full of toggles that nothing
consults" is described as the dominant historical defect in this repository.

The readable half of these settings rides along with the session response, so an employee's
leave form knows which leave types their company offers without being able to call the
admin-only settings endpoint.

Currency defaults to **NGN** for organizations created from now on (the product's initial market
is Nigeria); existing organizations are never silently converted.

---

## 13. Summary of what is not built

Collected from everything above, so nothing has to be inferred.

**Absent features with a table already in place:**
teams and team membership · task dependencies · time tracking · budgets · calendar event
attendees and RSVP · knowledge-base articles · ticket comments/conversation · workspace spaces ·
payment recording · leave-balance display.

**Absent features with no backing at all:**
AI / operational intelligence of any kind · payroll · recruitment and onboarding · an internal
HR case desk that persists · purchase requests as a separate approval workflow · a configurable
multi-step workflow builder · business units, branches and cost centres · an assets module · a
documents module distinct from Workspace · performance reviews · a reports module surfacing the
six computed-but-unrendered views · PDF export · scheduled or emailed reporting · billing,
payments or subscription enforcement · an organization switcher in the UI.

**Built but not reachable from any screen:**
`GET/POST /api/activity-log` · `GET/PATCH /api/admin/notifications` (a duplicate of
`/api/notifications`) · `GET/PATCH /api/hr/employees` and `/api/hr/employees/[id]` (the HR screen
uses `/api/admin/users` instead).

**Built with a stated limit:**
invitation email delivery is not wired up (the link is surfaced instead) · meetings need a TURN
server for hard networks and an SFU above roughly eight participants · rate-limit counters are
per-process · no Content-Security-Policy beyond `frame-ancestors` · no multi-factor
authentication · public signup is blocked until email confirmation is disabled or custom SMTP is
configured.

**Hard-coded mock UI presented as a feature tab** (no persistence, no endpoint):
HR → Recruitment & Onboarding · HR → Payroll & Compensation · HR → Internal HR Case Desk ·
Finance → Purchase Requests & Approval Workflows · Support → Knowledge Base.

---

*Compiled by reading the codebase at commit `4b9b1c8` on branch `main`.*
