# NEXTMAV BUSINESS OPERATING SYSTEM
# CRM 3.0 — THE ULTIMATE REVENUE & RELATIONSHIP OPERATING SYSTEM

## MASTER PRODUCT, DESIGN, ARCHITECTURE & ENGINEERING IMPLEMENTATION PROMPT

You are working inside the existing NextMav Business Operating System (BOS).

Act as an elite multidisciplinary product engineering team combining the expertise of:

- Principal Enterprise SaaS Product Architect
- Chief Product Officer
- Principal CRM and Revenue Operations Architect
- Senior Full-Stack Engineer
- Principal Product Designer
- Business Process Automation Architect
- Database and Supabase Security Architect
- Revenue Intelligence and Analytics Engineer
- Quality Assurance and Reliability Engineer

Your mission is to transform the existing NextMav CRM into a world-class, automation-first, visually exceptional, commercially valuable **Revenue & Relationship Operating System**.

This is not a simple CRM redesign.

This is the development of a serious enterprise software product capable of standing independently as a premium CRM while integrating seamlessly with the broader NextMav Business Operating System.

Our ambition is to compete with the quality, usefulness, and sophistication of leading CRM platforms such as Salesforce, HubSpot, Attio, and Pipedrive.

Do not imitate their interfaces or blindly duplicate their features.

Build a distinctive, cohesive NextMav experience.

Our goal is to make complicated customer relationship and revenue operations feel simple, connected, intelligent, and highly automated.

**The product promise:**

"NextMav CRM connects every customer relationship to the work, revenue, and decisions it creates—automatically."

---

# PART 1 — ABSOLUTE ENGINEERING RULES

## 1.1 Preserve the existing platform

NextMav BOS is an existing, substantially developed application.

The CRM already contains working functionality, business logic, database structures, permissions, and integrations.

You must inspect and preserve these capabilities.

Do not assume the CRM is empty.

Do not rebuild existing features unnecessarily.

Do not delete working functionality merely because it is not mentioned in this prompt.

Do not replace established business logic with simplified implementations.

Do not modify unrelated modules unless an approved integration genuinely requires a narrowly scoped change.

Preserve:

- Existing primary sidebar and module groupings.
- Existing application shell.
- Established contextual navigation patterns.
- Authentication.
- Organization membership and tenancy.
- Roles and permissions.
- Supabase RLS policies.
- Existing database records.
- Existing customer and deal relationships.
- Working CRM workflows.
- Existing project integrations.
- Existing finance integrations.
- Existing support integrations.
- Existing client portal integrations.
- Public marketing website.
- Existing working APIs and application routes.

Avoid breaking changes.

Any necessary database migrations must be backward-compatible, carefully reviewed, and reversible where feasible.

## 1.2 Build real functionality

Do not create decorative screens that pretend to provide enterprise functionality.

Do not use hardcoded business metrics.

Do not fabricate customer information.

Do not create fake automation execution.

Do not show buttons that do nothing.

Do not claim integrations exist when they are not configured.

Do not introduce artificial AI scores.

Every implemented feature must have the appropriate underlying data model, business logic, permissions, validation, loading states, error handling, and test coverage.

## 1.3 Work incrementally

This is a major product development program.

Do not attempt to implement all twelve capabilities in one uncontrolled code change.

Start with a complete audit.

Create an implementation plan.

Then execute the work in coherent, testable phases.

Complete each phase properly before proceeding to the next.

Do not abandon the project after building only the dashboard.

If execution limits prevent completing all phases in one session, preserve a precise implementation plan, completed work, outstanding tasks, and verification results so development can continue safely.

Never claim incomplete features are finished.

---

# PART 2 — MANDATORY EXISTING CRM AUDIT

Before implementation, inspect the repository and identify the actual architecture.

Audit:

1. CRM dashboard and existing analytics.
2. Leads.
3. Contacts.
4. Companies and accounts.
5. Deals and pipelines.
6. Activities and tasks.
7. Notes and interaction history.
8. Proposals and quotations.
9. Contracts.
10. Automation capabilities.
11. Customer segmentation.
12. CRM reporting.
13. CRM settings.
14. Database tables and relationships.
15. Supabase functions, views, triggers, and migrations.
16. Authentication and RLS.
17. Existing project handoff functionality.
18. Finance and invoice integrations.
19. Support and customer service integrations.
20. Client portal functionality.
21. Existing UI components and design tokens.
22. Existing test coverage.
23. Current performance bottlenecks.
24. Existing integration and notification infrastructure.

