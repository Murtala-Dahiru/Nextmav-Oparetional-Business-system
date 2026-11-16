# Commercial Hub audit — 2026-10-29

Repository and live database inspected before implementation. Existing uncommitted work is retained.

## Existing and reusable
- CRM navigation and identity remount; Company/Contact/Deal workspaces.
- `crm_record_visible`, `crm_entity_visible`, authenticated request context and private `crm-files` storage.
- Product catalog (organization currency must be made explicit; product rows have no currency).
- Finance invoices and payments (commercial amounts must not write accounting records).
- Automation Studio migrations 0094–0097, durable worker, versioned workflows, tasks and notifications.
- Pipeline approvals remain separate and unchanged.

## Incomplete / missing
- No live commercial/quote/proposal/contract/tax-rule tables were found.
- No commercial document generator, revisions, approval policy or execution evidence exists.
- Invoice tax percentages are not a reusable tax catalog.
- Automation worker only recognizes lead/deal/company/contact/activity entities. Commercial triggers must not be advertised until supported.

## Security requirements
- Read-only direct table grants; writes through transactional RPCs with membership, ownership and association validation.
- Row locks plus expected revision; decisions bound to immutable submitted snapshots.
- Private record-authorized files; evidence cannot be deleted or replaced.
- No implied email delivery, legal signature, exchange rate or Finance revenue.

## Required migrations and screens
- Additive 0098+ commercial records, versions, approval decisions, tax/policy settings, obligations, renewal terms, private documents and indexes.
- Commercial Overview, Quotes & Pricing, Proposal Studio, Contracts, Renewals & Obligations, contextual approvals/settings.
- Bounded Company/Contact/Deal related-commercial panels.

Acceptance evidence and limitations are maintained separately in COMMERCIAL-HUB-ACCEPTANCE.md.
