import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  ArrowUpRight,
  ShieldCheck,
  Network,
  History,
  Users,
  FolderKanban,
  Wallet,
  Package,
  MessagesSquare,
  LifeBuoy,
} from "lucide-react";
import {
  Container,
  Section,
  Eyebrow,
  buttonClass,
} from "@/components/public/ui";
import { ProductPreview } from "@/components/marketing/product-preview";
import { IndustrySection } from "@/components/marketing/industry-section";
import { ConnectedWork } from "@/components/marketing/connected-work";

export const metadata: Metadata = {
  title: "NextMav — The Business Operating System",
  description:
    "Bring customers, projects, people and finance into one connected workspace. NextMav is the Business Operating System for clearer everyday operations.",
};
const modules = [
  {
    icon: Users,
    name: "Customers & relationships",
    text: "Contacts, companies and your sales pipeline, with context that stays with the customer.",
    id: "crm",
  },
  {
    icon: FolderKanban,
    name: "Projects & delivery",
    text: "Tasks, milestones and time entries. A shared view of what needs to happen next.",
    id: "projects",
  },
  {
    icon: Wallet,
    name: "Finance & spend",
    text: "Invoices, payments and expenses, connected to the work behind them.",
    id: "finance",
  },
  {
    icon: Package,
    name: "Inventory & supply",
    text: "Stock, suppliers and purchase orders in the same operational workspace.",
    id: "inventory",
  },
  {
    icon: MessagesSquare,
    name: "Team communication",
    text: "Channels and conversations around your projects, customers and departments.",
    id: "communication",
  },
  {
    icon: LifeBuoy,
    name: "Support & client portal",
    text: "Keep customer requests visible and give clients access to their own tickets.",
    id: "support",
  },
];
export default function LandingPage() {
  return (
    <>
      <section className="nm-flagship" aria-labelledby="home-title">
        <Container>
          <div className="nm-flagship-intro">
            <div>
              <Eyebrow>The Business Operating System</Eyebrow>
              <h1 id="home-title">
                Your business.
                <br />
                Working <span>together.</span>
              </h1>
            </div>
            <div className="nm-flagship-copy">
              <p>
                Customers, projects, people and finance. One connected workspace
                for the work that keeps your business moving.
              </p>
              <div className="nm-flagship-actions">
                <Link href="/signup" className={buttonClass("primary", "lg")}>
                  Get started <ArrowRight size={17} />
                </Link>
                <Link href="/features" className="nm-flagship-link">
                  Explore the platform <ArrowUpRight size={17} />
                </Link>
              </div>
              <span className="nm-flagship-note">
                Shared records. Clear ownership. Connected teams.
              </span>
            </div>
          </div>
          <ProductPreview />
          <div className="nm-flagship-baseline">
            <span>ONE WORKSPACE. A SHARED FOUNDATION.</span>
            <span>Customers / Delivery / People / Operations</span>
          </div>
        </Container>
      </section>
      <Section className="nm-module-section" aria-labelledby="capabilities">
        <Container>
          <div className="nm-editorial-heading">
            <div>
              <Eyebrow>Work in context</Eyebrow>
              <h2 id="capabilities" className="nm-heading-lg">
                A clearer picture.
                <br />
                At every level.
              </h2>
            </div>
            <p className="nm-lead">
              The customer relationship. The work you promised. The people
              delivering it. Bring the records together so every team has the
              context to move forward.
            </p>
          </div>
          <div className="nm-module-index">
            {modules.map((m, i) => (
              <Link key={m.id} href={`/features#${m.id}`}>
                <span className="nm-module-number">0{i + 1}</span>
                <m.icon size={23} strokeWidth={1.5} />
                <h3>{m.name}</h3>
                <p>{m.text}</p>
                <ArrowUpRight size={18} className="nm-module-arrow" />
              </Link>
            ))}
          </div>
          <Link className="nm-arrow-link" href="/features">
            Explore all capabilities and availability <ArrowRight size={16} />
          </Link>
        </Container>
      </Section>
      <ConnectedWork />
      <IndustrySection />
      <Section className="nm-assurance" aria-labelledby="trust">
        <Container>
          <div className="nm-assurance-grid">
            <div>
              <Eyebrow>A considered foundation</Eyebrow>
              <h2 id="trust" className="nm-heading-lg">
                Your operations deserve
                <br />
                more than another tool.
              </h2>
              <p className="nm-lead">
                Connected work needs clear boundaries. NextMav brings
                organization structure, access and record history into the
                foundation of the platform.
              </p>
              <Link className="nm-arrow-link" href="/features#architecture">
                Explore the architecture <ArrowRight size={16} />
              </Link>
            </div>
            <div className="nm-assurance-list">
              {[
                {
                  icon: Network,
                  title: "One organization, shared context",
                  body: "Related business records live in the same platform, with access scoped to your organization.",
                },
                {
                  icon: ShieldCheck,
                  title: "Access with intention",
                  body: "Roles and departments determine what each person can see and do, with checks enforced beyond the interface.",
                },
                {
                  icon: History,
                  title: "Decisions with a record",
                  body: "Approvals and activity stay attached to the work, so your team can follow what happened.",
                },
              ].map((x) => (
                <div key={x.title}>
                  <x.icon size={22} />
                  <div>
                    <h3>{x.title}</h3>
                    <p>{x.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </Section>
      <section className="nm-next-step">
        <Container>
          <Eyebrow>Start with the work in front of you</Eyebrow>
          <div>
            <h2>
              A more connected business
              <br />
              starts here.
            </h2>
            <Link href="/signup" className={buttonClass("primary", "lg")}>
              Create your workspace <ArrowRight size={17} />
            </Link>
          </div>
          <p>
            Explore what is available today. Bring your team together at your
            own pace.
          </p>
        </Container>
      </section>
    </>
  );
}