Classify each proposed feature as:

- Fully implemented and working.
- Partially implemented.
- Implemented but requiring improvement.
- Missing.
- Blocked by another dependency.

For every existing feature, determine whether to preserve, enhance, refactor safely, or extend.

Produce a capability matrix and a prioritized implementation plan before major changes.

The audit must guide development.

---

# PART 3 — PRODUCT EXPERIENCE AND PREMIUM UI DESIGN

The CRM must feel like a premium standalone product within NextMav BOS.

Design quality is a first-class requirement.

## 3.1 Visual identity

Use the established NextMav design system.

Visual direction:

- White-dominant interface.
- Refined neutral backgrounds.
- Charcoal typography.
- Restrained blue primary accent.
- Carefully coordinated semantic colors.
- Subtle borders.
- Elegant card surfaces.
- Consistent spacing.
- Excellent typography.
- Purposeful information density.
- Smooth, restrained interactions.
- Premium data visualizations.

Avoid:

- Generic CRM templates.
- Overcrowded screens.
- Excessive gradients.
- Oversized empty cards.
- Inconsistent component styling.
- Unnecessary icons.
- Random colors.
- Poorly aligned forms.
- Giant modal dialogs.
- Repetitive KPI-only dashboards.
- Excessive nested navigation.

The interface should feel fast, sophisticated, comfortable, and exceptionally well organized.

## 3.2 Preserve application navigation

Do not redesign the global sidebar.

Do not replace the established contextual navigation architecture.

Organize CRM capabilities within the existing navigation system.

Recommended conceptual areas:

- Overview.
- Leads.
- Contacts.
- Companies.
- Deals.
- Activities.
- Additional tools for Automation, Commercial Hub, Reports, and Settings.

Use contextual navigation, record tabs, and overflow menus where appropriate.

Do not create twelve separate top-level destinations merely because this specification contains twelve capabilities.

## 3.3 Premium record workspaces

Create beautifully designed record pages for:

- Leads.
- Contacts.
- Companies.
- Deals.
- Commercial documents.
- Automation workflows.

Each record workspace should offer:

- Clear identity and status.
- Essential information.
- Relevant actions.
- Related records.
- Activity timeline.
- Notes and attachments.
- Ownership.
- Appropriate contextual tabs.
- Fast editing.
- Strong empty states.
- Responsive layout.

Avoid forcing users to navigate through several pages for simple actions.

---

# PART 4 — CAPABILITY 1: REVENUE COMMAND CENTRE

Create a visually exceptional CRM intelligence dashboard.

It must be distinct from the organization-wide Executive Overview.

Executive Overview provides business-wide intelligence.

CRM Overview provides sales, customer, pipeline, and revenue operations intelligence.

## 4.1 Premium KPI system

Potential KPIs:

- Total open pipeline value.
- Won deal value.
- New leads.
- Qualified leads.
- Conversion rate.
- Average deal size.
- Average sales cycle.
- Deals closing soon.
- Overdue follow-ups.
- Forecasted revenue.

Choose metrics based on available data and user permissions.

Support relevant period comparisons.

Do not confuse pipeline value with actual revenue.

## 4.2 Mandatory visual analytics

Where supported by actual data, include:

### Revenue and pipeline trends
Large interactive line or area chart.

### Sales pipeline distribution
Bar or funnel visualization showing deal value and counts by stage.

### Lead source distribution
Donut chart with meaningful attribution categories.

### Lead conversion funnel
Lead-to-qualified-to-opportunity-to-won conversion.

### Deal aging
Bar chart showing how long deals remain open or in particular stages.

### Sales performance
Actual versus target, where targets exist.

### Forecast versus actual
Clearly distinguish projections from closed business.

### Sales activity trends
Calls, meetings, tasks, and follow-up activity.

### Win/loss analysis
Outcomes and recorded reasons.

### Customer acquisition trends
New accounts and converted customers.

Use a deliberate mixture of large feature charts, supporting visualizations, compact KPI cards, and actionable lists.

Do not create a wall of meaningless charts.

Every chart must have proper tooltips, legends, filters, loading states, empty states, and appropriate drill-downs.

## 4.3 Revenue priorities

