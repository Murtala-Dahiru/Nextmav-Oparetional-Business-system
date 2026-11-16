import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Container, Section, Eyebrow } from "@/components/public/ui";

export function ConnectedWork() {
  const steps = [
    [
      "Customer",
      "Keep contacts, companies and the sales pipeline together.",
      "crm",
    ],
    [
      "Project",
      "Organize delivery with tasks, milestones and time entries.",
      "projects",
    ],
    ["Team", "Assign work and discuss it in shared channels.", "people"],
    ["Invoice", "Track line items, payments and customer balances.", "finance"],
    [
      "Client portal",
      "Give customers access to their own support tickets.",
      "support",
    ],
  ];
  return (
    <Section className="nm-connected-work" aria-labelledby="connected-work">
      <Container>
        <Eyebrow>From relationship to delivery</Eyebrow>
        <h2 id="connected-work" className="nm-heading-lg">
          The handoff is where
          <br />
          <span className="nm-serif">connected work matters.</span>
        </h2>
        <p className="nm-lead nm-connected-intro">
          Keep related work in the same platform, with shared customer records
          and access controls. These are existing capability areas; this
          sequence is not an automated workflow.
        </p>
        <ol className="nm-workflow">
          {steps.map(([name, description, id], i) => (
            <li key={id}>
              <span className="nm-mono">0{i + 1}</span>
              <h3>
                <Link href={`/features#${id}`}>
                  {name}
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </h3>
              <p>{description}</p>
            </li>
          ))}
        </ol>
      </Container>
    </Section>
  );
}
