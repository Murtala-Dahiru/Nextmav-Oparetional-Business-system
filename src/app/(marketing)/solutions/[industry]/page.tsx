import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import {
  Container,
  Section,
  Eyebrow,
  buttonClass,
} from "@/components/public/ui";
import { INDUSTRIES } from "@/components/marketing/industry-data";
import { CAPABILITIES } from "@/components/marketing/capabilities";
import { IndustryBrief } from "@/components/marketing/industry-brief";
import { IndustryPhotography } from "@/components/marketing/industry-photography";
import { ProductPreview } from "@/components/marketing/product-preview";

export function generateStaticParams() {
  return INDUSTRIES.map(({ slug }) => ({ industry: slug }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ industry: string }>;
}): Promise<Metadata> {
  const { industry } = await params;
  const item = INDUSTRIES.find((i) => i.slug === industry);
  return {
    title: `${item?.name ?? "Solutions"} — NextMav`,
    description: item?.description,
  };
}
export default async function IndustryPage({
  params,
}: {
  params: Promise<{ industry: string }>;
}) {
  const { industry } = await params;
  const item = INDUSTRIES.find((i) => i.slug === industry);
  if (!item) notFound();
  return (
    <>
      <section
        className={`nm-page-hero nm-industry-hero nm-industry-${industry}`}
      >
        <Container>
          <div className="nm-industry-hero-grid">
            <div>
              <Link className="nm-arrow-link" href="/solutions">
                All solutions <ArrowRight size={14} />
              </Link>
              <Eyebrow>{item.name}</Eyebrow>
              <h1 className="nm-page-hero-title">{item.headline}</h1>
              <p className="nm-page-hero-sub">{item.description}</p>
              <div className="nm-page-hero-actions">
                <Link href="/signup" className={buttonClass("primary", "lg")}>
                  Create a workspace <ArrowRight size={16} />
                </Link>
                <Link
                  href="/features"
                  className={buttonClass("secondary", "lg")}
                >
                  Explore the product
                </Link>
              </div>
            </div>
            <IndustryBrief industry={industry} />
          </div>
        </Container>
      </section>
      <Section className={`nm-industry-story nm-industry-story-${industry}`}>
        <Container>
          <div
            className={
              industry === "other-businesses" ? "" : "nm-industry-story-grid"
            }
          >
            <IndustryPhotography industry={industry} />
            <div className="nm-editorial-heading">
              <div>
                <Eyebrow>The everyday challenge</Eyebrow>
                <h2 className="nm-heading-lg">
                  Less context lost.
                  <br />
                  <span className="nm-serif">More work connected.</span>
                </h2>
              </div>
              <p className="nm-lead">{item.challenge}</p>
            </div>
          </div>
          <ol className="nm-workflow">
            {item.workflow.map((step, i) => (
              <li key={step}>
                <span className="nm-mono">0{i + 1}</span>
                <h3>{step}</h3>
              </li>
            ))}
          </ol>
        </Container>
      </Section>
      <Section className="nm-connected-work">
        <Container>
          <div className="nm-editorial-heading">
            <div>
              <Eyebrow>Available foundations</Eyebrow>
              <h2 className="nm-heading-lg">
                The tools behind
                <br />
                <span className="nm-serif">the work.</span>
              </h2>
            </div>
            <p className="nm-lead">
              Use existing capabilities with your own processes. The sequence
              above describes how a team can organize its work, not automatic
              provisioning or handoffs.
            </p>
          </div>
          <div className="nm-industry-capabilities">
            {CAPABILITIES.filter((c) =>
              item.capabilities.some((id) => id === c.id),
            ).map((c) => (
              <Link key={c.id} href={`/features#${c.id}`}>
                <c.icon size={22} />
                <h3>{c.name}</h3>
                <p>{c.summary}</p>
                <span className="nm-arrow-link">
                  Explore capability <ArrowRight size={14} />
                </span>
              </Link>
            ))}
          </div>
        </Container>
      </Section>
      <Section>
        <Container>
          <ProductPreview
            initialView={
              industry === "technology"
                ? "support"
                : industry === "consulting"
                  ? "finance"
                  : "projects"
            }
          />
          <aside className="nm-roadmap-note">
            <Eyebrow>What comes next</Eyebrow>
            <h2 className="nm-heading">Industry configuration is planned.</h2>
            <p>
              {item.planned} Today, signup and onboarding create the existing
              workspace. They do not select or provision an industry
              configuration.
            </p>
          </aside>
        </Container>
      </Section>
    </>
  );
}