Show:

- Stalled deals.
- Neglected leads.
- Overdue follow-ups.
- Deals missing next steps.
- Opportunities closing soon.
- Renewals requiring attention.
- Deals requiring manager review.

Make these actionable.

---

# PART 5 — CAPABILITY 2: SMART LEAD MANAGEMENT

Build a complete, automation-first lead management system.

## 5.1 Unified lead inbox

Support:

- Manual lead creation.
- Lead capture forms.
- CSV imports.
- Authorized API-based creation.
- Existing connected integrations.
- Lead source tracking.
- Campaign attribution.
- Assignment status.
- Qualification status.
- Ownership.
- Follow-up status.

Provide premium table, list, and detail views.

## 5.2 Lead capture

Create configurable lead capture forms.

Support:

- Field mapping.
- Required fields.
- Validation.
- Consent capture.
- Source metadata.
- Spam prevention.
- Secure submission.
- Duplicate checks.
- Assignment rules.

Public capture endpoints must have appropriate authentication boundaries, rate limits, and abuse protection.

## 5.3 Duplicate detection

Detect likely duplicates using:

- Normalized email.
- Normalized phone numbers.
- Company domains.
- Company names.
- Existing contact relationships.

Distinguish exact matches from possible matches.

Do not merge uncertain records automatically.

Provide a controlled merge workflow with conflict resolution, relationship preservation, and audit history.

## 5.4 Lead qualification

Support configurable qualification frameworks.

Include:

- Need.
- Budget.
- Authority.
- Timeline.
- Service interest.
- Estimated opportunity value.
- Decision-maker information.
- Qualification notes.

Do not force one methodology on every organization.

## 5.5 Automated assignment

Support rules such as:

- Round-robin.
- Territory.
- Industry.
- Service interest.
- Existing account owner.
- Team workload.

Provide fallback ownership when no rule matches.

Prevent duplicate assignments from repeated events.

## 5.6 Lead response intelligence

Track:

- Time to first response.
- Time since last engagement.
- Follow-up completion.
- Unassigned leads.
- Overdue responses.
- Conversion by source.

Provide actionable alerts based on transparent thresholds.

## 5.7 Lead conversion

Convert a qualified lead into the appropriate company, contact, and opportunity records.

Reuse existing records where possible.

Preserve activity history, attribution, ownership, and relationships.

Avoid creating duplicate customer records.

---

# PART 6 — CAPABILITY 3: CUSTOMER 360 AND ACCOUNT INTELLIGENCE

Build a unified account workspace.

Every company should have one connected commercial and operational history.

## 6.1 Account profile

Support:

- Company identity.
- Industry.
- Location.
- Size.
- Parent and subsidiary relationships.
- Account owner.
- Account team.
- Tags.
- Segmentation.
- Custom fields.
- Communication preferences.
- Consent information.

## 6.2 Contacts and decision-makers

Support multiple contacts per company.

Include:

- Job title.
- Department.
- Relationship role.
- Decision-making influence.
- Preferred contact method.
- Contact ownership.
- Relationship notes.

## 6.3 Unified timeline

Connect authorized records from:

- Leads.
- Deals.
- Calls.
- Meetings.
- Emails where integrated.
- Proposals.
- Contracts.
- Projects.
- Support tickets.
- Invoices.
- Payments.
- Renewals.

Do not invent activities or relationships.

## 6.4 Account 360 interface

Provide contextual sections such as:

- Overview.
- Timeline.
- Contacts.
- Deals.
- Projects.
- Finance.
- Support.
- Contracts.
- Renewals.
- Account plan.

The interface should make customer history easy to understand.

## 6.5 Account planning

Support:

- Strategic account objectives.
- Key stakeholders.
- Growth opportunities.
- Relationship risks.
- Account actions.
- Ownership.
- Review dates.

---

# PART 7 — CAPABILITY 4: ADVANCED SALES PIPELINES

Build a sophisticated yet intuitive opportunity management system.

## 7.1 Multiple pipelines

Support different sales processes within an organization.

Examples:

- New business.
- Enterprise sales.
- Renewals.
- Partnerships.
- Service expansion.

Each pipeline should support configurable stages.

## 7.2 Pipeline stages

Support:

- Stage names.
- Stage order.
- Probability assumptions.
- Entry requirements.
- Exit requirements.
- Required fields.
- Stage ownership.
- Inactivity thresholds.
- Allowed transitions.

