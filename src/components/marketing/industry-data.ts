export const INDUSTRIES = [
  {
    slug: "agencies",
    name: "Agencies & creative firms",
    headline: "Keep the client relationship connected to the work.",
    description:
      "Manage client records, project delivery, team conversations and invoices in one workspace.",
    challenge:
      "Briefs, deadlines and billing often live in different tools. Bringing the records together helps your team keep the context as work changes hands.",
    capabilities: ["crm", "projects", "finance", "communication"],
    workflow: ["Client record", "Project board", "Team channel", "Invoice"],
    planned:
      "Agency presets, campaign templates and automatic industry configuration are planned.",
  },
  {
    slug: "consulting",
    name: "Consulting & professional services",
    headline: "Give every engagement a shared operational record.",
    description:
      "Connect customer relationships, project milestones, time entries and expenses.",
    challenge:
      "An engagement needs a clear owner, a delivery plan and a record of the work. Keep these visible without rebuilding the same context in every department.",
    capabilities: ["crm", "projects", "people", "finance"],
    workflow: ["Customer", "Engagement project", "Time entries", "Invoice"],
    planned:
      "Consulting presets and specialized engagement templates are planned. Automated time-to-invoice billing is not included.",
  },
  {
    slug: "technology",
    name: "IT & technology services",
    headline: "Connect delivery with the people you support.",
    description:
      "Track projects, customer support tickets, team discussions and customer records together.",
    challenge:
      "Delivery and support should be able to refer to the same customer. Shared records keep the relationship visible beyond a single project or ticket.",
    capabilities: ["projects", "support", "communication", "crm"],
    workflow: [
      "Customer",
      "Delivery project",
      "Support ticket",
      "Client portal",
    ],
    planned:
      "IT service presets are planned. Specialized IT asset management and managed-service billing are not available.",
  },
  {
    slug: "construction",
    name: "Construction & engineering",
    headline: "Bring project administration into one workspace.",
    description:
      "Use project tasks, suppliers, purchase orders and expenses to organize the administrative side of delivery.",
    challenge:
      "Project coordination involves people, purchases and deadlines. Shared records make that administration easier to follow across the team.",
    capabilities: ["projects", "inventory", "finance", "people"],
    workflow: ["Project", "Assigned tasks", "Purchase order", "Expense record"],
    planned:
      "Construction presets are planned. BIM, quantity surveying, site inspections and specialized construction accounting are not available.",
  },
  {
    slug: "other-businesses",
    name: "Other businesses",
    headline: "Start with the work your team needs to organize.",
    description:
      "Bring customers, projects, people and everyday operations onto a shared platform.",
    challenge:
      "You do not need an industry-specific setup to organize everyday work. Begin with existing capabilities and decide where they fit your processes.",
    capabilities: [
      "crm",
      "projects",
      "people",
      "finance",
      "inventory",
      "support",
    ],
    workflow: [
      "Customer",
      "Work assignment",
      "Team collaboration",
      "Business record",
    ],
    planned:
      "Additional industry presets and automatic module configuration are planned. Current onboarding creates a workspace by name.",
  },
] as const;
