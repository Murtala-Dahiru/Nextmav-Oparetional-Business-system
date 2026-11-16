import { ArrowDown, Check } from "lucide-react";

const BRIEFS: Record<
  string,
  { label: string; title: string; items: string[]; note: string }
> = {
  agencies: {
    label: "The client delivery loop",
    title: "From brief to handover.",
    items: [
      "Keep the relationship in CRM",
      "Give delivery a shared project",
      "Discuss work in team channels",
      "Keep invoicing with the customer",
    ],
    note: "Organize the work around each client relationship.",
  },
  consulting: {
    label: "The engagement record",
    title: "A clear account of the work.",
    items: [
      "Customer & engagement context",
      "Milestones & assigned tasks",
      "Time entries & expense records",
      "Customer invoices & payments",
    ],
    note: "Track delivery and commercial records in the same platform.",
  },
  technology: {
    label: "Delivery meets support",
    title: "Keep the relationship visible.",
    items: [
      "Customer records",
      "Delivery projects",
      "Support requests",
      "Customer ticket access",
    ],
    note: "Support continues after a project. Keep the customer context close.",
  },
  construction: {
    label: "Project administration",
    title: "Coordinate beyond the site.",
    items: [
      "Project tasks & responsibilities",
      "Suppliers & purchase orders",
      "Expense records",
      "People & team coordination",
    ],
    note: "For project administration. Specialized site tools are not included.",
  },
  "other-businesses": {
    label: "Your starting point",
    title: "Start where the work is.",
    items: [
      "Organize customer records",
      "Create a shared project",
      "Bring your team together",
      "Track everyday operations",
    ],
    note: "Use the existing capabilities that fit your processes.",
  },
};
export function IndustryBrief({ industry }: { industry: string }) {
  const brief = BRIEFS[industry];
  return (
    <aside
      className={`nm-industry-brief ${industry === "construction" ? "nm-industry-brief-ledger" : ""}`}
      aria-label={brief.label}
    >
      <span className="nm-mono">{brief.label}</span>
      <h2>{brief.title}</h2>
      <ol>
        {brief.items.map((item, i) => (
          <li key={item}>
            <span>
              {industry === "consulting" ? (
                <Check size={14} />
              ) : (
                String(i + 1).padStart(2, "0")
              )}
            </span>
            <p>{item}</p>
            {industry === "agencies" && i < 3 && <ArrowDown size={13} />}
          </li>
        ))}
      </ol>
      <p>{brief.note}</p>
    </aside>
  );
}