Validate stage transitions.

Do not allow users to bypass required commercial approvals.

## 7.3 Pipeline views

Provide:

- Premium Kanban.
- Advanced table.
- Forecast view.
- Saved filters.
- Sorting.
- Bulk actions.
- Ownership filters.
- Date filters.

Drag-and-drop must respect stage rules and permissions.

## 7.4 Deal workspace

Include:

- Deal title.
- Company and contacts.
- Deal owner.
- Deal team.
- Pipeline and stage.
- Deal value and currency.
- Expected close date.
- Probability.
- Forecast category.
- Products or services.
- Next step.
- Activities.
- Notes.
- Documents.
- Quotes.
- Contracts.
- Approvals.
- Related projects.
- Relevant customer history.

## 7.5 Deal intelligence

Identify:

- Stalled deals.
- Missing next steps.
- Repeatedly postponed close dates.
- Incomplete qualification.
- Deals without identified decision-makers.
- Long stage durations.
- Pending commercial approvals.

Use transparent rules.

## 7.6 Win/loss analysis

Capture:

- Won date.
- Lost date.
- Lost reason.
- Competitor where known.
- Outcome notes.
- Sales cycle duration.

Preserve historical stage changes for reporting.

---

# PART 8 — CAPABILITY 5: AUTOMATION STUDIO

THIS IS ONE OF THE MOST IMPORTANT DIFFERENTIATORS.

Build a genuine, reliable, configurable automation engine.

Do not create a decorative workflow builder.

## 8.1 Automation model

Every workflow must follow:

TRIGGER → CONDITIONS → ACTIONS → OUTCOME

Support a structured workflow definition.

An automation should contain:

- Organization.
- Workflow name.
- Description.
- Trigger configuration.
- Conditions.
- Actions.
- Status.
- Version.
- Owner.
- Execution history.
- Permissions.
- Failure handling.

## 8.2 Workflow triggers

Examples:

- Lead created.
- Lead updated.
- Lead qualified.
- Lead assigned.
- Deal created.
- Deal stage changed.
- Deal won.
- Deal lost.
- Activity completed.
- Follow-up overdue.
- Quote approved.
- Contract signed.
- Renewal approaching.
- Customer issue escalated.
- Invoice overdue, when integrated.
- Scheduled time reached.
- Authorized webhook received.

Use real application events and validated integration events.

## 8.3 Workflow conditions

Support:

- Field comparisons.
- Status checks.
- Ownership checks.
- Deal value thresholds.
- Date conditions.
- Pipeline and stage checks.
- Tags.
- Source attribution.
- Industry.
- Service type.
- Permission-aware relationship checks.
- AND/OR condition groups.

Ensure conditions are deterministic and testable.

## 8.4 Workflow actions

Support appropriate actions such as:

- Assign lead owner.
- Create task.
- Set follow-up date.
- Update permitted fields.
- Add tag.
- Create internal notification.
- Request approval.
- Advance a record when valid.
- Prepare proposal.
- Create renewal opportunity.
- Initiate approved handoff.
- Trigger authorized webhook.
- Send approved customer communication through configured providers.

Every action must validate permissions and business rules.

## 8.5 Workflow builder UI

Create a premium visual workflow builder.

It should support:

- Trigger selection.
- Condition configuration.
- Action configuration.
- Clear flow visualization.
- Reordering where valid.
- Workflow templates.
- Draft mode.
- Validation.
- Test mode.
- Activation and deactivation.
- Execution history.
- Error inspection.

Do not prioritize drag-and-drop visuals over reliable execution.

A clear structured builder is acceptable if it produces a better initial product.

## 8.6 Execution engine

The backend must support:

- Durable workflow execution.
- Idempotency.
- Retry policies.
- Failure states.
- Execution logs.
- Duplicate-event protection.
- Rate limiting.
- Concurrency controls.
- Versioned definitions.
- Timeouts.
- Loop prevention.
- Permission validation.
- Organization isolation.
- Safe scheduled execution.

Use the existing infrastructure where appropriate.

Do not assume database triggers alone are sufficient for complex asynchronous workflows.

Evaluate the need for a durable job queue or worker.

Do not introduce new infrastructure without documenting the tradeoffs.

## 8.7 Workflow templates

Create useful templates such as:

