# CRM Governance & Customization acceptance record

13 November 2026. This record covers governance changes in the existing NextMav BOS workspace. The repository already contained extensive uncommitted CRM, Sign, Engagement and other work. The full working-tree diff includes changes outside this phase.

## Implementation and source inventory

| Area | Implementation and main files |
|---|---|
| Governance foundation | `supabase/migrations/0131` through `0147` in filename order, `src/lib/crm/customization.ts`, `src/lib/crm/custom-filter.ts`, `src/app/api/crm/settings/`. Organization and object scope, immutable IDs and types, versions, field defaults and constraints, references, archive dependencies and audit history. |
| Existing infrastructure reused | BOS authentication and membership, module capabilities, PostgreSQL policies, record APIs and forms, Customer 360, pipeline guarded transitions, Automation Studio, CSV analysis and duplicate matching, BOS role assignment and organization settings. Explicit membership foreign keys in `src/lib/auth-context.ts` and the login and organizations routes fixed an ambiguous organization lookup. |
| Field management | `governance-settings.tsx`, `custom-fields.tsx`, `forms.tsx`, `record-sheet.tsx`, `company-detail.tsx` under `src/components/modules/crm/`. Sixteen supported types, including active organization members, contacts and companies. SQL validates values on record writes. Internal company fields reside in a separate protected table because a portal client can legitimately read its own company row. |
| Layouts | `layout-editor.tsx` and shared field display. Section titles, ordering of fields, visibility, one or two columns, initial collapse state, drag between sections, undo/redo, draft, preview, publish and revert. Old custom-only layouts retain standard details. |
| Views and filters | `list-presentation.tsx`, `custom-field-filter.tsx`, `shared-views.tsx`, `directory-tools.tsx`, all four CRM lists and `src/lib/supabase/crud.ts`. Personal, team and organization views, defaults, search, sort, selected columns, order, density and bounded combination of custom matches. Custom column preferences use UUIDs. |
| Permissions | `src/lib/permissions.ts` and existing BOS roles supply effective capabilities. Leads and deals follow own, department or organization visibility. Contacts and companies remain the shared internal directory. `src/components/modules/admin/index.tsx` permits existing members with incomplete profile names to change role and defaults new members to Employee. |
| Sales processes | `pipeline-settings.tsx`, `automation-studio.tsx`, `src/lib/crm/pipelines.ts`, `src/lib/crm/automation.ts`. Custom stage requirements use the existing transition engine. Supported automation event snapshots reference scalar fields by stable ID. General settings expose the existing lead assignment rules and fallback owner. |
| Data management | `src/lib/import/{plan,records,deals}.ts`, `src/lib/crm/import-fields.ts`, import preview and commit routes, `import-center.tsx`, `src/app/api/export/route.ts`, `bulk-fields.tsx`. Custom mappings, row validation and summaries. Deals with matching names default to skip and never merge on name alone. Current-view CSV runs the authenticated list interpreter. Selected exports are bounded and audited. Bulk field edits confirm, check revisions and report partial success. |
| Verification | `scripts/crm-governance-{db,migrate,api,browser,views-browser,role-browser,authorization,performance}.mjs`, `scripts/crm-governance.test.mts`, `docs/governance-*.txt` and `docs/governance-evidence/`. |

## Migration and environment status

The configured PostgreSQL database received migrations 0131–0147. These cover fields, layouts, directory views, company field privacy, stage evidence, automation conditions, department visibility, shared views, defaults, references, usage, validation rules, list preferences, standard detail fields, personal/default views, empty-value validation and allowlisted automation event capture. Migration parsing and cross-file consistency passed. The database suite replays the migrations twice within a transaction, exercises synthetic tenants and rolls that transaction back. Separate API and browser tests retain synthetic users and records in the configured database. No release deployment was performed.

## Acceptance evidence

