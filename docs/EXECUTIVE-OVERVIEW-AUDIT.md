# Executive Overview audit and implementation contract

Scope: dashboard route, dashboard components and isolated styles only. Preserve existing working-tree changes, navigation, authentication, RLS and other module workflows. No migration is required for this increment.

| Capability | Classification | Source and definition |
|---|---|---|
| Actual collections | Derivable | payments.amount by paid_at in organization timezone, linked invoice currency; existing monthly view incorrectly uses paid invoice totals by issue_date |
| Issued revenue | Derivable | invoices.total excluding draft/cancelled/deleted; issue_date; organization currency only |
| Expense trends/categories | Derivable | approved/reimbursed expenses by expense_date; this is approved cost, not bank cash outflow |
| Receivables aging | Available | invoices total minus amount_paid; positive balances, non-draft/non-cancelled; local due date |
| Sales pipeline | Available | scoped deals and v_pipeline_summary; pipeline is not revenue; no stage history in dashboard |
| Project health | Available | v_project_health deterministic deadlines, task/milestone counts; existing eight-row sample must not claim full population |
| Delivery history | Available | task completed_at; weekly counts, not productivity or utilization |
| Support | Available | ticket status, priority, due_at, resolved_at; missing deadline is not SLA compliance |
| Workforce | Available | authorized aggregate headcount/departments; confidential individual performance excluded |
| Personal actions | Available | assignee_id = current member; existing record-opening routes |
| Business exceptions | Available | existing deduplicated deterministic attention builder; role-gated actions |
| Briefing | Derivable | explicit current snapshot and completed-month comparisons; no LLM |
| Cash forecast | Requires new functionality | obligation schedule, collection assumptions and forecast methodology |
| Goals / target scorecard | Requires new functionality | validated targets, ownership and period semantics |
| Capacity / utilization | Requires new functionality | reliable working schedules and allocations |
| Historical pipeline/backlog/customer health | Requires new functionality | event history and transparent methodology |
| Shared saved views | Requires new functionality | dashboard preference persistence; browser financial range preference is sufficient initially |

Infrastructure: Recharts 2, existing shared readout primitives, single dashboard fetch with throttled realtime and fallback polling. Currency formatting is configured by app-store from organization settings. authorize, can, scopeFor and security_invoker views remain the access boundary. No privileged client credentials.

Reliability: existing route silently turns most query errors into zero; new availability messages must distinguish failure/incomplete results from empty data. Bounded reads with exact counts must suppress incomplete aggregates. High-volume server-side RPC aggregation is a separate documented backend phase; never silently truncate totals.

Period contract: financial range selects calendar months, including an explicitly marked partial current month. Operational balances, pipeline and alerts are current snapshots and are labeled separately. Comparisons use complete adjacent months only; zero baseline means no percentage. Module navigation does not promise a date filter that destination modules do not implement.

## Verification results

- Finance regression tests: payment timestamps in organization timezone, partial payments, mixed-currency exclusion, draft exclusion, missing months, aging boundary days, fully settled balances and camelCase response contract passed.
- Existing dashboard attention suite: 21 passed; existing navigation suite: 44 passed.
- Scoped dashboard ESLint and TypeScript checks passed.
- Production build and final refinement build passed; output is recorded in `.design-review/command-final-build.log`.
- Repository-wide lint (excluding generated Next/visual-review artifacts) reports 34 existing errors and 5 warnings outside this change, principally bundled `.claude` skill files and `scripts/public-product-tour.test.tsx`. These unrelated files were not changed.
- Rendered actual dashboard components in a clearly labeled synthetic visual harness at 1440px and 390px. Checked reporting-window totals, chart labels, accessible service table, and mobile page width (390px viewport, 390px document). Harness stubs realtime only; no fake data enters production components or APIs.
- Live authenticated database integration, tenant-switching and RLS tests were not completed. Server access controls and explicit organization filters were inspected and retained; this does not substitute for live verification.
- Final diff inspected; shell/navigation/shared styling, database migrations and unrelated workflows were not edited by this change. Existing user modifications remain present.

## Deferred implementation

Server-side, currency-aware reporting RPCs should replace the bounded reads before serving high-volume tenants. Exact counts currently detect truncated results and withhold affected sections instead of publishing incomplete totals. Finance reads are capped at 1,000 records per source; invoices include historical records for current receivables. Reporting supports the configured organization currency only, with no invented FX conversion. Arbitrary day ranges, shared saved views, historical customer-health signals, target scorecards and cash forecasts remain separate work.