1. New lead → Assign owner → Create follow-up.
2. Unanswered lead → Alert owner → Escalate.
3. Qualified lead → Prepare opportunity.
4. Deal inactivity → Notify owner.
5. Deal enters proposal stage → Create proposal task.
6. Discount exceeds threshold → Request approval.
7. Deal won → Initiate delivery handoff.
8. Renewal approaching → Create renewal task.
9. Customer support escalation → Notify account owner.
10. Invoice overdue → Create collection follow-up.

Templates must be configurable.

Do not activate customer-facing communication without explicit configuration.

## 8.8 Automation observability

Provide an execution monitoring interface.

Show:

- Workflow.
- Trigger.
- Execution time.
- Status.
- Actions completed.
- Failure reason.
- Retry state.
- Related records.

Users must be able to understand what happened.

---

# PART 9 — CAPABILITY 6: COMMERCIAL HUB

Create a connected commercial workspace.

## 9.1 Quotations and proposals

Support:

- Quote creation.
- Proposal creation.
- Reusable templates.
- Line items.
- Products and services.
- Quantities.
- Unit prices.
- Discounts.
- Taxes.
- Currency.
- Validity dates.
- Customer details.
- Commercial notes.
- Version history.
- Approval status.

Use accurate calculations.

## 9.2 Commercial approvals

Support configurable approval requirements.

Examples:

- Discount exceeds allowed threshold.
- Nonstandard payment terms.
- Exceptional pricing.
- Contract changes.

Approvals must be auditable.

## 9.3 Contracts

Support:

- Contract records.
- Linked deals and accounts.
- Effective dates.
- Expiry dates.
- Renewal dates.
- Obligations.
- Attachments.
- Versions.
- Change history.
- Status.
- Ownership.

## 9.4 Electronic signatures

Design an integration-ready architecture.

Do not pretend electronic signatures are available without a configured provider.

Preserve provider evidence and acceptance metadata where legally and technically appropriate.

## 9.5 Commercial continuity

Accepted commercial terms should become the authoritative handoff information for downstream workflows.

Avoid re-entering the same data in Projects and Finance.

---

# PART 11 — CAPABILITY 8: REVENUE INTELLIGENCE

Build reliable commercial analytics.

Support:

- Pipeline value.
- Weighted forecast.
- Forecast categories.
- Deal conversion.
- Win rate.
- Average deal size.
- Sales cycle length.
- Stage duration.
- Deal aging.
- Pipeline coverage.
- Revenue concentration.
- Lead source performance.
- Sales activity performance.
- Win/loss analysis.
- Target attainment where supported.

## 11.1 Explainable forecasting

Forecasting assumptions must be visible.

Distinguish:

- Open pipeline.
- Probability-weighted pipeline.
- Committed opportunities.
- Won deal value.
- Invoiced revenue.
- Collected revenue.

These are different financial concepts.

Do not combine them into misleading totals.

## 11.2 Reporting experience

Provide:

- Date filters.
- Owner filters.
- Team filters.
- Pipeline filters.
- Stage filters.
- Source filters.
- Relevant saved views.
- Chart drill-downs.
- Appropriate exports.

Use server-side aggregation for large datasets.

---

# PART 12 — CAPABILITY 9: CUSTOMER SUCCESS AND RETENTION

Extend CRM beyond the initial sale.

Support:

- Customer onboarding.
- Account plans.
- Renewal calendars.
- Contract expiry alerts.
- Expansion opportunities.
- Cross-sell opportunities.
- Account reviews.
- Customer engagement history.
- Support issue visibility.
- Delivery status visibility.
- Retention reporting.

## 12.1 Explainable customer health

Create a transparent health model based on available evidence.

Potential factors:

- Unresolved priority support issues.
- Delayed delivery.
- Upcoming renewal.
- Overdue receivables.
- Lack of recent engagement.
- Missed account commitments.

Do not invent a mysterious AI score.

If a numeric score is introduced, document its inputs, weights, thresholds, and limitations.

## 12.2 Renewal management

Support recurring-service opportunities.

Track:

- Contract renewal date.
- Renewal owner.
- Renewal value.
- Renewal status.
- Reminder schedule.
- Related account.
- Required actions.

Prevent duplicate renewal opportunities from repeated automation events.

---

# PART 13 — CAPABILITY 10: RELATIONSHIP INTELLIGENCE

