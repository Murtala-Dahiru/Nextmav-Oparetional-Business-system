import {
  LayoutDashboard,
  Users,
  FolderKanban,
  UserRound,
  Target,
  Wallet,
  Boxes,
  LifeBuoy,
  MessagesSquare,
  Files,
  CalendarDays,
  PanelTop,
  type LucideIcon,
} from "lucide-react";

export type TourKey =
  | "dashboard"
  | "crm"
  | "projects"
  | "people"
  | "performance"
  | "finance"
  | "inventory"
  | "support"
  | "communication"
  | "workspace"
  | "calendar"
  | "portal";
export type TourModule = {
  label: string;
  icon: LucideIcon;
  title: string;
  description: string;
  anchor: string;
  kind:
    | "overview"
    | "board"
    | "table"
    | "conversation"
    | "library"
    | "calendar"
    | "portal";
  columns: [string, string, string];
  rows: [string, string, string][];
  features: [string, string, string];
  context: string;
};

// Synthetic examples only. Capabilities checked against the corresponding
// src/components/modules implementation; no application imports or API calls.
export const TOUR: Record<TourKey, TourModule> = {
  dashboard: {
    label: "Executive dashboard",
    icon: LayoutDashboard,
    anchor: "dashboards",
    kind: "overview",
    title: "See the business. Know where to look.",
    description:
      "Bring financial performance, delivery health and operational attention into one view.",
    columns: ["Attention", "Source", "Next step"],
    rows: [
      ["Invoice awaiting payment", "Finance", "Review receivables"],
      ["Milestone approaching", "Projects", "Review delivery"],
      ["Stock below threshold", "Inventory", "Review stock"],
    ],
    features: [
      "Financial performance",
      "Project health",
      "Operational attention",
    ],
    context:
      "The executive view draws on the modules your role can access. This example shows attention areas without fabricated business results.",
  },
  crm: {
    label: "CRM & sales",
    icon: Users,
    anchor: "crm",
    kind: "board",
    title: "Give every relationship a clear next step.",
    description:
      "Manage leads, customer records and opportunities through your sales pipeline.",
    columns: ["Discovery", "Proposal", "Negotiation"],
    rows: [
      ["Website engagement", "Example company A", "Discovery"],
      ["Service agreement", "Example company B", "Proposal"],
      ["Support retainer", "Example company C", "Negotiation"],
    ],
    features: [
      "Leads & contacts",
      "Configurable deal stages",
      "Customer activity",
    ],
    context:
      "Keep the contact, company and activity history close to each opportunity. Pipeline names shown here are examples.",
  },
  projects: {
    label: "Projects & tasks",
    icon: FolderKanban,
    anchor: "projects",
    kind: "table",
    title: "Every task. In context.",
    description:
      "Connect assigned work, milestones and time entries to the project they support.",
    columns: ["Task", "Project", "Status"],
    rows: [
      ["Confirm project scope", "Website launch", "Done"],
      ["Review design direction", "Website launch", "In progress"],
      ["Prepare delivery checklist", "Client onboarding", "To do"],
      ["Document handover notes", "Client onboarding", "To do"],
    ],
    features: ["Boards & tasks", "Project milestones", "Time entries"],
    context:
      "Keep delivery visible across the team, with comments and attachments alongside the work.",
  },
  people: {
    label: "HR & people",
    icon: UserRound,
    anchor: "people",
    kind: "table",
    title: "A shared foundation for your people.",
    description:
      "Organize employee records, departments, reporting lines and everyday HR requests.",
    columns: ["Example employee", "Department", "Status"],
    rows: [
      ["Team member A", "Operations", "Active"],
      ["Team member B", "Delivery", "Active"],
      ["Team member C", "Customer success", "Active"],
      ["Team member D", "Finance", "Active"],
    ],
    features: ["Employee directory", "Leave & approvals", "Attendance"],
    context:
      "Employee names are deliberately anonymized. Access to people records follows the platform’s existing permissions.",
  },
  performance: {
    label: "Performance",
    icon: Target,
    anchor: "performance",
    kind: "table",
    title: "Connect contribution with expectations.",
    description:
      "Review individual and team performance, targets, earnings and commission rules.",
    columns: ["Target metric", "Scope", "Period"],
    rows: [
      ["Revenue won", "Sales team", "Quarter"],
      ["Deals won", "Team member A", "Month"],
      ["Leads qualified", "Sales team", "Month"],
      ["Activities logged", "Team member B", "Month"],
    ],
    features: [
      "Individual & team views",
      "Targets by period",
      "Earnings & rules",
    ],
    context:
      "Targets are set against defined metrics and periods. This preview omits amounts and attainment rather than suggesting actual performance.",
  },
  finance: {
    label: "Finance & invoices",
    icon: Wallet,
    anchor: "finance",
    kind: "table",
    title: "The record behind the work.",
    description:
      "Keep invoices, customer context, expenses and recorded payments together.",
    columns: ["Invoice", "Customer", "Status"],
    rows: [
      ["Project kickoff", "Example customer A", "Draft"],
      ["Delivery invoice", "Example customer A", "Sent"],
      ["Support invoice", "Example customer B", "Paid"],
      ["Monthly services", "Example customer B", "Draft"],
    ],
    features: [
      "Invoices & line items",
      "Payment tracking",
      "Expenses & approvals",
    ],
    context:
      "Follow the commercial record from the customer to the work. Example records do not represent financial results.",
  },
  inventory: {
    label: "Inventory",
    icon: Boxes,
    anchor: "inventory",
    kind: "table",
    title: "Keep stock and purchasing in view.",
    description:
      "Track products, warehouse stock, movements, suppliers and purchase orders.",
    columns: ["Example product", "Warehouse", "Stock signal"],
    rows: [
      ["Packaging supplies", "Main warehouse", "In stock"],
      ["Office equipment", "Main warehouse", "Low stock"],
      ["Replacement parts", "Service store", "In stock"],
      ["Installation materials", "Service store", "In stock"],
    ],
    features: ["Warehouse stock", "Movement history", "Suppliers & orders"],
    context:
      "Use stock thresholds to identify items needing attention. Product names and stock signals here are illustrative.",
  },
  support: {
    label: "Customer support",
    icon: LifeBuoy,
    anchor: "support",
    kind: "table",
    title: "Give every request a place to go.",
    description:
      "Keep tickets organized by customer, owner, priority and status.",
    columns: ["Request", "Customer", "Status"],
    rows: [
      ["Getting started question", "Example customer A", "Open"],
      ["Workspace access", "Example customer B", "In progress"],
      ["Project handover", "Example customer A", "Open"],
      ["Account setup guidance", "Example customer B", "Resolved"],
    ],
    features: [
      "Ticket ownership",
      "Priority & response targets",
      "Customer context",
    ],
    context:
      "Keep the customer relationship visible beyond a single project, with a shared record of the request.",
  },
  communication: {
    label: "Team communication",
    icon: MessagesSquare,
    anchor: "communication",
    kind: "conversation",
    title: "Keep the conversation with the team.",
    description:
      "Bring channels, direct messages and shared files into the workspace.",
    columns: ["Person", "Message", "Channel"],
    rows: [
      [
        "Team member A",
        "The delivery checklist is ready for review.",
        "project-delivery",
      ],
      [
        "Team member B",
        "I’ve added the handover notes to our shared files.",
        "project-delivery",
      ],
      [
        "Team member C",
        "Thanks. We can review them in the team meeting.",
        "project-delivery",
      ],
    ],
    features: ["Team channels", "Direct messages", "Files & meetings"],
    context:
      "An illustrative team conversation. Messages and files follow the organization’s access and retention policies.",
  },
  workspace: {
    label: "Workspace & documents",
    icon: Files,
    anchor: "workspace",
    kind: "library",
    title: "Give shared knowledge a home.",
    description:
      "Organize documents, sheets and templates in a shared workspace library.",
    columns: ["Document", "Type", "Visibility"],
    rows: [
      ["Delivery playbook", "Document", "Organization"],
      ["Project checklist", "Sheet", "Department"],
      ["Team handbook", "Document", "Organization"],
      ["Engagement brief", "Template", "Private"],
    ],
    features: [
      "Documents & sheets",
      "Folders & templates",
      "Sharing permissions",
    ],
    context:
      "Workspace supports a library of pages, folders and templates. This does not imply a separate compliance document-management suite.",
  },
  calendar: {
    label: "Calendar",
    icon: CalendarDays,
    anchor: "calendar",
    kind: "calendar",
    title: "Make time for the work ahead.",
    description:
      "Organize events with start and end times, locations and all-day scheduling.",
    columns: ["Event", "Example time", "Location"],
    rows: [
      ["Delivery review", "09:00–09:30", "Meeting room"],
      ["Team planning", "11:00–12:00", "Office"],
      ["Customer check-in", "14:00–14:30", "Online"],
    ],
    features: ["Monthly calendar", "Timed & all-day events", "Event locations"],
    context:
      "A sample day in the calendar. Events shown here are illustrative; no external calendar synchronization is implied.",
  },
  portal: {
    label: "Client portal",
    icon: PanelTop,
    anchor: "support",
    kind: "portal",
    title: "A clearer view for your customers.",
    description:
      "Give clients access to their own projects, deliverables, invoices and support.",
    columns: ["Milestone", "Project", "Status"],
    rows: [
      ["Discovery & scope", "Example engagement", "Complete"],
      ["Design review", "Example engagement", "In progress"],
      ["Delivery & handover", "Example engagement", "Upcoming"],
    ],
    features: [
      "Project visibility",
      "Deliverables & invoices",
      "Customer requests",
    ],
    context:
      "A customer-facing view of their engagement, without internal task boards, budgets or other customers’ records.",
  },
};

export const TOUR_GROUPS: { label: string; keys: TourKey[] }[] = [
  {
    label: "Business overview",
    keys: ["dashboard", "performance", "calendar"],
  },
  { label: "Customers & sales", keys: ["crm", "support", "portal"] },
  { label: "Operations", keys: ["projects", "finance", "inventory"] },
  {
    label: "People & knowledge",
    keys: ["people", "communication", "workspace"],
  },
];
