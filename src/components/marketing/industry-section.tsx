import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { Container, Section, Eyebrow } from "@/components/public/ui";
import { INDUSTRIES } from "./industry-data";

export function IndustrySection() {
  return (
    <Section className="nm-industries" aria-labelledby="industries">
      <Container>
        <div className="nm-editorial-heading">
          <div>
            <Eyebrow>Different businesses. Shared foundations.</Eyebrow>
            <h2 id="industries" className="nm-heading-lg">
              Your business has its own rhythm.
              <br />
              <span className="nm-serif">Your tools should keep up.</span>
            </h2>
          </div>
          <p className="nm-lead">
            Explore how the existing platform can support your work. Industry
            presets and automatic configuration are planned, and are not part of
            today’s onboarding.
          </p>
        </div>
        <div className="nm-industry-list">
          {INDUSTRIES.map((industry, i) => (
            <Link
              key={industry.slug}
              href={`/solutions/${industry.slug}`}
              className="nm-industry-row"
            >
              <span className="nm-mono nm-industry-number">0{i + 1}</span>
              <h3>
                {industry.slug !== "other-businesses" && (
                  <Image
                    className="nm-industry-row-image"
                    src={`/images/industries/${industry.slug}.webp`}
                    alt=""
                    width={112}
                    height={76}
                    sizes="112px"
                  />
                )}
                {industry.name}
              </h3>
              <p>{industry.description}</p>
              <ArrowUpRight size={22} aria-hidden="true" />
            </Link>
          ))}
        </div>
      </Container>
    </Section>
  );
}