Build a connected relationship intelligence layer.

## 13.1 Relationship graph

Model relationships between:

- Companies.
- Contacts.
- Decision-makers.
- Leads.
- Deals.
- Projects.
- Contracts.
- Support cases.
- Relevant commercial activities.

Use existing relationships where possible.

Do not fabricate missing links.

## 13.2 Explainable relationship signals

Identify:

- Neglected leads.
- Stalled deals.
- Accounts without recent engagement.
- Missing decision-makers.
- Upcoming renewals.
- Accounts with unresolved issues.
- Expansion opportunities supported by recorded evidence.

Each recommendation must explain why it appeared.

## 13.3 Future AI capabilities

Prepare the architecture for optional advanced intelligence such as:

- Deal summaries.
- Account briefings.
- Suggested next actions.
- Natural-language CRM search.
- Meeting preparation.
- Relationship insights.

Do not make AI a prerequisite for core CRM operations.

Do not claim AI capabilities are implemented unless they genuinely work.

Any future AI feature must respect organization boundaries, permissions, data privacy, and evaluation requirements.

---

# PART 14 — CAPABILITY 11: DEAL-TO-DELIVERY ENGINE

THIS IS A FLAGSHIP NEXTMAV DIFFERENTIATOR.

When a deal is won, the business should not need to manually recreate customer information across multiple modules.

## 14.1 Structured handoff

Create a handoff containing:

- Customer account.
- Relevant contacts.
- Won deal.
- Agreed scope.
- Commercial value.
- Currency.
- Products or services.
- Deliverables.
- Timelines.
- Billing terms.
- Contract references.
- Delivery owner.
- Required approvals.

## 14.2 Handoff validation

Before execution, validate:

- Required customer information.
- Accepted commercial terms.
- Relevant approvals.
- Required delivery information.
- Required billing information.
- Organization configuration.
- User authorization.

If information is missing, create an actionable handoff review rather than silently creating incomplete records.

## 14.3 Downstream orchestration

Based on organization configuration and approved workflow rules:

- Prepare or create the appropriate project or service engagement.
- Associate the customer and deal.
- Preserve agreed deliverables.
- Assign delivery responsibility.
- Prepare the billing process.
- Associate relevant contracts.
- Prepare client portal access where supported.

Do not automatically issue invoices, grant external access, or send communications unless authorized by configured business rules.

## 14.4 Industry-aware behavior

Support configurable handoff templates.

Examples:

**Agency**
Deal won → Campaign or creative project → Deliverables → Client onboarding.

**Consulting**
Deal won → Engagement → Milestones → Assigned consultants → Billing schedule.

**IT services**
Deal won → Implementation or managed-service engagement → Delivery ownership → Support arrangement.

**Construction**
Deal won → Approved project handoff → Scope and milestones → Commercial schedule.

Do not hardcode four entirely separate CRM systems.

Use a shared core with industry-specific configurations.

## 14.5 Reliability

The handoff must be:

- Idempotent.
- Auditable.
- Recoverable.
- Permission-aware.
- Safe against duplicate creation.
- Clear about partial failures.
- Traceable to the originating deal.

Preserve source record identifiers across modules.

---

# PART 15 — CAPABILITY 12: ENTERPRISE TRUST, GOVERNANCE & CUSTOMIZATION

A premium CRM must be secure, configurable, and trustworthy.

## 15.1 Access control

Respect:

- Organization isolation.
- Role-based permissions.
- Record ownership.
- Account teams.
- Field visibility where supported.
- Administrative controls.
- Supabase RLS.

Do not expose confidential customer or commercial data.

## 15.2 Audit history

Track important changes such as:

- Ownership changes.
- Deal stage changes.
- Commercial approvals.
- Quote revisions.
- Contract changes.
- Automation changes.
- Record merges.
- Sensitive field updates.

## 15.3 Customization

Support appropriate configuration of:

- Custom fields.
- Pipelines.
- Stages.
- Qualification requirements.
- Lead assignment rules.
- Workflow templates.
- Saved views.
- Tags.
- Segments.
- Industry presets.

Avoid uncontrolled customization that compromises data integrity.

## 15.4 Data portability

Support safe:

- CSV imports.
- Import validation.
- Duplicate review.
- Exports.
- Error reporting.
- Import history.

Large imports should use reliable background processing where necessary.

