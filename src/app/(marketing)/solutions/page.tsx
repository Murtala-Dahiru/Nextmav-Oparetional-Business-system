import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  Users,
  FolderKanban,
  Wallet,
  ShieldCheck,
} from "lucide-react";
import {
  Container,
  Section,
  Eyebrow,
  buttonClass,
} from "@/components/public/ui";
import { IndustrySection } from "@/components/marketing/industry-section";

export const metadata: Metadata = {
  title: "Solutions — NextMav",
  description:
    "Explore how NextMav supports agencies, consulting firms, technology services, construction teams and everyday business operations.",
};
const roles = [
  {
    icon: FolderKanban,
    title: "For the people delivering the work",
    body: "Keep tasks, milestones and time entries with the project. Give delivery teams a shared view of what is next.",
    link: "projects",
    label: "Projects & delivery",
  },
  {
    icon: Wallet,
    title: "For the people tracking the money",
    body: "Bring invoices, payments and expenses into the same platform as customer and project records.",
    link: "finance",
    label: "Finance & spend",
  },
  {
    icon: Users,
    title: "For the people supporting the team",
    body: "Organize employee profiles, departments, leave and attendance around your organization structure.",
    link: "people",
    label: "People & HR",
  },
  {
    icon: ShieldCheck,
    title: "For the people managing access",
    body: "Use roles, departments and organization membership to define who can see and act on business records.",
    link: "identity",
    label: "Identity & access",
  },
];
export default function SolutionsPage() {
  return (
    <>
      <section className="nm-page-hero nm-solutions-intro">
        <Container>
          <Eyebrow>Solutions</Eyebrow>
          <div className="nm-solutions-intro-grid">
            <h1 className="nm-page-hero-title">
              Different businesses.
              <br />
              <span className="nm-serif">Connected ways of working.</span>
            </h1>
            <div>
              <p className="nm-page-hero-sub">
                Choose a starting point around the work your team does. Explore
                practical uses of the existing platform, with a clear
                distinction between available capabilities and what is planned.
              </p>
              <Link href="#industries" className="nm-arrow-link">
                Find your business <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </Container>
      </section>
      <IndustrySection />
      <Section className="nm-solutions-roles" aria-labelledby="roles">
        <Container>
          <div className="nm-editorial-heading">
            <div>
              <Eyebrow>Shared work. Different responsibilities.</Eyebrow>
              <h2 className="nm-heading-lg" id="roles">
                Everyone has a role.
                <br />
                Everyone needs context.
              </h2>
            </div>
            <p className="nm-lead">
              A shared platform does not mean everyone sees everything. Access
              follows the organization, while related work stays connected.
            </p>
          </div>
          <div className="nm-solution-role-list">
            {roles.map((r) => (
              <Link key={r.link} href={`/features#${r.link}`}>
                <r.icon size={24} />
                <div>
                  <h3>{r.title}</h3>
                  <p>{r.body}</p>
                  <span>
                    {r.label} <ArrowRight size={15} />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </Container>
      </Section>
      <section className="nm-next-step">
        <Container>
          <Eyebrow>Start with the essentials</Eyebrow>
          <div>
            <h2>
              Your team. Your work.
              <br />
              One shared starting point.
            </h2>
            <Link href="/signup" className={buttonClass("primary", "lg")}>
              Create a workspace <ArrowRight size={16} />
            </Link>
          </div>
          <p>
            Standard workspace setup is available today. Industry configuration
            is planned.
          </p>
        </Container>
      </section>
    </>
  );
}