| Requested checks | Result and limits |
|---|---|
| 1–8, 18–19, 30 | Database suite passed 63 checks across Real Estate and IT Consulting tenants and a portal client. Covered two-way isolation, actual inserts, invalid and required values, historical preservation, dependencies, stale revisions, typed defaults, references and audit. The API suite also reloaded values after editing. |
| 9–11, 15–17, 39 | Browser created a field and lead, published and previewed a layout, filtered results and read the saved field in record details. Desktop and 390px mobile evidence is in `governance-evidence`. Other object create, filter and edit paths were checked through real APIs. The mobile check covers record fit. |
| 12–14 | Browser created a personal view, saved its presentation, made it the default and restored it on return. Database assertions cover private views even against another administrator, organization publishing permissions, cross-tenant default rejection and deletion of the default. |
| 20–23, 29 | Six denied API requests, including exports and bulk edits. Manager same-department, cross-department, own and missing-department cases passed against database policies. Three BOS role UI checks passed, covering assign, restore and audit. Browser confirmed bulk lead edit. API verified stale bulk updates on the other three objects. |
| 24–26 | Database enforced custom evidence on a real deal transition and evaluated a custom automation condition. Pipeline regression suite passed two tests and automation regression suite passed five. All 22 live Automation Studio assertions passed, including durable execution and idempotency. A published custom dropdown condition triggered its action on a matching lead and skipped a nonmatching lead (`governance-workflow.txt`). |
| 27–28 | Live API exercised lead, contact, company and deal CSV mapping and persistence, invalid mappings/values, selected export, matching current-view export and header-only empty results. A separate contact import verified explicit values and the configured default when the CSV cell was blank. Existing import suite passed 69 assertions. |
| 31–38 | All four objects exercised. Authenticated read smoke tests passed for Customer 360, Engagement, Commercial Hub and Sign. Customer 360 signals passed five tests, Engagement passed ten assertions and Sign passed 22 customization assertions. Complete contract issuance and signing journeys were outside these smoke tests. |
| 40 | Targeted governance lint and TypeScript checks recorded in `governance-lint-final.txt` and `governance-types-final.txt`. Production build and standalone packaging passed, recorded in `governance-build-final.txt`. |

## Performance and operating limits

Field definitions and options are capped at 100 per object and field respectively. Layouts permit ten sections and 100 assigned fields. Custom filtering permits ten predicates. Bulk updates accept up to 100 revision-stamped records. Selected exports accept 500 IDs. Export responses are capped at 10,000 rows and retrieve smaller pages. On a 50,000-row synthetic temporary table PostgreSQL used the GIN containment index and returned 50 matches in 0.145 ms. This measurement covers one query plan. Large-tenant end-to-end latency, concurrency and network budgets remain unverified. A filtered export reads successive pages and concurrent record changes may affect the result.

## Remaining limits

- BOS uses a fixed permission enum and matching database policies. Organization owner/administrator manage CRM metadata. Independent custom CRM roles and a separately assignable CRM-only administrator remain unimplemented. No new setting grants global BOS privileges.
- Layout publication controls custom fields and supported standard detail fields. Built-in creation form fields and specialist Customer 360 panels retain their existing arrangements. Presets are optional industry field suggestions, not multi-object configuration packages.
- Conditional automation support depends on the event snapshot and field type. Company field values are private and excluded from generic automation snapshots. Full end-to-end automation execution for every supported custom type was not independently exercised.
- Company and deal CSV imports were exercised through the API. Deal imports create new opportunities at the initial stage, with name collisions marked for review. The browser-based mapping interaction across all four targets remains to be independently verified.
- Configuration metadata includes bounded limits. There is no tenant-facing editor to tune these limits, general sales terminology, or arbitrary field-level access policies. Sensitive fields inherit record access. Saved list presentations and filter metadata are versioned or ID-based where indicated.
- No formal accessibility or international standards certification, enterprise load certification or whole-product production-readiness determination was performed.
- External Gmail and Microsoft 365 synchronization, provider-backed email sequences and external calendar synchronization remain deferred integration dependencies. This phase did not start the final standalone CRM audit.