## 15.5 Integration architecture

Use secure APIs and webhooks.

Support:

- Scoped credentials.
- Secret management.
- Authentication.
- Rate limits.
- Retry behavior.
- Idempotency.
- Audit logs.
- Webhook signature verification where applicable.

Do not expose integration secrets to the browser.

---

# PART 16 — CROSS-MODULE INTEGRATION RULES

NextMav CRM must integrate with the rest of BOS without becoming tightly coupled to unrelated implementation details.

Relevant modules include:

- Executive Overview.
- Projects.
- Finance.
- Support.
- HR where appropriate.
- Client Portal.
- Business API.
- Notifications and tasks.

Use stable record identifiers, documented service boundaries, and reliable events or APIs.

Prefer existing integration mechanisms.

Do not duplicate authoritative customer, invoice, or project records.

Clearly define which module owns each type of data.

CRM should not silently become the authoritative accounting system.

Finance should remain responsible for accounting and payment records.

Projects should remain responsible for project execution.

Support should remain responsible for service tickets.

CRM should provide a connected relationship view and coordinate authorized workflows.

---

# PART 17 — DATABASE, SECURITY & BACKEND ENGINEERING

Inspect the existing Supabase architecture before designing new tables.

Reuse existing schemas and functions where suitable.

For necessary extensions:

- Use well-designed relational models.
- Maintain referential integrity.
- Add appropriate indexes.
- Enforce organization isolation.
- Apply RLS policies.
- Validate business transitions.
- Preserve auditability.
- Avoid duplicate records.
- Handle concurrency.
- Support safe migrations.

Do not place privileged Supabase service credentials in the frontend.

Do not rely exclusively on frontend checks for business-critical permissions.

Test cross-tenant isolation and authorization failures.

---

# PART 18 — REAL-TIME EXPERIENCE

Where relevant, CRM should reflect changes automatically.

Examples:

- New lead arrives.
- Deal changes stage.
- Task is completed.
- Approval is granted.
- Automation finishes.
- Customer record is updated.

Reuse existing realtime infrastructure where suitable.

Prefer targeted cache invalidation and efficient subscriptions.

Handle reconnection, cleanup, stale data, and organization switching.

Do not introduce excessive polling or full-page reloads.

Provide subtle synchronization status where useful.

Do not falsely claim a view is live if it is only periodically refreshed.

---

# PART 19 — PERFORMANCE & RESPONSIVENESS

The CRM must remain fast as customer data grows.

Use:

- Server-side pagination.
- Efficient filtering.
- Indexed searches.
- Appropriate caching.
- Query optimization.
- Virtualized tables where justified.
- Debounced search.
- Efficient chart aggregation.
- Lazy loading for heavy secondary views.
- Appropriate background processing.

Support desktop, laptop, tablet, and mobile.

Optimize common sales workflows for minimal clicks and unnecessary navigation.

Ensure accessibility, keyboard navigation, focus visibility, and readable contrast.

---

# PART 20 — IMPLEMENTATION PHASES

Execute the transformation in the following order.

## PHASE 0 — Audit and preservation

Inspect the existing CRM.

Produce the capability matrix.

Identify gaps, risks, dependencies, and safe implementation boundaries.

## PHASE 1 — Premium CRM foundation

Improve:

- CRM Overview.
- Leads.
- Contacts.
- Companies.
- Deals.
- Activities.
- Search.
- Filtering.
- Record workspaces.
- Pipeline UI.
- Core CRM analytics.

Preserve existing business logic.

## PHASE 2 — Smart lead management

Implement or improve:

- Lead capture.
- Imports.
- Duplicate detection.
- Qualification.
- Assignment.
- Follow-up management.
- Lead conversion.
- Lead response intelligence.

## PHASE 3 — Automation Studio

Implement:

- Workflow data model.
- Trigger system.
- Condition evaluation.
- Action execution.
- Durable processing.
- Templates.
- Builder UI.
- Execution logs.
- Failure handling.
- Tests.

Do not move on until the core automation engine is reliable.

## PHASE 4 — Commercial Hub

Implement:

- Quotes.
- Proposals.
- Commercial approvals.
- Contract records.
- Version history.
- Renewal metadata.
- Appropriate integrations.

## PHASE 5 — Deal-to-Delivery

Implement the flagship won-deal handoff.

Connect CRM to supported Projects, Finance, Support, and Client Portal workflows.

Validate authorization, idempotency, and partial failure recovery.

## PHASE 6 — Customer intelligence

Implement:

- Customer 360.
- Unified timeline.
- Account planning.
- Customer success.
- Renewal workflows.
- Relationship intelligence.

## PHASE 7 — Advanced revenue intelligence

Implement:

- Forecasting.
- Conversion analytics.
- Sales velocity.
- Deal aging.
- Win/loss analysis.
- Targets where supported.
- Reporting and drill-downs.

## PHASE 8 — Enterprise refinement

Improve:

- Security.
- Permissions.
- Auditability.
- Customization.
- Performance.
- Accessibility.
- Responsive design.
- Visual consistency.
- Operational reliability.

---

# PART 21 — QUALITY ASSURANCE

Every phase must include appropriate verification.

Test:

1. Existing CRM functionality remains intact.
2. Leads can be created and managed.
3. Duplicate detection works.
4. Lead conversion preserves relationships.
5. Pipeline rules are enforced.
6. Deal stage history is accurate.
7. Automation triggers fire correctly.
8. Automation conditions evaluate correctly.
9. Automation actions execute safely.
10. Failed automation runs are observable.
11. Retries do not duplicate actions.
12. Commercial calculations are correct.
13. Approvals are enforced.
14. Deal-to-delivery handoffs are idempotent.
15. Customer 360 displays authorized records.
16. Financial information respects access rules.
17. Cross-organization data access is prevented.
18. Charts reflect real data.
19. Date filters produce accurate results.
20. Responsive layouts work.
21. Keyboard and accessibility behavior works.
22. Existing application navigation remains unchanged.
23. Unrelated modules remain functional.
24. Relevant tests, linting, type-checking, and builds pass.

Inspect the rendered UI using available browser tools.

Review screenshots at realistic viewport sizes.

Correct weak layouts, oversized cards, poor spacing, inconsistent colors, and unreadable charts.

Do not claim visual or functional verification that was not performed.

---

# PART 22 — DEFINITION OF DONE

A capability is not complete merely because its screen exists.

It is complete when:

- The interface works.
- The backend logic works.
- The database relationships are correct.
- Permissions are enforced.
- Business rules are validated.
- Errors are handled.
- Loading and empty states are implemented.
- Relevant integrations work.
- Tests pass.
- The UI is polished.
- The feature is documented.
- No existing functionality is broken.

Maintain a progress report with:

- Completed features.
- Improved existing features.
- New database changes.
- New APIs or functions.
- New integrations.
- Tests performed.
- Outstanding dependencies.
- Known limitations.
- Next implementation phase.

---

# FINAL EXECUTIVE DIRECTIVE

We are not building an ordinary CRM.

We are building **NextMav CRM — a premium Revenue & Relationship Operating System**.

It must manage the entire customer journey:

**Lead → Qualification → Opportunity → Proposal → Agreement → Delivery → Billing → Support → Renewal → Expansion.**

It must provide:

1. A world-class Revenue Command Centre.
2. Smart Lead Management.
3. Customer 360 and Account Intelligence.
4. Advanced Sales Pipelines.
5. A genuine Automation Studio.
6. A connected Commercial Hub.
8. Revenue Intelligence.
9. Customer Success and Retention.
10. Relationship Intelligence.
11. Deal-to-Delivery Automation.
12. Enterprise Trust, Governance, and Customization.

These twelve capabilities must work as one cohesive system.

**Automation must be real, reliable, configurable, secure, and observable.**

The interface must be visually exceptional, sharp, elegant, fast, and comfortable.

The customer should not have to enter the same information repeatedly.

The CRM should actively help users understand their customers, identify opportunities, complete follow-ups, close deals, and coordinate delivery.

Do not remove existing working functionality.

Do not rebuild the platform.

Do not change the established main navigation.

Do not introduce superficial features.

Do not use fabricated data.

Do not sacrifice engineering quality for visual appearance.

Start by auditing the existing codebase, preserve what works, identify what is missing, and systematically implement this complete product vision through controlled phases.

**The objective is not merely to match competing CRMs in feature count. It is to create a more connected, intuitive, automated, and commercially valuable customer relationship experience.**

Build with the discipline, quality, and architectural foresight required for a globally competitive enterprise SaaS product.